package assistant

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"smallgo/server/sysconfig"

	"gorm.io/gorm"
)

// TestThinkingPayloadModes 锁住三种显示口径的裁剪规则：只有对话（丢掉）、
// 简洁思考（压成一行、超长截断并标记）、详细思考过程（原样）。
func TestThinkingPayloadModes(t *testing.T) {
	long := strings.Repeat("想", briefThinkingRunes+30)
	cases := []struct {
		name          string
		mode          string
		reasoning     string
		want          string
		wantTruncated bool
	}{
		{name: "只有对话：思维链直接丢掉", mode: ThinkingOff, reasoning: "先看看用户要什么", want: ""},
		{name: "只有对话：上游没给也是空", mode: ThinkingOff, reasoning: "", want: ""},
		{name: "简洁思考：换行压成一行", mode: ThinkingBrief, reasoning: "第一步\n\n第二步  第三步", want: "第一步 第二步 第三步"},
		{name: "简洁思考：超长截断并标记", mode: ThinkingBrief, reasoning: long, want: string([]rune(long)[:briefThinkingRunes]), wantTruncated: true},
		{name: "详细思考过程：原样给", mode: ThinkingFull, reasoning: "第一步\n第二步", want: "第一步\n第二步"},
		{name: "详细思考过程：去掉首尾空白", mode: ThinkingFull, reasoning: "  想好了  ", want: "想好了"},
		{name: "认不出的档位退回默认（简洁思考）", mode: "wild", reasoning: "a\nb", want: "a b"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, truncated := thinkingPayload(tc.mode, tc.reasoning)
			if got != tc.want {
				t.Errorf("thinkingPayload(%q) = %q，期望 %q", tc.mode, got, tc.want)
			}
			if truncated != tc.wantTruncated {
				t.Errorf("thinkingPayload(%q) truncated = %t，期望 %t", tc.mode, truncated, tc.wantTruncated)
			}
		})
	}
}

func TestNormalizeThinkingMode(t *testing.T) {
	cases := []struct{ in, want string }{
		{"off", ThinkingOff},
		{"brief", ThinkingBrief},
		{"full", ThinkingFull},
		{" full ", ThinkingFull},
		{"", defaultThinkingMode},
		{"FULL", defaultThinkingMode},
		{"详细", defaultThinkingMode},
	}
	for _, tc := range cases {
		if got := normalizeThinkingMode(tc.in); got != tc.want {
			t.Errorf("normalizeThinkingMode(%q) = %q，期望 %q", tc.in, got, tc.want)
		}
	}
	if defaultThinkingMode != ThinkingBrief {
		t.Errorf("默认口径应当是简洁思考，实际 %s", defaultThinkingMode)
	}
}

// TestRegistryRegistersThinkingModeAsInternalSelect 后台偏好的登记必须齐：
// 三个档位 + 默认简洁思考，并且同样是 Internal（否则会出现在 /api/configs/meta
// 的通用列表里）。
func TestRegistryRegistersThinkingModeAsInternalSelect(t *testing.T) {
	var def *sysconfig.ConfigDef
	for _, item := range sysconfig.ListConfigs(sysconfig.ScopeSystem) {
		if item.Key == keyThinkingMode {
			copied := item
			def = &copied
			break
		}
	}
	if def == nil {
		t.Fatalf("配置项 %s 没有注册", keyThinkingMode)
	}
	if !def.Internal {
		t.Errorf("配置项 %s 必须登记为 Internal", keyThinkingMode)
	}
	if def.Default != defaultThinkingMode {
		t.Errorf("默认值应当是 %s，实际 %v", defaultThinkingMode, def.Default)
	}
	if len(def.Options) != len(thinkingModeOptions) {
		t.Fatalf("可选值数量不一致：注册表 %d 个，代码 %d 个", len(def.Options), len(thinkingModeOptions))
	}
	for i, opt := range thinkingModeOptions {
		if def.Options[i] != opt {
			t.Errorf("第 %d 个选项应为 %s，实际 %s", i, opt, def.Options[i])
		}
	}
}

// TestSaveSettingsStoresThinkingMode 保存/读取 / 非法值拒绝 / 留空沿用旧值。
func TestSaveSettingsStoresThinkingMode(t *testing.T) {
	db := newTestDB(t)
	saved := saveComplete(t, db, "https://api.deepseek.com/v1", settingsInput{})
	if saved.ThinkingMode != defaultThinkingMode {
		t.Fatalf("没写过的库应当落到默认 %s，实际 %q", defaultThinkingMode, saved.ThinkingMode)
	}
	if got := loadSettings(db).ThinkingMode; got != defaultThinkingMode {
		t.Fatalf("读回来应当是 %s，实际 %q", defaultThinkingMode, got)
	}

	next, err := saveSettings(db, settingsInput{Enabled: true, Provider: "custom", BaseURL: "https://api.deepseek.com/v1", Model: "deepseek-chat", ThinkingMode: ThinkingFull})
	if err != nil {
		t.Fatalf("保存 full 失败：%v", err)
	}
	if next.ThinkingMode != ThinkingFull || loadSettings(db).ThinkingMode != ThinkingFull {
		t.Fatalf("full 没有落库：%+v / %q", next, loadSettings(db).ThinkingMode)
	}

	// 留空 = 不改（面板没带这一项时不能把它重置回默认）。
	kept, err := saveSettings(db, settingsInput{Enabled: true, Provider: "custom", BaseURL: "https://api.deepseek.com/v1", Model: "deepseek-chat"})
	if err != nil {
		t.Fatalf("留空保存失败：%v", err)
	}
	if kept.ThinkingMode != ThinkingFull {
		t.Fatalf("留空应当沿用旧值 full，实际 %q", kept.ThinkingMode)
	}

	if _, err := saveSettings(db, settingsInput{Enabled: true, Provider: "custom", BaseURL: "https://api.deepseek.com/v1", Model: "deepseek-chat", ThinkingMode: "wild"}); err == nil {
		t.Fatalf("非法档位应当被拒绝")
	}
	if got := loadSettings(db).ThinkingMode; got != ThinkingFull {
		t.Fatalf("被拒绝的保存不该改动库里的值，实际 %q", got)
	}
}

// TestChatHandlerReturnsThinkingPerMode 面板三条口径的端到端行为：同一个上游回复
// （带 reasoning），off 不给、brief 给一行、full 给整段；同时把实际用的档位回传，
// 面板据此标注。
func TestChatHandlerReturnsThinkingPerMode(t *testing.T) {
	reasoning := "用户在打招呼\n先自我介绍再问要不要帮忙"
	upstream := newStubUpstream(t, func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"model": "deepseek-reasoner",
			"choices": []map[string]interface{}{{
				"message": map[string]string{"role": "assistant", "content": "你好，我是小秘", "reasoning": reasoning},
			}},
			"usage": map[string]int{"prompt_tokens": 9, "completion_tokens": 6},
		})
	})
	db := newTestDB(t)
	saveComplete(t, db, upstream.URL, settingsInput{})

	chat := func(body string) map[string]interface{} {
		t.Helper()
		status, parsed := postJSON(t, handleChat(db), body)
		if status != http.StatusOK {
			t.Fatalf("期望 200，实际 %d（%v）", status, parsed)
		}
		data, ok := parsed["data"].(map[string]interface{})
		if !ok {
			t.Fatalf("响应缺少 data：%v", parsed)
		}
		return data
	}

	// 后台偏好默认 brief；请求里不带 thinking 时按后台走。
	brief := chat(`{"messages":[{"role":"user","content":"你好"}]}`)
	if brief["thinking_mode"] != ThinkingBrief {
		t.Errorf("默认档位应当是 %s，实际 %v", ThinkingBrief, brief["thinking_mode"])
	}
	if brief["thinking"] != "用户在打招呼 先自我介绍再问要不要帮忙" {
		t.Errorf("简洁思考应当压成一行，实际 %v", brief["thinking"])
	}
	if brief["reply"] != "你好，我是小秘" {
		t.Errorf("正式回答不应当被思考过程影响：%v", brief["reply"])
	}

	full := chat(`{"messages":[{"role":"user","content":"你好"}],"thinking":"full"}`)
	if full["thinking"] != reasoning {
		t.Errorf("详细思考过程应当原样给，实际 %v", full["thinking"])
	}

	off := chat(`{"messages":[{"role":"user","content":"你好"}],"thinking":"off"}`)
	if off["thinking"] != "" {
		t.Errorf("只有对话时不该带思维链，实际 %v", off["thinking"])
	}
	if off["thinking_mode"] != ThinkingOff {
		t.Errorf("档位应当是 %s，实际 %v", ThinkingOff, off["thinking_mode"])
	}

	// 后台偏好改了，请求没带 thinking 时跟着变。
	if _, err := saveSettings(db, settingsInput{Enabled: true, Provider: "custom", BaseURL: upstream.URL, Model: "deepseek-chat", ThinkingMode: ThinkingFull}); err != nil {
		t.Fatalf("save: %v", err)
	}
	inherited := chat(`{"messages":[{"role":"user","content":"你好"}]}`)
	if inherited["thinking"] != reasoning {
		t.Errorf("应当按后台偏好给整段思维链，实际 %v", inherited["thinking"])
	}

	// 非法档位（前端写脏）不该 500，而是退回默认。
	dirty := chat(`{"messages":[{"role":"user","content":"你好"}],"thinking":"乱写的"}`)
	if dirty["thinking_mode"] != defaultThinkingMode {
		t.Errorf("非法档位应当退回 %s，实际 %v", defaultThinkingMode, dirty["thinking_mode"])
	}
}

// TestChatParsesReasoningContentField 上游把思维链放在 reasoning_content 里
// （OpenAI 兼容网关常见）时也要能收到。
func TestChatParsesReasoningContentField(t *testing.T) {
	upstream := newStubUpstream(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"model":"gw-model","choices":[{"message":{"content":"答案","reasoning_content":"网关给的思考"}}]}`))
	})
	db := newTestDB(t)
	saveComplete(t, db, upstream.URL, settingsInput{})
	result, err := newClient(loadSettings(db)).Chat(context.Background(), []Message{{Role: "user", Content: "你好"}})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result.Reasoning != "网关给的思考" {
		t.Errorf("reasoning_content 没有解析出来：%q", result.Reasoning)
	}

	// reasoning 优先（两家都给时，Ollama/DeepSeek 原生字段更可信）。
	both := newStubUpstream(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"答案","reasoning":"原生","reasoning_content":"网关"}}]}`))
	})
	db2 := newTestDB(t)
	saveComplete(t, db2, both.URL, settingsInput{})
	result2, err := newClient(loadSettings(db2)).Chat(context.Background(), []Message{{Role: "user", Content: "你好"}})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if result2.Reasoning != "原生" {
		t.Errorf("两个字段都有时应当用 reasoning，实际 %q", result2.Reasoning)
	}
}

// TestChatHandlerDraftHasNoThinking 未接模型时的草稿不是模型写的，没有思维链，
// 但档位照样回传，面板不用为此分叉。
func TestChatHandlerDraftHasNoThinking(t *testing.T) {
	db := newTestDB(t)
	// 草稿分支要有工作数据模块在装配（正常启动时由 server/main.go 注入）。
	RegisterWorkDigestProvider(func(db *gorm.DB, userID uint, req WorkDigestRequest) (WorkDigestResult, error) {
		return WorkDigestResult{Found: true, Option: "week", Label: "本周周报", Completed: 3, Open: 2, Draft: "本周完成 3 项"}, nil
	})
	t.Cleanup(func() { workDigestProvider = nil })
	status, parsed := postJSON(t, handleChat(db), `{"messages":[{"role":"user","content":"本周周报"}],"digest":{"option":"week"},"thinking":"full"}`)
	if status != http.StatusOK {
		t.Fatalf("未接模型时应当回草稿 200，实际 %d（%v）", status, parsed)
	}
	data, _ := parsed["data"].(map[string]interface{})
	if data["mode"] != "draft" {
		t.Fatalf("应当是草稿模式：%v", data)
	}
	if data["thinking"] != "" {
		t.Errorf("草稿不该有思维链，实际 %v", data["thinking"])
	}
	if data["thinking_mode"] != ThinkingFull {
		t.Errorf("档位应当照传 %s，实际 %v", ThinkingFull, data["thinking_mode"])
	}
}

// TestStatusHandlerExposesThinkingMode 面板打开时按后台偏好初始化选择器。
func TestStatusHandlerExposesThinkingMode(t *testing.T) {
	db := newTestDB(t)
	status, parsed := postJSON(t, handleGetSettings(db), `{}`)
	if status != http.StatusOK {
		t.Fatalf("get settings 应当 200，实际 %d", status)
	}
	data, _ := parsed["data"].(map[string]interface{})
	if data["thinking_mode"] != defaultThinkingMode {
		t.Errorf("后台偏好默认应当是 %s，实际 %v", defaultThinkingMode, data["thinking_mode"])
	}
	options, _ := data["thinking_options"].([]interface{})
	if len(options) != 3 {
		t.Errorf("应当给出三个档位供下拉，实际 %v", options)
	}

	// 面板（普通用户可读的状态接口）也要拿到默认档位。
	status, parsed = postJSON(t, handleStatus(db), `{}`)
	if status != http.StatusOK {
		t.Fatalf("status 应当 200，实际 %d", status)
	}
	state, _ := parsed["data"].(map[string]interface{})
	if state["thinking_mode"] != defaultThinkingMode {
		t.Errorf("状态接口应当带上默认档位 %s，实际 %v", defaultThinkingMode, state["thinking_mode"])
	}
}
