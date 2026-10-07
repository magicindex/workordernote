package reminder

import (
	"time"

	"gorm.io/gorm"
)

// 「本周待还」：信用卡栏目页上那条长条卡片右半边用的数据。
//
// 口径：以**周一为一周的开始**，取每张卡**最早的那一期未还账单**，如果它的还款日
// 落在本周之内、或者已经过了（逾期），就列出来。金额取那一期记的应还金额
// （没记就是 0，前端显示「未记金额」）。已经还完的卡不出现在这里。

type WeekDueCard struct {
	CardID       uint   `json:"card_id"`
	Bank         string `json:"bank"`
	Name         string `json:"name"`
	Color        string `json:"color"`
	Tail         string `json:"tail"`
	Period       string `json:"period"`
	DueDate      string `json:"due_date"`
	DaysLeft     int    `json:"days_left"` // 负数表示已经逾期几天
	Overdue      bool   `json:"overdue"`
	AmountCents  int64  `json:"amount_cents"`
	MinimumCents int64  `json:"minimum_cents"`
}

type WeekDueDTO struct {
	Today      string        `json:"today"`
	Weekday    string        `json:"weekday"`
	WeekStart  string        `json:"week_start"`
	WeekEnd    string        `json:"week_end"`
	Count      int           `json:"count"`
	Overdue    int           `json:"overdue"`
	TotalCents int64         `json:"total_cents"`
	Cards      []WeekDueCard `json:"cards"`
}

var weekdayCN = [...]string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}

func weekDueCards(db *gorm.DB, userID uint, now time.Time) (WeekDueDTO, error) {
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	// Go 的 Weekday 里周日是 0，这里让周一当一周的第一天。
	offset := (int(today.Weekday()) + 6) % 7
	weekStart := today.AddDate(0, 0, -offset)
	weekEnd := weekStart.AddDate(0, 0, 7)

	out := WeekDueDTO{
		Today:     today.Format("2006-01-02"),
		Weekday:   weekdayCN[int(today.Weekday())],
		WeekStart: weekStart.Format("2006-01-02"),
		WeekEnd:   weekEnd.AddDate(0, 0, -1).Format("2006-01-02"),
		Cards:     []WeekDueCard{},
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
		// 每张卡取「最紧的那一期」：
		//   · 有未还账单（含逾期）→ 取最早的那一期，金额用账单里记的；
		//   · 没有未还账单     → 看当期：已还的不出现；**还没记金额的也要出现**
		//     （卡这周到期就该提醒，不该因为「还没填金额」被漏掉）。
		var (
			period  string
			due     time.Time
			amount  int64
			minimum int64
		)
		unpaid, err := unpaidStatements(db, userID, card.ID)
		if err != nil {
			return out, err
		}
		if len(unpaid) > 0 {
			// unpaidStatements 已按还款日升序：第一条就是最紧的那一期。
			nearest := unpaid[0]
			period, due, amount, minimum = nearest.Period, nearest.DueDate, nearest.Amount, nearest.Minimum
		} else {
			curPeriod, _, curDue := currentPeriod(card, now)
			var row CardStatement
			err := db.Where("user_id = ? AND card_id = ? AND period = ? AND deleted_at IS NULL",
				userID, card.ID, curPeriod).First(&row).Error
			if err == nil {
				if row.PaidAt != nil {
					continue // 这一期已经还了
				}
				amount, minimum = row.Amount, row.Minimum
			}
			period, due = curPeriod, curDue
		}
		due = time.Date(due.Year(), due.Month(), due.Day(), 0, 0, 0, 0, loc)
		if !due.Before(weekEnd) {
			continue // 下周或更晚，不算本周
		}
		item := WeekDueCard{
			CardID: card.ID, Bank: card.Bank, Name: card.Name, Color: card.Color,
			Tail: cardTailNo(card.No), Period: period,
			DueDate: due.Format("2006-01-02"), DaysLeft: int(due.Sub(today).Hours() / 24),
			AmountCents: amount, MinimumCents: minimum,
		}
		item.Overdue = item.DaysLeft < 0
		if item.Overdue {
			out.Overdue++
		}
		out.TotalCents += item.AmountCents
		out.Cards = append(out.Cards, item)
	}
	out.Count = len(out.Cards)
	return out, nil
}
