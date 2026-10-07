package reminder

import (
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// 信用卡清单：一个清单 = 一张卡。
//
// 用户填卡名/银行/卡号/账单日/还款日/备注 + 是否自动循环，后端据此生成还款计划：
//
//	· 账单日提醒（card_role=statement）
//	· 还款日提醒（card_role=due）
//
// 勾了自动循环就按月循环，不勾只生成最近一次。这两天在日历/列表里用两种标记色区分。
//
// 还款计划的日期口径（都按本地时区、当天 00:00 的「全天」提醒）：
//
//	· 账单日提醒 = 下一个还没到的账单日
//	· 还款日提醒 = 下一个还没到的还款日
//	· 免息期 = 账单日 → 它对应的还款日（还款日≤账单日的卡是跨月还款，顺延到下一月）
const (
	listTemplateGeneral = "general"
	listTemplateCard    = "credit_card"

	cardRoleStatement = "statement"
	cardRoleDue       = "due"
)

func normalizeListTemplate(t string) string {
	if strings.EqualFold(strings.TrimSpace(t), listTemplateCard) {
		return listTemplateCard
	}
	return listTemplateGeneral
}

func validCardDay(day int) bool { return day >= 1 && day <= 31 }

// dateWithDay 返回某年某月的第 day 天；该月没有这一天（如 2 月的 31 号）时取当月最后一天。
// 与 nextOccurrence 的月度滚动口径保持一致，免得账单日填 31 的卡在 2 月对不上。
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

// cardGraceDays 是账单日到还款日的天数（免息期）。还款日 ≤ 账单日视为跨月还款。
func cardGraceDays(statementDay, dueDay int, now time.Time) int {
	loc := now.Location()
	statement := nextDayOccurrence(statementDay, now)
	due := dateWithDay(statement.Year(), statement.Month(), dueDay, loc)
	if dueDay <= statementDay {
		next := statement.AddDate(0, 1, 0)
		due = dateWithDay(next.Year(), next.Month(), dueDay, loc)
	}
	return int(due.Sub(statement).Hours() / 24)
}

// CardSummary 是信用卡清单的「下一步」摘要：前端据此显示倒计时。
type CardSummary struct {
	StatementDate   string `json:"statement_date"`    // 下一次账单日 YYYY-MM-DD
	DueDate         string `json:"due_date"`          // 下一次还款日 YYYY-MM-DD
	DaysToStatement int    `json:"days_to_statement"` // 距账单日还有几天（今天=0）
	DaysToDue       int    `json:"days_to_due"`       // 距还款日还有几天
	GraceDays       int    `json:"grace_days"`        // 免息期（账单日→还款日）
}

func cardSummary(list List, now time.Time) *CardSummary {
	if normalizeListTemplate(list.Template) != listTemplateCard || !validCardDay(list.CardStatementDay) || !validCardDay(list.CardDueDay) {
		return nil
	}
	statement := nextDayOccurrence(list.CardStatementDay, now)
	due := nextDayOccurrence(list.CardDueDay, now)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	return &CardSummary{
		StatementDate:   statement.Format("2006-01-02"),
		DueDate:         due.Format("2006-01-02"),
		DaysToStatement: int(statement.Sub(today).Hours() / 24),
		DaysToDue:       int(due.Sub(today).Hours() / 24),
		GraceDays:       cardGraceDays(list.CardStatementDay, list.CardDueDay, now),
	}
}

// cardDisplayName 是生成提醒时用的称呼：银行 + 卡名，都没有就退回清单名。
func cardDisplayName(list List) string {
	parts := []string{strings.TrimSpace(list.CardBank), strings.TrimSpace(list.CardName)}
	name := strings.TrimSpace(strings.Join(parts, ""))
	if name == "" {
		name = strings.TrimSpace(list.Name)
	}
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

func cardPlanNote(list List, summary *CardSummary) string {
	lines := []string{}
	if tail := cardTailNo(list.CardNo); tail != "" {
		lines = append(lines, fmt.Sprintf("卡号尾号 %s", tail))
	}
	lines = append(lines, fmt.Sprintf("账单日 每月 %d 号 · 还款日 每月 %d 号", list.CardStatementDay, list.CardDueDay))
	if summary != nil {
		lines = append(lines, fmt.Sprintf("账单日到还款日 %d 天（免息期）", summary.GraceDays))
	}
	if notes := strings.TrimSpace(list.CardNotes); notes != "" {
		lines = append(lines, notes)
	}
	return strings.Join(lines, "\n")
}

// generateCardPlan 重建这个清单里的账单日/还款日提醒：
// 先把上一轮自动生成的（card_role 非空）软删掉，再按当前卡片信息重新生成，
// 这样改账单日/还款日之后不会留下旧的重复提醒。
func generateCardPlan(db *gorm.DB, list *List, now time.Time) ([]Reminder, error) {
	if normalizeListTemplate(list.Template) != listTemplateCard ||
		!validCardDay(list.CardStatementDay) || !validCardDay(list.CardDueDay) {
		return nil, fmt.Errorf("信用卡信息不完整：请填写账单日与还款日（1–31）")
	}
	var created []Reminder
	err := db.Transaction(func(tx *gorm.DB) error {
		// 旧的自动生成项软删（保留历史，同步也能把删除传出去）
		nowPtr := now
		if err := tx.Model(&Reminder{}).
			Where("user_id = ? AND list_id = ? AND card_role <> '' AND deleted_at IS NULL", list.UserID, list.ID).
			Updates(map[string]interface{}{"deleted_at": nowPtr, "updated_at": nowPtr}).Error; err != nil {
			return err
		}

		summary := cardSummary(*list, now)
		repeat := "none"
		if list.CardAutoRepeat {
			repeat = "monthly"
		}
		note := cardPlanNote(*list, summary)
		name := cardDisplayName(*list)
		specs := []struct {
			role  string
			title string
			day   int
		}{
			{cardRoleStatement, name + " 账单日", list.CardStatementDay},
			{cardRoleDue, name + " 还款日", list.CardDueDay},
		}
		for _, spec := range specs {
			due := nextDayOccurrence(spec.day, now)
			row := Reminder{
				UserID: list.UserID, ListID: list.ID,
				Title: spec.title, Notes: note, CardRole: spec.role,
				Kind: KindTask, DueAt: &due, AllDay: true,
				RepeatRule: repeat, Calendar: "solar", Version: 1,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			// 只上站内通知：其余渠道需要用户自己的绑定，编辑这条提醒即可加上。
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
