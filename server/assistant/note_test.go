package assistant

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"smallgo/server/reminder"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// jsonString 把一段文本变成能塞进请求体里的 JSON 字符串（带引号、转义）。
func jsonString(t *testing.T, value string) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("拼请求体失败：%v", err)
	}
	return string(raw)
}

// hasRoute 判断路由表里有没有「METHOD /path」这一条。
func hasRoute(routes gin.RoutesInfo, want string) bool {
	for _, route := range routes {
		if route.Method+" "+route.Path == want {
			return true
		}
	}
	return false
}

// registerNoteSaver 把真实的落库那一步接上——等价于 server/main.go 启动时注入的
// 那一句（reminder.CreateNote）。assistant 自己不 import reminder（reminder 的
// 测试 import 根包、根包 import assistant，直接依赖会绕成 import cycle），
// 所以这里补上，测到的就是「接口 + 自动标签 + 真进记事本」整条链。
func registerNoteSaver(t *testing.T) {
	t.Helper()
	RegisterNoteSaver(func(db *gorm.DB, userID uint, title, notes, originClientID string) (SavedNote, error) {
		item, err := reminder.CreateNote(db, userID, title, notes, originClientID)
		if err != nil {
			return SavedNote{}, err
		}
		return SavedNote{ID: item.ID, Title: item.Title, ListID: item.ListID, ListName: item.ListName}, nil
	})
	t.Cleanup(func() { RegisterNoteSaver(nil) })
}

// postNoteAs 以某个用户的身份调保存接口（生产里 userID 由鉴权中间件塞进上下文，
// 单元测试里手动放一个）。
func postNoteAs(t *testing.T, db *gorm.DB, userID uint, body string) (int, map[string]interface{}) {
	t.Helper()
	registerNoteSaver(t)
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/assistant/notes", strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Request.Header.Set("X-Client-Id", "test-tab")
	ctx.Set("userID", userID)
	handleSaveNote(db)(ctx)

	var parsed map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("响应不是合法 JSON: %v（%s）", err, recorder.Body.String())
	}
	return recorder.Code, parsed
}

// TestNoteTagsAreGeneratedFromContent 标签是扫「问 + 答」自动认出来的：
// 固定的「AI小秘」在前，内容里的人话认出来的在后，且同一轮最多三个。
func TestNoteTagsAreGeneratedFromContent(t *testing.T) {
	cases := []struct {
		name     string
		question string
		answer   string
		hint     string
		expected []string
	}{
		{"问的是周报", "写这周的周报", "本周完成 3 项，还有 4 项没做完", "", []string{"AI小秘", "周报"}},
		{"问不出来看回答", "今天该先做什么", "黄河农场大楼 wifi 覆盖优化已逾期 2 天", "", []string{"AI小秘", "待办"}},
		{"答里有账单", "", "10 月信用卡还款还剩 3 天", "", []string{"AI小秘", "账单"}},
		{"口径来自面板", "", "完成 3 项、未完成 4 项", "week", []string{"AI小秘", "周报"}},
		{"年月口径", "", "这一段是今年的汇总", "year", []string{"AI小秘", "年报"}},
		{"认不出来只留一个", "你好", "好的", "", []string{"AI小秘"}},
		{"最多三个", "本周周报、本月月报、今年年报、总结、待办、账单", "", "", []string{"AI小秘", "周报", "月报"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tags := noteTags(tc.question, tc.answer, tc.hint)
			if len(tags) != len(tc.expected) {
				t.Fatalf("标签应当是 %v，实际 %v", tc.expected, tags)
			}
			for i, tag := range tc.expected {
				if tags[i] != tag {
					t.Fatalf("标签应当是 %v，实际 %v", tc.expected, tags)
				}
			}
			if len(tags) > noteMaxTags {
				t.Errorf("标签最多 %d 个，实际 %d 个：%v", noteMaxTags, len(tags), tags)
			}
		})
	}
}

// TestNoteSummaryCleansMarkdown 标题取的是回答的第一行内容：Markdown 记号、
// 行首序号都去掉，太长按字符截断（补省略号）。
func TestNoteSummaryCleansMarkdown(t *testing.T) {
	cases := []struct {
		name     string
		text     string
		expected string
	}{
		{"标题井号", "## 本周工作总结\n\n一、完成的：3 条", "本周工作总结"},
		{"行首序号", "1. 先处理利泉村 AP 故障（截止 23:59）", "先处理利泉村 AP 故障（截止 23:59）"},
		{"粗体与行内码", "**结论**：今天只做这一件 `work`", "结论：今天只做这一件 work"},
		{"列表点", "- 黄河农场大楼 wifi 覆盖", "黄河农场大楼 wifi 覆盖"},
		{"跳过空行", "\n\n   \n小秘的结论在这", "小秘的结论在这"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := noteSummary(tc.text); got != tc.expected {
				t.Errorf("摘要应当是 %q，实际 %q", tc.expected, got)
			}
		})
	}

	long := strings.Repeat("很长的一段内容", 20)
	got := noteSummary(long)
	if runes := []rune(got); len(runes) != noteTitleRunes+1 || !strings.HasSuffix(got, "…") {
		t.Errorf("超长摘要应当截到 %d 字并补省略号，实际 %d 字：%q", noteTitleRunes, len(runes), got)
	}
}

// TestBuildSavedNoteShape 标题与备注的结构：标题=自动标签+摘要，备注=标签行+
// 来源行+原文；原文一个字都不能少（用户要的是存下来后还能看全）。
func TestBuildSavedNoteShape(t *testing.T) {
	at := time.Date(2026, 10, 17, 7, 41, 0, 0, time.FixedZone("CST", 8*3600))
	answer := "本周完成 3 项，还有 4 项没做完。\n\n下一周可以从逾期的两件开始。"
	title, notes, tags := buildSavedNote(answer, "写这周的周报", "week", at)

	if !strings.HasPrefix(title, "#AI小秘 #周报 ") {
		t.Errorf("标题应当以自动标签开头，实际 %q", title)
	}
	if !strings.Contains(title, "本周完成 3 项") {
		t.Errorf("标题应当带上摘要，实际 %q", title)
	}
	if len([]rune(title)) > noteTitleLimit {
		t.Errorf("标题不该超过 %d 字，实际 %d 字", noteTitleLimit, len([]rune(title)))
	}
	for _, want := range []string{
		"标签：#AI小秘 #周报",
		"来自 AI 小秘对话 · 2026-10-17 07:41",
		answer,
	} {
		if !strings.Contains(notes, want) {
			t.Errorf("备注里应当有 %q，实际：\n%s", want, notes)
		}
	}
	if len(tags) != 2 || tags[0] != noteSourceTag {
		t.Errorf("标签应当是 [AI小秘 周报]，实际 %v", tags)
	}
}

// TestSaveNoteHandlerStoresDraftInNotebook 端到端：存下来的是一条真正的记事
// ——落在「记事本」那一栏、kind=note、创建即完成（与界面里新建记事同一套）。
func TestSaveNoteHandlerStoresDraftInNotebook(t *testing.T) {
	db := newTestDB(t)
	const userID = uint(7)
	answer := "本周完成 3 项，还有 4 项没做完。"

	status, parsed := postNoteAs(t, db, userID,
		`{"text":`+jsonString(t, answer)+`,"question":"写这周的周报","hint":"week"}`)
	if status != http.StatusOK {
		t.Fatalf("保存应当成功 200，实际 %d（%v）", status, parsed)
	}
	data, _ := parsed["data"].(map[string]interface{})
	id, _ := data["id"].(float64)
	if id == 0 {
		t.Fatalf("响应里应当有新记事的 id：%v", parsed)
	}
	savedTitle, _ := data["title"].(string)
	if !strings.HasPrefix(savedTitle, "#AI小秘 #周报 ") {
		t.Errorf("响应标题应当是自动生成的标签+摘要，实际 %q", savedTitle)
	}

	var item reminder.Reminder
	if err := db.First(&item, id).Error; err != nil {
		t.Fatalf("记事没落库：%v", err)
	}
	if item.Kind != reminder.KindNote {
		t.Errorf("应当存成记事（kind=note），实际 %q", item.Kind)
	}
	if item.UserID != userID {
		t.Errorf("记事应当属于发起保存的那个人（%d），实际 %d", userID, item.UserID)
	}
	if item.CompletedAt == nil {
		t.Errorf("记事创建即完成（列表里直接进「已完成」的记事），completed_at 不该为空")
	}
	var bucket reminder.List
	if err := db.First(&bucket, item.ListID).Error; err != nil {
		t.Fatalf("记事该落在某一栏里：%v", err)
	}
	if bucket.Template != "notebook" {
		t.Errorf("记事应当落在「随手记事本」那一栏，实际落在 template=%q 的《%s》", bucket.Template, bucket.Name)
	}
	if !strings.Contains(item.Notes, answer) {
		t.Errorf("备注里应当留着回答原文，实际：\n%s", item.Notes)
	}
	if !strings.Contains(item.Notes, "标签：#AI小秘 #周报") {
		t.Errorf("备注里应当有标签行，实际：\n%s", item.Notes)
	}

	// 列表接口（「随手记事本」页最终读的就是它）能查到这条记事。
	var listed reminder.Reminder
	if err := db.Where("user_id = ? AND list_id = ? AND kind = ?", userID, bucket.ID, reminder.KindNote).
		Order("id DESC").First(&listed).Error; err != nil {
		t.Fatalf("记事本该在记事本列表里：%v", err)
	}
	if listed.ID != item.ID {
		t.Errorf("记事本里最新的那条应当是刚存的这条（%d），实际 %d", item.ID, listed.ID)
	}
}

// TestSaveNoteHandlerRejectsBadInput 空内容、超长、格式不对都要当面拒绝，
// 不能默默存一条空记事。
func TestSaveNoteHandlerRejectsBadInput(t *testing.T) {
	db := newTestDB(t)
	cases := []struct {
		name string
		body string
	}{
		{"空内容", `{"text":"   ","question":"你好"}`},
		{"没有 text", `{"question":"你好"}`},
		{"超长", `{"text":` + jsonString(t, strings.Repeat("长", maxNoteRunes+1)) + `}`},
		{"不是 JSON", `text=你好`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, parsed := postNoteAs(t, db, 7, tc.body)
			if status != http.StatusBadRequest {
				t.Fatalf("应当 400 拒绝，实际 %d（%v）", status, parsed)
			}
			var count int64
			db.Model(&reminder.Reminder{}).Count(&count)
			if count != 0 {
				t.Errorf("被拒绝的请求不该留下记事，实际存了 %d 条", count)
			}
		})
	}
}

// TestSaveNoteRouteIsRegistered 保存接口挂在登录用户组（自己的数据自己存）。
func TestSaveNoteRouteIsRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	auth := router.Group("/api")
	admin := router.Group("/api/admin")
	RegisterRoutes(auth, admin, newTestDB(t))

	registered := []string{
		"POST /api/assistant/notes",
		"POST /api/assistant/chat",
		"GET /api/assistant/status",
	}
	for _, want := range registered {
		if !hasRoute(router.Routes(), want) {
			t.Errorf("路由表里应当有 %s", want)
		}
	}
	// 保存记事是普通用户的功能，不该落到管理员组上。
	for _, route := range router.Routes() {
		if route.Path == "/api/admin/assistant/notes" {
			t.Errorf("保存记事不该挂管理员组：%s", route.Path)
		}
	}
}
