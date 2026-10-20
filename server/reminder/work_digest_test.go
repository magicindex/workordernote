package reminder

import (
	"strings"
	"testing"
	"time"

	"smallgo/server/timetable"
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

// 「@清单名」：这一轮只看点名的那一栏，别的清单的完成记录、记事、未完成
// 都不许混进来（用户 2026-10-17：「使用@清单名称 来指定数据源」）。
func TestWorkDigestListMentionFiltersToOneList(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	var work List
	if err := appDB.Where("user_id = ? AND name = ?", userID, "工作安排").First(&work).Error; err != nil {
		t.Fatal(err)
	}

	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "all", ListID: work.ID}, now)
	if err != nil {
		t.Fatal(err)
	}
	if digest.ListID != work.ID || digest.ListName != "工作安排" {
		t.Fatalf("快照要写清点名了哪一栏：%+v", digest)
	}
	if got := digestTitles(digest.Completed); strings.Contains(got, "上周的巡检记录") {
		t.Fatalf("别栏的完成记录不该出现：%s", got)
	}
	if got := digestTitles(digest.Completed); !strings.Contains(got, "黄河农场") {
		t.Fatalf("本栏的完成记录要留着：%s", got)
	}
	if len(digest.Notes) != 0 || digest.Stats.Notes != 0 {
		t.Fatalf("别栏的记事不该出现：%+v", digest.Notes)
	}
	if !strings.HasPrefix(digest.Label, "工作安排 · ") {
		t.Fatalf("标题要写明只看哪一栏：%s", digest.Label)
	}
	if !strings.Contains(digest.Markdown(), "只看清单：工作安排") {
		t.Fatalf("给模型的提示词要说清口径：%s", digest.Markdown())
	}
}

// 未完成（「手上还有哪些没做完」）同样按 @ 的清单收窄。
func TestWorkDigestOpenRespectsListMention(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	var card List
	if err := appDB.Where("user_id = ? AND name = ?", userID, "信用卡账单").First(&card).Error; err != nil {
		t.Fatal(err)
	}
	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: WorkOptionOpen, ListID: card.ID}, now)
	if err != nil {
		t.Fatal(err)
	}
	if got := digestTitles(digest.Open); got != "下下周的割接" {
		t.Fatalf("只看信用卡账单时应只剩它自己那一条：%s", got)
	}
	if digest.Stats.Open != 1 {
		t.Fatalf("计数也要跟着收窄：%+v", digest.Stats)
	}
}

// 认「@清单名」：名字长的先试，手打的也认，没点名/点了不存在的都不算。
func TestFindMentionedList(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, _ := workDigestFixture(t)
	seedWorkList(t, userID, "工作", "blue")

	cases := []struct {
		name     string
		text     string
		wantName string
		wantOK   bool
	}{
		{"点名一栏", "@工作安排 这周都干了什么", "工作安排", true},
		{"名字长的优先", "@工作安排 和 @工作 都提到", "工作安排", true},
		{"只有短名字时认短的", "@工作 有哪些没做完", "工作", true},
		{"@ 后面没跟清单名", "帮我看看 @ 这个符号", "", false},
		{"压根没 @", "上周都干了什么", "", false},
		{"点了不存在的清单", "@不存在的清单 看看", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, name, ok := FindMentionedList(appDB, userID, tc.text)
			if ok != tc.wantOK || name != tc.wantName {
				t.Fatalf("FindMentionedList(%q) = (%d, %q, %v)，想要 (%q, %v)", tc.text, id, name, ok, tc.wantName, tc.wantOK)
			}
			if ok && id == 0 {
				t.Fatalf("认出来了却没有清单 id：%q", tc.text)
			}
		})
	}
}

// 栏目提示词：只带「这段时间真有数据、且写了提示词」的栏目；@点名时只看那一栏。
func TestWorkDigestCarriesListPrompts(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	var work, other, card List
	if err := appDB.Where("user_id = ? AND name = ?", userID, "工作安排").First(&work).Error; err != nil {
		t.Fatal(err)
	}
	if err := appDB.Where("user_id = ? AND name = ?", userID, "个人事务").First(&other).Error; err != nil {
		t.Fatal(err)
	}
	if err := appDB.Where("user_id = ? AND name = ?", userID, "信用卡账单").First(&card).Error; err != nil {
		t.Fatal(err)
	}
	appDB.Model(&work).Update("ai_prompt", "按基站/线路分组，多说进度")
	appDB.Model(&other).Update("ai_prompt", "私人事务不提细节")
	// 这一栏写了提示词，但这段时间一条数据也没有：不该把要求带给模型。
	idle := seedWorkList(t, userID, "人生要有仪式感", "rose")
	appDB.Model(&idle).Update("ai_prompt", "只列日期，不要评价")

	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "week"}, now)
	if err != nil {
		t.Fatal(err)
	}
	got := promptNames(digest.Prompts)
	if !strings.Contains(got, "工作安排") || !strings.Contains(got, "个人事务") {
		t.Fatalf("有数据的栏目要带上提示词：%s", got)
	}
	if strings.Contains(got, "人生要有仪式感") {
		t.Fatalf("这段时间没数据的栏目不该带：%s", got)
	}
	if strings.Contains(got, "信用卡账单") {
		t.Fatalf("没写提示词的栏目不该出现：%s", got)
	}
	for _, item := range digest.Prompts {
		if item.ListID == 0 || item.Prompt == "" {
			t.Fatalf("提示词要带清单 id 与内容：%+v", item)
		}
	}

	// @点名：只带点名那一栏的提示词。
	digest, err = BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "all", ListID: other.ID}, now)
	if err != nil {
		t.Fatal(err)
	}
	if got := promptNames(digest.Prompts); got != "个人事务" {
		t.Fatalf("@点名时只带那一栏的提示词，得到：%q", got)
	}
}

// 提示词条数有上限：带太多会把真正的工作数据挤走。
func TestWorkDigestListPromptsCapAtFour(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	loc := shanghai()
	now := time.Date(2026, 10, 16, 17, 30, 0, 0, loc)
	const userID = 31
	at := time.Date(2026, 10, 15, 9, 0, 0, 0, loc)
	for i := 0; i < 6; i++ {
		list := seedWorkList(t, userID, "栏目"+string(rune('A'+i)), "blue")
		appDB.Model(&list).Update("ai_prompt", "这段是我的分析要求")
		seedWorkReminder(t, userID, list.ID, "做完的事", KindTask, &at, &at)
	}
	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "all"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(digest.Prompts) != workDigestMaxListPrompts {
		t.Fatalf("提示词最多 %d 条，实际 %d 条：%+v", workDigestMaxListPrompts, len(digest.Prompts), digest.Prompts)
	}
}

// promptNames 把提示词的栏目名连成一串，方便断言。
func promptNames(prompts []WorkDigestPrompt) string {
	names := make([]string, 0, len(prompts))
	for _, item := range prompts {
		names = append(names, item.Name)
	}
	return strings.Join(names, ",")
}

func TestNormalizeListAIPrompt(t *testing.T) {
	got, err := normalizeListAIPrompt("  第一行\r\n第二行  ")
	if err != nil {
		t.Fatal(err)
	}
	if got != "第一行\n第二行" {
		t.Fatalf("要去首尾空白、把 CRLF 换成 LF：%q", got)
	}
	ok := strings.Repeat("字", listAIPromptMaxRunes)
	if _, err := normalizeListAIPrompt(ok); err != nil {
		t.Fatalf("%d 字应该放行：%v", listAIPromptMaxRunes, err)
	}
	if _, err := normalizeListAIPrompt(ok + "多"); err == nil {
		t.Fatal("超长要拒绝，不能静默截断")
	}
}

// 课表也要进 AI 的快照：小秘得能回答「这周三下午有什么课」。
// 课表按周几重复，所以给的是本周那天的日期，测试钉住 2026-10-16（周五）。
func TestWorkDigestIncludesTimetable(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	userID, now := workDigestFixture(t)

	table := timetable.Timetable{UserID: userID, Name: "小明", Location: "三班", LessonMinutes: 45, BreakMinutes: 10}
	if err := appDB.Create(&table).Error; err != nil {
		t.Fatal(err)
	}
	entries := []timetable.TimetableEntry{
		{UserID: userID, TimetableID: table.ID, Title: "数学", Kind: "course", Weekday: 1, StartTime: "08:00", EndTime: "08:45", Location: "三班", Teacher: "李老师", Note: "带尺子"},
		{UserID: userID, TimetableID: table.ID, Title: "机器人社团", Kind: "activity", Weekday: 3, StartTime: "15:30", EndTime: "17:00", Location: "科技楼"},
	}
	for i := range entries {
		if err := appDB.Create(&entries[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 别人的课表不该出现在这个人的快照里。
	other := timetable.Timetable{UserID: userID + 1, Name: "别人的表", LessonMinutes: 45, BreakMinutes: 10}
	if err := appDB.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	if err := appDB.Create(&timetable.TimetableEntry{
		UserID: userID + 1, TimetableID: other.ID, Title: "别人的数学", Kind: "course", Weekday: 1, StartTime: "09:00", EndTime: "09:45",
	}).Error; err != nil {
		t.Fatal(err)
	}

	digest, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "week"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if digest.Stats.Courses != 2 {
		t.Fatalf("expected 2 courses, got %d", digest.Stats.Courses)
	}
	if len(digest.Courses) != 2 {
		t.Fatalf("expected 2 course rows, got %d", len(digest.Courses))
	}
	first := digest.Courses[0]
	if first.Day != "2026-10-12" || first.Start != "08:00" || first.Note != "带尺子" {
		t.Fatalf("unexpected first course: %+v", first)
	}
	md := digest.Markdown()
	for _, want := range []string{"课程表（2 节）", "08:00-08:45 数学", "15:30-17:00 机器人社团（活动）", "小明"} {
		if !strings.Contains(md, want) {
			t.Fatalf("markdown missing %q:\n%s", want, md)
		}
	}
	// 「今天」这种窄口径只留当天的课：10-16 是周五，两节都在周一/周三，应该一节不剩。
	today, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "today"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if today.Stats.Courses != 0 {
		t.Fatalf("today should not include Monday/Wednesday courses: %+v", today.Courses)
	}
	for _, text := range []string{"周三下午有什么课", "看一下课表", "今天几节课"} {
		if !LooksLikeScheduleQuery(text) {
			t.Fatalf("LooksLikeScheduleQuery(%q) = false", text)
		}
	}
	if LooksLikeScheduleQuery("上周做了什么") {
		t.Fatal("普通工作问题不该被当成课表查询")
	}
	if strings.Contains(md, "别人的数学") {
		t.Fatalf("leaked another user's timetable:\n%s", md)
	}
	// 用 @清单名 点名时只看那一栏，不掺课表。
	scoped, err := BuildWorkDigest(appDB, userID, WorkDigestOptions{Option: "week", ListID: 1, ListName: "工作安排"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if scoped.Stats.Courses != 0 || strings.Contains(scoped.Markdown(), "本周课表") {
		t.Fatalf("scoped digest should not include timetable: %+v", scoped.Stats)
	}
}
