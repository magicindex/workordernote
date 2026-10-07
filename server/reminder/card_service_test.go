package reminder

import (
	"testing"
	"time"
)

func cardTestLoc(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

// 账单日填 31 号的卡，落在只有 28/29 天的 2 月要取当月最后一天，
// 与月度滚动（nextOccurrence）的口径一致。
func TestCardDateWithDayClamps(t *testing.T) {
	loc := cardTestLoc(t)
	cases := []struct {
		year  int
		month time.Month
		day   int
		want  string
	}{
		{2026, time.February, 31, "2026-02-28"},
		{2028, time.February, 31, "2028-02-29"},
		{2026, time.April, 31, "2026-04-30"},
		{2026, time.March, 15, "2026-03-15"},
	}
	for _, c := range cases {
		if got := dateWithDay(c.year, c.month, c.day, loc).Format("2006-01-02"); got != c.want {
			t.Errorf("dateWithDay(%d-%d,%d)=%s，期望 %s", c.year, c.month, c.day, got, c.want)
		}
	}
}

// 免息期：账单日 → 对应还款日；还款日 ≤ 账单日按跨月算。
func TestCardGraceDays(t *testing.T) {
	loc := cardTestLoc(t)
	now := time.Date(2026, time.October, 5, 9, 0, 0, 0, loc)
	if got := graceDaysBetween(5, 25, now); got != 20 {
		t.Errorf("账单日 5 / 还款日 25 应为 20 天，实际 %d", got)
	}
	if got := graceDaysBetween(25, 10, now); got != 16 {
		t.Errorf("账单日 25 / 还款日 10 跨月应为 16 天，实际 %d", got)
	}
}

// 当期：还款日还没过的那一期；都过了就看下一期。
func TestCardCurrentPeriod(t *testing.T) {
	loc := cardTestLoc(t)
	card := Card{StatementDay: 5, DueDay: 25}

	period, statement, due := currentPeriod(card, time.Date(2026, time.October, 6, 12, 0, 0, 0, loc))
	if period != "2026-10" || statement.Format("2006-01-02") != "2026-10-05" || due.Format("2006-01-02") != "2026-10-25" {
		t.Errorf("10-06 时当期应为 2026-10 / 10-05 / 10-25，实际 %s / %s / %s", period, statement.Format("2006-01-02"), due.Format("2006-01-02"))
	}
	// 10-26：还款日已过 → 下一期（11 月）
	period, _, due = currentPeriod(card, time.Date(2026, time.October, 26, 12, 0, 0, 0, loc))
	if period != "2026-11" || due.Format("2006-01-02") != "2026-11-25" {
		t.Errorf("10-26 时当期应为 2026-11 / 11-25，实际 %s / %s", period, due.Format("2006-01-02"))
	}
}

// 跨月卡（账单日 25 / 还款日 10）：10 月账单的还款日在 11-10。
func TestCardCrossMonthDue(t *testing.T) {
	loc := cardTestLoc(t)
	statement, due := statementDates(Card{StatementDay: 25, DueDay: 10}, 2026, time.October, loc)
	if statement.Format("2006-01-02") != "2026-10-25" || due.Format("2006-01-02") != "2026-11-10" {
		t.Errorf("跨月卡应 10-25 → 11-10，实际 %s → %s", statement.Format("2006-01-02"), due.Format("2006-01-02"))
	}
}

// 生成提醒：账单日 + 还款日 + 提前提醒（勾了提前天数才有第三条）。
func TestGenerateCardPlanWithAdvance(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	loc := cardTestLoc(t)
	list, err := ensureDefaultList(appDB, 91)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{
		UserID: 91, ListID: list.ID, Name: "经典白", Bank: "招商银行", No: "6225 8800 1234 5678",
		StatementDay: 5, DueDay: 25, AdvanceDays: 3, AutoRepeat: true,
	}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.October, 6, 10, 0, 0, 0, loc)
	created, err := generateCardPlan(appDB, &card, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 3 {
		t.Fatalf("应生成 3 条提醒（账单日/还款日/提前提醒），实际 %d", len(created))
	}
	roles := map[string]Reminder{}
	for _, r := range created {
		roles[r.CardRole] = r
		if r.CardID != card.ID {
			t.Error("生成的提醒应挂在卡片上（card_id）")
		}
		if !r.AllDay || r.RepeatRule != "monthly" {
			t.Errorf("应为全天 + 按月循环，实际 allDay=%v repeat=%s", r.AllDay, r.RepeatRule)
		}
	}
	advance, ok := roles[cardRoleAdvance]
	if !ok {
		t.Fatal("缺少提前提醒")
	}
	if got := advance.DueAt.Format("2006-01-02"); got != "2026-10-22" {
		t.Errorf("还款日前 3 天应为 10-22，实际 %s", got)
	}
	if due := roles[cardRoleDue]; due.DueAt.Format("2006-01-02") != "2026-10-25" {
		t.Errorf("还款日应为 10-25，实际 %s", due.DueAt.Format("2006-01-02"))
	}
}

// 记金额 → 标记已还：paid_at 写入、「还款日」提醒进完成记录并滚到下一期、待还合计归零。
func TestCardStatementPayFlow(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	loc := cardTestLoc(t)
	list, err := ensureDefaultList(appDB, 92)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{
		UserID: 92, ListID: list.ID, Name: "白金", Bank: "广发银行",
		StatementDay: 5, DueDay: 25, AutoRepeat: true,
	}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.October, 6, 10, 0, 0, 0, loc)
	if _, err := generateCardPlan(appDB, &card, now); err != nil {
		t.Fatal(err)
	}

	// 记这一期 1234.56 元（123456 分）
	if _, err := upsertStatement(appDB, 92, card, "2026-10", 123456, 12345, "本期有分期"); err != nil {
		t.Fatal(err)
	}
	dto, err := buildCardDTO(appDB, card, now)
	if err != nil {
		t.Fatal(err)
	}
	if dto.Current == nil || dto.Current.Amount != 123456 || dto.Current.Minimum != 12345 {
		t.Fatalf("本期账单金额不对：%+v", dto.Current)
	}
	if dto.UnpaidTotal != 123456 || dto.UnpaidCount != 1 {
		t.Errorf("待还合计应为 123456 / 1 期，实际 %d / %d", dto.UnpaidTotal, dto.UnpaidCount)
	}

	// 标记已还
	if _, err := payStatement(appDB, 92, card, "2026-10", 123456, now); err != nil {
		t.Fatal(err)
	}
	dto, err = buildCardDTO(appDB, card, now)
	if err != nil {
		t.Fatal(err)
	}
	if dto.Current.PaidAt == nil || dto.Current.PaidAmount != 123456 {
		t.Errorf("标记已还后应记录 paid_at 与金额，实际 %+v", dto.Current)
	}
	if dto.UnpaidTotal != 0 || dto.UnpaidCount != 0 {
		t.Errorf("已还后待还合计应为 0，实际 %d / %d", dto.UnpaidTotal, dto.UnpaidCount)
	}

	// 「还款日」提醒应写了一条完成历史，并把 due_at 滚到下个月
	var history int64
	if err := appDB.Model(&Completion{}).Where("user_id = ?", 92).Count(&history).Error; err != nil {
		t.Fatal(err)
	}
	if history != 1 {
		t.Errorf("标记已还应在完成记录里留一条，实际 %d 条", history)
	}
	var due Reminder
	if err := appDB.Where("user_id = ? AND card_id = ? AND card_role = ?", 92, card.ID, cardRoleDue).First(&due).Error; err != nil {
		t.Fatal(err)
	}
	if got := due.DueAt.Format("2006-01-02"); got != "2026-11-25" {
		t.Errorf("还款日提醒应滚到 11-25，实际 %s", got)
	}

	// 撤销已还必须是完整撤回：完成记录删掉、还款日提醒滚回本期。
	_, dueDate, err := parsePeriodDates(card, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	rolled, changed, err := retractCardPayment(appDB, card, dueDate)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("撤销已还应撤回这一期的完成记录")
	}
	if rolled.DueAt == nil || rolled.DueAt.Format("2006-01-02") != "2026-10-25" {
		t.Errorf("撤销后还款日提醒应回到 2026-10-25，实际 %v", rolled.DueAt)
	}
	if rolled.CompletedAt != nil || rolled.SnoozedUntil != nil {
		t.Errorf("撤销后提醒不应处于已完成/已稍后状态：%+v", rolled)
	}
	if err := appDB.Model(&Completion{}).Where("user_id = ?", 92).Count(&history).Error; err != nil {
		t.Fatal(err)
	}
	if history != 0 {
		t.Errorf("撤销后完成记录应清空，实际 %d 条", history)
	}

	// 再撤一次：这一期已经没有对应完成记录了，不能把提醒越改越偏。
	if _, changed, err := retractCardPayment(appDB, card, dueDate); err != nil || changed {
		t.Errorf("重复撤销不应改动提醒（changed=%v err=%v）", changed, err)
	}
	var again Reminder
	if err := appDB.Where("user_id = ? AND card_id = ? AND card_role = ?", 92, card.ID, cardRoleDue).First(&again).Error; err != nil {
		t.Fatal(err)
	}
	if got := again.DueAt.Format("2006-01-02"); got != "2026-10-25" {
		t.Errorf("重复撤销后还款日提醒应仍是 2026-10-25，实际 %s", got)
	}
}

// 还款计划：当期标出来，已还的期数带 paid_at，逾期期数标 overdue。
func TestCardSchedulePeriods(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	loc := cardTestLoc(t)
	list, err := ensureDefaultList(appDB, 93)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{UserID: 93, ListID: list.ID, Bank: "中信银行", Name: "i白金", StatementDay: 5, DueDay: 25}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.October, 6, 10, 0, 0, 0, loc)
	// 上一期（9 月）没还 → 应算逾期
	if _, err := upsertStatement(appDB, 93, card, "2026-09", 500000, 0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := payStatement(appDB, 93, card, "2026-09", 500000, time.Date(2026, time.September, 20, 10, 0, 0, 0, loc)); err != nil {
		t.Fatal(err)
	}
	periods, err := cardPeriods(appDB, card, now, 6)
	if err != nil {
		t.Fatal(err)
	}
	var current, paid int
	for _, p := range periods {
		if p.Current {
			current++
			if p.Period != "2026-10" {
				t.Errorf("当期应为 2026-10，实际 %s", p.Period)
			}
		}
		if p.Paid {
			paid++
			if p.Period != "2026-09" {
				t.Errorf("已还的应是 2026-09，实际 %s", p.Period)
			}
		}
	}
	if current != 1 || paid != 1 {
		t.Errorf("计划里应有 1 个当期、1 个已还，实际 %d / %d", current, paid)
	}
}
