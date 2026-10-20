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

// exportColumn 是导出 CSV 的一列：key 用于前端多选与 URL 参数
// （columns=title,due,...），header 是 Excel 里的表头，pick 从一行里取这一格。
type exportColumn struct {
	Key    string
	Header string
	Pick   func(exportRow) string
}

// exportRow 是一行导出数据的全部可用字段（值已按各自口径格式化好）。
type exportRow struct {
	title     string
	kind      string
	list      string
	status    string
	due       string
	completed string
	repeat    string
	notes     string
}

// exportColumns 集中定义所有可导出的列——列 key、表头、取值函数只有这一处，
// 加列/改名不会漏掉某条导出路径。顺序就是 CSV 的列顺序；带 columns 参数时按这里
// 的顺序过滤，缺省（不带参数）导出全部列，输出与旧版逐字节一致。
var exportColumns = []exportColumn{
	{Key: "title", Header: "标题", Pick: func(r exportRow) string { return r.title }},
	{Key: "kind", Header: "类型", Pick: func(r exportRow) string { return r.kind }},
	{Key: "list", Header: "清单", Pick: func(r exportRow) string { return r.list }},
	{Key: "status", Header: "状态", Pick: func(r exportRow) string { return r.status }},
	{Key: "due", Header: "到期时间", Pick: func(r exportRow) string { return r.due }},
	{Key: "completed", Header: "完成时间", Pick: func(r exportRow) string { return r.completed }},
	{Key: "repeat", Header: "重复", Pick: func(r exportRow) string { return r.repeat }},
	{Key: "notes", Header: "备注", Pick: func(r exportRow) string { return r.notes }},
}

// selectedExportColumns 解析 columns=title,due（可空）。空串、或一个都没认出来
// 时返回 nil（＝导出全部列）；否则按 exportColumns 的固定顺序返回选中的 key。
func selectedExportColumns(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	wanted := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		wanted[strings.TrimSpace(part)] = true
	}
	keys := make([]string, 0, len(exportColumns))
	for _, col := range exportColumns {
		if wanted[col.Key] {
			keys = append(keys, col.Key)
		}
	}
	if len(keys) == 0 {
		return nil
	}
	return keys
}

// exportColumnsFor 返回要渲染的列：keys 为空表示全部列。
func exportColumnsFor(keys []string) []exportColumn {
	if len(keys) == 0 {
		return exportColumns
	}
	selected := make([]exportColumn, 0, len(keys))
	for _, key := range keys {
		for _, col := range exportColumns {
			if col.Key == key {
				selected = append(selected, col)
				break
			}
		}
	}
	return selected
}

// exportHeaderFor 返回选中的表头。
func exportHeaderFor(keys []string) []string {
	cols := exportColumnsFor(keys)
	out := make([]string, 0, len(cols))
	for _, col := range cols {
		out = append(out, col.Header)
	}
	return out
}

// exportHeader 是默认（全部列）的表头。列固定，Excel 里所见即所得。
func exportHeader() []string { return exportHeaderFor(nil) }

// renderExportRows 把行按选中的列渲染成 CSV 记录。
func renderExportRows(rows []exportRow, keys []string) [][]string {
	cols := exportColumnsFor(keys)
	out := make([][]string, 0, len(rows))
	for _, row := range rows {
		line := make([]string, 0, len(cols))
		for _, col := range cols {
			line = append(line, col.Pick(row))
		}
		out = append(out, line)
	}
	return out
}

// activeExportCells 把列表页的提醒/记事转成导出行的字段。纯函数，便于单测。
func activeExportCells(items []ReminderDTO, loc *time.Location, now time.Time) []exportRow {
	rows := make([]exportRow, 0, len(items))
	for _, item := range items {
		rows = append(rows, exportRow{
			title:     item.Title,
			kind:      kindLabel(item.Kind),
			list:      item.ListName,
			status:    reminderStatusLabel(item, now),
			due:       formatExportTime(item.DueAt, item.AllDay, loc),
			completed: formatExportTime(item.CompletedAt, false, loc),
			repeat:    repeatRuleLabel(item.RepeatRule, item.Calendar),
			notes:     strings.ReplaceAll(item.Notes, "\r\n", "\n"),
		})
	}
	return rows
}

// activeExportRows 默认全部列（旧调用点/单测沿用）。
func activeExportRows(items []ReminderDTO, loc *time.Location, now time.Time) [][]string {
	return renderExportRows(activeExportCells(items, loc, now), nil)
}

// completedExportCells 把「已完成」记录转成导出行的字段，沿用同一套列。
// 完成记录一行就是一次完成，所以状态列固定是「已完成」。
func completedExportCells(items []CompletedItemDTO, loc *time.Location) []exportRow {
	rows := make([]exportRow, 0, len(items))
	for _, item := range items {
		completedAt := item.CompletedAt
		rows = append(rows, exportRow{
			title:     item.Title,
			kind:      kindLabel(item.Kind),
			list:      item.ListName,
			status:    "已完成",
			due:       formatExportTime(item.ScheduledFor, false, loc),
			completed: formatExportTime(&completedAt, false, loc),
			repeat:    repeatRuleLabel(item.RepeatRule, ""),
			notes:     "",
		})
	}
	return rows
}

// calendarExportCells 把「某个月的日历条目」转成导出行的字段，沿用同一套列。
//
// 与列表口径的差别只在时间列：
//   - 任务：到期时间 = due_at，完成时间 = completed_at；
//   - 记事：没有到期时间（存的时候就被清掉了），记录时间写进「完成时间」列，
//     状态列统一写「记事」——它既不是未完成也不是「做完的任务」。
func calendarExportCells(items []CalendarItemDTO, loc *time.Location) []exportRow {
	rows := make([]exportRow, 0, len(items))
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
		rows = append(rows, exportRow{
			title:     item.Title,
			kind:      kindLabel(item.Kind),
			list:      item.ListName,
			status:    status,
			due:       formatExportTime(dueAt, item.AllDay, loc),
			completed: formatExportTime(completedAt, false, loc),
			repeat:    repeatRuleLabel(item.RepeatRule, ""),
			notes:     strings.ReplaceAll(item.Notes, "\r\n", "\n"),
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
//
// 导出对话框新增两个可选参数（都不传＝与旧版行为完全一致）：
//   - lists=1,2,3：只导出这些清单（缺省＝全部清单，含信用卡/记事本栏目）；
//   - columns=title,due,...：只导出这些列（缺省＝exportColumns 的全部列）。
//
// 导出永远是「所有数据」：不带页面上的月份与时间范围（用户要求）。
func handleExportReminders(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		loc, err := time.LoadLocation("Asia/Shanghai")
		if err != nil {
			response.ErrorInternal(c, "时区数据不可用")
			return
		}
		userID := currentUserID(c)
		scope := strings.TrimSpace(c.DefaultQuery("scope", "active"))
		// 清单筛选：新参数 lists 优先，缺省回落到旧的 list_ids/list_id。
		listIDs := parseListFilter(c)
		if raw := strings.TrimSpace(c.Query("lists")); raw != "" {
			listIDs = parseUintCSV(raw)
		}
		columns := selectedExportColumns(c.Query("columns"))

		var cells []exportRow
		filename := "task-list.csv"
		switch scope {
		case "completed":
			rng, err := ParseCompletedRange(c.Query("range"), c.Query("from"), c.Query("to"))
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			items, err := listCompletedHistory(db, userID, rng, c.Query("q"), listIDs)
			if err != nil {
				response.ErrorInternal(c, "读取完成记录失败")
				return
			}
			cells = completedExportCells(items, loc)
			filename = "completed-list.csv"
		case "active":
			// 导出不带月份：用户要求「导出内容则导出所有数据」，不受页面按月翻页影响。
			items, err := listReminders(db, userID, c.DefaultQuery("view", "all"),
				c.Query("q"), listIDs, wantCompleted(c), "", "", "")
			if err != nil {
				response.ErrorInternal(c, "读取提醒失败")
				return
			}
			cells = activeExportCells(items, loc, time.Now())
		case "calendar":
			start, end, err := parseExportMonth(c.Query("month"), loc)
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			items, err := listCalendarItems(db, userID, start, end, listIDs)
			if err != nil {
				response.ErrorInternal(c, "读取日历数据失败")
				return
			}
			cells = calendarExportCells(items, loc)
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
		_ = w.Write(exportHeaderFor(columns))
		for _, row := range renderExportRows(cells, columns) {
			_ = w.Write(row)
		}
	}
}
