package timetable

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func callQuery(t *testing.T, handler gin.HandlerFunc, method, body, query string, userID uint, p params) (int, map[string]interface{}) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(method, "/api/timetable/test?"+query, strings.NewReader(body))
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

func TestWeekSnapshotsIndependentAndPastReadOnly(t *testing.T) {
	db := newTestDB(t)
	_, created := call(t, handleCreateTable(db), http.MethodPost, `{"name":"哥哥"}`, 7, nil)
	tableID := dataID(t, created)

	entryBody := `{"title":"数学","kind":"course","weekday":1,"start_time":"08:00","end_time":"08:45"}`
	status, entry := call(t, handleCreateEntry(db), http.MethodPost, entryBody, 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("本周建课失败：%d %v", status, entry)
	}
	entryID := dataID(t, entry)

	next := weekStartOf(time.Now().AddDate(0, 0, 7))
	status, nextDetail := callQuery(t, handleGetTable(db), http.MethodGet, "", "week="+next, 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("读下一周失败：%d %v", status, nextDetail)
	}
	data := nextDetail["data"].(map[string]interface{})
	rows := data["entries"].([]interface{})
	if len(rows) != 1 {
		t.Fatalf("下一周应继承 1 条，实际 %d", len(rows))
	}
	if data["week_start"] != next || data["past"] != false {
		t.Errorf("下周元信息不对：%v", data)
	}
	nextID := uint(rows[0].(map[string]interface{})["id"].(float64))
	if nextID == 0 {
		t.Fatal("下一周条目没有 id")
	}

	// 改下一周不影响本周。
	status, _ = call(t, handleUpdateEntry(db), http.MethodPatch, `{"title":"高数"}`, 7, params{"id": uintString(nextID)})
	if status != http.StatusOK {
		t.Fatalf("改下周课程失败：%d", status)
	}
	_, currentDetail := call(t, handleGetTable(db), http.MethodGet, "", 7, params{"id": tableID})
	currentRows := currentDetail["data"].(map[string]interface{})["entries"].([]interface{})
	if got := currentRows[0].(map[string]interface{})["title"]; got != "数学" {
		t.Errorf("本周课程被下周编辑影响：%v", got)
	}

	// 更早一周没有快照，保持空白且只读。
	past := weekStartOf(time.Now().AddDate(0, 0, -21))
	status, pastDetail := callQuery(t, handleGetTable(db), http.MethodGet, "", "week="+past, 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("读历史周失败：%d", status)
	}
	pdata := pastDetail["data"].(map[string]interface{})
	if pdata["past"] != true || len(pdata["entries"].([]interface{})) != 0 {
		t.Errorf("历史周应为空且只读：%v", pdata)
	}
	status, _ = callQuery(t, handleCreateEntry(db), http.MethodPost, entryBody, "week="+past, 7, params{"id": tableID})
	if status != http.StatusForbidden {
		t.Errorf("历史周建课应 403，实际 %d", status)
	}
	_ = entryID
}

func TestLegacyEntriesMoveToCurrentWeek(t *testing.T) {
	db := newTestDB(t)
	_, created := call(t, handleCreateTable(db), http.MethodPost, `{"name":"哥哥"}`, 7, nil)
	tableID := dataID(t, created)
	tableIDNum := uint(mustFloat(created["data"].(map[string]interface{})["id"]))
	row := TimetableEntry{UserID: 7, TimetableID: tableIDNum, Title: "旧课", Kind: KindCourse,
		Weekday: 2, StartTime: "09:00", EndTime: "09:45"}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	status, detail := call(t, handleGetTable(db), http.MethodGet, "", 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("读表失败：%d", status)
	}
	if n := len(detail["data"].(map[string]interface{})["entries"].([]interface{})); n != 1 {
		t.Fatalf("旧条目应归入本周，实际 %d", n)
	}
	var got TimetableEntry
	db.First(&got, row.ID)
	if got.WeekStart != CurrentWeekStart() {
		t.Errorf("旧条目 week_start=%q，期望 %q", got.WeekStart, CurrentWeekStart())
	}
}

func TestBatchShareManyTables(t *testing.T) {
	db := newTestDB(t)
	seedUser(t, db, 7, "owner")
	seedUser(t, db, 8, "reader")
	_, a := call(t, handleCreateTable(db), http.MethodPost, `{"name":"哥哥"}`, 7, nil)
	_, b := call(t, handleCreateTable(db), http.MethodPost, `{"name":"妹妹"}`, 7, nil)
	aid := uint(mustFloat(a["data"].(map[string]interface{})["id"]))
	bid := uint(mustFloat(b["data"].(map[string]interface{})["id"]))

	body := `{"username":"reader","permission":"read","timetable_ids":[` + uintString(aid) + `,` + uintString(bid) + `]}`
	status, res := call(t, handleBatchShare(db), http.MethodPost, body, 7, nil)
	if status != http.StatusOK {
		t.Fatalf("批量共享失败：%d %v", status, res)
	}
	if added := res["data"].(map[string]interface{})["added"]; added != float64(2) {
		t.Errorf("应新增 2 条，实际 %v", added)
	}
	status, list := call(t, handleListAllShares(db), http.MethodGet, "", 7, nil)
	if status != http.StatusOK || len(list["data"].(map[string]interface{})["shares"].([]interface{})) != 2 {
		t.Fatalf("聚合共享列表不对：%d %v", status, list)
	}
	status, res = call(t, handleBatchShare(db), http.MethodPost, body, 7, nil)
	if status != http.StatusOK {
		t.Fatalf("重复批量应更新权限：%d", status)
	}
	// 改成读写
	body2 := `{"username":"reader","permission":"write","timetable_ids":[` + uintString(aid) + `]}`
	status, res = call(t, handleBatchShare(db), http.MethodPost, body2, 7, nil)
	if status != http.StatusOK {
		t.Fatalf("批量改权限失败：%d", status)
	}
	var share TimetableShare
	db.Where("timetable_id = ? AND user_id = ?", aid, 8).First(&share)
	if share.Permission != PermissionWrite {
		t.Errorf("权限应更新为 write，实际 %q", share.Permission)
	}
	// 不能共享给自己
	status, _ = call(t, handleBatchShare(db), http.MethodPost,
		`{"username":"owner","permission":"read","timetable_ids":[`+uintString(aid)+`]}`, 7, nil)
	if status != http.StatusBadRequest {
		t.Errorf("共享给自己应 400，实际 %d", status)
	}
}

func mustFloat(v interface{}) float64 { f, _ := v.(float64); return f }
func uintString(v uint) string        { return fmt.Sprintf("%d", v) }
