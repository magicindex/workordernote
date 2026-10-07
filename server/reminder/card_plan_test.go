package reminder

import (
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
)

func cardTestLoc(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

// 账单日填 31 号的卡，在只有 28/29 天的 2 月要落到当月最后一天，
// 与下一轮月度滚动（nextOccurrence）的口径一致。
func TestDateWithDayClampsToMonthEnd(t *testing.T) {
	loc := cardTestLoc(t)
	cases := []struct {
		year  int
		month time.Month
		day   int
		want  string
	}{
		{2026, time.February, 31, "2026-02-28"},
		{2028, time.February, 31, "2028-02-29"}, // 闰年
		{2026, time.April, 31, "2026-04-30"},
		{2026, time.March, 15, "2026-03-15"},
	}
	for _, c := range cases {
		got := dateWithDay(c.year, c.month, c.day, loc).Format("2006-01-02")
		if got != c.want {
			t.Errorf("dateWithDay(%d-%d, %d) = %s，期望 %s", c.year, c.month, c.day, got, c.want)
		}
	}
}

// 「下一个账单日」：当天算没过去；已经过去就滚到下个月。
func TestNextDayOccurrence(t *testing.T) {
	loc := cardTestLoc(t)
	at := func(day int) time.Time { return time.Date(2026, time.October, day, 10, 30, 0, 0, loc) }

	if got := nextDayOccurrence(10, at(5)).Format("2006-01-02"); got != "2026-10-10" {
		t.Errorf("账单日 10 号、今天 10-05 应为当月，实际 %s", got)
	}
	if got := nextDayOccurrence(5, at(5)).Format("2006-01-02"); got != "2026-10-05" {
		t.Errorf("当天就是账单日应算今天，实际 %s", got)
	}
	if got := nextDayOccurrence(5, at(6)).Format("2006-01-02"); got != "2026-11-05" {
		t.Errorf("账单日已过应滚下月，实际 %s", got)
	}
	if got := nextDayOccurrence(31, time.Date(2026, time.February, 1, 9, 0, 0, 0, loc)).Format("2006-01-02"); got != "2026-02-28" {
		t.Errorf("2 月的 31 号应落到 28 号，实际 %s", got)
	}
}

// 免息期 = 账单日 → 它对应的还款日；还款日 ≤ 账单日按跨月算。
func TestCardGraceDays(t *testing.T) {
	loc := cardTestLoc(t)
	now := time.Date(2026, time.October, 5, 9, 0, 0, 0, loc)

	if got := cardGraceDays(5, 25, now); got != 20 {
		t.Errorf("账单日 5 / 还款日 25 应为 20 天，实际 %d", got)
	}
	// 账单日 25 / 还款日 10：跨月，10-25 → 11-10 = 16 天
	if got := cardGraceDays(25, 10, now); got != 16 {
		t.Errorf("账单日 25 / 还款日 10 跨月应为 16 天，实际 %d", got)
	}
	// 账单日与还款日同一天：顺延到下一月同一天 = 当月天数
	if got := cardGraceDays(5, 5, now); got != 31 {
		t.Errorf("账单日 = 还款日应为一个月天数（10 月 31 天），实际 %d", got)
	}
}

// 生成还款计划：两条提醒（账单日 + 还款日），全天、按月循环、带 card_role 与卡片信息。
func TestGenerateCardPlanCreatesTwoReminders(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	loc := cardTestLoc(t)
	const userID = 77
	list := List{
		UserID: userID, Name: "招商银行经典白", Color: "rose", Template: listTemplateCard,
		CardName: "经典白", CardBank: "招商银行", CardNo: "6225 8800 1234 5678",
		CardStatementDay: 5, CardDueDay: 25, CardNotes: "年费刷 8 次免", CardAutoRepeat: true,
	}
	if err := appDB.Create(&list).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.October, 6, 10, 0, 0, 0, loc)
	created, err := generateCardPlan(appDB, &list, now)
	if err != nil {
		t.Fatalf("生成还款计划失败：%v", err)
	}
	if len(created) != 2 {
		t.Fatalf("应生成 2 条提醒，实际 %d", len(created))
	}

	roles := map[string]Reminder{}
	for _, r := range created {
		roles[r.CardRole] = r
	}
	statement, ok := roles[cardRoleStatement]
	if !ok {
		t.Fatal("缺少账单日提醒")
	}
	due, ok := roles[cardRoleDue]
	if !ok {
		t.Fatal("缺少还款日提醒")
	}
	if statement.DueAt == nil || due.DueAt == nil {
		t.Fatal("两条提醒都应有到期日")
	}
	if got := statement.DueAt.Format("2006-01-02"); got != "2026-10-05" && got != "2026-11-05" {
		t.Errorf("账单日应落在 10-05 或 11-05，实际 %s", got)
	}
	if got := due.DueAt.Format("2006-01-02"); got != "2026-10-25" {
		t.Errorf("还款日应为 2026-10-25，实际 %s", got)
	}
	for _, r := range created {
		if !r.AllDay {
			t.Error("还款计划应使用全天提醒（账单日/还款日都是整天的事）")
		}
		if r.RepeatRule != "monthly" {
			t.Errorf("勾了自动循环应按月重复，实际 %q", r.RepeatRule)
		}
		if !strings.Contains(r.Title, "招商银行") {
			t.Errorf("标题应带银行名，实际 %q", r.Title)
		}
	}
	if !strings.Contains(statement.Notes, "5678") {
		t.Errorf("备注里应有卡号尾号，实际 %q", statement.Notes)
	}
	if !strings.Contains(due.Notes, "20 天") {
		t.Errorf("备注里应有免息期天数，实际 %q", due.Notes)
	}
	if !strings.Contains(due.Notes, "年费刷 8 次免") {
		t.Errorf("备注里应带上用户填的备注，实际 %q", due.Notes)
	}
}

// 重建时旧的自动生成项要被软删，列表里只留最新的两条（否则改一次账单日就多两条）。
func TestGenerateCardPlanReplacesPrevious(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	loc := cardTestLoc(t)
	list := List{
		UserID: 78, Name: "广发", Template: listTemplateCard, CardBank: "广发银行",
		CardStatementDay: 8, CardDueDay: 28, CardAutoRepeat: true,
	}
	if err := appDB.Create(&list).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.October, 6, 10, 0, 0, 0, loc)
	if _, err := generateCardPlan(appDB, &list, now); err != nil {
		t.Fatal(err)
	}
	// 改账单日后再生成一次
	list.CardStatementDay = 12
	if _, err := generateCardPlan(appDB, &list, now); err != nil {
		t.Fatal(err)
	}

	var active []Reminder
	if err := appDB.Where("user_id = ? AND list_id = ? AND deleted_at IS NULL", list.UserID, list.ID).Find(&active).Error; err != nil {
		t.Fatal(err)
	}
	if len(active) != 2 {
		t.Fatalf("重建后应只剩 2 条在用，实际 %d", len(active))
	}
	for _, r := range active {
		if r.CardRole == cardRoleStatement && r.DueAt != nil && r.DueAt.Day() != 12 {
			t.Errorf("重建后账单日应更新为 12 号，实际 %s", r.DueAt.Format("2006-01-02"))
		}
	}
	var all int64
	appDB.Model(&Reminder{}).Where("user_id = ? AND list_id = ?", list.UserID, list.ID).Count(&all)
	if all != 4 {
		t.Errorf("旧的两条应保留为软删记录（共 4 行），实际 %d", all)
	}
}

// 不勾自动循环：只生成最近一次，不按月重复。
func TestGenerateCardPlanWithoutRepeat(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	loc := cardTestLoc(t)
	list := List{
		UserID: 79, Name: "一次性", Template: listTemplateCard,
		CardStatementDay: 3, CardDueDay: 20, CardAutoRepeat: false,
	}
	if err := appDB.Create(&list).Error; err != nil {
		t.Fatal(err)
	}
	created, err := generateCardPlan(appDB, &list, time.Date(2026, time.October, 6, 10, 0, 0, 0, loc))
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range created {
		if r.RepeatRule != "none" {
			t.Errorf("没勾自动循环不应按月重复，实际 %q", r.RepeatRule)
		}
	}
}

// 信息不全（没填账单日/还款日）时拒绝生成，别造出没有日期的提醒。
func TestGenerateCardPlanRejectsIncompleteCard(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	list := List{UserID: 80, Name: "缺信息", Template: listTemplateCard}
	if err := appDB.Create(&list).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := generateCardPlan(appDB, &list, time.Now()); err == nil {
		t.Fatal("账单日/还款日缺失时应报错")
	}
	// 普通清单也不该生成
	plain := List{UserID: 80, Name: "普通", Template: listTemplateGeneral, CardStatementDay: 5, CardDueDay: 25}
	if err := appDB.Create(&plain).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := generateCardPlan(appDB, &plain, time.Now()); err == nil {
		t.Fatal("通用清单不应生成还款计划")
	}
}

// 摘要给前端的倒计时：距账单日/还款日天数与免息期。
func TestCardSummaryCountdown(t *testing.T) {
	loc := cardTestLoc(t)
	list := List{Template: listTemplateCard, CardStatementDay: 10, CardDueDay: 25}
	got := cardSummary(list, time.Date(2026, time.October, 6, 12, 0, 0, 0, loc))
	if got == nil {
		t.Fatal("信用卡清单应给出摘要")
	}
	if got.DaysToStatement != 4 || got.DaysToDue != 19 || got.GraceDays != 15 {
		t.Errorf("倒计时不对：账单日还剩 %d 天、还款日还剩 %d 天、免息期 %d 天",
			got.DaysToStatement, got.DaysToDue, got.GraceDays)
	}
	if got.StatementDate != "2026-10-10" || got.DueDate != "2026-10-25" {
		t.Errorf("日期不对：%s / %s", got.StatementDate, got.DueDate)
	}
	if s := cardSummary(List{Template: listTemplateGeneral}, time.Now()); s != nil {
		t.Error("通用清单不应有卡片摘要")
	}
}

var _ = gorm.ErrRecordNotFound
