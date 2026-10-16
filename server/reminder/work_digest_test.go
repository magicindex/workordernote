package reminder

import (
	"strings"
	"testing"
	"time"
)

// 免打扰/周报这些功能都依赖「时间段口径」与「已完成 页一致」。这里固定一个
// 时刻（2026-10-16 周五 17:30 上海），把本周/上周/未完成/关键词/记事几条
// 路径都钉死；换时刻的用例单独写在 TestDetectWorkOptions 里。
func workDigestFixture(t *testing.T) (uint, time.Time) {
	t.Helper()
	loc := shanghai()
	now := time.Date(2026, 10, 16, 17, 30, 0, 0, loc)
	const userID = 21

	work := seedWorkList(t, userID, "工作安排", "blue")
	card := seedWorkList(t, userID, "信用卡账单", "amber")
	other := seedWorkList(t, userID, "个人事务", "violet")

	at := func(day int, hour, minute int) *time.Time {
		t := time.Date(2026, 10, day, hour, minute, 0, 0, loc)
		return &t
	}
	// 本周完成（周三 09:30）
	seedWorkReminder(t, userID, work.ID, "黄河农场大楼wifi覆盖优化", KindTask, at(14, 9, 30), at(14, 9, 30))
	// 上周完成（10-08 15:00）——「本周」不该收它，「上周」才收
	seedWorkReminder(t, userID, other.ID, "上周的巡检记录", KindTask, at(8, 15, 0), at(8, 15, 0))
	// 本周完成、命中关键词
	seedWorkReminder(t, userID, work.ID, "王庄基站光缆巡检", KindTask, at(13, 11, 0), at(13, 11, 0))
	// 已逾期未完成（昨天 23:59）
	seedWorkReminder(t, userID, work.ID, "别忘记发今天5G工单", KindTask, at(15, 23, 59), nil)
	// 本周内到期、还没做完（明天 23:59）
	seedWorkReminder(t, userID, work.ID, "李阳报障利泉村委AP故障", KindTask, at(17, 23, 59), nil)
	// 下下周才到期：本周/上周的报告都不该收
	seedWorkReminder(t, userID, card.ID, "下下周的割接", KindTask, at(25, 9, 0), nil)
	// 记事：记录时间落在本周
	seedWorkReminder(t, userID, other.ID, "王庄基站现场照片已归档", KindNote, nil, at(13, 10, 0))
	return userID, now
}

func seedWorkList(t *testing.T, userID uint, name, color string) List {
	t.Helper()
	row := List{UserID: userID, Name: name, Color: color, Icon: "list", Template: "general"}
	if err := appDB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	return row
}

// seedWorkReminder 直接落库：这里要的是「某天完成/某天到期」的历史数据，
// 走 createReminder + completeReminder 只能拿到「此刻」，钉不住区间。
func seedWorkReminder(t *testing.T, userID, listID uint, title, kind string, dueAt, completedAt *time.Time) {
	t.Helper()
	row := Reminder{
		UserID: userID, ListID: listID, Title: title, Kind: kind,
		DueAt: dueAt, CompletedAt: completedAt, RepeatRule: "none",
	}
	if err := appDB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
}

func TestWorkDigestWeekCoversThisWeekOnly(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "week"}, now)
	if err != nil {
		t.Fatal(err)
	}
	titles := digestTitles(digest.Completed)
	if !strings.Contains(titles, "黄河农场大楼wifi覆盖优化") || !strings.Contains(titles, "王庄基站光缆巡检") {
		t.Fatalf("本周应收到本周完成的记录，实际：%s", titles)
	}
	if strings.Contains(titles, "上周的巡检记录") {
		t.Fatalf("本周不该收到上周完成的记录：%s", titles)
	}
	if len(digest.Open) != 2 {
		t.Fatalf("本周未完成应为 2 条（逾期 1 + 明天到期 1），实际 %d：%s", len(digest.Open), digestTitles(digest.Open))
	}
	// 逾期最多的排最前，并且标出逾期天数
	if !digest.Open[0].Overdue || digest.Open[0].OverdueDays != 1 {
		t.Fatalf("第一条应是「逾期 1 天」：%+v", digest.Open[0])
	}
	if digest.Stats.Overdue != 1 {
		t.Fatalf("逾期计数应为 1，实际 %d", digest.Stats.Overdue)
	}
	if strings.Contains(digestTitles(digest.Open), "下下周的割接") {
		t.Fatal("晚于区间结束的任务不该进本周报告")
	}
	if len(digest.Notes) != 1 || !strings.Contains(digest.Notes[0].Title, "王庄基站现场照片") {
		t.Fatalf("本周记事应为 1 条，实际 %+v", digest.Notes)
	}
	if digest.Stats.Completed != 2 || digest.Stats.Lists != 2 {
		t.Fatalf("统计不对：%+v", digest.Stats)
	}
	if digest.Label != "本周（2026-10-12 ~ 2026-10-18）" {
		t.Fatalf("区间文案不对：%s", digest.Label)
	}
}

func TestWorkDigestLastWeekIsPreviousCalendarWeek(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "lastweek"}, now)
	if err != nil {
		t.Fatal(err)
	}
	titles := digestTitles(digest.Completed)
	if !strings.Contains(titles, "上周的巡检记录") {
		t.Fatalf("上周应收到上周完成的记录：%s", titles)
	}
	if strings.Contains(titles, "黄河农场大楼wifi覆盖优化") {
		t.Fatalf("上周不该收到本周完成的记录：%s", titles)
	}
	if digest.Label != "上周（2026-10-05 ~ 2026-10-11）" {
		t.Fatalf("区间文案不对：%s", digest.Label)
	}
	// 上周报告不该把「本周才到期、还没做完」的算进来
	if len(digest.Open) != 0 {
		t.Fatalf("上周的未完成应为 0 条，实际：%s", digestTitles(digest.Open))
	}
}

func TestWorkDigestOpenOptionIgnoresWindow(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: WorkOptionOpen}, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(digest.Completed) != 0 {
		t.Fatalf("「当前未完成」不该有完成记录：%s", digestTitles(digest.Completed))
	}
	if len(digest.Open) != 3 {
		t.Fatalf("当前未完成应为 3 条（含下下周那条），实际：%s", digestTitles(digest.Open))
	}
	if digest.Label != "当前未完成" {
		t.Fatalf("文案不对：%s", digest.Label)
	}
}

func TestWorkDigestKeywordFiltersEverySection(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "week", Keyword: "王庄"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if got := digestTitles(digest.Completed); !strings.Contains(got, "王庄基站光缆巡检") || strings.Contains(got, "黄河农场") {
		t.Fatalf("关键词应只留命中的完成记录：%s", got)
	}
	if len(digest.Open) != 0 {
		t.Fatalf("关键词应滤掉未命中的未完成：%s", digestTitles(digest.Open))
	}
	if len(digest.Notes) != 1 {
		t.Fatalf("关键词应命中那条记事：%+v", digest.Notes)
	}
}

func TestWorkDigestMarkdownListsFactsAndTruncation(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "week"}, now)
	if err != nil {
		t.Fatal(err)
	}
	text := digest.Markdown()
	for _, want := range []string{"【工作数据】", "2026-10-12 ~ 2026-10-18", "黄河农场大楼wifi覆盖优化", "已逾期 1 天", "清单分布", "工作安排"} {
		if !strings.Contains(text, want) {
			t.Fatalf("给模型的数据里缺少 %q：\n%s", want, text)
		}
	}
	if strings.Contains(text, "（提示：数据量较大") {
		t.Fatalf("没截断时不该出现截断提示：\n%s", text)
	}

	draft := digest.DraftReport()
	for _, want := range []string{"工作草稿", "一、完成事项", "二、还没收尾", "黄河农场大楼wifi覆盖优化", "已逾期 1 天"} {
		if !strings.Contains(draft, want) {
			t.Fatalf("草稿里缺少 %q：\n%s", want, draft)
		}
	}
}

func TestWorkDigestEmptyRangeSaysSo(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	// 2026-08 那一整月没有任何记录
	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "custom", From: "2026-08-01", To: "2026-08-31"}, now)
	if err != nil {
		t.Fatal(err)
	}
	draft := digest.DraftReport()
	if !strings.Contains(draft, "这段时间没有对应的记录") {
		t.Fatalf("空区间应明说没有记录：\n%s", draft)
	}
	if !strings.Contains(digest.Markdown(), "没有记录") {
		t.Fatalf("给模型的文本也要明说没有记录：\n%s", digest.Markdown())
	}
}

func TestDetectWorkOptions(t *testing.T) {
	loc := shanghai()
	now := time.Date(2026, 10, 16, 17, 30, 0, 0, loc)
	cases := []struct {
		text   string
		option string
		from   string
		to     string
		found  bool
	}{
		{"写上周工作总结", "lastweek", "", "", true},
		{"帮我写这周的周报", "week", "", "", true},
		{"来一份月报", "month", "", "", true},
		{"写年报", "year", "", "", true},
		{"上个月做了什么", "lastmonth", "", "", true},
		{"今天还剩什么没做", "today", "", "", true},
		{"昨天做了啥", "yesterday", "", "", true},
		{"去年都干了什么", "custom", "2025-01-01", "2025-12-31", true},
		{"近 7 天做了什么", "custom", "2026-10-10", "2026-10-16", true},
		{"最近三个月的工作", "custom", "2026-07-19", "2026-10-16", true},
		{"近两周的进展", "custom", "2026-10-03", "2026-10-16", true},
		{"2026-09-01 到 2026-09-30 的完成情况", "custom", "2026-09-01", "2026-09-30", true},
		{"9月1日到9月30日做了啥", "", "", "", false},
		{"帮我建一个明天 9 点的提醒", "", "", "", false},
		{"你好", "", "", "", false},
	}
	for _, tc := range cases {
		got, ok := DetectWorkOptions(tc.text, now)
		if ok != tc.found {
			t.Fatalf("%q：识别结果应为 %v，实际 %v（%+v）", tc.text, tc.found, ok, got)
		}
		if !tc.found {
			continue
		}
		if got.Option != tc.option || got.From != tc.from || got.To != tc.to {
			t.Fatalf("%q：应得 %s %s~%s，实际 %s %s~%s", tc.text, tc.option, tc.from, tc.to, got.Option, got.From, got.To)
		}
	}
}

func TestValidateWorkOptions(t *testing.T) {
	if err := ValidateWorkOptions(WorkDigestOptions{Option: "week"}); err != nil {
		t.Fatalf("week 应合法：%v", err)
	}
	if err := ValidateWorkOptions(WorkDigestOptions{Option: WorkOptionOpen}); err != nil {
		t.Fatalf("open 应合法：%v", err)
	}
	if err := ValidateWorkOptions(WorkDigestOptions{Option: "custom", From: "2026-10-01"}); err == nil {
		t.Fatal("自定义缺结束日期应报错")
	}
	if err := ValidateWorkOptions(WorkDigestOptions{Option: "custom", From: "2026-10-10", To: "2026-10-01"}); err == nil {
		t.Fatal("结束早于开始应报错")
	}
	if err := ValidateWorkOptions(WorkDigestOptions{Option: "季度"}); err == nil {
		t.Fatal("不认的选项应报错")
	}
}

// 关键词查询（用户要求的「自定义快速查询项目」）不带时间段时，默认看全部时间，
// 这是「按关键词翻记录」最不容易漏的默认值。
func TestWorkDigestKeywordOnlySearchesAllTime(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Keyword: "王庄"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if !digest.All {
		t.Fatalf("不带时间段时应为「全部时间」：%+v", digest)
	}
	titles := digestTitles(digest.Completed)
	if !strings.Contains(titles, "王庄基站光缆巡检") {
		t.Fatalf("应命中关键词完成记录：%s", titles)
	}
}

func digestTitles(items []WorkDigestItem) string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, item.Title)
	}
	return strings.Join(out, " / ")
}
