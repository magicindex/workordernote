package reminder

import (
	"strings"
	"testing"
	"time"
)

// 已完成页的「撤销」：用户 2026-11-09 点错了一条未结束的提醒，把它提前结束了，
// 要求能在已完成里一键撤回、恢复成未完成。
//
// 两条数据来源对应两条撤销路径：
//   - 一次性任务：completed_at 置空（/items/:id/restore，已有逻辑）；
//   - 重复提醒：删掉 completions 里那次完成，并把 due_at 退回那次的排期。
func TestRetractCompletionRollsRepeatingReminderBack(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 12
	due := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	created, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "撤销完成测试", DueAt: &due, RepeatRule: "daily",
	})
	if err != nil {
		t.Fatal(err)
	}
	scheduled := *created.DueAt

	if _, err := completeReminder(appDB, userID, created.ID); err != nil {
		t.Fatal(err)
	}
	var done Completion
	if err := appDB.Where("reminder_id = ?", created.ID).First(&done).Error; err != nil {
		t.Fatalf("完成重复提醒应写一条完成记录：%v", err)
	}
	if done.ScheduledFor == nil || !done.ScheduledFor.Equal(scheduled) {
		t.Fatalf("完成记录的排期应为原到期时间 %v，实际 %v", scheduled, done.ScheduledFor)
	}
	var advanced Reminder
	if err := appDB.First(&advanced, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if advanced.DueAt == nil || !advanced.DueAt.After(scheduled) {
		t.Fatalf("完成后 due_at 应滚到下一次，实际 %v", advanced.DueAt)
	}

	// 列表里这一行必须标成可撤销，前端才会显示按钮。
	rows, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	row, ok := findCompleted(rows, done.ID)
	if !ok {
		t.Fatal("刚完成的重复提醒应出现在已完成里")
	}
	if !row.Undoable {
		t.Fatalf("最近一次完成应可撤销：%+v", row)
	}

	if _, err := retractCompletion(appDB, userID, done.ID); err != nil {
		t.Fatalf("撤销完成失败：%v", err)
	}
	var back Reminder
	if err := appDB.First(&back, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if back.DueAt == nil || !back.DueAt.Equal(scheduled) {
		t.Fatalf("撤销后 due_at 应退回 %v，实际 %v", scheduled, back.DueAt)
	}
	if back.CompletedAt != nil || back.SnoozedUntil != nil {
		t.Fatalf("撤销后不该保留完成/稍后状态：%+v", back)
	}
	var history int64
	if err := appDB.Model(&Completion{}).Where("user_id = ? AND reminder_id = ?", userID, created.ID).Count(&history).Error; err != nil {
		t.Fatal(err)
	}
	if history != 0 {
		t.Fatalf("撤销后完成记录应该看不见了，实际 %d 条", history)
	}
	rows, err = listCompletedHistory(appDB, userID, CompletedRange{}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, still := findCompleted(rows, done.ID); still {
		t.Fatal("撤销后不该再出现在已完成里")
	}
	// 提醒回到「待办」：未完成、到期时间已过去（这里仍是原来的未来时刻）。
	detail, err := getReminder(appDB, userID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.CompletedAt != nil {
		t.Fatalf("撤销后提醒应恢复为未完成：%+v", detail.Reminder)
	}
	// 「第几次」由完成次数推出来：撤掉唯一一次之后要回到第 1 次。
	open, err := listReminders(appDB, userID, "all", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range open {
		if d.ID == created.ID && d.CycleIndex != 1 {
			t.Fatalf("撤销后「第几次」应回到 1，实际 %d", d.CycleIndex)
		}
	}

	// 重复撤销：记录已经软删，应当明确失败而不是静默成功。
	if _, err := retractCompletion(appDB, userID, done.ID); err == nil {
		t.Fatal("同一条完成记录不能撤销两次")
	}
}

// 连续完成多次时，只允许撤最近一次：更早的那次撤了，due_at 会和后面的完成打架。
func TestRetractCompletionOnlyAllowsLatest(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 13
	due := time.Now().Add(time.Hour).Truncate(time.Second)
	created, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "只能撤最近一次", DueAt: &due, RepeatRule: "daily",
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := completeReminder(appDB, userID, created.ID); err != nil {
			t.Fatal(err)
		}
	}
	var history []Completion
	if err := appDB.Where("user_id = ? AND reminder_id = ?", userID, created.ID).
		Order("completed_at ASC, id ASC").Find(&history).Error; err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 {
		t.Fatalf("应写入 2 条完成记录，实际 %d", len(history))
	}
	older, latest := history[0], history[1]

	rows, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	olderRow, ok := findCompleted(rows, older.ID)
	if !ok {
		t.Fatal("较早的完成记录应出现在已完成里")
	}
	latestRow, ok := findCompleted(rows, latest.ID)
	if !ok {
		t.Fatal("最近的完成记录应出现在已完成里")
	}
	if olderRow.Undoable {
		t.Fatal("较早的完成记录不该标成可撤销")
	}
	if !latestRow.Undoable {
		t.Fatal("最近的完成记录应可撤销")
	}

	if _, err := retractCompletion(appDB, userID, older.ID); err == nil || !strings.Contains(err.Error(), "最近一次") {
		t.Fatalf("撤销较早的完成应被拒绝并说明原因，实际 %v", err)
	}
	// 拒绝后什么都不该改：两条历史都还在。
	var count int64
	if err := appDB.Model(&Completion{}).Where("user_id = ? AND reminder_id = ?", userID, created.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("被拒绝的撤销不该删记录，实际剩 %d 条", count)
	}
	if _, err := retractCompletion(appDB, userID, latest.ID); err != nil {
		t.Fatalf("撤销最近一次应当成功：%v", err)
	}
}

// 记事没有「完成/撤销」这回事；一次性任务的完成则应可撤销（清 completed_at）。
func TestCompletedUndoableFlags(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 14
	if _, err := createReminder(appDB, userID, SaveReminderInput{Title: "一条记事", Kind: KindNote}); err != nil {
		t.Fatal(err)
	}
	once, err := createReminder(appDB, userID, SaveReminderInput{Title: "一次性任务"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminder(appDB, userID, once.ID); err != nil {
		t.Fatal(err)
	}

	rows, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		switch row.Title {
		case "一条记事":
			if row.Undoable {
				t.Fatalf("记事不该可撤销：%+v", row)
			}
		case "一次性任务":
			if !row.Undoable {
				t.Fatalf("一次性任务的完成应可撤销：%+v", row)
			}
		}
	}
}

func findCompleted(rows []CompletedItemDTO, id uint) (CompletedItemDTO, bool) {
	for _, row := range rows {
		if row.ID == id {
			return row, true
		}
	}
	return CompletedItemDTO{}, false
}
