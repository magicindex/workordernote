package reminder

import (
	"encoding/csv"
	"errors"
	"strings"
	"time"

	"smallgo/server/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// repeatRuleLabel 把库里的重复规则翻译成导出表格里的中文说法。
// 「每年（农历）」只在 calendar 为 lunar 且规则是每月/每年时出现。
func repeatRuleLabel(rule, calendar string) string {
	label := map[string]string{
		"none":    "不重复",
		"daily":   "每天",
		"weekly":  "每周",
		"monthly": "每月",
		"yearly":  "每年",
	}[rule]
	if label == "" {
		label = rule
	}
	if calendar == "lunar" && (rule == "monthly" || rule == "yearly") {
		label += "（农历）"
	}
	return label
}

func kindLabel(kind string) string {
	if kind == KindNote {
		return "记事"
	}
	return "提醒"
}

// formatExportTime 按上海时区格式化导出时间；全天事项只保留日期。
// 指针为空表示没有这个时间（未完成项没有完成时间、无到期项没有到期时间）。
func formatExportTime(value *time.Time, allDay bool, loc *time.Location) string {
	if value == nil || value.IsZero() {
		return ""
	}
	local := value.In(loc)
	if allDay {
		return local.Format("2006-01-02")
	}
	return local.Format("2006-01-02 15:04")
}

// reminderStatusLabel 描述未完成视图里一行的状态：
// 记事建好即完成；有过期时间的提醒过了时间点算过期，其余是未完成。
func reminderStatusLabel(item ReminderDTO, now time.Time) string {
	if item.CompletedAt != nil {
		return "已完成"
	}
	if item.DueAt != nil && item.DueAt.Before(now) {
		return "已过期"
	}
	return "未完成"
}

// exportHeader 是两张表共用的表头。列固定，Excel 里所见即所得。
func exportHeader() []string {
	return []string{"标题", "类型", "清单", "状态", "到期时间", "完成时间", "重复", "备注"}
}

// activeExportRows 把列表页的提醒/记事转成导出行。纯函数，便于单测。
func activeExportRows(items []ReminderDTO, loc *time.Location, now time.Time) [][]string {
	rows := make([][]string, 0, len(items))
	for _, item := range items {
		rows = append(rows, []string{
			item.Title,
			kindLabel(item.Kind),
			item.ListName,
			reminderStatusLabel(item, now),
			formatExportTime(item.DueAt, item.AllDay, loc),
			formatExportTime(item.CompletedAt, false, loc),
			repeatRuleLabel(item.RepeatRule, item.Calendar),
			strings.ReplaceAll(item.Notes, "\r\n", "\n"),
		})
	}
	return rows
}

// completedExportRows 把「已完成」记录转成导出行，沿用同一套列。
// 完成记录一行就是一次完成，所以状态列固定是「已完成」。
func completedExportRows(items []CompletedItemDTO, loc *time.Location) [][]string {
	rows := make([][]string, 0, len(items))
	for _, item := range items {
		completedAt := item.CompletedAt
		rows = append(rows, []string{
			item.Title,
			kindLabel(item.Kind),
			item.ListName,
			"已完成",
			formatExportTime(item.ScheduledFor, false, loc),
			formatExportTime(&completedAt, false, loc),
			repeatRuleLabel(item.RepeatRule, ""),
			"",
		})
	}
	return rows
}

// calendarExportRows 把「某个月的日历条目」转成导出行，沿用同一套列。
//
// 与列表口径的差别只在时间列：
//   - 任务：到期时间 = due_at，完成时间 = completed_at；
//   - 记事：没有到期时间（存的时候就被清掉了），记录时间写进「完成时间」列，
//     状态列统一写「记事」——它既不是未完成也不是「做完的任务」。
func calendarExportRows(items []CalendarItemDTO, loc *time.Location) [][]string {
	rows := make([][]string, 0, len(items))
	for _, item := range items {
		status := "未完成"
		dueAt := &item.DueAt
		completedAt := item.CompletedAt
		if item.Kind == KindNote {
			status = "记事"
			dueAt = nil
		} else if item.Completed {
			status = "已完成"
		}
		rows = append(rows, []string{
			item.Title,
			kindLabel(item.Kind),
			item.ListName,
			status,
			formatExportTime(dueAt, item.AllDay, loc),
			formatExportTime(completedAt, false, loc),
			repeatRuleLabel(item.RepeatRule, ""),
			strings.ReplaceAll(item.Notes, "\r\n", "\n"),
		})
	}
	return rows
}

// parseExportMonth 解析 scope=calendar 的月份参数（YYYY-MM，缺省当月），
// 返回该月第一天与下月第一天（左闭右开，与其它区间口径一致）。
func parseExportMonth(raw string, loc *time.Location) (time.Time, time.Time, error) {
	month := strings.TrimSpace(raw)
	if month == "" {
		now := time.Now().In(loc)
		month = now.Format("2006-01")
	}
	start, err := time.ParseInLocation("2006-01", month, loc)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("月份格式应为 YYYY-MM")
	}
	return start, start.AddDate(0, 1, 0), nil
}

// handleExportReminders 把清单导出成 CSV（带 UTF-8 BOM，Excel/WPS 直接双击可读）。
//
// 参数与列表接口保持一致，导出的是「当前屏幕上这一份筛选结果」：
//   - scope=active（默认）：走 /items 的 view / q / list_ids / status；
//   - scope=completed：走 /completed 的 range / from / to / q / list_ids；
//   - scope=calendar：走日历视图的 month=YYYY-MM（缺省当月）+ list_ids，
//     内容与日历上看到的完全一致（任务按到期时间、记事按记录时间）。
func handleExportReminders(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		loc, err := time.LoadLocation("Asia/Shanghai")
		if err != nil {
			response.ErrorInternal(c, "时区数据不可用")
			return
		}
		userID := currentUserID(c)
		scope := strings.TrimSpace(c.DefaultQuery("scope", "active"))

		var rows [][]string
		filename := "task-list.csv"
		switch scope {
		case "completed":
			rng, err := ParseCompletedRange(c.Query("range"), c.Query("from"), c.Query("to"))
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			items, err := listCompletedHistory(db, userID, rng, c.Query("q"), parseListFilter(c))
			if err != nil {
				response.ErrorInternal(c, "读取完成记录失败")
				return
			}
			rows = completedExportRows(items, loc)
			filename = "completed-list.csv"
		case "active":
			// 导出不带月份：用户要求「导出内容则导出所有数据」，不受页面按月翻页影响。
			items, err := listReminders(db, userID, c.DefaultQuery("view", "all"),
				c.Query("q"), parseListFilter(c), wantCompleted(c), "")
			if err != nil {
				response.ErrorInternal(c, "读取提醒失败")
				return
			}
			rows = activeExportRows(items, loc, time.Now())
		case "calendar":
			start, end, err := parseExportMonth(c.Query("month"), loc)
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			items, err := listCalendarItems(db, userID, start, end, parseListFilter(c))
			if err != nil {
				response.ErrorInternal(c, "读取日历数据失败")
				return
			}
			rows = calendarExportRows(items, loc)
			filename = "calendar-" + start.Format("2006-01") + ".csv"
		default:
			response.ErrorBadRequest(c, "导出范围无效")
			return
		}

		c.Header("Content-Type", "text/csv; charset=utf-8")
		c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
		c.Writer.WriteString("\xEF\xBB\xBF") // UTF-8 BOM：Excel 打开中文不乱码

		w := csv.NewWriter(c.Writer)
		defer w.Flush()
		_ = w.Write(exportHeader())
		for _, row := range rows {
			_ = w.Write(row)
		}
	}
}
