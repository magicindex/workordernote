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

func TestWeekParamsNoLongerSwitchWeeks(t *testing.T) {
	db := newTestDB(t)
	_, created := call(t, handleCreateTable(db), http.MethodPost, `{"name":"哥哥"}`, 7, nil)
	tableID := dataID(t, created)

	entryBody := `{"title":"数学","kind":"course","weekday":1,"start_time":"08:00","end_time":"08:45"}`
	status, entry := call(t, handleCreateEntry(db), http.MethodPost, entryBody, 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("本周建课失败：%d %v", status, entry)
	}

	next := weekStartOf(time.Now().AddDate(0, 0, 7))
	status, nextDetail := callQuery(t, handleGetTable(db), http.MethodGet, "", "week="+next, 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("带 week 读表失败：%d %v", status, nextDetail)
	}
	data := nextDetail["data"].(map[string]interface{})
	if data["week_start"] != CurrentWeekStart() || len(data["entries"].([]interface{})) != 1 {
		t.Errorf("week 参数应被忽略、只返回本周：%v", data)
	}
	var weekRows int64
	db.Model(&TimetableWeek{}).Where("timetable_id = ? AND week_start = ?", tableID, next).Count(&weekRows)
	if weekRows != 0 {
		t.Errorf("不应再创建未来周快照，实际 %d 行", weekRows)
	}

	past := weekStartOf(time.Now().AddDate(0, 0, -7))
	status, pastEntry := callQuery(t, handleCreateEntry(db), http.MethodPost, `{"title":"历史补录","kind":"course","weekday":2,"start_time":"09:00","end_time":"09:45"}`, "week="+past, 7, params{"id": tableID})
	if status != http.StatusOK {
		t.Fatalf("旧 week 参数不应阻止建课：%d %v", status, pastEntry)
	}
	id := dataID(t, pastEntry)
	var got TimetableEntry
	if err := db.First(&got, id).Error; err != nil {
		t.Fatal(err)
	}
	if got.WeekStart != CurrentWeekStart() {
		t.Errorf("新条目应归入本周，实际 %q", got.WeekStart)
	}
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

func TestCarriedEntryUIDIsDeterministic(t *testing.T) {
	a := carriedEntryUID("base-uid", "2026-11-02")
	b := carriedEntryUID("base-uid", "2026-11-02")
	c := carriedEntryUID("other-uid", "2026-11-02")
	if len(a) != 40 || a != b || a == c {
		t.Fatalf("跨设备复制 UID 应稳定且可区分：%q %q %q", a, b, c)
	}
}

func TestWeekCarryForwardCopiesLatestPrevious(t *testing.T) {
	db := newTestDB(t)
	table := Timetable{UserID: 1, Name: "测试课表", PeriodCount: 4}
	if err := db.Create(&table).Error; err != nil {
		t.Fatal(err)
	}
	current := CurrentWeekStart()
	if err := ensureWeek(db, table, current); err != nil {
		t.Fatal(err)
	}
	entry := TimetableEntry{
		UserID: 1, TimetableID: table.ID, Title: "数学", Kind: KindCourse,
		Weekday: 1, StartTime: "08:00", EndTime: "08:45", WeekStart: current,
	}
	if err := db.Create(&entry).Error; err != nil {
		t.Fatal(err)
	}

	next := weekStartOf(time.Now().AddDate(0, 0, 7))
	if err := ensureWeek(db, table, next); err != nil {
		t.Fatal(err)
	}
	var copied []TimetableEntry
	if err := db.Where("timetable_id = ? AND week_start = ?", table.ID, next).Find(&copied).Error; err != nil {
		t.Fatal(err)
	}
	if len(copied) != 1 || copied[0].Title != "数学" || copied[0].SyncUID == entry.SyncUID {
		t.Fatalf("下周应复制本周课程并生成新 UID，实际 %+v", copied)
	}

	// 同一周重复调用不能复制第二份。
	if err := ensureWeek(db, table, next); err != nil {
		t.Fatal(err)
	}
	var n int64
	db.Model(&TimetableEntry{}).Where("timetable_id = ? AND week_start = ?", table.ID, next).Count(&n)
	if n != 1 {
		t.Fatalf("同一周应只有一份课程，实际 %d", n)
	}

	// 修改本周（即下周）后，再下一周沿用最新修改。
	if err := db.Model(&TimetableEntry{}).Where("id = ?", copied[0].ID).Update("title", "数学改").Error; err != nil {
		t.Fatal(err)
	}
	after := weekStartOf(time.Now().AddDate(0, 0, 14))
	if err := ensureWeek(db, table, after); err != nil {
		t.Fatal(err)
	}
	var third []TimetableEntry
	if err := db.Where("timetable_id = ? AND week_start = ?", table.ID, after).Find(&third).Error; err != nil {
		t.Fatal(err)
	}
	if len(third) != 1 || third[0].Title != "数学改" {
		t.Fatalf("再下周应沿用最新修改，实际 %+v", third)
	}
}

func TestStaleEmptyFutureWeekRowsDoNotBlockCarryForward(t *testing.T) {
	db := newTestDB(t)
	table := Timetable{UserID: 1, Name: "旧快照", PeriodCount: 4}
	if err := db.Create(&table).Error; err != nil {
		t.Fatal(err)
	}
	current := CurrentWeekStart()
	next := weekStartOf(time.Now().AddDate(0, 0, 7))
	if err := db.Create(&TimetableWeek{TimetableID: table.ID, WeekStart: next}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&TimetableEntry{UserID: 1, TimetableID: table.ID, Title: "语文", Kind: KindCourse,
		Weekday: 1, StartTime: "08:00", EndTime: "08:45", WeekStart: current}).Error; err != nil {
		t.Fatal(err)
	}

	if err := ensureWeek(db, table, current); err != nil {
		t.Fatal(err)
	}
	var stale int64
	db.Model(&TimetableWeek{}).Where("timetable_id = ? AND week_start = ?", table.ID, next).Count(&stale)
	if stale != 0 {
		t.Fatalf("空的未来周记录应被清理，实际 %d 行", stale)
	}
	if err := ensureWeek(db, table, next); err != nil {
		t.Fatal(err)
	}
	var copied int64
	db.Model(&TimetableEntry{}).Where("timetable_id = ? AND week_start = ? AND deleted_at IS NULL", table.ID, next).Count(&copied)
	if copied != 1 {
		t.Fatalf("清理后下周应能自动沿用，实际 %d 条", copied)
	}
}

func TestWeekCarryForwardSkipsDeletedEntries(t *testing.T) {
	db := newTestDB(t)
	table := Timetable{UserID: 1, Name: "删除不沿用", PeriodCount: 4}
	if err := db.Create(&table).Error; err != nil {
		t.Fatal(err)
	}
	current := CurrentWeekStart()
	if err := ensureWeek(db, table, current); err != nil {
		t.Fatal(err)
	}
	entry := TimetableEntry{UserID: 1, TimetableID: table.ID, Title: "已删课", Kind: KindCourse,
		Weekday: 1, StartTime: "08:00", EndTime: "08:45", WeekStart: current}
	if err := db.Create(&entry).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&entry).Error; err != nil {
		t.Fatal(err)
	}
	next := weekStartOf(time.Now().AddDate(0, 0, 7))
	if err := ensureWeek(db, table, next); err != nil {
		t.Fatal(err)
	}
	var n int64
	db.Model(&TimetableEntry{}).Where("timetable_id = ? AND week_start = ?", table.ID, next).Count(&n)
	if n != 0 {
		t.Fatalf("已删除的课程不应被下周沿用，实际 %d 条", n)
	}
}
