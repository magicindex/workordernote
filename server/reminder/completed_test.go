package reminder

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// summaryCompleted 直接打 /summary 接口取「已完成」角标值。角标与列表必须同口径，
// 而这个计数是并进 summary 那条聚合 SQL 的子查询里的，所以只能这样验证。
func summaryCompleted(t *testing.T, userID uint) int64 {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/reminder/summary", nil)
	context.Set("userID", userID)
	handleSummary(appDB)(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("summary 返回 %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data map[string]int64 `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Data["completed"]
}

// 「已完成」必须同时覆盖两条数据来源，否则重复提醒的完成记录会全部丢失：
// 重复提醒完成时只往 completions 写历史、把 due_at 滚到下一次，completed_at 始终为空。
func TestCompletedHistoryUnionsReminderAndHistorySources(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 11

	// 1) 重复提醒：完成一次 -> 写进 completions 历史
	due := time.Now().Add(time.Hour).Truncate(time.Second)
	repeating, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "每天还款提醒", DueAt: &due, RepeatRule: "daily",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminder(appDB, userID, repeating.ID); err != nil {
		t.Fatal(err)
	}
	// 完成重复提醒不应写 completed_at，这正是历史表存在的理由。
	var afterRepeat Reminder
	if err := appDB.First(&afterRepeat, repeating.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterRepeat.CompletedAt != nil {
		t.Fatal("重复提醒完成后 completed_at 应为空")
	}

	// 2) 一次性任务：完成 -> 只写 completed_at，不进历史表
	once, err := createReminder(appDB, userID, SaveReminderInput{Title: "一次性任务"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminder(appDB, userID, once.ID); err != nil {
		t.Fatal(err)
	}

	// 3) 记事：创建即完成
	if _, err := createReminder(appDB, userID, SaveReminderInput{Title: "一条记事", Kind: KindNote}); err != nil {
		t.Fatal(err)
	}

	all, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("应合并出 3 条完成记录，实际 %d 条: %+v", len(all), all)
	}
	// 倒序：记事与两个完成都在「刚刚」，只校验来源与标题齐备。
	byTitle := map[string]CompletedItemDTO{}
	for _, item := range all {
		byTitle[item.Title] = item
	}
	if got := byTitle["每天还款提醒"]; got.Source != "history" || got.ReminderID != repeating.ID {
		t.Fatalf("重复提醒的完成应来自 history，实际 %+v", got)
	}
	if got := byTitle["一次性任务"]; got.Source != "reminder" || !got.ReminderExists {
		t.Fatalf("一次性任务的完成应来自 reminder，实际 %+v", got)
	}
	if got := byTitle["一条记事"]; got.Source != "reminder" || got.Kind != KindNote {
		t.Fatalf("记事应来自 reminder 且 kind=note，实际 %+v", got)
	}

	// 角标口径必须和列表一致，否则侧栏数字和页面条数对不上。
	if got := summaryCompleted(t, userID); got != int64(len(all)) {
		t.Fatalf("summary.completed=%d，列表 %d 条，两者必须一致", got, len(all))
	}

	// 删掉重复提醒后，它的完成历史仍应保留（靠 title_snapshot）。
	if err := deleteReminder(appDB, userID, repeating.ID); err != nil {
		t.Fatal(err)
	}
	afterDelete, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	var found *CompletedItemDTO
	for i := range afterDelete {
		if afterDelete[i].Title == "每天还款提醒" {
			found = &afterDelete[i]
		}
	}
	if found == nil {
		t.Fatal("提醒删除后完成历史不应消失")
	}
	if found.ReminderExists {
		t.Fatal("提醒已删除，ReminderExists 应为 false")
	}
	// 提醒删掉后，它的完成历史既不该从列表消失，也不该从角标里掉出去。
	if got := summaryCompleted(t, userID); got != int64(len(afterDelete)) {
		t.Fatalf("删除提醒后 summary.completed=%d，列表 %d 条，两者必须一致", got, len(afterDelete))
	}
}

func TestParseCompletedRange(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().In(loc)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	// 空值 / all 表示不限时间，保证不传参数的老客户端行为不变。
	for _, option := range []string{"", "all"} {
		rng, err := ParseCompletedRange(option, "", "")
		if err != nil {
			t.Fatalf("%q 不应报错: %v", option, err)
		}
		if rng.Start != nil || rng.End != nil {
			t.Fatalf("%q 应为不限时间，实际 %+v", option, rng)
		}
	}

	today, err := ParseCompletedRange("today", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if today.Start == nil || !today.Start.Equal(startOfToday) {
		t.Fatalf("today 起点应为今天 0 点，实际 %v", today.Start)
	}
	if today.End == nil || !today.End.Equal(startOfToday.AddDate(0, 0, 1)) {
		t.Fatalf("today 终点应为明天 0 点，实际 %v", today.End)
	}

	// 一周从周一算起（国内习惯）。
	week, err := ParseCompletedRange("week", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if week.Start == nil || week.Start.Weekday() != time.Monday {
		t.Fatalf("week 起点应是周一，实际 %v (%v)", week.Start, week.Start.Weekday())
	}
	if week.Start.After(startOfToday) {
		t.Fatalf("week 起点不应晚于今天 0 点，实际 %v", week.Start)
	}

	month, err := ParseCompletedRange("month", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if month.Start == nil || month.Start.Day() != 1 || month.Start.Month() != now.Month() {
		t.Fatalf("month 起点应是本月 1 日，实际 %v", month.Start)
	}

	year, err := ParseCompletedRange("year", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if year.Start == nil || year.Start.Month() != time.January || year.Start.Day() != 1 || year.Start.Year() != now.Year() {
		t.Fatalf("year 起点应是本年 1 月 1 日，实际 %v", year.Start)
	}

	// 自定义区间含结束日期当天，所以终点是「结束日期 + 1 天」。
	custom, err := ParseCompletedRange("custom", "2026-01-01", "2026-01-31")
	if err != nil {
		t.Fatal(err)
	}
	wantStart := time.Date(2026, 1, 1, 0, 0, 0, 0, loc)
	wantEnd := time.Date(2026, 2, 1, 0, 0, 0, 0, loc)
	if custom.Start == nil || !custom.Start.Equal(wantStart) {
		t.Fatalf("custom 起点错误：%v", custom.Start)
	}
	if custom.End == nil || !custom.End.Equal(wantEnd) {
		t.Fatalf("custom 终点应是结束日期次日，实际 %v", custom.End)
	}

	for _, bad := range [][3]string{
		{"custom", "2026-02-01", "2026-01-01"}, // 结束早于开始
		{"custom", "", "2026-01-01"},           // 缺开始日期
		{"custom", "不是日期", "2026-01-01"},      // 非法日期
		{"lastyear", "", ""},                   // 未知选项
	} {
		if _, err := ParseCompletedRange(bad[0], bad[1], bad[2]); err == nil {
			t.Fatalf("参数 %v 应被拒绝", bad)
		}
	}
}

func TestSetDefaultListKeepsExactlyOneDefault(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 12
	first, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	if !first.IsDefault {
		t.Fatal("首次初始化应产生一个默认清单")
	}

	other := List{UserID: userID, Name: "工作", Color: "violet", Icon: "list", Position: 2}
	if err := appDB.Create(&other).Error; err != nil {
		t.Fatal(err)
	}

	if err := setDefaultList(appDB, userID, other.ID); err != nil {
		t.Fatal(err)
	}
	// 无论怎么切换，任何时刻都必须恰好有一个默认清单：新建提醒不带清单、
	// 删除清单后归置提醒都依赖它。
	var defaults []List
	if err := appDB.Where("user_id = ? AND is_default = ? AND deleted_at IS NULL", userID, true).
		Find(&defaults).Error; err != nil {
		t.Fatal(err)
	}
	if len(defaults) != 1 || defaults[0].ID != other.ID {
		t.Fatalf("默认清单应唯一且为 %d，实际 %+v", other.ID, defaults)
	}
	// ensureDefaultList 必须跟着返回新的默认清单，而不是又建一个。
	resolved, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ID != other.ID {
		t.Fatalf("ensureDefaultList 应返回新的默认清单 %d，实际 %d", other.ID, resolved.ID)
	}
	// 重复设置同一个清单应当幂等。
	if err := setDefaultList(appDB, userID, other.ID); err != nil {
		t.Fatalf("重复设为默认不应报错: %v", err)
	}
	// 别人的清单不能设为默认。
	if err := setDefaultList(appDB, 999, other.ID); err == nil {
		t.Fatal("把不属于该用户的清单设为默认应被拒绝")
	}
}
