package reminder

import (
	"sort"
	"time"

	"gorm.io/gorm"
)

// 「账单已出」的卡片：信用卡页头部那条时间卡片右半边用的数据。
//
// 口径（用户指定）：
//   · 只列**当期账单日已经过去**（账单已出）且**这一期还没还**的卡；
//     账单日还没到的卡不算「待还」，不进来；
//   · 排序：先把**红色**的（已逾期，或离还款日 ≤3 天）排在最前，红色内部按还款日由近到远；
//     其余按**账单日**由早到晚，账单日相同的按还款日由近到远；
//   · 不再按「本周」筛（0.13.x 的旧口径），所以这里也返回 statement_date 供显示与排序。

const billingUrgentDays = 3

type BillingCard struct {
	CardID        uint   `json:"card_id"`
	Bank          string `json:"bank"`
	Name          string `json:"name"`
	Color         string `json:"color"`
	Tail          string `json:"tail"`
	Period        string `json:"period"`
	StatementDate string `json:"statement_date"`
	DueDate       string `json:"due_date"`
	DaysLeft      int    `json:"days_left"` // 负数表示已经逾期几天
	Overdue       bool   `json:"overdue"`
	Urgent        bool   `json:"urgent"` // 逾期或 ≤3 天（红色卡）
	AmountCents   int64  `json:"amount_cents"`
	MinimumCents  int64  `json:"minimum_cents"`
}

type BillingDTO struct {
	Today      string        `json:"today"`
	Weekday    string        `json:"weekday"`
	Count      int           `json:"count"`
	Overdue    int           `json:"overdue"`
	Urgent     int           `json:"urgent"`
	TotalCents int64         `json:"total_cents"`
	Cards      []BillingCard `json:"cards"`
}

var weekdayCN = [...]string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}

func billingCards(db *gorm.DB, userID uint, now time.Time) (BillingDTO, error) {
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	out := BillingDTO{
		Today:   today.Format("2006-01-02"),
		Weekday: weekdayCN[int(today.Weekday())],
		Cards:   []BillingCard{},
	}

	bucket, err := findCardBucket(db, userID, false)
	if err != nil {
		return out, err
	}
	if bucket == nil {
		return out, nil
	}
	var cards []Card
	if err := db.Where("user_id = ? AND list_id = ? AND deleted_at IS NULL", userID, bucket.ID).
		Order("position, id").Find(&cards).Error; err != nil {
		return out, err
	}
	for _, card := range cards {
		var (
			period    string
			statement time.Time
			due       time.Time
			amount    int64
			minimum   int64
		)
		// 先看**未还的账单**（含逾期）：这是最紧的一期。
		// 不能只看 currentPeriod —— 它的口径是「还款日还没过的最早一期」，还款日一过
		// 就会滚到下个月，逾期未还的卡反而会从这条卡片里消失（必须在最前面才对）。
		unpaid, err := unpaidStatements(db, userID, card.ID)
		if err != nil {
			return out, err
		}
		if len(unpaid) > 0 {
			row := unpaid[0]
			statement, due, err = parsePeriodDates(card, row.Period)
			if err != nil {
				continue
			}
			period, amount, minimum = row.Period, row.Amount, row.Minimum
		} else {
			// 没有未还账单 → 看当期；当期没有记录也算「账单已出待记金额」，已还的则跳过
			period, statement, due = currentPeriod(card, now)
			var row CardStatement
			found := db.Where("user_id = ? AND card_id = ? AND period = ? AND deleted_at IS NULL",
				userID, card.ID, period).First(&row).Error
			if found == nil {
				if row.PaidAt != nil {
					continue
				}
				amount, minimum = row.Amount, row.Minimum
			}
		}
		statement = time.Date(statement.Year(), statement.Month(), statement.Day(), 0, 0, 0, 0, loc)
		due = time.Date(due.Year(), due.Month(), due.Day(), 0, 0, 0, 0, loc)
		// 账单日还没到 → 账单未出，不进这条卡片
		if today.Before(statement) {
			continue
		}

		days := int(due.Sub(today).Hours() / 24)
		item := BillingCard{
			CardID: card.ID, Bank: card.Bank, Name: card.Name, Color: card.Color,
			Tail: cardTailNo(card.No), Period: period,
			StatementDate: statement.Format("2006-01-02"),
			DueDate:       due.Format("2006-01-02"),
			DaysLeft:      days,
			Overdue:       days < 0,
			Urgent:        days <= billingUrgentDays,
			AmountCents:   amount,
			MinimumCents:  minimum,
		}
		out.TotalCents += item.AmountCents
		if item.Overdue {
			out.Overdue++
		}
		if item.Urgent {
			out.Urgent++
		}
		out.Cards = append(out.Cards, item)
	}

	// 红色最前 → 账单日早的在前 → 还款日近的在前
	sort.SliceStable(out.Cards, func(i, j int) bool {
		a, b := out.Cards[i], out.Cards[j]
		if a.Urgent != b.Urgent {
			return a.Urgent
		}
		if a.StatementDate != b.StatementDate {
			return a.StatementDate < b.StatementDate
		}
		if a.DaysLeft != b.DaysLeft {
			return a.DaysLeft < b.DaysLeft
		}
		return a.CardID < b.CardID
	})
	out.Count = len(out.Cards)
	return out, nil
}
