package reminder

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// 完成备注（用户 2026-11-12：「点击任务前边按钮完成任务的时候 弹窗添加备注框，
// 确定，取消，不要直接完成……空备注也允许直接完成」）。
//
// 口径：
//   - 一次性任务：备注写进 reminders.completed_note，随「撤销完成」一起清掉；
//   - 循环任务：备注写进这一次的 completions.note，下一次完成是另一条，不串；
//   - 空备注 / 不传 body：照常完成，不报错；
//   - 「已完成」列表的两种来源都要把备注带出来（前端据此在行内显示）。
func TestCompletionNoteIsStoredPerCompletion(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 21

	// 1) 一次性任务：备注落在提醒自己身上，「已完成」列表的 reminder 来源带出来
	once, err := createReminder(appDB, userID, SaveReminderInput{Title: "换电瓶"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminderWithNote(appDB, userID, once.ID, "  换完了，旧的留在车库  "); err != nil {
		t.Fatal(err)
	}
	var afterOnce Reminder
	if err := appDB.First(&afterOnce, once.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterOnce.CompletedNote != "换完了，旧的留在车库" {
		t.Fatalf("一次性任务的完成备注应去掉首尾空白后落库，实际 %q", afterOnce.CompletedNote)
	}
	if afterOnce.CompletedAt == nil {
		t.Fatal("一次性任务完成后 completed_at 应有值")
	}

	// 2) 循环任务：备注落在这一条完成记录上，提醒本身不留备注
	due := time.Now().Add(time.Hour).Truncate(time.Second)
	repeating, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "每月交电费", DueAt: &due, RepeatRule: "monthly",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminderWithNote(appDB, userID, repeating.ID, "10 月已交"); err != nil {
		t.Fatal(err)
	}
	var afterRepeat Reminder
	if err := appDB.First(&afterRepeat, repeating.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterRepeat.CompletedNote != "" {
		t.Fatalf("循环任务的完成备注不能挂在提醒上（会被下一次沿用），实际 %q", afterRepeat.CompletedNote)
	}
	if afterRepeat.CompletedAt != nil {
		t.Fatal("循环提醒完成后 completed_at 应为空")
	}
	var historyRows []Completion
	if err := appDB.Where("reminder_id = ?", repeating.ID).Find(&historyRows).Error; err != nil {
		t.Fatal(err)
	}
	if len(historyRows) != 1 || historyRows[0].Note != "10 月已交" {
		t.Fatalf("循环任务的完成备注应在 completions.note 上，实际 %+v", historyRows)
	}

	// 3) 「已完成」列表两种来源都带 note
	all, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	byTitle := map[string]CompletedItemDTO{}
	for _, item := range all {
		byTitle[item.Title] = item
	}
	if got := byTitle["换电瓶"]; got.Source != "reminder" || got.Note != "换完了，旧的留在车库" {
		t.Fatalf("reminder 来源应带 completed_note，实际 %+v", got)
	}
	if got := byTitle["每月交电费"]; got.Source != "history" || got.Note != "10 月已交" {
		t.Fatalf("history 来源应带 note，实际 %+v", got)
	}

	// 4) 撤销完成要把一次性任务的备注清掉，免得未完成的行还挂着上一条的文字
	if _, err := restoreReminder(appDB, userID, once.ID); err != nil {
		t.Fatal(err)
	}
	var restored Reminder
	if err := appDB.First(&restored, once.ID).Error; err != nil {
		t.Fatal(err)
	}
	if restored.CompletedNote != "" || restored.CompletedAt != nil {
		t.Fatalf("撤销完成后 completed_note / completed_at 都应清空，实际 %+v", restored)
	}
}

// 空备注照常完成（用户要求「空备注也允许直接完成」），超长备注截断而不是拒绝。
func TestCompletionNoteEmptyAndTooLong(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 22

	empty, err := createReminder(appDB, userID, SaveReminderInput{Title: "空备注"})
	if err != nil {
		t.Fatal(err)
	}
	// 不带备注的老入口（信用卡还款等内部路径用的就是它）同样应该正常完成
	if _, err := completeReminder(appDB, userID, empty.ID); err != nil {
		t.Fatalf("空备注应该允许直接完成：%v", err)
	}
	var gotEmpty Reminder
	if err := appDB.First(&gotEmpty, empty.ID).Error; err != nil {
		t.Fatal(err)
	}
	if gotEmpty.CompletedAt == nil || gotEmpty.CompletedNote != "" {
		t.Fatalf("空备注完成后 completed_at 有值、completed_note 为空，实际 %+v", gotEmpty)
	}

	long, err := createReminder(appDB, userID, SaveReminderInput{Title: "超长备注"})
	if err != nil {
		t.Fatal(err)
	}
	huge := strings.Repeat("长", completionNoteMaxRunes+50)
	if _, err := completeReminderWithNote(appDB, userID, long.ID, huge); err != nil {
		t.Fatalf("超长备注应该截断而不是拒绝：%v", err)
	}
	var gotLong Reminder
	if err := appDB.First(&gotLong, long.ID).Error; err != nil {
		t.Fatal(err)
	}
	if n := len([]rune(gotLong.CompletedNote)); n != completionNoteMaxRunes {
		t.Fatalf("超长备注应截断到 %d 个字，实际 %d", completionNoteMaxRunes, n)
	}
}

// 接口层：POST /items/:id/complete 带 {"note": "..."} 能落库；不带 body 也照常完成。
func TestCompleteReminderHandlerAcceptsNote(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 23
	due := time.Now().Add(time.Hour).Truncate(time.Second)
	item, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "接口带备注", DueAt: &due, RepeatRule: "daily",
	})
	if err != nil {
		t.Fatal(err)
	}

	post := func(body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, "/api/reminder/items/"+itoa(item.ID)+"/complete", strings.NewReader(body))
		context.Request.Header.Set("Content-Type", "application/json")
		context.Params = gin.Params{{Key: "id", Value: itoa(item.ID)}}
		context.Set("userID", userID)
		handleCompleteReminder(appDB)(context)
		return recorder
	}

	recorder := post(`{"note":"今天已经处理"}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("带备注完成返回 %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data ReminderDTO `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	var rows []Completion
	if err := appDB.Where("reminder_id = ?", item.ID).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Note != "今天已经处理" {
		t.Fatalf("接口传来的备注应写进 completions.note，实际 %+v", rows)
	}

	// 不带 body：与旧客户端一致，照常完成（还是循环任务，所以再记一条历史）
	if recorder := post(""); recorder.Code != http.StatusOK {
		t.Fatalf("不带 body 完成返回 %d: %s", recorder.Code, recorder.Body.String())
	}
	var count int64
	if err := appDB.Model(&Completion{}).Where("reminder_id = ?", item.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("两次完成应有 2 条历史，实际 %d", count)
	}
}

// itoa 只是避免在测试里再引一个 strconv（已有用例都在本包里直接拼路径）。
func itoa(v uint) string {
	if v == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}
