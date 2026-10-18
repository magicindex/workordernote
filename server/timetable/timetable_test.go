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
