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

	// ① 不管在哪个钟点跑，首次提醒只可能是这两种之一：
	//    · 「创建后 10 分钟」（新口径）；或者
	//    · 结束时间本身（10 分钟那条越过了结束时间、被夹回来的时候）。
	//    以前这里按「今天 06:00 已经过去」写死了期望，凌晨跑就会假红（本轮踩过两次）。
	threeDays := now.In(loc).AddDate(0, 0, 3)
	threeDue := time.Date(threeDays.Year(), threeDays.Month(), threeDays.Day(), 23, 59, 0, 0, loc)
	floor := created.Add(firstRemindDelay).UTC()
	for _, due := range []time.Time{
		todayAt(23, 59),
		now.Add(-2 * time.Hour),
		now.Add(5 * time.Minute),
		now.Add(time.Hour),
		threeDue,
	} {
		item := Reminder{UserID: userID, CreatedAt: created, DueAt: ptrTime(due), RepeatRule: "none"}
		got := firstRemindSchedule(appDB, item)
		// 不早于「创建 + 10 分钟」——除非那 10 分钟会越过结束时间，这时按结束时间夹回来
		if got.Before(floor) && !sameInstant(got, due.UTC()) {
			t.Fatalf("首次提醒不该早于创建后 10 分钟（除非夹回结束时间）：实际 %v（due=%v floor=%v）", got, due, floor)
		}
		// 结束时间还在未来时，提醒也不会晚于它
		if due.After(now) && got.After(due.UTC()) {
			t.Fatalf("首次提醒不该晚于还没到的结束时间：实际 %v（due=%v）", got, due)
		}
	}
	// 已过点的条目：不早于创建 + 10 分钟（不再保存完就弹窗）
	pastItem := Reminder{UserID: userID, CreatedAt: created, DueAt: ptrTime(now.Add(-2 * time.Hour)), RepeatRule: "none"}
	if got := firstRemindSchedule(appDB, pastItem); !got.After(now) {
		t.Fatalf("新建的已过点任务不该立刻弹窗，实际 %v（现在 %v）", got, now)
	}

	// ② 三天后到期的任务：不受 10 分钟那条影响，仍然按到期日当天的「开始提醒时间」
	later := Reminder{UserID: userID, CreatedAt: created, DueAt: ptrTime(threeDue), RepeatRule: "none"}
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

// 用户 2026-10-14：「稍后提醒……不改变创建、到期时间，只是延迟提醒时间」。
// 断言三件事：到期时间不变、首次提醒的口径不看 snooze、投递任务被推迟到稍后那一刻。
func TestSnoozeOnlyDelaysDelivery(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 703
	setUserConfig(t, "reminder_all_day_time", "00:00", userID)

	now := time.Now()
	due := now.Add(2 * time.Hour).Truncate(time.Second)
	created, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "稍后一下", Kind: KindTask, DueAt: &due, RepeatRule: "none", Channels: []string{ChannelInApp},
	})
	if err != nil {
		t.Fatal(err)
	}
	snoozeUntil := now.Add(30 * time.Minute).Truncate(time.Second)
	if _, err := snoozeReminder(appDB, userID, created.ID, snoozeUntil); err != nil {
		t.Fatal(err)
	}

	var item Reminder
	if err := appDB.First(&item, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if item.DueAt == nil || !sameInstant(*item.DueAt, due) {
		t.Fatalf("稍后提醒不该改到期时间：%v（原 %v）", item.DueAt, due)
	}
	if got := firstRemindSchedule(appDB, item); !sameInstant(got, due) {
		t.Fatalf("首次提醒的口径不该被 snooze 改掉：期望 %v，实际 %v", due, got)
	}
	// 投递任务：run_at 推迟到稍后那一刻，scheduled_for 仍是正常口径
	var job DeliveryJob
	if err := appDB.Where("reminder_id = ? AND status = ?", created.ID, "pending").
		Order("id DESC").First(&job).Error; err != nil {
		t.Fatal(err)
	}
	if !sameInstant(job.RunAt, snoozeUntil) {
		t.Fatalf("投递应当推迟到 %v，实际 %v", snoozeUntil, job.RunAt)
	}
	if !sameInstant(job.ScheduledFor, due) {
		t.Fatalf("排期不该变：期望 %v，实际 %v", due, job.ScheduledFor)
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
