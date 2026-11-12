package reminder

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// 完成备注的几条「周边」：导出、已完成搜索、提醒@他回执、接口参数校验。
// 都是 2026-11-12 整体体检发现的口径缺口，用例钉住避免以后又漏。
//
//   - 导出「已完成」时「备注」列不能永远空着（那是用户唯一写下来的那句话）；
//   - 「已完成」的搜索要能搜到完成备注；
//   - 「提醒@他」的回执要把完成备注带给发起人；
//   - 完成接口收到写了但解析不了的 body 要报 400，不能静默丢掉用户那行字。

func TestCompletedExportCarriesCompletionNote(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 41
	item, err := createReminder(appDB, userID, SaveReminderInput{Title: "导出完成备注"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminderWithNote(appDB, userID, item.ID, "现场已处理完"); err != nil {
		t.Fatal(err)
	}

	rows, _ := exportRows(t, "scope=completed&range=all", userID)
	if len(rows) < 2 {
		t.Fatalf("已完成导出应至少 1 行数据，实际 %d 行", len(rows))
	}
	// 列序：标题,类型,清单,状态,到期时间,完成时间,重复,备注
	var notesCol string
	for _, row := range rows[1:] {
		if row[0] == "导出完成备注" {
			notesCol = row[7]
		}
	}
	if notesCol != "现场已处理完" {
		t.Fatalf("「备注」列应写完成备注，实际 %q（整表 %v）", notesCol, rows)
	}
}

func TestCompletedSearchMatchesCompletionNote(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 42
	// 一次性任务：备注在 reminders.completed_note
	once, err := createReminder(appDB, userID, SaveReminderInput{Title: "一次性任务"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminderWithNote(appDB, userID, once.ID, "换了新电瓶"); err != nil {
		t.Fatal(err)
	}
	// 循环任务：备注在 completions.note
	due := time.Now().Add(time.Hour).Truncate(time.Second)
	repeating, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "循环任务", DueAt: &due, RepeatRule: "daily",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminderWithNote(appDB, userID, repeating.ID, "今天已巡检"); err != nil {
		t.Fatal(err)
	}

	hitOnce, err := listCompletedHistory(appDB, userID, CompletedRange{}, "电瓶", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(hitOnce) != 1 || hitOnce[0].Title != "一次性任务" {
		t.Fatalf("按一次性任务的完成备注应能搜到 1 条，实际 %+v", hitOnce)
	}
	hitRepeat, err := listCompletedHistory(appDB, userID, CompletedRange{}, "巡检", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(hitRepeat) != 1 || hitRepeat[0].Title != "循环任务" {
		t.Fatalf("按循环任务的完成备注应能搜到 1 条，实际 %+v", hitRepeat)
	}
	// 搜不到的词仍然空
	miss, err := listCompletedHistory(appDB, userID, CompletedRange{}, "完全不存在", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(miss) != 0 {
		t.Fatalf("不相干的搜索词不该有结果，实际 %d 条", len(miss))
	}
}

func TestCompleteEndpointRejectsMalformedBody(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)

	const userID = 43
	item, err := createReminder(appDB, userID, SaveReminderInput{Title: "坏 body"})
	if err != nil {
		t.Fatal(err)
	}

	post := func(body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost,
			"/api/reminder/items/"+strconv.FormatUint(uint64(item.ID), 10)+"/complete", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		ctx.Params = nudgeIDParam(item.ID)
		ctx.Set("userID", userID)
		handleCompleteReminder(appDB)(ctx)
		return recorder
	}

	// note 写成数字 → 400，且这条**没被完成**（不能半生不熟地改一半）
	rec := post(`{"note":123}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("非法 body 应返回 400，实际 %d（%s）", rec.Code, rec.Body.String())
	}
	var after Reminder
	if err := appDB.First(&after, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.CompletedAt != nil {
		t.Fatalf("解析失败时不该把它标成完成：%+v", after.CompletedAt)
	}

	// 空 body（旧客户端）仍然照常完成
	rec = post("")
	if rec.Code != http.StatusOK {
		t.Fatalf("空 body 应照常完成，实际 %d（%s）", rec.Code, rec.Body.String())
	}
	if err := appDB.First(&after, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.CompletedAt == nil {
		t.Fatal("空 body 完成后 completed_at 应有值")
	}
}

func TestNudgeDoneReceiptCarriesCompletionNote(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)

	const sender, receiver = 944, 945
	seedNudgeUsers(t, sender, receiver)

	rec := nudgeRequest(t, handleCreateNudge(appDB), sender, http.MethodPost,
		`{"to_user_id":945,"content":"把电瓶换了"}`, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("发提醒失败：%d（%s）", rec.Code, rec.Body.String())
	}
	sent := nudgeData[NudgeDTO](t, rec)
	list, err := ensureDefaultList(appDB, receiver)
	if err != nil {
		t.Fatal(err)
	}
	rec = nudgeRequest(t, handleSaveNudgeToReminder(appDB), receiver, http.MethodPost,
		`{"list_id":`+strconv.FormatUint(uint64(list.ID), 10)+`}`, nudgeIDParam(sent.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("保存到清单失败：%d（%s）", rec.Code, rec.Body.String())
	}
	saved := nudgeData[NudgeDTO](t, rec)
	if saved.ReminderID == nil {
		t.Fatal("保存到清单后应关联一条提醒")
	}

	// 接收人带备注完成 → 发起人收到带备注的回执
	body, _ := json.Marshal(map[string]string{"note": "换了瓦尔塔，旧的放车库"})
	complete := nudgeRequest(t, handleCompleteReminder(appDB), receiver, http.MethodPost,
		string(body), nudgeIDParam(*saved.ReminderID))
	if complete.Code != http.StatusOK {
		t.Fatalf("完成失败：%d（%s）", complete.Code, complete.Body.String())
	}
	var notice Notification
	if err := appDB.Where("user_id = ? AND type = ?", sender, "nudge_done").First(&notice).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(notice.Body, "完成备注") || !strings.Contains(notice.Body, "瓦尔塔") {
		t.Fatalf("回执应带上完成备注，实际 %q", notice.Body)
	}
}
