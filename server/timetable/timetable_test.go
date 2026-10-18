package timetable

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"smallgo/server/database"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := database.InitDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("init db: %v", err)
	}
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

type params map[string]string

func call(t *testing.T, handler gin.HandlerFunc, method, body string, userID uint, p params) (int, map[string]interface{}) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(method, "/api/timetable/test", strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("userID", userID)
	for k, v := range p {
		ctx.Params = append(ctx.Params, gin.Param{Key: k, Value: v})
	}
	handler(ctx)
	var parsed map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("响应不是合法 JSON: %v（%s）", err, recorder.Body.String())
	}
	return recorder.Code, parsed
}

func dataID(t *testing.T, parsed map[string]interface{}) string {
	t.Helper()
	data, _ := parsed["data"].(map[string]interface{})
	if data == nil {
		t.Fatalf("响应缺少 data：%v", parsed)
	}
	n, ok := data["id"].(float64)
	if !ok {
		t.Fatalf("响应缺少 id：%v", parsed)
	}
	return fmt.Sprintf("%.0f", n)
}

func TestTimetableTablesAndEntries(t *testing.T) {
	db := newTestDB(t)

	status, created := call(t, handleCreateTable(db), http.MethodPost, `{"name":" 哥哥 "}`, 7, nil)
	if status != http.StatusOK {
		t.Fatalf("建表应当 200，实际 %d（%v）", status, created)
	}
	tableID := dataID(t, created)
	if name := created["data"].(map[string]interface{})["name"]; name != "哥哥" {
		t.Errorf("表名应当去掉首尾空格，实际 %v", name)
	}

	// 另一张表：用来验「多张表」与条目归属。
	status, second := call(t, handleCreateTable(db), http.MethodPost, `{"name":"妹妹"}`, 7, nil)
	if status != http.StatusOK {
		t.Fatalf("建第二张表应当 200，实际 %d", status)
	}
	secondID := dataID(t, second)

	status, listed := call(t, handleListTables(db), http.MethodGet, "", 7, nil)
	if status != http.StatusOK {
		t.Fatalf("列表应当 200，实际 %d", status)
	}
	tables := listed["data"].(map[string]interface{})["tables"].([]interface{})
	if len(tables) != 2 {
		t.Fatalf("应当有两张表，实际 %d", len(tables))
	}

	entryBody := `{"title":"数学","kind":"course","weekday":1,"start_time":"08:00","end_time":"08:45","location":"三班","teacher":"李老师"}`
	status, entry := call(t, handleCreateEntry(db), http.MethodPost, entryBody, 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("建课程应当 200，实际 %d（%v）", status, entry)
	}
	if kind := entry["data"].(map[string]interface{})["kind"]; kind != KindCourse {
		t.Errorf("类型应当为 course，实际 %v", kind)
	}

	status, _ = call(t, handleCreateEntry(db), http.MethodPost,
		`{"title":"机器人社团","kind":"activity","weekday":5,"start_time":"16:00","end_time":"17:30"}`, 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("建课外活动应当 200，实际 %d", status)
	}

	// 读回来：两张表的条目互不串。
	_, detail := call(t, handleGetTable(db), http.MethodGet, "", 7, params{"id": tableID})
	entries := detail["data"].(map[string]interface{})["entries"].([]interface{})
	if len(entries) != 2 {
		t.Fatalf("第一张表应当有 2 条，实际 %d", len(entries))
	}
	_, other := call(t, handleGetTable(db), http.MethodGet, "", 7, params{"id": secondID})
	if n := len(other["data"].(map[string]interface{})["entries"].([]interface{})); n != 0 {
		t.Fatalf("第二张表应当为空，实际 %d", n)
	}

	// 别人的账号读不到、也改不了这张表。
	status, _ = call(t, handleGetTable(db), http.MethodGet, "", 8, params{"id": tableID})
	if status != http.StatusNotFound {
		t.Errorf("别的账号读表应当 404，实际 %d", status)
	}
	entryID := dataID(t, entry)
	status, _ = call(t, handleUpdateEntry(db), http.MethodPatch, `{"title":"偷改"}`, 8, params{"id": entryID})
	if status != http.StatusNotFound {
		t.Errorf("别的账号改条目应当 404，实际 %d", status)
	}

	// 校验：时间格式、结束早于开始、类型白名单。
	for _, bad := range []string{
		`{"title":"语文","weekday":2,"start_time":"8:00","end_time":"09:00"}`,
		`{"title":"语文","weekday":2,"start_time":"09:00","end_time":"09:00"}`,
		`{"title":"语文","kind":"club","weekday":2,"start_time":"09:00","end_time":"10:00"}`,
		`{"title":"语文","weekday":8,"start_time":"09:00","end_time":"10:00"}`,
	} {
		status, parsed := call(t, handleCreateEntry(db), http.MethodPost, bad, 7, params{"id": tableID})
		if status != http.StatusBadRequest {
			t.Errorf("非法条目应当 400，实际 %d（%v）body=%s", status, parsed, bad)
		}
	}

	// 部分更新只改传进来的字段。
	status, updated := call(t, handleUpdateEntry(db), http.MethodPatch, `{"end_time":"09:30"}`, 7, params{"id": entryID})
	if status != http.StatusOK {
		t.Fatalf("改条目应当 200，实际 %d（%v）", status, updated)
	}
	got := updated["data"].(map[string]interface{})
	if got["end_time"] != "09:30" || got["title"] != "数学" || got["teacher"] != "李老师" {
		t.Errorf("部分更新把别的字段弄丢了：%v", got)
	}

	// 删表连条目一起删（且不动别的表）。
	status, _ = call(t, handleDeleteTable(db), http.MethodDelete, "", 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("删表应当 200，实际 %d", status)
	}
	var left int64
	db.Model(&TimetableEntry{}).Where("timetable_id = ?", tableID).Count(&left)
	if left != 0 {
		t.Errorf("删表后条目应当清空，实际还剩 %d", left)
	}
	_, other = call(t, handleGetTable(db), http.MethodGet, "", 7, params{"id": secondID})
	if other["code"].(float64) != 0 {
		t.Errorf("另一张表不该被连带删掉：%v", other)
	}
}

func TestTimetableNameValidation(t *testing.T) {
	db := newTestDB(t)
	for _, body := range []string{`{"name":"   "}`, `{"name":"` + strings.Repeat("字", maxTableNameRunes+1) + `"}`} {
		status, parsed := call(t, handleCreateTable(db), http.MethodPost, body, 7, nil)
		if status != http.StatusBadRequest {
			t.Errorf("非法表名应当 400，实际 %d（%v）", status, parsed)
		}
	}
}

// 用户 2026-10-19：「节次按当前时间设置成默认」——新建表沿用当前表的节次与课时。
func TestTimetableCreateCopiesPeriods(t *testing.T) {
	db := newTestDB(t)
	_, created := call(t, handleCreateTable(db), http.MethodPost, `{"name":"哥哥"}`, 9, nil)
	id := dataID(t, created)

	if status, _ := call(t, handleUpdateTable(db), http.MethodPatch,
		`{"lesson_minutes":40}`, 9, params{"id": id}); status != http.StatusOK {
		t.Fatalf("改课时失败：%d", status)
	}
	if status, _ := call(t, handleUpdateTable(db), http.MethodPatch,
		`{"periods":[{"section":"early","start":"07:10","end":"07:50"},{"section":"morning","start":"08:10","end":"08:50"}]}`,
		9, params{"id": id}); status != http.StatusOK {
		t.Fatalf("改节次失败：%d", status)
	}

	status, copied := call(t, handleCreateTable(db), http.MethodPost,
		`{"name":"妹妹","copy_from":`+id+`}`, 9, nil)
	if status != http.StatusOK || copied["code"].(float64) != 0 {
		t.Fatalf("复制建表失败：%d %v", status, copied)
	}
	data := copied["data"].(map[string]interface{})
	periods, _ := data["periods"].([]interface{})
	if len(periods) != 2 {
		t.Fatalf("新表应沿用 2 节，实际 %d", len(periods))
	}
	first := periods[0].(map[string]interface{})
	if first["start"] != "07:10" || first["section"] != "early" || data["lesson_minutes"].(float64) != 40 {
		t.Errorf("新表没沿用当前表的节次/课时：%v / %v", first, data["lesson_minutes"])
	}

	// 不属于自己的表 id 不给复制，退回默认骨架。
	status, other := call(t, handleCreateTable(db), http.MethodPost,
		`{"name":"路人","copy_from":999999}`, 9, nil)
	if status != http.StatusOK {
		t.Fatalf("建表失败：%d", status)
	}
	if got := other["data"].(map[string]interface{})["periods"].([]interface{}); len(got) != defaultPeriodCount {
		t.Errorf("非法 copy_from 应退回默认骨架，实际 %d 节", len(got))
	}
}

func TestTimetablePacingDefaultsAndValidation(t *testing.T) {
	db := newTestDB(t)
	status, created := call(t, handleCreateTable(db), http.MethodPost, `{"name":"哥哥"}`, 9, nil)
	if status != http.StatusOK {
		t.Fatalf("建表失败：%d %v", status, created)
	}
	id := dataID(t, created)
	data := created["data"].(map[string]interface{})
	if data["lesson_minutes"].(float64) != defaultLessonMinutes ||
		data["break_minutes"].(float64) != defaultBreakMinutes {
		t.Errorf("默认节奏应当 45/10，实际 %v/%v", data["lesson_minutes"], data["break_minutes"])
	}
	periods, _ := data["periods"].([]interface{})
	if len(periods) != defaultPeriodCount {
		t.Fatalf("建表应当铺 %d 节骨架，实际 %d", defaultPeriodCount, len(periods))
	}
	first := periods[0].(map[string]interface{})
	if first["start"] != "07:30" || first["end"] != "08:15" || first["section"] != "early" {
		t.Errorf("第一节不对：%v", first)
	}

	// 手改每节次的时间段：只改第二节，其余不动，顺序仍要合法。
	status, updated := call(t, handleUpdateTable(db), http.MethodPatch,
		`{"periods":[{"section":"early","start":"08:00","end":"08:45"},{"section":"early","start":"08:50","end":"09:35"},{"section":"morning","start":"09:45","end":"10:30"}]}`,
		9, params{"id": id})
	if status != http.StatusOK || updated["code"].(float64) != 0 {
		t.Fatalf("保存节次失败：%d %v", status, updated)
	}
	up := updated["data"].(map[string]interface{})
	got, _ := up["periods"].([]interface{})
	if len(got) != 3 || up["period_count"].(float64) != 3 {
		t.Fatalf("节次没按预期保存：%v", up["periods"])
	}
	second := got[1].(map[string]interface{})
	if second["start"] != "08:50" || second["end"] != "09:35" {
		t.Errorf("第二节时间不对：%v", second)
	}

	// 结束时早于开始、时间叠在一起、段写错都要拒。
	for name, body := range map[string]string{
		"结束早于开始": `{"periods":[{"section":"early","start":"08:50","end":"08:40"}]}`,
		"节次重叠":   `{"periods":[{"section":"early","start":"08:00","end":"08:45"},{"section":"morning","start":"08:30","end":"09:15"}]}`,
		"段写错":    `{"periods":[{"section":"noon","start":"08:00","end":"08:45"}]}`,
		"时间格式":   `{"periods":[{"section":"early","start":"8:00","end":"08:45"}]}`,
	} {
		status, resp := call(t, handleUpdateTable(db), http.MethodPatch, body, 9, params{"id": id})
		if status != http.StatusBadRequest {
			t.Errorf("%s 应当被拒，实际 %d %v", name, status, resp)
		}
	}

	// 只改课时：每段从自己的第 1 节起算，段结构保持（第一节 08:00 不动）。
	status, updated = call(t, handleUpdateTable(db), http.MethodPatch,
		`{"lesson_minutes":40,"break_minutes":5}`, 9, params{"id": id})
	if status != http.StatusOK || updated["code"].(float64) != 0 {
		t.Fatalf("保存节奏失败：%d %v", status, updated)
	}
	up = updated["data"].(map[string]interface{})
	got, _ = up["periods"].([]interface{})
	if len(got) != 3 {
		t.Fatalf("重排后节数应保持 3，实际 %d", len(got))
	}
	if got[0].(map[string]interface{})["start"] != "08:00" || got[0].(map[string]interface{})["end"] != "08:40" {
		t.Errorf("重排后第一节应保持 08:00 起、40 分钟：%v", got[0])
	}
	if got[1].(map[string]interface{})["start"] != "08:45" {
		t.Errorf("第二节应接 5 分钟课间到 08:45：%v", got[1])
	}
	if up["lesson_minutes"].(float64) != 40 || up["break_minutes"].(float64) != 5 {
		t.Errorf("节奏没保存：%v/%v", up["lesson_minutes"], up["break_minutes"])
	}

	// 课时越界要拒。
	if status, _ := call(t, handleUpdateTable(db), http.MethodPatch,
		`{"lesson_minutes":5}`, 9, params{"id": id}); status != http.StatusBadRequest {
		t.Errorf("课时越界应当被拒，实际 %d", status)
	}
}
