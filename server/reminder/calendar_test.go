package reminder

import (
	"testing"
	"time"
)

// 日历要能看到「这天有哪些安排、哪些已经做完」，所以含已完成项；
// 记事没有到期日，必须被排除；区间是左闭右开，并按上海时区归日。
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
	// 记事没有到期日，不该出现在日历里。
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "一条记事", ListID: list.ID, Kind: KindNote,
	}); err != nil {
		t.Fatal(err)
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
	if len(items) != 3 {
		t.Fatalf("区间内应有 3 条（含已完成、不含区间外与记事），实际 %d 条: %v", len(items), titles)
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
