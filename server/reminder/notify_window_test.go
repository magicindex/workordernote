package reminder

import (
	"testing"
	"time"

	"smallgo/server/sysconfig"
)

// 「开始提醒时间」（reminder_all_day_time）之前的静默窗口：每天 [00:00, start)。
// 用户 2026-10-12 要求的「类似手机的免打扰」。
func TestInQuietHours(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 321
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	day := time.Date(2026, 10, 12, 0, 0, 0, 0, loc)

	setUserConfig(t, "reminder_all_day_time", "06:00", userID)
	cases := []struct {
		h, m int
		want bool
	}{
		{0, 0, true}, {3, 30, true}, {5, 59, true},
		{6, 0, false}, {12, 30, false}, {23, 59, false},
	}
	for _, c := range cases {
		at := day.Add(time.Duration(c.h)*time.Hour + time.Duration(c.m)*time.Minute)
		if got := inQuietHours(appDB, userID, at); got != c.want {
			t.Fatalf("开始提醒时间 06:00：%02d:%02d 是否静默应为 %v，实际 %v", c.h, c.m, c.want, got)
		}
	}

	// 00:00 = 整天不静默（否则等于把提醒全关掉，不是用户的本意）
	setUserConfig(t, "reminder_all_day_time", "00:00", userID)
	if inQuietHours(appDB, userID, day.Add(3*time.Hour)) {
		t.Fatal("开始提醒时间写 00:00 时不该静默")
	}

	// 小时数补零：写 "6:00" 也认（存进去统一成 06:00）
	setUserConfig(t, "reminder_all_day_time", "6:00", userID)
	if v, err := sysconfig.GetConfig(appDB, "reminder_all_day_time", userID); err != nil || v != "06:00" {
		t.Fatalf("时刻应被归一化成 06:00，实际 %q（err=%v）", v, err)
	}
	if !inQuietHours(appDB, userID, day.Add(5*time.Hour)) {
		t.Fatal("6:00 应等同 06:00：5 点仍在静默窗口里")
	}

	// 没写过这一行的用户按注册表默认（00:00 = 不静默）—— 老用户 / 其它安装的行为不变
	if inQuietHours(appDB, userID+99, day.Add(3*time.Hour)) {
		t.Fatal("没设过的用户默认 00:00，不该静默")
	}
}

// 逾期提醒：进入逾期时发一条站内提醒；每个任务每天最多一条；静默窗口里不发、静默结束后补发。
func TestNotifyOverdueOncePerDay(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 322
	setPublicConfig(t, "task_overdue_after_minutes", "0")
	// 逾期时间 00:00 = 按到期时刻算，这样「1 小时前到期」的任务必然已进入逾期
	setUserConfig(t, "task_overdue_time", "00:00", userID)
	setUserConfig(t, "reminder_all_day_time", "00:00", userID) // 不静默

	now := time.Now()
	due := now.Add(-time.Hour)
	row := Reminder{UserID: userID, ListID: 1, Title: "自检逾期提醒", DueAt: &due, RepeatRule: "none"}
	if err := appDB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	count := func() int64 {
		var n int64
		appDB.Model(&Notification{}).
			Where("user_id = ? AND reminder_id = ? AND type = ?", userID, row.ID, "reminder_overdue").
			Count(&n)
		return n
	}

	notifyOverdueAt(appDB, now)
	if got := count(); got != 1 {
		t.Fatalf("进入逾期后应发 1 条逾期提醒，实际 %d", got)
	}
	notifyOverdueAt(appDB, now.Add(time.Minute))
	if got := count(); got != 1 {
		t.Fatalf("同一天不该重复发逾期提醒，实际 %d", got)
	}

	// 已完成的任务不再提醒
	doneAt := now
	if err := appDB.Model(&Reminder{}).Where("id = ?", row.ID).
		Updates(map[string]interface{}{"completed_at": &doneAt}).Error; err != nil {
		t.Fatal(err)
	}
	notifyOverdueAt(appDB, now.Add(2*time.Minute))
	if got := count(); got != 1 {
		t.Fatalf("已完成的任务不该再发逾期提醒，实际 %d", got)
	}

	// 静默窗口里不发、窗口过后补发
	const userID2 = 323
	setUserConfig(t, "reminder_all_day_time", "06:00", userID2)
	setUserConfig(t, "task_overdue_time", "00:00", userID2) // 与上面同一个口径：按到期时刻算
	loc, _ := time.LoadLocation("Asia/Shanghai")
	quietNow := time.Date(2026, 10, 12, 3, 0, 0, 0, loc)
	due2 := quietNow.Add(-time.Hour)
	row2 := Reminder{UserID: userID2, ListID: 1, Title: "自检静默逾期", DueAt: &due2, RepeatRule: "none"}
	if err := appDB.Create(&row2).Error; err != nil {
		t.Fatal(err)
	}
	count2 := func() int64 {
		var n int64
		appDB.Model(&Notification{}).
			Where("user_id = ? AND reminder_id = ? AND type = ?", userID2, row2.ID, "reminder_overdue").
			Count(&n)
		return n
	}
	// 静默窗口里有别的用户先发过：用同一天、不同用户，互不影响
	notifyOverdueAt(appDB, quietNow)
	if got := count2(); got != 0 {
		t.Fatalf("静默窗口里不该发逾期提醒，实际 %d", got)
	}
	afterQuiet := time.Date(2026, 10, 12, 6, 5, 0, 0, loc)
	notifyOverdueAt(appDB, afterQuiet)
	if got := count2(); got != 1 {
		t.Fatalf("静默结束后应补发 1 条逾期提醒，实际 %d", got)
	}
}

// 第一次提醒时刻（用户 2026-10-13：「开始提醒时间」＝当天第一次提醒弹窗）：
// 取「结束时间」与「生效日当天的开始提醒时间」里更早的那个。
func TestFirstRemindAt(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 351
	loc, _ := time.LoadLocation("Asia/Shanghai")
	due := time.Date(2026, 10, 20, 23, 59, 0, 0, loc) // 结束时间 23:59
	item := Reminder{UserID: userID, ListID: 1, Title: "第一次提醒", DueAt: &due, RepeatRule: "none"}
	if err := appDB.Create(&item).Error; err != nil {
		t.Fatal(err)
	}

	// 开始提醒时间 06:00 → 当天 06:00 就先弹
	setUserConfig(t, "reminder_all_day_time", "06:00", userID)
	got := firstRemindAt(appDB, item).In(loc)
	want := time.Date(2026, 10, 20, 6, 0, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("开始提醒 06:00 时首次提醒应是当天 06:00，实际 %s", got.Format(time.RFC3339))
	}

	// 开始提醒时间 00:00 = 不提前 → 就是结束时间
	setUserConfig(t, "reminder_all_day_time", "00:00", userID)
	if got := firstRemindAt(appDB, item).In(loc); !got.Equal(due) {
		t.Fatalf("开始提醒 00:00 时首次提醒应等于结束时间，实际 %s", got.Format(time.RFC3339))
	}

	// 结束时间本来就早于开始提醒时间（凌晨 05:00 到期）→ 还是到点弹
	early := time.Date(2026, 10, 20, 5, 0, 0, 0, loc)
	earlyItem := Reminder{UserID: userID, ListID: 1, Title: "凌晨到期", DueAt: &early, RepeatRule: "none"}
	if err := appDB.Create(&earlyItem).Error; err != nil {
		t.Fatal(err)
	}
	setUserConfig(t, "reminder_all_day_time", "06:00", userID)
	if got := firstRemindAt(appDB, earlyItem).In(loc); !got.Equal(early) {
		t.Fatalf("结束时间早于开始提醒时间时应按结束时间，实际 %s", got.Format(time.RFC3339))
	}

	// 建出的投递任务用的是这个时刻（而不是结束时间）
	setUserConfig(t, "reminder_all_day_time", "06:00", userID)
	// 用「明天」而不是固定日期：06:00 一旦已经过去，创建动作会按「现在」排程，
	// 这条断言就会在每天 06:00 之后必红（与逻辑无关，只是用例太依赖运行时刻）。
	tomorrowNoon := time.Now().In(loc).AddDate(0, 0, 1)
	createdDue := time.Date(tomorrowNoon.Year(), tomorrowNoon.Month(), tomorrowNoon.Day(), 23, 59, 0, 0, loc)
	created, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "排程检查", Kind: KindTask, DueAt: &createdDue, RepeatRule: "none", Channels: []string{"inapp"},
	})
	if err != nil {
		t.Fatalf("建提醒失败：%v", err)
	}
	var job DeliveryJob
	if err := appDB.Where("reminder_id = ?", created.ID).Order("id ASC").First(&job).Error; err != nil {
		t.Fatalf("没排到投递任务：%v", err)
	}
	wantJob := createdDue.Format("2006-01-02") + " 06:00"
	if got := job.ScheduledFor.In(loc).Format("2006-01-02 15:04"); got != wantJob {
		t.Fatalf("投递任务应排在当天 06:00，实际 %s", got)
	}
}
