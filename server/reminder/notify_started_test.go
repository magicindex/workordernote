package reminder

import (
	"context"
	"testing"
	"time"
)

func TestNotifyStartedTasksAfterHours(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 331
	setUserConfig(t, "reminder_all_day_time", "00:00", userID)
	setUserConfig(t, "reminder_same_day_hours", "2", userID)

	now := time.Now()
	start := now.Add(-3 * time.Hour)
	due := now.Add(time.Hour)
	row := Reminder{UserID: userID, ListID: 1, Title: "自检开始后提醒", Kind: KindTask, StartAt: &start, DueAt: &due, RepeatRule: "none"}
	if err := appDB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	count := func() int64 {
		var n int64
		appDB.Model(&Notification{}).
			Where("user_id = ? AND reminder_id = ? AND type = ?", userID, row.ID, "reminder_started").
			Count(&n)
		return n
	}

	notifyStartedAt(appDB, now)
	if got := count(); got != 1 {
		t.Fatalf("开始 3 小时后应发 1 条，实际 %d", got)
	}
	notifyStartedAt(appDB, now.Add(time.Minute))
	if got := count(); got != 1 {
		t.Fatalf("同一天不该重复发，实际 %d", got)
	}

	// 距开始不足 2 小时：不提醒
	earlyStart := now.Add(-time.Hour)
	earlyDue := now.Add(time.Hour)
	early := Reminder{UserID: userID, ListID: 1, Title: "不足两小时", Kind: KindTask, StartAt: &earlyStart, DueAt: &earlyDue, RepeatRule: "none"}
	if err := appDB.Create(&early).Error; err != nil {
		t.Fatal(err)
	}
	notifyStartedAt(appDB, now)
	var earlyCount int64
	appDB.Model(&Notification{}).Where("user_id = ? AND reminder_id = ? AND type = ?", userID, early.ID, "reminder_started").Count(&earlyCount)
	if earlyCount != 0 {
		t.Fatalf("距开始不足设定时间不该提醒，实际 %d", earlyCount)
	}

	// 关闭：0 小时不提醒
	setUserConfig(t, "reminder_same_day_hours", "0", userID)
	notifyStartedAt(appDB, now.Add(2*time.Hour))
	if got := count(); got != 1 {
		t.Fatalf("关闭后不该再发，实际 %d", got)
	}
}

// 「当天任务提醒」开启后，带开始时间的任务不能在开始 + X 小时前先弹普通到点提醒。
func TestSameDayHoursSuppressesEarlierDuePopup(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 332
	setUserConfig(t, "reminder_same_day_hours", "1", userID)
	now := time.Now()
	start := now.Add(-30 * time.Minute)
	due := start
	row := Reminder{UserID: userID, ListID: 1, Title: "自检当天提醒接管", Kind: KindTask, StartAt: &start, DueAt: &due, RepeatRule: "none"}
	if err := appDB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	count := func() int64 {
		var n int64
		appDB.Model(&Notification{}).Where("user_id = ? AND reminder_id = ? AND type = ?", userID, row.ID, "reminder_due").Count(&n)
		return n
	}
	if _, err := sendChannel(context.Background(), appDB, ChannelInApp, userID, row, "same-day-test", nil); err != nil {
		t.Fatal(err)
	}
	if got := count(); got != 0 {
		t.Fatalf("设定 1 小时、开始仅 30 分钟，不该发到点弹窗，实际 %d", got)
	}

	setUserConfig(t, "reminder_same_day_hours", "0", userID)
	if _, err := sendChannel(context.Background(), appDB, ChannelInApp, userID, row, "same-day-test-off", nil); err != nil {
		t.Fatal(err)
	}
	if got := count(); got != 1 {
		t.Fatalf("关闭当天任务提醒后应恢复正常到点弹窗，实际 %d", got)
	}
}
