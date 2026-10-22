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

	all, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", nil)
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
	// 「完成时段」要靠录入时间算：两个来源都必须回填，历史行（重复提醒）也一样。
	if got := byTitle["每天还款提醒"]; got.CreatedAt == nil || !got.CreatedAt.Equal(repeating.CreatedAt) {
		t.Fatalf("历史行的录入时间应从底层提醒回填，实际 %+v", got.CreatedAt)
	}
	if got := byTitle["一次性任务"]; got.CreatedAt == nil || !got.CreatedAt.Equal(once.CreatedAt) {
		t.Fatalf("提醒来源的录入时间应回填，实际 %+v", got.CreatedAt)
	}

	// 角标口径必须和列表一致，否则侧栏数字和页面条数对不上。
	if got := summaryCompleted(t, userID); got != int64(len(all)) {
		t.Fatalf("summary.completed=%d，列表 %d 条，两者必须一致", got, len(all))
	}

	// 删掉重复提醒后，它的完成历史仍应保留（靠 title_snapshot）。
	if err := deleteReminder(appDB, userID, repeating.ID); err != nil {
		t.Fatal(err)
	}
	afterDelete, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", nil)
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

	// 昨天：昨天 0 点到今天 0 点，左闭右开，和今天正好首尾相接不重叠。
	yesterday, err := ParseCompletedRange("yesterday", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if yesterday.Start == nil || !yesterday.Start.Equal(startOfToday.AddDate(0, 0, -1)) {
		t.Fatalf("yesterday 起点应为昨天 0 点，实际 %v", yesterday.Start)
	}
	if yesterday.End == nil || !yesterday.End.Equal(startOfToday) {
		t.Fatalf("yesterday 终点应为今天 0 点，实际 %v", yesterday.End)
	}

	// 一周从周一算起（国内习惯），而且是**整周**：终点是下周一 0 点。
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
	if week.End == nil || !week.End.Equal(week.Start.AddDate(0, 0, 7)) || week.End.Weekday() != time.Monday {
		t.Fatalf("week 终点应是下周一 0 点（整周），实际 %v", week.End)
	}
	if week.Start.Day() > startOfToday.Day() && week.Start.Month() == startOfToday.Month() {
		t.Fatalf("week 起点应落在本周，实际 %v", week.Start)
	}

	// 上周是上一个**自然周**（周一 → 周日），不是「最近 7 天」：
	// 起点必须是周一、终点必须正好接上本周起点，且跨月/跨年也要对。
	lastWeek, err := ParseCompletedRange("lastweek", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if lastWeek.Start == nil || lastWeek.Start.Weekday() != time.Monday {
		t.Fatalf("lastweek 起点应是周一，实际 %v (%v)", lastWeek.Start, lastWeek.Start.Weekday())
	}
	if lastWeek.End == nil || !lastWeek.End.Equal(*week.Start) {
		t.Fatalf("lastweek 终点应正好是本周起点（首尾相接），实际 %v vs %v", lastWeek.End, week.Start)
	}
	if !lastWeek.Start.Equal(week.Start.AddDate(0, 0, -7)) {
		t.Fatalf("lastweek 起点应是本周一往前 7 天，实际 %v", lastWeek.Start)
	}
	if lastWeek.End.Sub(*lastWeek.Start) != 7*24*time.Hour {
		t.Fatalf("lastweek 应恰好 7 天，实际 %v", lastWeek.End.Sub(*lastWeek.Start))
	}
	// 整段都在过去：终点（本周一 0 点）不能晚于今天 0 点。
	if lastWeek.End.After(startOfToday) {
		t.Fatalf("lastweek 不应包含今天之后的时刻，终点 %v", lastWeek.End)
	}

	// 本月/今年都是整段：终点是下个月 1 号 / 次年 1 月 1 号，而不是「此刻」。
	// 这一点是用户要求校准的重点：边界必须是固定的自然日历边界。
	month, err := ParseCompletedRange("month", "", "")
	if err != nil {
		t.Fatal(err)
	}
	startOfThisMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	if month.Start == nil || !month.Start.Equal(startOfThisMonth) {
		t.Fatalf("month 起点应是本月 1 日 0 点，实际 %v", month.Start)
	}
	if month.End == nil || !month.End.Equal(startOfThisMonth.AddDate(0, 1, 0)) {
		t.Fatalf("month 终点应是下月 1 日 0 点（整月），实际 %v", month.End)
	}

	// 上月是整月闭区间：本月 1 号往前一个月 → 本月 1 号。
	lastMonth, err := ParseCompletedRange("lastmonth", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if lastMonth.Start == nil || !lastMonth.Start.Equal(startOfThisMonth.AddDate(0, -1, 0)) {
		t.Fatalf("lastmonth 起点应是上个月 1 日，实际 %v", lastMonth.Start)
	}
	if lastMonth.End == nil || !lastMonth.End.Equal(startOfThisMonth) {
		t.Fatalf("lastmonth 终点应是本月 1 日，实际 %v", lastMonth.End)
	}
	if lastMonth.Start.Day() != 1 || !lastMonth.End.After(*lastMonth.Start) {
		t.Fatalf("lastmonth 区间不合法：%v ~ %v", lastMonth.Start, lastMonth.End)
	}

	year, err := ParseCompletedRange("year", "", "")
	if err != nil {
		t.Fatal(err)
	}
	startOfThisYear := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, loc)
	if year.Start == nil || !year.Start.Equal(startOfThisYear) {
		t.Fatalf("year 起点应是本年 1 月 1 日 0 点，实际 %v", year.Start)
	}
	if year.End == nil || !year.End.Equal(startOfThisYear.AddDate(1, 0, 0)) {
		t.Fatalf("year 终点应是次年 1 月 1 日 0 点（整年），实际 %v", year.End)
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
		{"custom", "不是日期", "2026-01-01"},       // 非法日期
		{"lastyear", "", ""},                   // 未知选项
	} {
		if _, err := ParseCompletedRange(bad[0], bad[1], bad[2]); err == nil {
			t.Fatalf("参数 %v 应被拒绝", bad)
		}
	}
}

// 区间描述是给用户核对用的（界面上显示「当前区间」），所以要保证左闭右开的
// 终点被正确回退一天：整月显示到 31 号，而不是下月 1 号。
func TestDescribeCompletedRange(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}

	all := DescribeCompletedRange(CompletedRange{}, loc)
	if all.Label != "不限时间" || all.Start != "" || all.End != "" {
		t.Fatalf("全部区间描述错误：%+v", all)
	}

	start := time.Date(2026, 10, 1, 0, 0, 0, 0, loc)
	end := time.Date(2026, 11, 1, 0, 0, 0, 0, loc)
	month := DescribeCompletedRange(CompletedRange{Start: &start, End: &end}, loc)
	if month.Label != "2026-10-01 ~ 2026-10-31" {
		t.Fatalf("整月描述错误：%+v", month)
	}

	nextDay := start.AddDate(0, 0, 1)
	oneDay := DescribeCompletedRange(CompletedRange{Start: &start, End: &nextDay}, loc)
	if oneDay.Label != "2026-10-01" {
		t.Fatalf("单日应只显示一天：%+v", oneDay)
	}

	openEnd := DescribeCompletedRange(CompletedRange{Start: &start}, loc)
	if openEnd.Label != "2026-10-01 起" {
		t.Fatalf("只有起点时的描述错误：%+v", openEnd)
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

// 多清单筛选：日历与已完成页都靠它决定「显示哪些清单」。
func TestMultiListFilter(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 31
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	base, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	other := List{UserID: userID, Name: "工作", Color: "violet", Icon: "list", Position: 2}
	if err := appDB.Create(&other).Error; err != nil {
		t.Fatal(err)
	}

	due := time.Date(2026, time.May, 10, 9, 0, 0, 0, loc)
	mk := func(title string, listID uint) ReminderDTO {
		t.Helper()
		d := due
		item, err := createReminder(appDB, userID, SaveReminderInput{
			Title: title, ListID: listID, DueAt: &d, RepeatRule: "none",
		})
		if err != nil {
			t.Fatal(err)
		}
		return item
	}
	a := mk("默认清单里的", base.ID)
	b := mk("工作清单里的", other.ID)

	from := time.Date(2026, time.May, 10, 0, 0, 0, 0, loc)
	to := time.Date(2026, time.May, 11, 0, 0, 0, 0, loc)

	// 不筛选 = 全部
	all, err := listCalendarItems(appDB, userID, from, to, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("不筛选应返回 2 条，实际 %d", len(all))
	}

	// 只选默认清单
	onlyBase, err := listCalendarItems(appDB, userID, from, to, []uint{base.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(onlyBase) != 1 || onlyBase[0].ID != a.ID {
		t.Fatalf("按默认清单筛选应只剩 1 条，实际 %+v", onlyBase)
	}

	// 多选 = 两个都要
	both, err := listCalendarItems(appDB, userID, from, to, []uint{base.ID, other.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(both) != 2 {
		t.Fatalf("多选两个清单应返回 2 条，实际 %d", len(both))
	}

	// 选中一个不存在的清单 = 空
	none, err := listCalendarItems(appDB, userID, from, to, []uint{9999})
	if err != nil {
		t.Fatal(err)
	}
	if len(none) != 0 {
		t.Fatalf("选中不存在的清单应为空，实际 %d", len(none))
	}

	// 完成一条，验证已完成页同样支持多清单筛选
	if _, err := completeReminder(appDB, userID, b.ID); err != nil {
		t.Fatal(err)
	}
	histAll, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(histAll) != 1 {
		t.Fatalf("已完成不筛选应有 1 条，实际 %d", len(histAll))
	}
	histBase, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", []uint{base.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(histBase) != 0 {
		t.Fatalf("按默认清单筛已完成应为 0 条，实际 %d", len(histBase))
	}
	histOther, err := listCompletedHistory(appDB, userID, CompletedRange{}, "", []uint{other.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(histOther) != 1 || histOther[0].ReminderID != b.ID {
		t.Fatalf("按工作清单筛已完成应有 1 条，实际 %+v", histOther)
	}
}
