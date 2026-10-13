package reminder

import (
	"testing"
	"time"
)

// 需求 1（用户 2026-10-13）：
//   「新建提醒，10分钟以后开始第一次提醒，低于10分钟到逾期设定时间的的不再提醒，
//     直接给出逾期提醒」
//
// 两条口径都在 firstRemindSchedule / rebuildJobs 里，这里把它们逐条钉住。
func TestFirstRemindScheduleDelaysFreshReminders(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 701
	setUserConfig(t, "reminder_all_day_time", "06:00", userID)
	setUserConfig(t, "task_overdue_time", "23:59", userID)

	loc := shanghai()
	now := time.Now()
	todayAt := func(h, m int) time.Time {
		local := now.In(loc)
		return time.Date(local.Year(), local.Month(), local.Day(), h, m, 0, 0, loc)
	}
	created := now.Add(-time.Minute)

	// ① 今天 23:59 到期、下午才建：首次提醒 = 创建后 10 分钟，而不是当天 06:00（已经过去）
	fresh := Reminder{UserID: userID, CreatedAt: created, DueAt: ptrTime(todayAt(23, 59)), RepeatRule: "none"}
	got := firstRemindSchedule(appDB, fresh)
	want := created.Add(firstRemindDelay).UTC()
	if !sameInstant(got, want) {
		t.Fatalf("新建的已过点任务：首次提醒应为创建后 10 分钟 %v，实际 %v", want, got)
	}
	if !got.After(now) {
		t.Fatalf("首次提醒不该是过去时刻（会立刻弹窗），实际 %v（现在 %v）", got, now)
	}
	if got.Equal(fresh.DueAt.UTC()) {
		t.Fatal("10 分钟这条口径没生效：还是结束时间本身")
	}

	// ② 结束时间只剩 5 分钟：10 分钟那条会越过结束时间 → 夹回结束时间（不能晚于它）
	soonDue := Reminder{UserID: userID, CreatedAt: created, DueAt: ptrTime(now.Add(5 * time.Minute)), RepeatRule: "none"}
	if got := firstRemindSchedule(appDB, soonDue); !sameInstant(got, soonDue.DueAt.UTC()) {
		t.Fatalf("结束时间只剩 5 分钟时应夹回结束时间 %v，实际 %v", soonDue.DueAt.UTC(), got)
	}

	// ③ 结束时间早就过了：保持「创建后 10 分钟」，不再立刻弹
	pastDue := Reminder{UserID: userID, CreatedAt: created, DueAt: ptrTime(now.Add(-2 * time.Hour)), RepeatRule: "none"}
	if got := firstRemindSchedule(appDB, pastDue); !sameInstant(got, created.Add(firstRemindDelay).UTC()) {
		t.Fatalf("已过期的新建任务首次提醒应为创建后 10 分钟，实际 %v", got)
	}

	// ④ 一小时后到期、但今天的「开始提醒时间」（06:00）已经过去：首次提醒仍是
	//    「创建后 10 分钟」—— 既没有立刻弹，也不会被早上那个点拉回过去
	later := Reminder{UserID: userID, CreatedAt: created, DueAt: ptrTime(now.Add(time.Hour)), RepeatRule: "none"}
	if got := firstRemindSchedule(appDB, later); !sameInstant(got, created.Add(firstRemindDelay).UTC()) {
		t.Fatalf("今天已过「开始提醒时间」的任务首次提醒应为创建后 10 分钟，实际 %v", got)
	}

	// ⑤ 明天到期的任务：开始提醒时间（明天 06:00）仍然生效 —— 这条老口径不能被改掉
	tomorrow := now.In(loc).AddDate(0, 0, 1)
	tomorrowDue := time.Date(tomorrow.Year(), tomorrow.Month(), tomorrow.Day(), 23, 59, 0, 0, loc)
	item := Reminder{UserID: userID, CreatedAt: created, DueAt: &tomorrowDue, RepeatRule: "none"}
	if got := firstRemindSchedule(appDB, item); !sameInstant(got, firstRemindAt(appDB, item)) {
		t.Fatalf("明天的任务首次提醒应等于「开始提醒时间」口径 %v，实际 %v", firstRemindAt(appDB, item), got)
	}
}

// 距「逾期提醒时间」不足 10 分钟时，一条普通提醒都不排（交给逾期提醒）。
func TestRebuildJobsSkipsWhenCloseToOverdue(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 702
	setUserConfig(t, "reminder_all_day_time", "00:00", userID)
	// 逾期时间写成 00:00 = 「到期那一刻就算逾期」，这样「距逾期」= 距结束时间，
	// 用例不依赖跑测试的钟点。
	setUserConfig(t, "task_overdue_time", "00:00", userID)

	now := time.Now()

	// 5 分钟后到期：离逾期只剩 5 分钟 → 不排普通提醒
	closeItem, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "马上就到逾期", Kind: KindTask, DueAt: ptrTime(now.Add(5 * time.Minute)),
		RepeatRule: "none", Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	var closeJobs int64
	if err := appDB.Model(&DeliveryJob{}).Where("reminder_id = ? AND status = ?", closeItem.ID, "pending").Count(&closeJobs).Error; err != nil {
		t.Fatal(err)
	}
	if closeJobs != 0 {
		t.Fatalf("离逾期不足 10 分钟不该排普通提醒，实际排了 %d 条", closeJobs)
	}

	// 两小时后到期：照常排一条
	farItem, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "还早", Kind: KindTask, DueAt: ptrTime(now.Add(2 * time.Hour)),
		RepeatRule: "none", Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	var farJobs int64
	if err := appDB.Model(&DeliveryJob{}).Where("reminder_id = ? AND status = ?", farItem.ID, "pending").Count(&farJobs).Error; err != nil {
		t.Fatal(err)
	}
	if farJobs != 1 {
		t.Fatalf("两小时后到期的任务应当排 1 条普通提醒，实际 %d 条", farJobs)
	}
}

// 「稍后提醒」是用户明确点出来的时刻，不吃「新建后 10 分钟」这条口径；
// 同一条提醒如果没有稍后提醒，就按 10 分钟那条走 —— 两条并排验证。
func TestFirstRemindScheduleHonoursSnooze(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 703
	setUserConfig(t, "reminder_all_day_time", "00:00", userID)

	now := time.Now()
	created := now.Add(-time.Minute)
	snooze := now.Add(2 * time.Second)

	snoozed := Reminder{
		UserID: userID, CreatedAt: created, DueAt: ptrTime(now.Add(time.Hour)),
		SnoozedUntil: &snooze, RepeatRule: "none",
	}
	if got := firstRemindSchedule(appDB, snoozed); !sameInstant(got, snooze.UTC()) {
		t.Fatalf("稍后提醒指定的时刻不该被 10 分钟口径推后：期望 %v，实际 %v", snooze.UTC(), got)
	}

	// 对照组：同样「刚建一分钟」，但已经过期（没有稍后提醒）→ 按创建后 10 分钟
	plain := Reminder{UserID: userID, CreatedAt: created, DueAt: ptrTime(now.Add(-2 * time.Hour)), RepeatRule: "none"}
	if got := firstRemindSchedule(appDB, plain); !sameInstant(got, created.Add(firstRemindDelay).UTC()) {
		t.Fatalf("同一条没有稍后提醒时应当按创建后 10 分钟，实际 %v", got)
	}
}
