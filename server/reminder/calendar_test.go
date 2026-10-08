package reminder

import (
	"testing"
	"time"
)

// 日历要能看到「这天有哪些安排、哪些已经做完」，所以含已完成项；
// 记事没有到期时间，按**记录时间**落进日历（见 listCalendarItems）；
// 区间是左闭右开，并按上海时区归日。
func TestListCalendarItems(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	const userID = 21
	at := func(day, hour int) time.Time {
		return time.Date(2026, time.March, day, hour, 0, 0, 0, loc)
	}

	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}

	mk := func(title string, due time.Time) ReminderDTO {
		t.Helper()
		d := due
		item, err := createReminder(appDB, userID, SaveReminderInput{
			Title: title, ListID: list.ID, DueAt: &d, RepeatRule: "none",
		})
		if err != nil {
			t.Fatal(err)
		}
		return item
	}

	mk("区间内第一天", at(10, 9))
	mk("区间内最后一天", at(16, 9))
	mk("区间前一天", at(9, 9))
	mk("区间后一天", at(17, 9))
	done := mk("区间内已完成", at(12, 9))
	if _, err := completeReminder(appDB, userID, done.ID); err != nil {
		t.Fatal(err)
	}
	// 记事没有到期时间，但按记录时间（=创建时刻，写进 completed_at）进日历。
	note, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "一条记事", ListID: list.ID, Kind: KindNote,
	})
	if err != nil {
		t.Fatal(err)
	}
	if note.CompletedAt == nil {
		t.Fatal("记事创建即完成，completed_at 不应为空")
	}

	// [3/10, 3/17) —— 含 10 日与 16 日，不含 9 日与 17 日。
	items, err := listCalendarItems(appDB, userID, at(10, 0), at(17, 0), nil)
	if err != nil {
		t.Fatal(err)
	}
	titles := make([]string, 0, len(items))
	completed := map[string]bool{}
	dueDates := map[string]string{}
	for _, it := range items {
		titles = append(titles, it.Title)
		completed[it.Title] = it.Completed
		dueDates[it.Title] = it.DueDate
	}
	// 记事的记录时间是「现在」（2026 年之外的今天），不在 3/10–3/17 这个区间里。
	if len(items) != 3 {
		t.Fatalf("区间内应有 3 条（含已完成、不含区间外与记事），实际 %d 条: %v", len(items), titles)
	}
	for _, it := range items {
		if it.Kind == KindNote {
			t.Fatalf("记事不该落在这个区间：%+v", it)
		}
	}
	for _, want := range []string{"区间内第一天", "区间内已完成", "区间内最后一天"} {
		if _, ok := completed[want]; !ok {
			t.Fatalf("缺少 %q，实际 %v", want, titles)
		}
	}
	if !completed["区间内已完成"] {
		t.Fatal("已完成项的 Completed 应为 true")
	}
	if completed["区间内第一天"] {
		t.Fatal("未完成项的 Completed 应为 false")
	}
	// 排序：按到期时间升序。
	if items[0].Title != "区间内第一天" || items[2].Title != "区间内最后一天" {
		t.Fatalf("应按到期时间升序，实际 %v", titles)
	}
	// 归日走上海时区，且带上清单名/颜色供前端上色。
	if dueDates["区间内第一天"] != "2026-03-10" {
		t.Fatalf("DueDate 应为 2026-03-10，实际 %q", dueDates["区间内第一天"])
	}
	if items[0].ListName != list.Name || items[0].ListColor == "" {
		t.Fatalf("应带清单名与颜色，实际 %+v", items[0])
	}

	// 跨天边界：23:59 仍算当天，次日 00:00 算下一天。
	late := at(20, 23)
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "深夜", ListID: list.ID, DueAt: &late, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	day, err := listCalendarItems(appDB, userID, at(20, 0), at(21, 0), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(day) != 1 || day[0].DueDate != "2026-03-20" {
		t.Fatalf("深夜提醒应归到 2026-03-20，实际 %+v", day)
	}

	// 空区间返回空切片而不是 nil，前端可以直接遍历。
	empty, err := listCalendarItems(appDB, userID, at(1, 0), at(2, 0), nil)
	if err != nil {
		t.Fatal(err)
	}
	if empty == nil || len(empty) != 0 {
		t.Fatalf("空区间应返回空切片，实际 %#v", empty)
	}
}

// TestCalendarIncludesNotesOnRecordDate 锁住「记事按记录时间进日历」：
// 记事没有到期时间，但它是「哪天记的」这件事必须能在日历上看到——否则用户
// 刚创建的工作记录在日历里凭空消失（实测就是这么反馈的）。
func TestCalendarIncludesNotesOnRecordDate(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	const userID = 33
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	// 一条任务落在 3/11，两条记事分别落在 3/10 与 3/12（记事的记录时间就是创建时刻，
	// 创建后直接改库里的 completed_at，避免用例依赖「运行时刻」）。
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "任务", ListID: list.ID,
		DueAt: ptrTime(time.Date(2026, time.March, 11, 9, 0, 0, 0, loc)), RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	mkNote := func(title string, day int) uint {
		t.Helper()
		note, err := createReminder(appDB, userID, SaveReminderInput{
			Title: title, ListID: list.ID, Kind: KindNote, Notes: title + " 的备注",
		})
		if err != nil {
			t.Fatal(err)
		}
		at := time.Date(2026, time.March, day, 14, 30, 0, 0, loc)
		if err := appDB.Model(&Reminder{}).Where("id = ?", note.ID).
			UpdateColumn("completed_at", at).Error; err != nil {
			t.Fatal(err)
		}
		return note.ID
	}
	mkNote("十日记事", 10)
	mkNote("十二日记事", 12)
	// 区间外（4 月）与已删除的都不该出现。
	outside := mkNote("四月记事", 10)
	if err := appDB.Model(&Reminder{}).Where("id = ?", outside).
		UpdateColumn("completed_at", time.Date(2026, time.April, 10, 9, 0, 0, 0, loc)).Error; err != nil {
		t.Fatal(err)
	}
	deleted := mkNote("三月的删除记事", 13)
	if err := deleteReminder(appDB, userID, deleted); err != nil {
		t.Fatal(err)
	}

	items, err := listCalendarItems(appDB, userID,
		time.Date(2026, time.March, 10, 0, 0, 0, 0, loc),
		time.Date(2026, time.March, 13, 0, 0, 0, 0, loc), nil)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]CalendarItemDTO{}
	order := make([]string, 0, len(items))
	for _, it := range items {
		got[it.Title] = it
		order = append(order, it.Title)
	}
	if len(items) != 3 {
		t.Fatalf("应有 3 条（1 任务 + 2 记事），实际 %d 条：%v", len(items), order)
	}
	note := got["十日记事"]
	if note.Kind != KindNote {
		t.Fatalf("记事的 kind 应为 note，实际 %q", note.Kind)
	}
	if note.DueDate != "2026-03-10" {
		t.Fatalf("记事应按记录时间归到 2026-03-10，实际 %q", note.DueDate)
	}
	if !note.Completed {
		t.Fatal("记事创建即完成，Completed 应为 true")
	}
	if note.Notes != "十日记事 的备注" {
		t.Fatalf("导出需要备注原文，实际 %q", note.Notes)
	}
	// 排序按「生效时间」（任务看到期、记事看记录），混合排列。
	want := []string{"十日记事", "任务", "十二日记事"}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("应按生效时间升序 %v，实际 %v", want, order)
		}
	}
}

// TestListRemindersIncludeCompleted 覆盖「未完成 / 全部」开关的服务端口径：
// 打开后已完成的行也返回（记事因此能在「我的清单」里看见），且已完成排在最后。
func TestListRemindersIncludeCompleted(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	due := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	const userID = 44
	open, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "未完成的任务", DueAt: &due, RepeatRule: "none",
	})
	if err != nil {
		t.Fatal(err)
	}
	finished, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "已完成的任务", DueAt: &due, RepeatRule: "none",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminder(appDB, userID, finished.ID); err != nil {
		t.Fatal(err)
	}
	note, err := createReminder(appDB, userID, SaveReminderInput{Title: "一条记事", Kind: KindNote})
	if err != nil {
		t.Fatal(err)
	}

	// 关着开关：只看未完成，记事不出现。
	openOnly, err := listReminders(appDB, userID, "all", "", nil, false, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(openOnly) != 1 || openOnly[0].ID != open.ID {
		t.Fatalf("未完成口径应只有 1 条，实际 %+v", titlesOf(openOnly))
	}

	// 打开开关：三条都在，已完成的（任务与记事）排在后面。
	all, err := listReminders(appDB, userID, "all", "", nil, true, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("「全部」应有 3 条，实际 %d 条：%v", len(all), titlesOf(all))
	}
	if all[0].ID != open.ID {
		t.Fatalf("未完成的应排在最前，实际第一条是 %q", all[0].Title)
	}
	for _, item := range all[1:] {
		if item.CompletedAt == nil {
			t.Fatalf("已完成的应排在后面，实际 %q 还没有完成时间", item.Title)
		}
	}
	if all[2].ID != note.ID && all[1].ID != note.ID {
		t.Fatalf("记事应出现在「全部」里，实际 %v", titlesOf(all))
	}
	// 「已完成」页的开关打开也不该改变它自己的口径（它本来就只看已完成）。
	doneView, err := listReminders(appDB, userID, "completed", "", nil, true, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(doneView) != 2 {
		t.Fatalf("已完成视图应仍是 2 条，实际 %d 条", len(doneView))
	}
}

func ptrTime(t time.Time) *time.Time { return &t }

func titlesOf(items []ReminderDTO) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, item.Title)
	}
	return out
}
