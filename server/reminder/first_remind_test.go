package reminder

import (
	"testing"
	"time"

	"net/http"

	"github.com/gin-gonic/gin"
)

// 需求 1（用户 2026-10-13）：
//
//	「新建提醒，10分钟以后开始第一次提醒，低于10分钟到逾期设定时间的的不再提醒，
//	  直接给出逾期提醒」
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

	// ① 今天 23:59 到期、当天 06:00 已经过去才建：首次提醒 = 创建后 10 分钟，
	//    而不是当天 06:00（已经过去）。
	//
	// 注意**接近午夜**跑测试时有个正常分支：10 分钟那条会越过 23:59，于是按
	// 「不晚于结束时间」夹回 23:59（以前这里写死了期望，跨午夜就会假红）。
	fresh := Reminder{UserID: userID, CreatedAt: created, DueAt: ptrTime(todayAt(23, 59)), RepeatRule: "none"}
	got := firstRemindSchedule(appDB, fresh)
	want := created.Add(firstRemindDelay).UTC()
	if fresh.DueAt.After(created.Add(firstRemindDelay)) {
		if !sameInstant(got, want) {
			t.Fatalf("新建的已过点任务：首次提醒应为创建后 10 分钟 %v，实际 %v", want, got)
		}
		if !got.After(now) {
			t.Fatalf("首次提醒不该是过去时刻（会立刻弹窗），实际 %v（现在 %v）", got, now)
		}
		if got.Equal(fresh.DueAt.UTC()) {
			t.Fatal("10 分钟这条口径没生效：还是结束时间本身")
		}
	} else if !sameInstant(got, fresh.DueAt.UTC()) {
		t.Fatalf("离午夜不到 10 分钟时，应夹回结束时间 %v，实际 %v", fresh.DueAt.UTC(), got)
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

	// ④ 三天后到期的任务：不受 10 分钟那条影响，仍然按到期日当天的「开始提醒时间」
	//    （用「三天后」而不是「一小时后」，免得跨午夜时到期日的 06:00 还没到、口径变成
	//     结束时间本身 —— 那种时刻依赖测试员钟点的断言最容易假红，本轮就踩过）
	threeDays := now.In(loc).AddDate(0, 0, 3)
	threeDue := time.Date(threeDays.Year(), threeDays.Month(), threeDays.Day(), 23, 59, 0, 0, loc)
	later := Reminder{UserID: userID, CreatedAt: created, DueAt: &threeDue, RepeatRule: "none"}
	if got := firstRemindSchedule(appDB, later); !sameInstant(got, firstRemindAt(appDB, later)) {
		t.Fatalf("三天后到期的任务首次提醒应按正常流程 %v，实际 %v", firstRemindAt(appDB, later), got)
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

// 「提前几天开始提醒」（用户 2026-10-13：「开始提醒时间，增加提前几天开始提醒，
// 低于几天的按照正常流程走，超过提醒天数的等符合设定时间后再开始执行提醒」）。
func TestFirstRemindAdvanceDays(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 704
	setUserConfig(t, "reminder_all_day_time", "06:00", userID)
	loc := shanghai()
	now := time.Now()
	startOfToday := time.Date(now.In(loc).Year(), now.In(loc).Month(), now.In(loc).Day(), 0, 0, 0, 0, loc)

	at := func(dayOffset, hour int) time.Time {
		d := startOfToday.AddDate(0, 0, dayOffset)
		return time.Date(d.Year(), d.Month(), d.Day(), hour, 0, 0, 0, loc)
	}
	// 造一条「10 天后 23:59 到期、今天创建的」提醒：离到期超过 3 天
	due10 := at(10, 23)
	item := Reminder{UserID: userID, CreatedAt: now.Add(-time.Minute), DueAt: &due10, RepeatRule: "none"}

	// 没设提前天数（默认 0）：老口径 —— 到期日当天 06:00
	setUserConfig(t, "reminder_advance_days", "0", userID)
	if got := firstRemindAt(appDB, item); !sameInstant(got, at(10, 6).UTC()) {
		t.Fatalf("提前 0 天时首次提醒应为到期日 06:00，实际 %v", got)
	}

	// 提前 3 天：窗口 = 到期日往前 3 天（也就是 7 天后）的 06:00
	setUserConfig(t, "reminder_advance_days", "3", userID)
	if got := firstRemindAt(appDB, item); !sameInstant(got, at(7, 6).UTC()) {
		t.Fatalf("提前 3 天时首次提醒应为 7 天后的 06:00，实际 %v", got)
	}
	if got := firstRemindSchedule(appDB, item); !sameInstant(got, at(7, 6).UTC()) {
		t.Fatalf("调度用的首次提醒时刻也应当是窗口起点，实际 %v", got)
	}

	// 创建时已经在窗口之内（明天到期 < 提前 3 天）：按正常流程 —— 明天 06:00，不是立刻
	dueTomorrow := at(1, 23)
	inside := Reminder{UserID: userID, CreatedAt: now.Add(-time.Minute), DueAt: &dueTomorrow, RepeatRule: "none"}
	if got := firstRemindAt(appDB, inside); !sameInstant(got, at(1, 6).UTC()) {
		t.Fatalf("窗口之内创建的应当按正常流程（明天 06:00），实际 %v", got)
	}

	// 窗口还没到来就创建（今天创建、窗口在 7 天后）→ 用窗口；窗口那天之后再创建 → 正常流程
	// （这里用 CreatedAt 模拟「窗口已经过去才创建」）
	lateCreated := Reminder{UserID: userID, CreatedAt: at(8, 12), DueAt: &due10, RepeatRule: "none"}
	if got := firstRemindAt(appDB, lateCreated); !sameInstant(got, at(10, 6).UTC()) {
		t.Fatalf("窗口过了才创建的应当按正常流程（到期日 06:00），实际 %v", got)
	}
}

// 提前窗口内「每天只在开始提醒时间提醒一次」，到了到期日那天恢复「提醒频率」。
func TestAdvanceWindowRepeatsOncePerDay(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 705
	setUserConfig(t, "reminder_all_day_time", "06:00", userID)
	setUserConfig(t, "reminder_advance_days", "3", userID)

	loc := shanghai()
	now := time.Now()
	startOfToday := time.Date(now.In(loc).Year(), now.In(loc).Month(), now.In(loc).Day(), 0, 0, 0, 0, loc)
	at := func(dayOffset, hour int) time.Time {
		d := startOfToday.AddDate(0, 0, dayOffset)
		return time.Date(d.Year(), d.Month(), d.Day(), hour, 0, 0, 0, loc)
	}
	due := at(10, 23)

	item := Reminder{
		ID: 1, UserID: userID, CreatedAt: now.Add(-time.Minute), DueAt: &due,
		RepeatRule: "none", RepeatNotifyMinutes: 15,
	}
	first := firstRemindAt(appDB, item)
	if !sameInstant(first, at(7, 6).UTC()) {
		t.Fatalf("窗口起点应为 7 天后的 06:00，实际 %v", first)
	}

	// 窗口内第一次投递之后：下一个不是 15 分钟后，而是**第二天同一时刻**
	job := DeliveryJob{UserID: userID, ReminderID: 1, Channel: ChannelInApp, ScheduledFor: first}
	if err := scheduleRepeatNotify(appDB, item, job); err != nil {
		t.Fatal(err)
	}
	var chain DeliveryJob
	if err := appDB.Where("reminder_id = ? AND channel = ? AND status = ?", uint(1), ChannelInApp, "pending").
		Order("scheduled_for ASC").First(&chain).Error; err != nil {
		t.Fatal(err)
	}
	if !sameInstant(chain.ScheduledFor, at(8, 6).UTC()) {
		t.Fatalf("窗口内应当每天只排一次（第二天 06:00），实际 %v", chain.ScheduledFor)
	}
}

// 「开始提醒时间 = 00:00（不提前、也不静默）」时，提前天数仍然生效：
// 窗口从 (到期日 - N 天) 的 0 点开始，而不是被 00:00 这条口径吃掉。
func TestAdvanceDaysWorksWithMidnightStart(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 706
	setUserConfig(t, "reminder_all_day_time", "00:00", userID)
	setUserConfig(t, "reminder_advance_days", "3", userID)

	loc := shanghai()
	now := time.Now()
	startOfToday := time.Date(now.In(loc).Year(), now.In(loc).Month(), now.In(loc).Day(), 0, 0, 0, 0, loc)
	dayAt := func(offset, hour int) time.Time {
		d := startOfToday.AddDate(0, 0, offset)
		return time.Date(d.Year(), d.Month(), d.Day(), hour, 0, 0, 0, loc)
	}
	due := dayAt(10, 23)
	item := Reminder{UserID: userID, CreatedAt: now.Add(-time.Minute), DueAt: &due, RepeatRule: "none"}

	if got := firstRemindAt(appDB, item); !sameInstant(got, dayAt(7, 0).UTC()) {
		t.Fatalf("00:00 + 提前 3 天：窗口应为 7 天后的 0 点，实际 %v", got)
	}
}

// 「逾期项目点击知道了（稍后提醒），提醒依然保留在逾期栏目」（用户 2026-10-13）：
// 逾期判定**不看 snoozed_until** —— 今天页里它还在，/summary 的 overdue 也还数它。
func TestOverdueSurvivesAcknowledge(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)

	const userID = 707
	if _, err := ensureDefaultList(appDB, userID); err != nil {
		t.Fatal(err)
	}

	overdueDue := time.Now().AddDate(0, 0, -2)
	created, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "逾期了还被顺延", Kind: KindTask, DueAt: &overdueDue, RepeatRule: "none", Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	// 点「知道了」= 稍后提醒到明天（前端 ackCurrentAlert 就是这么做的）
	if _, err := snoozeReminder(appDB, userID, created.ID, time.Now().AddDate(0, 0, 1)); err != nil {
		t.Fatal(err)
	}

	items, err := listReminders(appDB, userID, "today", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range items {
		if item.ID == created.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("逾期、被稍后提醒的条目必须留在今天页（已逾期栏）：%v", titlesOfTest(items))
	}

	rec := nudgeRequest(t, handleSummary(appDB), userID, http.MethodGet, "", nil)
	data := nudgeData[map[string]any](t, rec)
	if got := int64(data["overdue"].(float64)); got != 1 {
		t.Fatalf("/summary 的 overdue 应当算上它（1），实际 %d", got)
	}
}

func titlesOfTest(items []ReminderDTO) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, item.Title)
	}
	return out
}
