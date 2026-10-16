package reminder

import (
	"testing"
	"time"
)

// 计划页口径：只放「预设信息」——有循环规则的、有时间段的、或排在明天及以后的任务；
// 待办页那些「就今天办」的普通任务不进计划页，记事也永远不进（它没有排期）。
func TestPlannedViewOnlyPresets(t *testing.T) {
	withShanghaiLocal(t)
	cleanup := testDB(t)
	defer cleanup()

	const userID = 71
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	loc := shanghai()
	todayNoon := time.Date(now.In(loc).Year(), now.In(loc).Month(), now.In(loc).Day(), 20, 0, 0, 0, loc)
	tomorrow := todayNoon.AddDate(0, 0, 1)
	yesterday := todayNoon.AddDate(0, 0, -1)
	rangeStart := todayNoon.AddDate(0, 0, 2)
	rangeEnd := rangeStart.Add(2 * time.Hour)

	mk := func(title string, in SaveReminderInput) uint {
		in.Title = title
		in.ListID = list.ID
		if in.RepeatRule == "" {
			in.RepeatRule = "none"
		}
		created, err := createReminder(appDB, userID, in)
		if err != nil {
			t.Fatalf("建 %q 失败：%v", title, err)
		}
		return created.ID
	}
	mk("只有今天", SaveReminderInput{DueAt: &todayNoon})
	mk("明天的事", SaveReminderInput{DueAt: &tomorrow})
	mk("每天的例行", SaveReminderInput{DueAt: &yesterday, RepeatRule: "daily"})
	mk("跨两小时的时间段", SaveReminderInput{StartAt: &rangeStart, EndAt: &rangeEnd})
	mk("记事", SaveReminderInput{Kind: KindNote})
	// 待办页只看到第 7 天（今天 + 7 天 20:00 已经在窗口之外）
	day8 := todayNoon.AddDate(0, 0, 7)
	mk("第八天的事", SaveReminderInput{DueAt: &day8})

	planned, err := listReminders(appDB, userID, "planned", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, r := range planned {
		got[r.Title] = true
	}
	for _, want := range []string{"明天的事", "每天的例行", "跨两小时的时间段"} {
		if !got[want] {
			t.Errorf("计划页少了 %q（现有：%v）", want, keysOf(got))
		}
	}
	for _, notWant := range []string{"只有今天", "记事"} {
		if got[notWant] {
			t.Errorf("计划页不该出现 %q", notWant)
		}
	}

	today, err := listReminders(appDB, userID, "today", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	// 待办页（2026-10-16 起由「今天」改名）：排期落在今天起 7 天内的 + 逾期未完成的，
	// 且逾期的排在最前。
	if len(today) != 4 {
		t.Fatalf("待办页应有 4 条（近 7 天的 3 条 + 逾期的 1 条），实际 %d：%v", len(today), titlesOf(today))
	}
	if today[0].Title != "每天的例行" {
		t.Errorf("逾期未完成的应置顶，实际第一条是 %q", today[0].Title)
	}
	inToday := map[string]bool{}
	for _, r := range today {
		inToday[r.Title] = true
	}
	for _, want := range []string{"只有今天", "明天的事", "跨两小时的时间段"} {
		if !inToday[want] {
			t.Errorf("待办页少了 %q（现有：%v）", want, keysOf(inToday))
		}
	}
	if inToday["第八天的事"] {
		t.Errorf("待办页只显示到第 7 天，不该出现「第八天的事」：%v", titlesOf(today))
	}
}

// 时间段校验：开始/结束必须成对且有序；有区间时 DueAt 归到开始时间。
func TestReminderRangeValidation(t *testing.T) {
	withShanghaiLocal(t)
	cleanup := testDB(t)
	defer cleanup()

	const userID = 72
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	loc := shanghai()
	start := time.Date(2026, time.October, 10, 14, 0, 0, 0, loc)
	end := time.Date(2026, time.October, 10, 16, 0, 0, 0, loc)

	// 只给结束 → 拒绝
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "只有结束", ListID: list.ID, EndAt: &end, RepeatRule: "none",
	}); err == nil {
		t.Fatal("只给结束时间应当被拒绝")
	}
	// 结束早于开始 → 拒绝
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "时间颠倒", ListID: list.ID, StartAt: &end, EndAt: &start, RepeatRule: "none",
	}); err == nil {
		t.Fatal("结束早于开始应当被拒绝")
	}
	// 两个都给 → 落库，DueAt = StartAt
	full, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "开会 14-16", ListID: list.ID, StartAt: &start, EndAt: &end, RepeatRule: "none",
	})
	if err != nil {
		t.Fatal(err)
	}
	if full.StartAt == nil || full.EndAt == nil || !full.StartAt.Equal(start) || !full.EndAt.Equal(end) {
		t.Fatalf("时间段没有原样落库：%+v / %+v", full.StartAt, full.EndAt)
	}
	if full.DueAt == nil || !full.DueAt.Equal(start) {
		t.Fatalf("有区间时 DueAt 应等于开始时间，实际 %+v", full.DueAt)
	}
	// 只给开始 → 当作单点时间
	only, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "只给开始", ListID: list.ID, StartAt: &start, RepeatRule: "none",
	})
	if err != nil {
		t.Fatal(err)
	}
	if only.EndAt != nil {
		t.Fatalf("只给开始时应没有结束时间，实际 %+v", only.EndAt)
	}
	if only.DueAt == nil || !only.DueAt.Equal(start) {
		t.Fatalf("只给开始时应把 DueAt 设为开始时间，实际 %+v", only.DueAt)
	}
	// 记事必须把区间一起清掉
	note, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "记事", Kind: KindNote, ListID: list.ID, StartAt: &start, EndAt: &end,
	})
	if err != nil {
		t.Fatal(err)
	}
	if note.StartAt != nil || note.EndAt != nil || note.DueAt != nil {
		t.Fatalf("记事不该带排期：%+v / %+v / %+v", note.StartAt, note.EndAt, note.DueAt)
	}
}

// 时间段要能跟着同步走到对端（字段进了快照、比较与落地三处）。
func TestSyncCarriesTimeRange(t *testing.T) {
	withShanghaiLocal(t)
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	seedUser(t, dbB, "王耀辉", "admin")
	list, err := ensureDefaultList(dbA, userA.ID)
	if err != nil {
		t.Fatal(err)
	}
	loc := shanghai()
	start := time.Date(2026, time.October, 12, 9, 0, 0, 0, loc)
	end := time.Date(2026, time.October, 12, 11, 30, 0, 0, loc)
	if _, err := createReminder(dbA, userA.ID, SaveReminderInput{
		Title: "季度评审", ListID: list.ID, StartAt: &start, EndAt: &end,
		RepeatRule: "none", Channels: []string{ChannelInApp},
	}); err != nil {
		t.Fatal(err)
	}
	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, snap); err != nil {
		t.Fatal(err)
	}
	var inB Reminder
	if err := dbB.Where("title = ?", "季度评审").First(&inB).Error; err != nil {
		t.Fatal(err)
	}
	if inB.StartAt == nil || inB.EndAt == nil || !inB.StartAt.Equal(start) || !inB.EndAt.Equal(end) {
		t.Fatalf("对端没拿到时间段：%+v / %+v", inB.StartAt, inB.EndAt)
	}
	movedEnd := end.Add(time.Hour)
	assertSameFingerprint(t, fingerprint(t, dbA), fingerprint(t, dbB), "时间段首次同步后")

	// 在 A 上改结束时间，再同步一次
	var inA Reminder
	if err := dbA.Where("title = ?", "季度评审").First(&inA).Error; err != nil {
		t.Fatal(err)
	}
	updated, err := updateReminder(dbA, userA.ID, inA.ID, SaveReminderInput{
		Title: inA.Title, ListID: inA.ListID, StartAt: &start, EndAt: &movedEnd,
		RepeatRule: "none", Channels: []string{ChannelInApp}, Version: inA.Version,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.EndAt == nil || !updated.EndAt.Equal(movedEnd) {
		t.Fatalf("A 上没改成功：%+v", updated.EndAt)
	}
	snap2, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, snap2); err != nil {
		t.Fatal(err)
	}
	var afterB Reminder
	if err := dbB.Where("title = ?", "季度评审").First(&afterB).Error; err != nil {
		t.Fatal(err)
	}
	if afterB.EndAt == nil || !afterB.EndAt.Equal(movedEnd) {
		t.Fatalf("结束时间没同步到对端：%+v", afterB.EndAt)
	}
	assertSameFingerprint(t, fingerprint(t, dbA), fingerprint(t, dbB), "改区间后再同步")
}

func keysOf(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// 「全部」页按月翻页 + 计划页「全部」只收本月已完成。
func TestMonthScopedViews(t *testing.T) {
	withShanghaiLocal(t)
	cleanup := testDB(t)
	defer cleanup()

	const userID = 73
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	loc := shanghai()
	now := time.Now().In(loc)
	thisMonth := time.Date(now.Year(), now.Month(), 10, 10, 0, 0, 0, loc)
	lastMonth := thisMonth.AddDate(0, -1, 0)

	mk := func(title string, due time.Time, repeat string) Reminder {
		dto, err := createReminder(appDB, userID, SaveReminderInput{
			Title: title, ListID: list.ID, DueAt: &due, RepeatRule: repeat, Channels: []string{ChannelInApp},
		})
		if err != nil {
			t.Fatalf("建 %q 失败：%v", title, err)
		}
		var row Reminder
		if err := appDB.Where("id = ?", dto.ID).First(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}
	mk("上月未完成", lastMonth, "none")
	mk("本月未完成", thisMonth, "none")
	thisDone := mk("本月已完成", thisMonth.AddDate(0, 0, 1), "none")
	if _, err := completeReminder(appDB, userID, thisDone.ID); err != nil {
		t.Fatal(err)
	}
	lastDone := mk("上月已完成", lastMonth.AddDate(0, 0, 1), "none")
	if _, err := completeReminder(appDB, userID, lastDone.ID); err != nil {
		t.Fatal(err)
	}
	// 把「上月已完成」的完成时间挪回上个月（completeReminder 只会写成当下）
	if err := appDB.Model(&Reminder{}).Where("id = ?", lastDone.ID).
		UpdateColumn("completed_at", lastMonth.AddDate(0, 0, 2)).Error; err != nil {
		t.Fatal(err)
	}

	// 旧的 month 兼容参数换算成 from/to，与接口路径一致。
	windowFrom, windowTo := monthWindow(now.Format("2006-01"))
	titles := func(rows []ReminderDTO) map[string]bool {
		out := map[string]bool{}
		for _, r := range rows {
			out[r.Title] = true
		}
		return out
	}

	// 「全部」页：带时间窗口 → 只有当月；不带窗口 → 全都要有（导出用的就是这条路径）
	scoped, err := listReminders(appDB, userID, "all", "", nil, true, windowFrom, windowTo, "")
	if err != nil {
		t.Fatal(err)
	}
	got := titles(scoped)
	if !got["本月未完成"] || !got["本月已完成"] {
		t.Errorf("按月筛选少了本月条目：%v", keysOf(got))
	}
	if got["上月未完成"] || got["上月已完成"] {
		t.Errorf("按月筛选混进了上月条目：%v", keysOf(got))
	}
	unscoped, err := listReminders(appDB, userID, "all", "", nil, true, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	all := titles(unscoped)
	for _, want := range []string{"上月未完成", "本月未完成", "本月已完成", "上月已完成"} {
		if !all[want] {
			t.Errorf("不带月份时少了 %q（导出必须能拿到所有数据）", want)
		}
	}

	// 计划页的「全部」：本月完成的**预设**（循环任务）要出现，上月完成的不出现
	presetDone := mk("本月完成的例行", thisMonth, "daily")
	if _, err := completeReminder(appDB, userID, presetDone.ID); err != nil {
		t.Fatal(err)
	}
	oldPreset := mk("上月完成的例行", lastMonth, "daily")
	if _, err := completeReminder(appDB, userID, oldPreset.ID); err != nil {
		t.Fatal(err)
	}
	if err := appDB.Model(&Reminder{}).Where("id = ?", oldPreset.ID).
		UpdateColumn("completed_at", lastMonth.AddDate(0, 0, 3)).Error; err != nil {
		t.Fatal(err)
	}
	planned, err := listReminders(appDB, userID, "planned", "", nil, true, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	pgot := titles(planned)
	if !pgot["本月完成的例行"] {
		t.Errorf("计划页「全部」应包含本月已完成的预设：%v", keysOf(pgot))
	}
	if pgot["上月完成的例行"] {
		t.Errorf("计划页「全部」不该包含上个月完成的条目：%v", keysOf(pgot))
	}
}
