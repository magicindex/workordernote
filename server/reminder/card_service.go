package reminder

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// 信用卡的业务逻辑：日期口径、还款计划（提醒）、账单期（金额与还款）。
//
// 日期口径必须和前端 web/src/utils/card.ts 保持一致：
//   · 某月没有那一天（如 2 月 31 号）就取当月最后一天；
//   · 「下一个账单日」把当天算作还没过去；
//   · 免息期 = 账单日 → 它对应的还款日，还款日 ≤ 账单日按跨月算。

const (
	cardRoleStatement = "statement"
	cardRoleDue       = "due"
	cardRoleAdvance   = "advance"
)

func validCardDay(day int) bool { return day >= 1 && day <= 31 }

// dateWithDay 返回某年某月的第 day 天；该月没有这一天就取当月最后一天。
func dateWithDay(year int, month time.Month, day int, loc *time.Location) time.Time {
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, loc).Day()
	if day > last {
		day = last
	}
	if day < 1 {
		day = 1
	}
	return time.Date(year, month, day, 0, 0, 0, 0, loc)
}

// nextDayOccurrence 返回从今天算起、还没过去的那个「每月 day 号」（今天算没过去）。
func nextDayOccurrence(day int, now time.Time) time.Time {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	at := dateWithDay(today.Year(), today.Month(), day, now.Location())
	if at.Before(today) {
		next := today.AddDate(0, 1, 0)
		at = dateWithDay(next.Year(), next.Month(), day, now.Location())
	}
	return at
}

// graceDaysBetween 是账单日到它对应还款日的天数（免息期）。
func graceDaysBetween(statementDay, dueDay int, now time.Time) int {
	statement := nextDayOccurrence(statementDay, now)
	due := dateWithDay(statement.Year(), statement.Month(), dueDay, now.Location())
	if dueDay <= statementDay {
		next := statement.AddDate(0, 1, 0)
		due = dateWithDay(next.Year(), next.Month(), dueDay, now.Location())
	}
	return int(due.Sub(statement).Hours() / 24)
}

// periodOf 是某个账单日所属的账单期（"2026-10"）：按账单日的年月。
func periodOf(statement time.Time) string { return statement.Format("2006-01") }

// statementDates 算出某一期的账单日与还款日（账单期由账单日的年月决定）。
func statementDates(card Card, year int, month time.Month, loc *time.Location) (time.Time, time.Time) {
	statement := dateWithDay(year, month, card.StatementDay, loc)
	due := dateWithDay(year, month, card.DueDay, loc)
	if card.DueDay <= card.StatementDay {
		next := statement.AddDate(0, 1, 0)
		due = dateWithDay(next.Year(), next.Month(), card.DueDay, loc)
	}
	return statement, due
}

// currentPeriod 是「现在该看的那一期」：还款日还没过的那一期（都过了就看下一期）。
func currentPeriod(card Card, now time.Time) (period string, statement, due time.Time) {
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	for i := 0; i < 3; i++ {
		m := today.AddDate(0, i, 0)
		s, d := statementDates(card, m.Year(), m.Month(), loc)
		if !d.Before(today) {
			return periodOf(s), s, d
		}
	}
	s, d := statementDates(card, today.Year(), today.Month(), loc)
	return periodOf(s), s, d
}

func cardDisplayName(card Card) string {
	name := strings.TrimSpace(card.Bank + card.Name)
	if name == "" {
		name = "信用卡"
	}
	return name
}

func cardTailNo(no string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, no)
	if len(digits) <= 4 {
		return digits
	}
	return digits[len(digits)-4:]
}

func cardSummary(card Card, now time.Time) *CardSummary {
	if !validCardDay(card.StatementDay) || !validCardDay(card.DueDay) {
		return nil
	}
	statement := nextDayOccurrence(card.StatementDay, now)
	due := nextDayOccurrence(card.DueDay, now)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	summary := &CardSummary{
		StatementDate:   statement.Format("2006-01-02"),
		DueDate:         due.Format("2006-01-02"),
		DaysToStatement: int(statement.Sub(today).Hours() / 24),
		DaysToDue:       int(due.Sub(today).Hours() / 24),
		GraceDays:       graceDaysBetween(card.StatementDay, card.DueDay, now),
		AdvanceDays:     card.AdvanceDays,
	}
	if card.AdvanceDays > 0 {
		summary.AdvanceDate = due.AddDate(0, 0, -card.AdvanceDays).Format("2006-01-02")
	}
	return summary
}

func cardPlanNote(card Card, summary *CardSummary) string {
	lines := []string{}
	if tail := cardTailNo(card.No); tail != "" {
		lines = append(lines, fmt.Sprintf("卡号尾号 %s", tail))
	}
	lines = append(lines, fmt.Sprintf("账单日 每月 %d 号 · 还款日 每月 %d 号", card.StatementDay, card.DueDay))
	if summary != nil {
		lines = append(lines, fmt.Sprintf("账单日到还款日 %d 天（免息期）", summary.GraceDays))
	}
	if card.AdvanceDays > 0 {
		lines = append(lines, fmt.Sprintf("还款日前 %d 天会提前提醒一次", card.AdvanceDays))
	}
	if notes := strings.TrimSpace(card.Notes); notes != "" {
		lines = append(lines, notes)
	}
	return strings.Join(lines, "\n")
}

// generateCardPlan 按卡片当前信息重建它的提醒：
//
//	账单日（statement）、还款日（due）、提前提醒（advance，可选）
//
// 旧的自动生成项先软删，避免改一次账单日就多出一批重复提醒。
func generateCardPlan(db *gorm.DB, card *Card, now time.Time) ([]Reminder, error) {
	if !validCardDay(card.StatementDay) || !validCardDay(card.DueDay) {
		return nil, errors.New("请填写账单日与还款日（每月 1–31 号）")
	}
	var created []Reminder
	err := db.Transaction(func(tx *gorm.DB) error {
		nowPtr := now
		if err := tx.Model(&Reminder{}).
			Where("user_id = ? AND card_id = ? AND deleted_at IS NULL", card.UserID, card.ID).
			Updates(map[string]interface{}{"deleted_at": nowPtr, "updated_at": nowPtr}).Error; err != nil {
			return err
		}

		summary := cardSummary(*card, now)
		repeat := "none"
		if card.AutoRepeat {
			repeat = "monthly"
		}
		note := cardPlanNote(*card, summary)
		name := cardDisplayName(*card)

		specs := []struct {
			role  string
			title string
			day   int
		}{
			{cardRoleStatement, name + " 账单日", card.StatementDay},
			{cardRoleDue, name + " 还款日", card.DueDay},
		}
		if card.AdvanceDays > 0 {
			// 「还款日前 N 天」不是一个固定的号数：按还款日推算日期更准，
			// 所以这一条用绝对日期 + 同规则重复，而不是「每月某号」。
			due := nextDayOccurrence(card.DueDay, now).AddDate(0, 0, -card.AdvanceDays)
			specs = append(specs, struct {
				role  string
				title string
				day   int
			}{cardRoleAdvance, fmt.Sprintf("%s 还款提醒（还有 %d 天）", name, card.AdvanceDays), due.Day()})
		}
		for _, spec := range specs {
			due := nextDayOccurrence(spec.day, now)
			if spec.role == cardRoleAdvance {
				due = nextDayOccurrence(card.DueDay, now).AddDate(0, 0, -card.AdvanceDays)
			}
			row := Reminder{
				UserID: card.UserID, ListID: card.ListID, CardID: card.ID, CardRole: spec.role,
				Title: spec.title, Notes: note, Kind: KindTask, DueAt: &due, AllDay: true,
				RepeatRule: repeat, Calendar: "solar", Version: 1,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			// 只上站内通知：其它渠道要用户自己的绑定，编辑那条提醒即可加上。
			if err := replaceChannels(tx, row, SaveReminderInput{Channels: []string{"inapp"}}); err != nil {
				return err
			}
			if err := rebuildJobs(tx, row, []string{"inapp"}); err != nil {
				return err
			}
			created = append(created, row)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

// listCards 取某个用户的卡片（可按清单过滤），并带上摘要、本期账单与待还合计。
func listCards(db *gorm.DB, userID uint, listID uint, now time.Time) ([]CardDTO, error) {
	query := db.Where("user_id = ? AND deleted_at IS NULL", userID)
	if listID > 0 {
		query = query.Where("list_id = ?", listID)
	}
	var cards []Card
	if err := query.Order("position, id").Find(&cards).Error; err != nil {
		return nil, err
	}
	out := make([]CardDTO, 0, len(cards))
	for _, card := range cards {
		dto, err := buildCardDTO(db, card, now)
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	return out, nil
}

func buildCardDTO(db *gorm.DB, card Card, now time.Time) (CardDTO, error) {
	dto := CardDTO{Card: card, Summary: cardSummary(card, now)}
	period, statement, due := currentPeriod(card, now)
	var row CardStatement
	err := db.Where("user_id = ? AND card_id = ? AND period = ? AND deleted_at IS NULL", card.UserID, card.ID, period).
		First(&row).Error
	if err == nil {
		dto.Current = &CardStatementDTO{CardStatement: row}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return dto, err
	} else {
		// 本期还没填过金额：给出算好的日期，前端可以直接填
		dto.Current = &CardStatementDTO{CardStatement: CardStatement{
			CardID: card.ID, UserID: card.UserID, Period: period, StatementDate: statement, DueDate: due,
		}}
	}
	if err := db.Model(&CardStatement{}).
		Where("user_id = ? AND card_id = ? AND deleted_at IS NULL AND paid_at IS NULL", card.UserID, card.ID).
		Select("COALESCE(SUM(amount), 0)").Scan(&dto.UnpaidTotal).Error; err != nil {
		return dto, err
	}
	if err := db.Model(&CardStatement{}).
		Where("user_id = ? AND card_id = ? AND deleted_at IS NULL AND paid_at IS NULL", card.UserID, card.ID).
		Count(&dto.UnpaidCount).Error; err != nil {
		return dto, err
	}
	return dto, nil
}

// upsertStatement 记下某一期的金额（同一期重复提交即更新）。
func upsertStatement(db *gorm.DB, userID uint, card Card, period string, amount, minimum int64, note string) (CardStatement, error) {
	var row CardStatement
	statement, due, err := parsePeriodDates(card, period)
	if err != nil {
		return row, err
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		found := tx.Where("user_id = ? AND card_id = ? AND period = ?", userID, card.ID, period).First(&row)
		if errors.Is(found.Error, gorm.ErrRecordNotFound) {
			row = CardStatement{
				UserID: userID, CardID: card.ID, Period: period,
				StatementDate: statement, DueDate: due, Amount: amount, Minimum: minimum, Note: note,
			}
			return tx.Create(&row).Error
		}
		if found.Error != nil {
			return found.Error
		}
		return tx.Model(&CardStatement{}).Where("id = ?", row.ID).
			Updates(map[string]interface{}{
				"amount": amount, "minimum": minimum, "note": note,
				"statement_date": statement, "due_date": due, "deleted_at": nil,
			}).Error
	})
	return row, err
}

// parsePeriodDates 把 "2026-10" 解析成这一期的账单日与还款日。
func parsePeriodDates(card Card, period string) (time.Time, time.Time, error) {
	t, err := time.ParseInLocation("2006-01", strings.TrimSpace(period), time.Local)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("账单期格式应为 YYYY-MM")
	}
	statement, due := statementDates(card, t.Year(), t.Month(), time.Local)
	return statement, due, nil
}

// payStatement 标记某一期已还：写 paid_at/paid_amount，并把这一期对应的
// 「还款日」提醒标记完成（进完成记录，之后按月滚动到下一期）。
func payStatement(db *gorm.DB, userID uint, card Card, period string, amount int64, now time.Time) (CardStatement, error) {
	row, err := upsertStatement(db, userID, card, period, amount, 0, "")
	if err != nil {
		return row, err
	}
	if amount <= 0 {
		amount = row.Amount
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&CardStatement{}).Where("id = ?", row.ID).
			Updates(map[string]interface{}{"paid_at": now, "paid_amount": amount}).Error; err != nil {
			return err
		}
		row.PaidAt = &now
		row.PaidAmount = amount
		// 顺带完成这张卡的「还款日」提醒：完成记录里就有了这一笔，
		// 列表页的「已完成」与完成历史都能看到。
		var reminder Reminder
		found := tx.Where("user_id = ? AND card_id = ? AND card_role = ? AND deleted_at IS NULL",
			userID, card.ID, cardRoleDue).First(&reminder)
		if errors.Is(found.Error, gorm.ErrRecordNotFound) {
			return nil
		}
		if found.Error != nil {
			return found.Error
		}
		// 复用现成的完成逻辑：重复提醒会写一条完成历史并把 due_at 滚到下一期
		_, err := completeReminder(tx, userID, reminder.ID)
		return err
	})
	return row, err
}

// unpaidStatements 取还没还的账单（含逾期），用于历史与合计。
func unpaidStatements(db *gorm.DB, userID uint, cardID uint) ([]CardStatement, error) {
	var rows []CardStatement
	query := db.Where("user_id = ? AND deleted_at IS NULL AND paid_at IS NULL", userID)
	if cardID > 0 {
		query = query.Where("card_id = ?", cardID)
	}
	err := query.Order("due_date").Find(&rows).Error
	return rows, err
}

// cardPeriods 是还款计划：把「已出的、当期的、未来的」期数排出来，
// 并合上已记录的金额与还款状态。往前看 12 期（漏还的要能看到），往后看 months 期。
func cardPeriods(db *gorm.DB, card Card, now time.Time, months int) ([]CardPeriod, error) {
	if months <= 0 || months > 36 {
		months = 12
	}
	loc := now.Location()
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc).AddDate(0, -12, 0)

	var stored []CardStatement
	if err := db.Where("user_id = ? AND card_id = ? AND deleted_at IS NULL", card.UserID, card.ID).Find(&stored).Error; err != nil {
		return nil, err
	}
	byPeriod := make(map[string]CardStatement, len(stored))
	for _, row := range stored {
		byPeriod[row.Period] = row
	}

	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	currentPeriodKey, _, _ := currentPeriod(card, now)

	periods := make([]CardPeriod, 0, months+13)
	for i := 0; i <= 12+months; i++ {
		m := start.AddDate(0, i, 0)
		statement, due := statementDates(card, m.Year(), m.Month(), loc)
		period := periodOf(statement)
		entry := CardPeriod{
			Period:        period,
			StatementDate: statement.Format("2006-01-02"),
			DueDate:       due.Format("2006-01-02"),
			Current:       period == currentPeriodKey,
		}
		if row, ok := byPeriod[period]; ok {
			entry.Amount = row.Amount
			entry.Minimum = row.Minimum
			entry.PaidAmount = row.PaidAmount
			entry.Note = row.Note
			if row.PaidAt != nil {
				entry.Paid = true
				entry.PaidAt = row.PaidAt.Format("2006-01-02")
			}
		}
		entry.Overdue = !entry.Paid && due.Before(today)
		// 未来还没出账的期数（账单日还没到）不用列：列出来也没有意义。
		// 但当期、逾期未还的、以及已经记过金额的都要显示。
		if !entry.Current && !entry.Overdue && !entry.Paid && entry.Amount == 0 && statement.After(today) {
			continue
		}
		periods = append(periods, entry)
	}
	return periods, nil
}
