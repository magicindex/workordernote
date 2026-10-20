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

// 信用卡生成的提醒一律落在**还款日当天的 23:59**（用户 2026-10-13：「信用卡新建时间同
// 新建提醒一致默认 23:59」）：原来生成在 0 点，等于半夜弹窗、而且当天零点就算到期。
const (
	cardDueClockHour   = 23
	cardDueClockMinute = 59
)

// cardDayAt 返回「从今天算起还没过去的那个每月 day 号」的指定时刻（默认还款日的 23:59）。
func cardDayAt(day int, now time.Time, hour, minute int) time.Time {
	d := nextDayOccurrence(day, now)
	return time.Date(d.Year(), d.Month(), d.Day(), hour, minute, 0, 0, d.Location())
}

// cardRemindWindowStart 是信用卡提醒的**提前窗口起点**（用户 2026-10-13：
// 「信用卡还款从账单日开始，直到还款日」）：
//
//	· 还款日那条 → **本期账单日**（账单日当天到「开始提醒时间」就开始提醒）；
//	· 还款提醒（还有 N 天）→ 还款日往前 N 天。
//
// 窗口起点只用来决定「第一次提醒什么时候开始」（见 notify_window.go 的 firstRemindAt），
// **到期时间仍然是还款日** —— 今天/计划/统计页的逾期口径都按还款日算。
func cardRemindWindowStart(db *gorm.DB, item Reminder) (time.Time, bool) {
	if item.CardID == 0 || item.DueAt == nil {
		return time.Time{}, false
	}
	var card Card
	if err := db.Where("id = ? AND deleted_at IS NULL", item.CardID).First(&card).Error; err != nil {
		return time.Time{}, false
	}
	if !validCardDay(card.StatementDay) || !validCardDay(card.DueDay) {
		return time.Time{}, false
	}
	due := item.DueAt.In(shanghai())
	switch item.CardRole {
	case cardRoleAdvance:
		if card.AdvanceDays <= 0 {
			return time.Time{}, false
		}
		return due.AddDate(0, 0, -card.AdvanceDays), true
	case cardRoleDue:
		// 这一期还款日对应的账单日：账单日在还款日之前 —— 还款日 ≤ 账单日 号数的卡是
		// 「本月账单日 → 下月还款日」（跨月），这时账单日要退到上个月。
		statement := dateWithDay(due.Year(), due.Month(), card.StatementDay, due.Location())
		if statement.After(due) {
			prev := due.AddDate(0, -1, 0)
			statement = dateWithDay(prev.Year(), prev.Month(), card.StatementDay, due.Location())
		}
		return statement, true
	}
	return time.Time{}, false
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

// currentPeriod 是「现在该看的那一期」：**还款日还没过、且最早的那一期**。
//
// 循环要从**上一个月**开始（i = -1）：跨月卡的账期是「本月账单日 → 下月还款日」
// （还款日 ≤ 账单日时），所以 10-08 看到的那一期其实是 **9 月**的账单（9-25 出账、10-19 还款）。
// 以前从当月开始找，会直接跳到 10 月的账单（10-25 出账、11-19 还款），于是：
//
//	· 本期金额记到了错误的期数上；
//	· 卡片颜色停在「账单未出」（黄→橘的那一段永远不出现）——
//	  用户报的「上个月 25 号账单日、这个月 19 号还款日，颜色没变」就是这个 bug。
func currentPeriod(card Card, now time.Time) (period string, statement, due time.Time) {
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	for i := -1; i < 3; i++ {
		m := today.AddDate(0, i, 0)
		s, d := statementDates(card, m.Year(), m.Month(), loc)
		if !d.Before(today) {
			return periodOf(s), s, d
		}
	}
	s, d := statementDates(card, today.Year(), today.Month(), loc)
	return periodOf(s), s, d
}

// nextPeriod 返回「再往后一期」的账期与起止日期。账期标识沿用开始那一天的月份，
// 与 currentPeriod/parsePeriodDates 保持一致（跨月卡也不例外）。
func nextPeriod(card Card, statement time.Time) (period string, nextStatement, due time.Time) {
	loc := statement.Location()
	m := statement.AddDate(0, 1, 0)
	nextStatement, due = statementDates(card, m.Year(), m.Month(), loc)
	return periodOf(nextStatement), nextStatement, due
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

		// 信用卡只生成**还款**相关的提醒（用户 2026-10-13：
		// 「修正账单日仅在卡片页面使用，今天、计划页面 逾期时间计算采用还款日，到期时间为还款日」）：
		//   · 账单日过去也有一条「X 账单日」提醒，它在列表里是一条「到期时间＝账单日」的任务，
		//     账单日一过就变「已逾期」—— 可钱是还款日才要还，用户看到的就是「逾期时间错位」。
		//     现在账单日只在卡片页面用（卡面/摘要里都有），不再生成提醒（老数据由
		//     register.go 的 drop_card_statement_reminders 迁移软删）。
		//   · 到期时间一律是**还款日 23:59**（用户 2026-10-13：「信用卡新建时间同新建提醒一致
		//     默认 23:59」；原来生成在当天 0 点，等于半夜就提醒、当天零点就算到期）。
		//   · 提醒**从本期账单日开始**（用户 2026-10-13：「信用卡还款从账单日开始，直到还款日，
		//     如果没有还款确认则提示逾期」）—— 窗口起点由 cardRemindWindowStart 按卡片算，
		//     窗口内每天只在「开始提醒时间」提醒一次（见 dispatcher.go 的 scheduleRepeatNotify），
		//     过了还款日还没确认还款就是逾期（逾期提醒照发）。
		// 每张卡只留**一条**还款提醒（用户 2026-10-13）：
		//   · 「账单日」那条不再生成（账单日只在卡片页面用）；
		//   · 原来的「还款日前 N 天提醒」（cardRoleAdvance）也不再单独生成 —— 新口径是
		//     **从账单日一直提醒到还款日**，账单日到还款日通常 20 天上下，任何「提前 N 天」
		//     都落在这个窗口里，等于重复。卡片设置里的「提前提醒天数」相应地不再出现在界面上
		//     （字段保留，老数据不删，同步也不受影响）。
		dueAt := cardDayAt(card.DueDay, now, cardDueClockHour, cardDueClockMinute)
		specs := []struct {
			role  string
			title string
			due   time.Time
		}{
			{cardRoleDue, name + " 还款日", dueAt},
		}
		for _, spec := range specs {
			due := spec.due
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
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return dto, err
	}
	if err == nil {
		// 本期已经点过「已还款」：应还额度就算结清了，卡片要**跳到下一期**。
		// 不跳的话读秒还停在刚还过的那一期（用户报的「交通银行手工点了已还款，
		// 还款倒计时没有跳到下一周期，导致排序错误」），而且它还会一直以「快到还款日」
		// 的身份排在前面。
		if row.PaidAt != nil {
			period, statement, due = nextPeriod(card, statement)
			row = CardStatement{}
			err = db.Where("user_id = ? AND card_id = ? AND period = ? AND deleted_at IS NULL", card.UserID, card.ID, period).
				First(&row).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return dto, err
			}
		}
	}
	if err == nil {
		dto.Current = &CardStatementDTO{CardStatement: row}
	} else {
		// 本期还没填过金额：给出算好的日期，前端可以直接填
		dto.Current = &CardStatementDTO{CardStatement: CardStatement{
			CardID: card.ID, UserID: card.UserID, Period: period, StatementDate: statement, DueDate: due,
		}}
	}
	// 倒计时/日期跟着**当前这一期**走：还过款之后要指向下一期。原来 cardSummary 算的是
	// 「下一个还款日号」，刚还完 10-19 也还显示 10-19，用户看到的「倒计时没跳到下一周期」
	// 就是这个（同时也会让排序把已还的卡排在前面）。
	if dto.Summary != nil {
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		dto.Summary.StatementDate = statement.Format("2006-01-02")
		dto.Summary.DueDate = due.Format("2006-01-02")
		dto.Summary.DaysToStatement = int(statement.Sub(today).Hours() / 24)
		dto.Summary.DaysToDue = int(due.Sub(today).Hours() / 24)
		if card.AdvanceDays > 0 {
			dto.Summary.AdvanceDate = due.AddDate(0, 0, -card.AdvanceDays).Format("2006-01-02")
		}
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
	// 最近一次已还款的那一期（卡片上显示「本期已还 + 撤销已还」用）
	var lastPaid CardStatement
	if err := db.Where("user_id = ? AND card_id = ? AND deleted_at IS NULL AND paid_at IS NOT NULL", card.UserID, card.ID).
		Order("paid_at DESC").First(&lastPaid).Error; err == nil {
		dto.LastPaid = &CardStatementDTO{CardStatement: lastPaid}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
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
