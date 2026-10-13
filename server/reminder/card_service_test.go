package reminder

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"smallgo/server/database"

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

// 跨月卡（账单日 25 / 还款日 19）：10-08 的当期是 **9 月**那一期（9-25 出账、10-19 还款），
// 不是 10 月那一期（10-25 出账、11-19 还款）。用户报的「颜色没变」就是这个口径错了。
func TestCardCurrentPeriodCrossMonth(t *testing.T) {
	loc := cardTestLoc(t)
	card := Card{StatementDay: 25, DueDay: 19}

	period, statement, due := currentPeriod(card, time.Date(2026, time.October, 8, 9, 0, 0, 0, loc))
	if period != "2026-09" || statement.Format("2006-01-02") != "2026-09-25" || due.Format("2006-01-02") != "2026-10-19" {
		t.Errorf("10-08 时跨月卡当期应为 2026-09 / 09-25 / 10-19，实际 %s / %s / %s",
			period, statement.Format("2006-01-02"), due.Format("2006-01-02"))
	}
	// 10-20：这一期已经过了还款日 → 顺延到 10 月那一期（10-25 出账 / 11-19 还款）
	period, statement, due = currentPeriod(card, time.Date(2026, time.October, 20, 9, 0, 0, 0, loc))
	if period != "2026-10" || statement.Format("2006-01-02") != "2026-10-25" || due.Format("2006-01-02") != "2026-11-19" {
		t.Errorf("10-20 时跨月卡当期应为 2026-10 / 10-25 / 11-19，实际 %s / %s / %s",
			period, statement.Format("2006-01-02"), due.Format("2006-01-02"))
	}
	// 同月卡不受影响：账单日 5 / 还款日 25，10-08 仍是 10 月那一期
	period, _, due = currentPeriod(Card{StatementDay: 5, DueDay: 25}, time.Date(2026, time.October, 8, 9, 0, 0, 0, loc))
	if period != "2026-10" || due.Format("2006-01-02") != "2026-10-25" {
		t.Errorf("同月卡 10-08 应为 2026-10 / 10-25，实际 %s / %s", period, due.Format("2006-01-02"))
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
	// 用户 2026-10-13：账单日只在卡片页面用、不再生成提醒；「还款日前 N 天提醒」被
	// 「从账单日提醒到还款日」的窗口取代 —— 所以每张卡只留**一条**还款日提醒。
	if len(created) != 1 {
		t.Fatalf("应生成 1 条提醒（还款日），实际 %d", len(created))
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
	if _, ok := roles[cardRoleStatement]; ok {
		t.Error("账单日提醒不该再生成（账单日只在卡片页面用）")
	}
	if _, ok := roles[cardRoleAdvance]; ok {
		t.Error("「还款日前 N 天提醒」已被「从账单日提醒到还款日」的窗口取代，不该再有独立提醒")
	}
	due, ok := roles[cardRoleDue]
	if !ok {
		t.Fatal("缺少还款日提醒")
	}
	if got := due.DueAt.Format("2006-01-02"); got != "2026-10-25" {
		t.Errorf("还款日应为 10-25，实际 %s", got)
	}
	// 到期时间统一是**还款日 23:59**（用户 2026-10-13：「信用卡新建时间同新建提醒一致默认 23:59」）
	if h, m := due.DueAt.Hour(), due.DueAt.Minute(); h != 23 || m != 59 {
		t.Errorf("还款日提醒应落在 23:59，实际 %02d:%02d", h, m)
	}
	// 提前窗口从**本期账单日**开始（用户 2026-10-13：「信用卡还款从账单日开始，直到还款日」）
	window, ok := cardRemindWindowStart(appDB, due)
	if !ok || window.Format("2006-01-02") != "2026-10-05" {
		t.Errorf("窗口起点应为本期账单日 10-05，实际 %v（ok=%v）", window, ok)
	}
	if first := firstRemindAt(appDB, due); !first.Equal(window.UTC()) && !sameInstant(first, window.UTC()) {
		// 卡片提醒是「创建时窗口还没到」才用窗口；这条的 CreatedAt 是生成那一刻（10-06 10:00），
		// 而窗口 10-05 06:00 已经过去 → 落到正常流程（还款日当天）
		if !sameInstant(first, normalFirstRemindAt(appDB, due)) {
			t.Errorf("首次提醒应为正常流程或窗口起点，实际 %v", first)
		}
	}
}

// 记金额 → 标记已还：paid_at 写入、「还款日」提醒进完成记录并滚到下一期、待还合计归零。
func TestCardStatementPayFlow(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	// time.Local 也要是上海：parsePeriodDates / retractCardPayment 用的是 time.Local
	// （生产容器 TZ=Asia/Shanghai），只把 loc 传给 generateCardPlan 的话两边会差 8 小时
	// —— 以前字符串比较「碰巧」能对上，认偏移之后就把这条对不上了。
	withShanghaiLocal(t)

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
	// 还款之后当期会**推进到下一期**（用户要求：还完就清空应还额度、倒计时跳下一周期），
	// 刚还的那一期改从 LastPaid 读，卡片上据此显示「已还 + 撤销已还」。
	if dto.LastPaid == nil || dto.LastPaid.Period != "2026-10" || dto.LastPaid.PaidAt == nil || dto.LastPaid.PaidAmount != 123456 {
		t.Errorf("标记已还后应在 LastPaid 里记下 paid_at 与金额，实际 %+v", dto.LastPaid)
	}
	if dto.Current.Period == "2026-10" || dto.Current.PaidAt != nil || dto.Current.Amount != 0 {
		t.Errorf("还完当期应推进到下一期且应还清零，实际 %+v", dto.Current)
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

// 删除卡片必须把它名下的账单期一起软删，并把没处理的到点通知标为已读。
//
// 起因两条（都是实际踩到的）：
//  1. 回归用例删掉 3 张测试卡后，沙箱的 card_statements 比生产多 6 条「没有卡的
//     账单期」——界面上看不见，但它们是活行，会一直跟着同步快照发给对端。
//  2. 用户收到「自检第二卡 还款提醒」的弹窗，点「知道了」提示「不存在」，
//     弹窗还关不掉：卡片删了，提醒删了，可那条未读通知还在，点操作必然 404。
func TestDeleteCardSoftDeletesStatements(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	const userID = 95
	loc := cardTestLoc(t)
	list, err := ensureCardBucket(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{
		UserID: userID, ListID: list.ID, Name: "白金刚", Bank: "招商银行",
		StatementDay: 5, DueDay: 25, AutoRepeat: true,
	}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.October, 8, 10, 0, 0, 0, loc)
	if _, err := generateCardPlan(appDB, &card, now); err != nil {
		t.Fatal(err)
	}
	if _, err := upsertStatement(appDB, userID, card, "2026-09", 123456, 0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := upsertStatement(appDB, userID, card, "2026-10", 200000, 0, ""); err != nil {
		t.Fatal(err)
	}

	// 造一条「到点」未读通知挂在这张卡的某条提醒上（弹窗会把它弹出来）
	var cardReminder Reminder
	if err := appDB.Where("card_id = ? AND deleted_at IS NULL", card.ID).First(&cardReminder).Error; err != nil {
		t.Fatal(err)
	}
	notification := Notification{
		UserID: userID, ReminderID: &cardReminder.ID, Type: "reminder_due",
		Title: "白金刚 还款提醒（还有 3 天）", CreatedAt: now,
	}
	if err := appDB.Create(&notification).Error; err != nil {
		t.Fatal(err)
	}

	// 走 handler 删卡（路由里的那条路径）
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/reminder/cards/1", nil)
	context.Params = gin.Params{{Key: "id", Value: strconv.FormatUint(uint64(card.ID), 10)}}
	context.Set("userID", uint(userID))
	handleDeleteCard(appDB)(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("删卡返回 %d：%s", recorder.Code, recorder.Body.String())
	}

	var aliveStatements int64
	if err := appDB.Model(&CardStatement{}).
		Where("card_id = ? AND deleted_at IS NULL", card.ID).Count(&aliveStatements).Error; err != nil {
		t.Fatal(err)
	}
	if aliveStatements != 0 {
		t.Fatalf("删卡后还剩 %d 条未软删的账单期（应全部软删）", aliveStatements)
	}
	var aliveReminders int64
	if err := appDB.Model(&Reminder{}).
		Where("card_id = ? AND deleted_at IS NULL", card.ID).Count(&aliveReminders).Error; err != nil {
		t.Fatal(err)
	}
	if aliveReminders != 0 {
		t.Fatalf("删卡后还剩 %d 条未软删的卡片提醒", aliveReminders)
	}
	var reloaded Card
	if err := appDB.Where("id = ?", card.ID).First(&reloaded).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.DeletedAt == nil {
		t.Fatal("卡片本身没有被软删")
	}
	// 通知必须变成已读，否则弹窗还会弹，而点「知道了」时提醒已经没了 → 弹窗卡死
	var reloadedNotification Notification
	if err := appDB.Where("id = ?", notification.ID).First(&reloadedNotification).Error; err != nil {
		t.Fatal(err)
	}
	if reloadedNotification.ReadAt == nil {
		t.Fatal("删卡后那条未读的到点通知仍是未读（弹窗会弹出来且点不掉）")
	}
}

// 点过「已还款」之后，卡片要跳到下一期：倒计时/日期跟着走，应还额度也随之清零
// （用户报的「交通银行手工点了已还款，还款倒计时没有跳到下一周期，导致排序错误」）。
func TestPaidPeriodAdvancesToNextCycle(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshCardFeature(t)

	const userID = 96
	list, err := ensureCardBucket(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{
		UserID: userID, ListID: list.ID, Name: "VISA", Bank: "交通银行",
		StatementDay: 25, DueDay: 19, AutoRepeat: true,
	}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	loc := shanghai()
	// 以 2026-10-08 为例：账单日 25 / 还款日 19 的当期是 2026-09（9-25 出账、10-19 还款）
	now := time.Date(2026, time.October, 8, 10, 0, 0, 0, loc)
	if _, err := generateCardPlan(appDB, &card, now); err != nil {
		t.Fatal(err)
	}
	before, err := buildCardDTO(appDB, card, now)
	if err != nil {
		t.Fatal(err)
	}
	if before.Current == nil || before.Current.Period != "2026-09" {
		t.Fatalf("当期应为 2026-09，实际 %+v", before.Current)
	}
	if before.Summary == nil || before.Summary.DueDate != "2026-10-19" {
		t.Fatalf("倒计时应指向 10-19，实际 %+v", before.Summary)
	}

	// 记金额并标记已还
	if _, err := upsertStatement(appDB, userID, card, "2026-09", 123456, 0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := payStatement(appDB, userID, card, "2026-09", 123456, now); err != nil {
		t.Fatal(err)
	}

	after, err := buildCardDTO(appDB, card, now)
	if err != nil {
		t.Fatal(err)
	}
	if after.Current == nil {
		t.Fatal("还款后应给出下一期")
	}
	if after.Current.Period == "2026-09" {
		t.Fatalf("还款后当期还停在已还的那一期：%+v", after.Current)
	}
	if after.Current.PaidAt != nil {
		t.Fatalf("下一期不该带已还标记：%+v", after.Current)
	}
	if after.Current.Amount != 0 {
		t.Fatalf("下一期还没有金额，应还额度应清零，实际 %d", after.Current.Amount)
	}
	if after.Current.DueDate.Format("2006-01-02") != "2026-11-19" {
		t.Fatalf("下一期还款日应为 2026-11-19，实际 %s", after.Current.DueDate.Format("2006-01-02"))
	}
	if after.Summary == nil || after.Summary.DueDate != "2026-11-19" {
		t.Fatalf("倒计时应跟着跳到 2026-11-19，实际 %+v", after.Summary)
	}
	if after.UnpaidCount != 0 || after.UnpaidTotal != 0 {
		t.Fatalf("已还的期不该再算进未还合计：%d 期 / %d 分", after.UnpaidCount, after.UnpaidTotal)
	}
}

// 迁移 0.26.0（用户 2026-10-13）：老的「账单日」「还款日前 N 天」提醒软删，
// 还款日提醒的到期时间从 0 点改到 23:59 —— 只动时间，不碰完成状态。
func TestFixCardPlanRemindersUpgrade(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 93
	loc := cardTestLoc(t)
	list, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	card := Card{UserID: userID, ListID: list.ID, Name: "老卡", Bank: "招行", StatementDay: 5, DueDay: 25}
	if err := appDB.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	// 造三条「旧口径」提醒：账单日 / 还款日 / 提前提醒，时间都在当天 0 点
	midnight := func(day int) time.Time {
		return time.Date(2026, time.October, day, 0, 0, 0, 0, loc)
	}
	doneAt := time.Now()
	rows := []Reminder{
		{UserID: userID, ListID: list.ID, CardID: card.ID, CardRole: cardRoleStatement, Title: "老卡 账单日", DueAt: ptrTime(midnight(5)), Kind: KindTask, RepeatRule: "monthly"},
		{UserID: userID, ListID: list.ID, CardID: card.ID, CardRole: cardRoleDue, Title: "老卡 还款日", DueAt: ptrTime(midnight(25)), Kind: KindTask, RepeatRule: "monthly"},
		{UserID: userID, ListID: list.ID, CardID: card.ID, CardRole: cardRoleAdvance, Title: "老卡 还款提醒（还有 3 天）", DueAt: ptrTime(midnight(22)), Kind: KindTask, RepeatRule: "monthly"},
		{UserID: userID, ListID: list.ID, CardID: card.ID, CardRole: cardRoleDue, Title: "老卡 还款日（已完成）", DueAt: ptrTime(midnight(25)), Kind: KindTask, RepeatRule: "monthly", CompletedAt: &doneAt},
	}
	if err := appDB.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	// 找出注册表里那条迁移并执行（与升级流程用的是同一个函数）
	var upgrade func(*gorm.DB) error //nolint
	for _, u := range database.Upgrades {
		if u.Version == "0.26.0" && u.Name == "fix_card_plan_reminders" {
			upgrade = u.Upgrade
		}
	}
	if upgrade == nil {
		t.Fatal("注册表里找不到 fix_card_plan_reminders 迁移")
	}
	if err := upgrade(appDB); err != nil {
		t.Fatal(err)
	}

	alive := func(role string) int64 {
		var n int64
		if err := appDB.Model(&Reminder{}).
			Where("card_id = ? AND card_role = ? AND deleted_at IS NULL", card.ID, role).Count(&n).Error; err != nil {
			t.Fatal(err)
		}
		return n
	}
	if got := alive(cardRoleStatement); got != 0 {
		t.Errorf("账单日提醒应被软删，实际还剩 %d", got)
	}
	if got := alive(cardRoleAdvance); got != 0 {
		t.Errorf("提前提醒应被软删，实际还剩 %d", got)
	}
	if got := alive(cardRoleDue); got != 2 {
		t.Errorf("两条还款日提醒都应保留（含已完成那条），实际 %d", got)
	}
	var kept []Reminder
	if err := appDB.Where("card_id = ? AND card_role = ? AND deleted_at IS NULL", card.ID, cardRoleDue).
		Order("id ASC").Find(&kept).Error; err != nil {
		t.Fatal(err)
	}
	for _, r := range kept {
		if h, m := r.DueAt.In(loc).Hour(), r.DueAt.In(loc).Minute(); h != 23 || m != 59 {
			t.Errorf("到期时间应改成 23:59，实际 %02d:%02d（%s）", h, m, r.Title)
		}
		if d := r.DueAt.In(loc).Day(); d != 25 {
			t.Errorf("日期不该变，%s 的日号成了 %d", r.Title, d)
		}
	}
	if kept[1].CompletedAt == nil {
		t.Error("已完成状态不该被迁移清掉")
	}
}
