package assistant

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"gorm.io/gorm"
)

// withDigestProvider 替换「工作数据」来源，让 handler 测试不依赖提醒库。
// 每个用例结束时恢复原实现，避免影响同包其它测试。
func withDigestProvider(t *testing.T, result WorkDigestResult) {
	t.Helper()
	previous := workDigestProvider
	workDigestProvider = func(*gorm.DB, uint, WorkDigestRequest) (WorkDigestResult, error) {
		return result, nil
	}
	t.Cleanup(func() { workDigestProvider = previous })
}

// withoutDigestProvider 模拟「数据模块没装配 / 这一轮取不到数据」。
func withoutDigestProvider(t *testing.T) {
	t.Helper()
	previous := workDigestProvider
	workDigestProvider = nil
	t.Cleanup(func() { workDigestProvider = previous })
}

// stubChat 起一个按顺序返回多条回答的假上游，并记录每次收到的请求体。
func stubChat(t *testing.T, replies ...string) (*stubSequence, string) {
	t.Helper()
	seq := &stubSequence{replies: replies}
	upstream := newStubUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		var body chatRequest
		_ = json.NewDecoder(r.Body).Decode(&body)
		seq.bodies = append(seq.bodies, body)
		reply := ""
		if seq.calls < len(seq.replies) {
			reply = seq.replies[seq.calls]
		}
		seq.calls++
		w.Header().Set("Content-Type", "application/json")
		payload, _ := json.Marshal(map[string]interface{}{
			"model":   "deepseek-chat",
			"choices": []map[string]interface{}{{"message": map[string]interface{}{"content": reply}}},
			"usage":   map[string]int{"prompt_tokens": 10, "completion_tokens": 5},
		})
		_, _ = w.Write(payload)
	})
	return seq, upstream.URL
}

type stubSequence struct {
	replies []string
	bodies  []chatRequest
	calls   int
}

func dataOf(t *testing.T, parsed map[string]interface{}) map[string]interface{} {
	t.Helper()
	data, ok := parsed["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("响应缺少 data：%v", parsed)
	}
	return data
}

// 正常回答一次通过时不额外发请求：这是「提升响应速度」的关键——校验只做
// 本地计算，只有不合格才重答。
func TestChatHandlerValidAnswerNeedsNoRepair(t *testing.T) {
	seq, baseURL := stubChat(t, "完成 2 条 [2][3]；没有未完成事项。")
	db := newTestDB(t)
	saveComplete(t, db, baseURL, settingsInput{})
	withDigestProvider(t, groundedDigest())

	status, parsed := postJSON(t, handleChat(db), `{"messages":[{"role":"user","content":"写本周周报"}],"digest":{"option":"week"}}`)
	if status != http.StatusOK {
		t.Fatalf("期望 200，实际 %d（%v）", status, parsed)
	}
	data := dataOf(t, parsed)
	if seq.calls != 1 {
		t.Fatalf("合格回答不应重答，实际上游被调用 %d 次", seq.calls)
	}
	grounding, _ := data["grounding"].(map[string]interface{})
	if grounding["ok"] != true || grounding["repaired"] == true {
		t.Fatalf("合格回答的校验结果不对：%v", grounding)
	}
	sources, _ := data["sources"].([]interface{})
	if len(sources) != 4 {
		t.Fatalf("应当回 4 条来源（1 汇总 + 2 完成 + 1 清单），实际 %d", len(sources))
	}
	first := sources[0].(map[string]interface{})
	if first["id"] != float64(1) || first["kind"] != "summary" {
		t.Fatalf("来源编号与类型不对：%v", first)
	}
}

// 数据冲突场景：第一次回答把完成 2 条说成 9 条，服务端带着违规原因重答一次，
// 最终展示重答后的正确数字。
func TestChatHandlerRepairsConflictingNumbers(t *testing.T) {
	seq, baseURL := stubChat(t,
		"本周完成 9 条 [1]。",
		"本周完成 2 条 [2][3]；没有未完成事项。",
	)
	db := newTestDB(t)
	saveComplete(t, db, baseURL, settingsInput{})
	withDigestProvider(t, groundedDigest())

	status, parsed := postJSON(t, handleChat(db), `{"messages":[{"role":"user","content":"写本周周报"}],"digest":{"option":"week"}}`)
	if status != http.StatusOK {
		t.Fatalf("期望 200，实际 %d（%v）", status, parsed)
	}
	data := dataOf(t, parsed)
	if seq.calls != 2 {
		t.Fatalf("数字冲突应当重答一次，实际上游被调用 %d 次", seq.calls)
	}
	if !strings.Contains(asString(data["reply"]), "完成 2 条") {
		t.Fatalf("最终回答应当使用重答后的正确数字：%v", data["reply"])
	}
	grounding, _ := data["grounding"].(map[string]interface{})
	if grounding["repaired"] != true || grounding["ok"] != true || grounding["fallback"] == true {
		t.Fatalf("重答通过时应当标 repaired=true、ok=true：%v", grounding)
	}
	// 重答请求里要带着上一轮回答与具体的违规原因，模型才知道改什么。
	if len(seq.bodies) < 2 {
		t.Fatal("没有记录到重答请求")
	}
	repaired := seq.bodies[1]
	if len(repaired.Messages) < 3 {
		t.Fatalf("重答请求应当带系统数据 + 原回答 + 纠正指令：%+v", repaired.Messages)
	}
	system := repaired.Messages[0]
	if system.Role != "system" || !strings.Contains(system.Content, "【工作数据】") {
		t.Fatalf("重答时仍要下发真实数据：%+v", system)
	}
	if last := repaired.Messages[len(repaired.Messages)-1]; last.Role != "user" || !strings.Contains(last.Content, "数据校验") {
		t.Fatalf("重答请求缺少违规原因：%+v", last)
	}
}

// 重答仍不合格时不能把编造的回答交给用户：退回按真实数据拼的草稿，并标记 fallback。
func TestChatHandlerFallsBackWhenRepairStillConflicts(t *testing.T) {
	seq, baseURL := stubChat(t,
		"本周完成 9 条 [1]。",
		"本周完成 9 条 [1]，还有一堆没列出来的事。",
	)
	db := newTestDB(t)
	saveComplete(t, db, baseURL, settingsInput{})
	withDigestProvider(t, groundedDigest())

	status, parsed := postJSON(t, handleChat(db), `{"messages":[{"role":"user","content":"写本周周报"}],"digest":{"option":"week"}}`)
	if status != http.StatusOK {
		t.Fatalf("期望 200，实际 %d（%v）", status, parsed)
	}
	data := dataOf(t, parsed)
	if seq.calls != 2 {
		t.Fatalf("应当只重答一次（不无限重试），实际 %d 次", seq.calls)
	}
	reply := asString(data["reply"])
	if strings.Contains(reply, "9 条") {
		t.Fatalf("不合格回答不能返回给用户：%s", reply)
	}
	if !strings.Contains(reply, "工作草稿") || !strings.Contains(reply, "未通过数据校验") {
		t.Fatalf("应当退回数据草稿并说明原因：%s", reply)
	}
	grounding, _ := data["grounding"].(map[string]interface{})
	if grounding["fallback"] != true || grounding["ok"] == true {
		t.Fatalf("兜底时应当标 fallback=true、ok=false：%v", grounding)
	}
}

// 无数据场景：时段里一条记录都没有，模型编了「3 项任务」，重答后改口为没有记录。
func TestChatHandlerEmptyDataIsNotFabricated(t *testing.T) {
	seq, baseURL := stubChat(t,
		"本周完成了 3 项任务 [1]。",
		"已提供的数据中没有相关记录。",
	)
	db := newTestDB(t)
	saveComplete(t, db, baseURL, settingsInput{})
	withDigestProvider(t, emptyDigest())

	status, parsed := postJSON(t, handleChat(db), `{"messages":[{"role":"user","content":"本周做了什么"}],"digest":{"option":"week"}}`)
	if status != http.StatusOK {
		t.Fatalf("期望 200，实际 %d（%v）", status, parsed)
	}
	data := dataOf(t, parsed)
	if seq.calls != 2 {
		t.Fatalf("空数据编造应当触发一次重答，实际 %d 次", seq.calls)
	}
	if reply := asString(data["reply"]); !strings.Contains(reply, "没有相关记录") {
		t.Fatalf("最终回答必须承认没有数据：%s", reply)
	}
	grounding, _ := data["grounding"].(map[string]interface{})
	if grounding["repaired"] != true || grounding["ok"] != true {
		t.Fatalf("重答承认无数据后应当通过：%v", grounding)
	}
}

// 没有模型时直接出草稿：同样要带回来源，用户才能核对。
func TestChatHandlerDraftReturnsSources(t *testing.T) {
	db := newTestDB(t)
	withDigestProvider(t, groundedDigest())

	status, parsed := postJSON(t, handleChat(db), `{"messages":[{"role":"user","content":"写本周周报"}],"digest":{"option":"week"}}`)
	if status != http.StatusOK {
		t.Fatalf("期望 200，实际 %d（%v）", status, parsed)
	}
	data := dataOf(t, parsed)
	if data["mode"] != "draft" {
		t.Fatalf("未启用模型时应当是草稿模式：%v", data["mode"])
	}
	sources, _ := data["sources"].([]interface{})
	if len(sources) != 4 {
		t.Fatalf("草稿也要带来源：%v", data["sources"])
	}
	grounding, _ := data["grounding"].(map[string]interface{})
	if grounding["checked"] != true || grounding["ok"] != true {
		t.Fatalf("草稿由真实数据拼成，校验应当通过：%v", grounding)
	}
}

// 不附数据时不能伪造 sources / grounding，普通聊天照旧。
func TestChatHandlerWithoutDigestHasNoGrounding(t *testing.T) {
	seq, baseURL := stubChat(t, "你好，有什么可以帮你？")
	db := newTestDB(t)
	saveComplete(t, db, baseURL, settingsInput{})

	status, parsed := postJSON(t, handleChat(db), `{"messages":[{"role":"user","content":"你好"}]}`)
	if status != http.StatusOK {
		t.Fatalf("期望 200，实际 %d（%v）", status, parsed)
	}
	data := dataOf(t, parsed)
	if seq.calls != 1 {
		t.Fatalf("普通聊天不该触发重答，实际 %d 次", seq.calls)
	}
	sources, _ := data["sources"].([]interface{})
	if len(sources) != 0 {
		t.Fatalf("没附数据时 sources 应当为空：%v", data["sources"])
	}
	grounding, _ := data["grounding"].(map[string]interface{})
	if grounding["checked"] == true {
		t.Fatalf("没附数据时不该声称校验过：%v", grounding)
	}
}

// 连接池复用：每次对话不再新建 Transport，第二次请求可以走已建立的连接。
func TestNewClientReusesSharedTransport(t *testing.T) {
	c := newClient(Settings{Provider: "custom", BaseURL: "https://example.com/v1", Model: "m", TimeoutSeconds: 30})
	if c.http.Transport != sharedTransport {
		t.Fatal("client 应当复用进程级 sharedTransport，避免每次对话重建连接")
	}
}

// 没有附数据、但问句明显在要记录：模型编了「完成了 3 项」，服务端让它改口。
func TestChatHandlerWithoutDataRefusesFabrication(t *testing.T) {
	seq, baseURL := stubChat(t,
		"你上周完成了 3 项任务，还写了周报。",
		"我现在看不到你的工作记录，请先在面板上选择时间范围再问。",
	)
	db := newTestDB(t)
	saveComplete(t, db, baseURL, settingsInput{})
	withoutDigestProvider(t)

	status, parsed := postJSON(t, handleChat(db), `{"messages":[{"role":"user","content":"我上周做了些什么工作"}]}`)
	if status != http.StatusOK {
		t.Fatalf("期望 200，实际 %d（%v）", status, parsed)
	}
	data := dataOf(t, parsed)
	if seq.calls != 2 {
		t.Fatalf("没数据却编了条数，应当触发一次改口，实际 %d 次", seq.calls)
	}
	if reply := asString(data["reply"]); !strings.Contains(reply, "看不到") {
		t.Fatalf("最终回答必须承认看不到记录：%s", reply)
	}
	grounding, _ := data["grounding"].(map[string]interface{})
	if grounding["checked"] != true || grounding["repaired"] != true || grounding["ok"] != true {
		t.Fatalf("改口通过后应当标记 repaired=true：%v", grounding)
	}
}

// 没数据时模型连续编，最终给安全文案，不把编造内容交给用户。
func TestChatHandlerWithoutDataFallsBack(t *testing.T) {
	seq, baseURL := stubChat(t,
		"你完成了 3 项任务 [1]。",
		"你完成了 5 项任务 [2]。",
	)
	db := newTestDB(t)
	saveComplete(t, db, baseURL, settingsInput{})
	withoutDigestProvider(t)

	status, parsed := postJSON(t, handleChat(db), `{"messages":[{"role":"user","content":"总结一下我的工作"}]}`)
	if status != http.StatusOK {
		t.Fatalf("期望 200，实际 %d（%v）", status, parsed)
	}
	data := dataOf(t, parsed)
	if seq.calls != 2 {
		t.Fatalf("只应改口一次，实际 %d 次", seq.calls)
	}
	reply := asString(data["reply"])
	if strings.Contains(reply, "5 项") {
		t.Fatalf("编造内容不能返回给用户：%s", reply)
	}
	if !strings.Contains(reply, "选择时间范围") {
		t.Fatalf("应当给用户一个补数据的下一步：%s", reply)
	}
	grounding, _ := data["grounding"].(map[string]interface{})
	if grounding["fallback"] != true {
		t.Fatalf("应当标记 fallback=true：%v", grounding)
	}
}

func TestChatContextCanceledIsExplained(t *testing.T) {
	_, baseURL := stubChat(t, "不该被返回")
	db := newTestDB(t)
	saveComplete(t, db, baseURL, settingsInput{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := newClient(loadSettings(db)).Chat(ctx, []Message{{Role: "user", Content: "hi"}})
	if err == nil {
		t.Fatal("ctx 已取消时应当返回错误")
	}
	if !strings.Contains(err.Error(), "取消") {
		t.Fatalf("要说明是请求被取消，而不是模型慢：%q", err.Error())
	}
}

func TestChatEmptyResponseBodyIsExplained(t *testing.T) {
	upstream := newStubUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	db := newTestDB(t)
	saveComplete(t, db, upstream.URL, settingsInput{})

	_, err := newClient(loadSettings(db)).Chat(context.Background(), []Message{{Role: "user", Content: "hi"}})
	if err == nil {
		t.Fatal("空响应应当返回错误")
	}
	if !strings.Contains(err.Error(), "空响应") {
		t.Fatalf("要明确是上游返回空响应：%q", err.Error())
	}
}
