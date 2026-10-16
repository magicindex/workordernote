package reminder

import (
	"testing"
	"time"
)

// 今天页必须**认偏移**，不能按字符串比时间。
//
// SQLite 把时间列存成带偏移的文本，而历史数据里的偏移并不统一（老版本前端写过
// `toISOString()` 的 `+00:00`，从对端同步过来的行也可能带别的偏移）。SQLite 的
// `<` / `>` 对文本是按字符串比的，于是
//
//	'2026-10-10 00:00:00+00:00'（本地 10-10 08:00，其实是明天）
//	  < '2026-10-10 00:00:00+08:00'（今天 24 点）
//
// 成立，明天的条目就漏进了今天页 —— 0.15.4 上线后实测到「今天页多出一张
// 『明天 · 10月10日』的卡片」。这里把「同一时刻、不同偏移」的条目都建出来，
// 钉住待办页与计划页的口径（修法见 sql_time.go 的 tsUTC / sqlTimeArg）。
func TestTodayViewIsOffsetAware(t *testing.T) {
	withShanghaiLocal(t)
	cleanup := testDB(t)
	defer cleanup()

	const userID = 122
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	loc := shanghai()
	now := time.Now().In(loc)
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	todayEvening := midnight.Add(20 * time.Hour)                                // 今天 20:00，用 +08:00 存
	tomorrowMorningUTC := midnight.AddDate(0, 0, 1).Add(8 * time.Hour).UTC()    // 明天 08:00 本地，用 +00:00 存
	yesterdayEveningUTC := midnight.AddDate(0, 0, -1).Add(20 * time.Hour).UTC() // 昨天 20:00 本地，用 +00:00 存

	mk := func(title string, due time.Time) uint {
		created, err := createReminder(appDB, userID, SaveReminderInput{
			Title: title, ListID: list.ID, DueAt: &due, RepeatRule: "none",
		})
		if err != nil {
			t.Fatalf("建 %q 失败：%v", title, err)
		}
		return created.ID
	}
	mk("今天20点本机偏移", todayEvening)
	mk("明天8点UTC偏移", tomorrowMorningUTC)
	mk("昨天20点UTC偏移", yesterdayEveningUTC)
	// 窗口之外的对照组：待办页从 2026-10-16 起是「今天到第 7 天」，第 9 天必须看不见。
	mk("第九天8点UTC偏移", midnight.AddDate(0, 0, 8).Add(8*time.Hour).UTC())

	// 前提：偏移确实按传入的位置存下来了（不然这条用例就白测了）。
	var stored []Reminder
	if err := appDB.Order("id ASC").Find(&stored).Error; err != nil {
		t.Fatal(err)
	}
	rawOffsets := map[string]string{}
	for _, r := range stored {
		if r.DueAt != nil {
			rawOffsets[r.Title] = r.DueAt.Format("-07:00")
		}
	}
	if rawOffsets["明天8点UTC偏移"] != "+00:00" || rawOffsets["今天20点本机偏移"] != "+08:00" {
		t.Fatalf("存储偏移不符合预期，用例失去意义：%v", rawOffsets)
	}

	today, err := listReminders(appDB, userID, "today", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, r := range today {
		got[r.Title] = true
	}
	if got["第九天8点UTC偏移"] {
		t.Errorf("待办页只到第 7 天，不该出现第 9 天 08:00（本地）的条目（存的是 +00:00 偏移）：%v", titlesOf(today))
	}
	if !got["明天8点UTC偏移"] {
		t.Errorf("待办页现在是近 7 天，明天 08:00（存的是 +00:00 偏移）应该在：%v", titlesOf(today))
	}
	for _, want := range []string{"今天20点本机偏移", "昨天20点UTC偏移"} {
		if !got[want] {
			t.Errorf("今天页少了 %q（现有：%v）", want, titlesOf(today))
		}
	}

	// 计划页相反：明天那条必须在，今天那条不在。
	planned, err := listReminders(appDB, userID, "planned", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	plannedTitles := map[string]bool{}
	for _, r := range planned {
		plannedTitles[r.Title] = true
	}
	if !plannedTitles["明天8点UTC偏移"] {
		t.Errorf("计划页该有明天那条（跨偏移比较被漏掉了）：%v", titlesOf(planned))
	}
	if plannedTitles["今天20点本机偏移"] {
		t.Errorf("计划页不该有「就今天办」的普通任务：%v", titlesOf(planned))
	}
}

// 完成记录的时间窗口也要认偏移：跨偏移时「昨天完成」不能被漏进/漏出。
func TestCompletedRangeIsOffsetAware(t *testing.T) {
	withShanghaiLocal(t)
	cleanup := testDB(t)
	defer cleanup()

	const userID = 123
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	loc := shanghai()
	now := time.Now().In(loc)
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	// 两条都在「今天」窗口内，但一条用 +08:00 存、一条用 +00:00 存。
	fitsLocal := midnight.Add(9 * time.Hour)
	fitsUTC := midnight.Add(15 * time.Hour).UTC()
	for _, due := range []time.Time{fitsLocal, fitsUTC} {
		d := due
		if _, err := createReminder(appDB, userID, SaveReminderInput{
			Title: "完成-" + d.Format("-07:00"), ListID: list.ID, DueAt: &d, RepeatRule: "none",
		}); err != nil {
			t.Fatal(err)
		}
	}
	var rows []Reminder
	if err := appDB.Where("user_id = ?", userID).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	for i := range rows {
		if err := appDB.Model(&Reminder{}).Where("id = ?", rows[i].ID).
			Update("completed_at", rows[i].DueAt).Error; err != nil {
			t.Fatal(err)
		}
	}

	start := midnight
	end := midnight.AddDate(0, 0, 1)
	rng := CompletedRange{Start: &start, End: &end}
	items, err := listCompletedHistory(appDB, userID, rng, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("今天窗口内的完成记录应有 2 条（两种偏移各一条），实际 %d：%v", len(items), items)
	}
}

// 「稍后提醒」之后，今天 / 计划两个视图要跟着**生效时间**走。
//
// 2026-10-10 实测到的坑：一条今天 00:00 到期、被稍后到明天 00:34 的条目仍留在今天页，
// 而列表行显示的时间与按天分卡片的卡片头都是「明天」—— 同一个页面上自相矛盾。
// 现在今天页看 COALESCE(snoozed_until, due_at)，计划页的预设判断也用它。
func TestTodayViewKeepsSnoozedItems(t *testing.T) {
	withShanghaiLocal(t)
	cleanup := testDB(t)
	defer cleanup()

	const userID = 124
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	loc := shanghai()
	now := time.Now().In(loc)

	// 用户 2026-10-14：「逾期项目点击稍后提醒后不应该移出逾期栏目，只是再次提醒时间延迟；
	// 未逾期项目同样，不改变创建、到期时间，只是延迟提醒时间」。
	// 所以今天页看的是**原来的排期**（不说 snoozed_until）：稍后到明天之后，
	// 今天到期的还在今天页、逾期的一样在（并靠 isOverdue 归到「已逾期」分组）。
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	todayDue := midnight.Add(23 * time.Hour)
	todayItem, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "今天到期、稍后到明天", ListID: list.ID, DueAt: &todayDue, RepeatRule: "none",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := appDB.Model(&Reminder{}).Where("id = ?", todayItem.ID).
		Update("snoozed_until", todayDue.AddDate(0, 0, 1)).Error; err != nil {
		t.Fatal(err)
	}

	overdueDue := now.AddDate(0, 0, -2)
	overdueItem, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "逾期了还被顺延", ListID: list.ID, DueAt: &overdueDue, RepeatRule: "none",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := appDB.Model(&Reminder{}).Where("id = ?", overdueItem.ID).
		Update("snoozed_until", now.AddDate(0, 0, 1)).Error; err != nil {
		t.Fatal(err)
	}

	today, err := listReminders(appDB, userID, "today", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, r := range today {
		got[r.Title] = true
	}
	if !got["今天到期、稍后到明天"] {
		t.Errorf("今天到期、被稍后提醒的条目仍应留在今天页：%v", titlesOf(today))
	}
	if !got["逾期了还被顺延"] {
		t.Errorf("已经逾期、被稍后提醒的条目必须留在今天页（已逾期栏）：%v", titlesOf(today))
	}

	// 计划页是「明天及以后」：这两条的排期都在今天或更早，不该跑去计划页
	planned, err := listReminders(appDB, userID, "planned", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	plannedTitles := map[string]bool{}
	for _, r := range planned {
		plannedTitles[r.Title] = true
	}
	if plannedTitles["今天到期、稍后到明天"] || plannedTitles["逾期了还被顺延"] {
		t.Errorf("稍后提醒不该把它们挪到计划页：%v", titlesOf(planned))
	}

	// 列表里显示的排期时间也不该被 snooze 改掉
	items, err := listReminders(appDB, userID, "all", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID == todayItem.ID {
			if item.DueAt == nil || !sameInstant(*item.DueAt, todayDue.In(loc)) {
				t.Errorf("稍后提醒不该改到期时间：%v", item.DueAt)
			}
		}
	}
}
