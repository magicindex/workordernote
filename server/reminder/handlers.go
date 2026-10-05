package reminder

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"smallgo/server/lunar"
	"smallgo/server/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func setupAuthRoutes(api *gin.RouterGroup, db *gorm.DB) {
	group := api.Group("/reminder")

	group.GET("/summary", handleSummary(db))
	group.GET("/events", handleRealtimeEvents())
	group.GET("/revision", handleRevision())
	group.GET("/lists", handleListLists(db))
	group.POST("/lists", handleCreateList(db))
	group.PATCH("/lists/:id", handleUpdateList(db))
	group.DELETE("/lists/:id", handleDeleteList(db))

	group.GET("/items", handleListReminders(db))
	// 「已完成」单独一个接口：它读的是 completions 历史 ∪ reminders 的完成，
	// 返回结构（CompletedItemDTO）与 /items 不同，并且支持时间段筛选。
	group.GET("/completed", handleCompletedHistory(db))
	// 日历视图：按日期区间取到期提醒（含已完成），供月历网格按天铺开。
	group.GET("/calendar", handleCalendarItems(db))
	// 导出当前筛选结果成 CSV：scope=active 走列表口径，scope=completed 走完成记录口径。
	group.GET("/export", handleExportReminders(db))
	group.POST("/items", handleCreateReminder(db))
	group.GET("/items/:id", handleGetReminder(db))
	group.PUT("/items/:id", handleUpdateReminder(db))
	group.DELETE("/items/:id", handleDeleteReminder(db))
	group.POST("/items/:id/complete", handleCompleteReminder(db))
	group.POST("/items/:id/restore", handleRestoreReminder(db))
	group.POST("/items/:id/snooze", handleSnoozeReminder(db))

	group.GET("/notifications", handleNotifications(db))
	group.GET("/notifications/unread-count", handleUnreadCount(db))
	group.POST("/notifications/:id/read", handleReadNotification(db))
	group.POST("/notifications/read-all", handleReadAllNotifications(db))

	group.GET("/channels", handleChannelStatuses(db))
	group.GET("/lunar", handleLunarCalendar(db))
	group.GET("/lunar/convert", handleLunarConvert(db))
	group.PUT("/channels/:channel", handleBindChannel(db))
	group.PATCH("/channels/:channel", handleToggleChannel(db))
	group.DELETE("/channels/:channel", handleUnbindChannel(db))
	group.DELETE("/channels/:channel/bindings/:id", handleDeleteChannelBinding(db))
	group.POST("/channels/:channel/test", handleTestChannel(db))
	group.POST("/channels/qq/bind-code", handleCreateQQBindCode(db))
}

// originClientID 是发起这次请求的浏览器标签页标识（前端每个标签页生成一个，随请求
// 与 SSE 连接一起带上）。广播数据变更时用它跳过发起者自己。
func originClientID(c *gin.Context) string {
	return strings.TrimSpace(c.GetHeader("X-Client-Id"))
}

func setupAdminRoutes(api *gin.RouterGroup, db *gorm.DB) {
	// 双机同步的设置与手动触发（见 sync_handlers.go）。
	setupSyncAdminRoutes(api, db)
	api.GET("/reminder/admin/providers", handleProviderStatuses(db))
	api.GET("/reminder/admin/notification-brand", handleNotificationBrand(db))
	api.PUT("/reminder/admin/notification-brand", handleNotificationBrand(db))
	api.PUT("/reminder/admin/providers/feishu", handleSaveFeishuProvider(db))
	api.PUT("/reminder/admin/providers/:provider", handleSaveProvider(db))
	api.GET("/reminder/admin/deliveries", func(c *gin.Context) {
		var jobs []DeliveryJob
		if err := db.Order("id DESC").Limit(200).Find(&jobs).Error; err != nil {
			response.ErrorInternal(c, "读取投递记录失败")
			return
		}
		response.Success(c, jobs)
	})
}

func currentUserID(c *gin.Context) uint {
	v, _ := c.Get("userID")
	switch id := v.(type) {
	case uint:
		return id
	case int:
		return uint(id)
	case float64:
		return uint(id)
	default:
		return 0
	}
}

func parseID(c *gin.Context) (uint, bool) {
	n, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || n == 0 {
		response.ErrorBadRequest(c, "无效的资源 ID")
		return 0, false
	}
	return uint(n), true
}

func writeServiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		response.Error(c, http.StatusNotFound, response.CodeNotFound, "提醒或清单不存在")
	case errors.Is(err, errVersionConflict):
		response.Error(c, http.StatusConflict, 409, err.Error())
	default:
		response.ErrorBadRequest(c, err.Error())
	}
}

func handleListLists(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := currentUserID(c)
		if _, err := ensureDefaultList(db, userID); err != nil {
			response.ErrorInternal(c, "初始化默认清单失败")
			return
		}
		var lists []List
		if err := db.Where("user_id = ? AND deleted_at IS NULL", userID).Order("is_default DESC, position ASC, id ASC").Find(&lists).Error; err != nil {
			response.ErrorInternal(c, "读取清单失败")
			return
		}
		type openCountRow struct {
			ListID    uint
			OpenCount int64
		}
		var countRows []openCountRow
		if err := db.Model(&Reminder{}).
			Select("list_id, COUNT(*) AS open_count").
			Where("user_id = ? AND completed_at IS NULL AND deleted_at IS NULL", userID).
			Group("list_id").Scan(&countRows).Error; err != nil {
			response.ErrorInternal(c, "统计清单失败")
			return
		}
		openCounts := make(map[uint]int64, len(countRows))
		for _, row := range countRows {
			openCounts[row.ListID] = row.OpenCount
		}
		result := make([]ListDTO, 0, len(lists))
		for _, list := range lists {
			result = append(result, ListDTO{List: list, OpenCount: openCounts[list.ID]})
		}
		response.Success(c, result)
	}
}

func handleCreateList(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in struct {
			Name  string `json:"name"`
			Color string `json:"color"`
			Icon  string `json:"icon"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "清单参数无效")
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		if in.Name == "" || len([]rune(in.Name)) > 40 {
			response.ErrorBadRequest(c, "清单名称应为 1–40 个字符")
			return
		}
		if in.Color == "" {
			in.Color = "blue"
		}
		if in.Icon == "" {
			in.Icon = "list"
		}
		var maxPosition int
		_ = db.Model(&List{}).Where("user_id = ?", currentUserID(c)).Select("COALESCE(MAX(position), 0)").Scan(&maxPosition).Error
		list := List{UserID: currentUserID(c), Name: in.Name, Color: in.Color, Icon: in.Icon, Position: maxPosition + 1}
		if err := db.Create(&list).Error; err != nil {
			response.ErrorInternal(c, "创建清单失败")
			return
		}
		publishDataChanged(list.UserID, "list", "created", list.ID, originClientID(c))
		response.Success(c, list)
	}
}

func handleUpdateList(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		var in struct {
			Name      string `json:"name"`
			Color     string `json:"color"`
			Icon      string `json:"icon"`
			Position  *int   `json:"position"`
			IsDefault *bool  `json:"is_default"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "清单参数无效")
			return
		}
		var list List
		if err := db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", id, currentUserID(c)).First(&list).Error; err != nil {
			writeServiceError(c, err)
			return
		}
		// 默认清单必须恒有且唯一（新建提醒不带清单时、删除清单后归置提醒时都依赖它），
		// 所以这里只接受“设为默认”，不接受“取消默认”——换默认就是给另一个清单设 true。
		if in.IsDefault != nil {
			if !*in.IsDefault {
				response.ErrorBadRequest(c, "不能取消默认清单，请改为把其它清单设为默认")
				return
			}
			if err := setDefaultList(db, currentUserID(c), id); err != nil {
				writeServiceError(c, err)
				return
			}
		}
		updates := map[string]interface{}{}
		if name := strings.TrimSpace(in.Name); name != "" {
			updates["name"] = name
		}
		if in.Color != "" {
			updates["color"] = in.Color
		}
		if in.Icon != "" {
			updates["icon"] = in.Icon
		}
		if in.Position != nil {
			updates["position"] = *in.Position
		}
		if err := db.Model(&list).Updates(updates).Error; err != nil {
			response.ErrorInternal(c, "更新清单失败")
			return
		}
		db.First(&list, id)
		publishDataChanged(list.UserID, "list", "updated", list.ID, originClientID(c))
		response.Success(c, list)
	}
}

func handleDeleteList(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		userID := currentUserID(c)
		err := deleteList(db, userID, id)
		if err != nil {
			writeServiceError(c, err)
			return
		}
		// 删清单会把清单里的提醒挪到默认清单，所以提醒列表也得跟着刷。
		publishDataChanged(userID, "list", "deleted", id, originClientID(c))
		publishDataChanged(userID, "reminder", "moved", 0, originClientID(c))
		response.Success(c, gin.H{"deleted": true})
	}
}

// parseListFilter 解析清单筛选参数。两种写法都认：
//
//	list_id=3       单个（兼容旧调用）
//	list_ids=1,2,3  多个，用于「选择哪些清单在视图里显示」
//
// 空值、全非法值都返回 nil，表示不筛选（即全部清单）。
func parseListFilter(c *gin.Context) []uint {
	raw := strings.TrimSpace(c.Query("list_ids"))
	if raw == "" {
		raw = strings.TrimSpace(c.Query("list_id"))
	}
	if raw == "" {
		return nil
	}
	seen := make(map[uint]struct{})
	ids := make([]uint, 0, 4)
	for _, part := range strings.Split(raw, ",") {
		n, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || n <= 0 {
			continue
		}
		id := uint(n)
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil
	}
	return ids
}

func handleListReminders(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		items, err := listReminders(db, currentUserID(c), c.DefaultQuery("view", "today"), c.Query("q"), parseListFilter(c))
		if err != nil {
			response.ErrorInternal(c, "读取提醒失败")
			return
		}
		response.Success(c, items)
	}
}

func handleGetReminder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		item, err := getReminder(db, currentUserID(c), id)
		if err != nil {
			writeServiceError(c, err)
			return
		}
		response.Success(c, item)
	}
}

func handleCreateReminder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in SaveReminderInput
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "提醒参数无效")
			return
		}
		item, err := createReminder(db, currentUserID(c), in)
		if err != nil {
			writeServiceError(c, err)
			return
		}
		publishDataChanged(item.UserID, "reminder", "created", item.ID, originClientID(c))
		response.Success(c, item)
	}
}

func handleUpdateReminder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		var in SaveReminderInput
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "提醒参数无效")
			return
		}
		item, err := updateReminder(db, currentUserID(c), id, in)
		if err != nil {
			writeServiceError(c, err)
			return
		}
		publishDataChanged(item.UserID, "reminder", "updated", item.ID, originClientID(c))
		response.Success(c, item)
	}
}

func handleDeleteReminder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		if err := deleteReminder(db, currentUserID(c), id); err != nil {
			writeServiceError(c, err)
			return
		}
		publishDataChanged(currentUserID(c), "reminder", "deleted", id, originClientID(c))
		response.Success(c, gin.H{"deleted": true})
	}
}

func handleCompleteReminder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		item, err := completeReminder(db, currentUserID(c), id)
		if err != nil {
			writeServiceError(c, err)
			return
		}
		publishDataChanged(item.UserID, "reminder", "completed", item.ID, originClientID(c))
		response.Success(c, item)
	}
}

func handleRestoreReminder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		item, err := restoreReminder(db, currentUserID(c), id)
		if err != nil {
			writeServiceError(c, err)
			return
		}
		publishDataChanged(item.UserID, "reminder", "restored", item.ID, originClientID(c))
		response.Success(c, item)
	}
}

func handleSnoozeReminder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		var in struct {
			Until time.Time `json:"until"`
		}
		if err := c.ShouldBindJSON(&in); err != nil || in.Until.IsZero() {
			response.ErrorBadRequest(c, "请选择稍后提醒时间")
			return
		}
		item, err := snoozeReminder(db, currentUserID(c), id, in.Until)
		if err != nil {
			writeServiceError(c, err)
			return
		}
		publishDataChanged(item.UserID, "reminder", "snoozed", item.ID, originClientID(c))
		response.Success(c, item)
	}
}

func handleLunarCalendar(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		loc := shanghai()
		now := time.Now().In(loc)
		year := now.Year()
		month := int(now.Month())
		if raw := c.Query("year"); raw != "" {
			if n, err := strconv.Atoi(raw); err == nil {
				year = n
			}
		}
		if raw := c.Query("month"); raw != "" {
			if n, err := strconv.Atoi(raw); err == nil && n >= 1 && n <= 12 {
				month = n
			}
		}
		if year < 1901 || year > 2099 {
			response.ErrorBadRequest(c, "仅支持 1901–2099 年的农历")
			return
		}
		cells, err := lunar.CalendarMonth(year, time.Month(month), loc)
		if err != nil {
			response.ErrorBadRequest(c, "农历数据不可用")
			return
		}
		response.Success(c, gin.H{
			"year":  year,
			"month": month,
			"days":  cells,
		})
	}
}

// handleLunarConvert answers bidirectional lunar↔solar lookups for the date
// picker's calendar tabs:
//
//	GET /api/reminder/lunar/convert?year=2026&month=9&day=25
//	  → the lunar date of that Gregorian day (lunar_month negative = leap),
//	    plus the ganzhi/zodiac year label.
//	GET /api/reminder/lunar/convert?lunar_year=2026&lunar_month=8&lunar_day=15
//	  → the Gregorian date of that lunar day (30 clamps to the month end;
//	    a leap month with no counterpart in the year falls back to the
//	    regular month).
func handleLunarConvert(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		loc := shanghai()
		if c.Query("lunar_year") != "" {
			ly, err1 := strconv.Atoi(c.Query("lunar_year"))
			lm, err2 := strconv.Atoi(c.Query("lunar_month"))
			ld, err3 := strconv.Atoi(c.Query("lunar_day"))
			if err1 != nil || err2 != nil || err3 != nil || ly < 1901 || ly > 2099 {
				response.ErrorBadRequest(c, "农历日期参数无效")
				return
			}
			absMonth := lm
			if absMonth < 0 {
				absMonth = -absMonth
			}
			if absMonth < 1 || absMonth > 12 || ld < 1 || ld > 30 {
				response.ErrorBadRequest(c, "农历日期参数无效")
				return
			}
			solar, err := lunar.ToSolar(ly, lm, ld, loc)
			if err != nil {
				response.ErrorBadRequest(c, "农历日期不可用")
				return
			}
			converted := lunar.FromTime(solar)
			response.Success(c, gin.H{
				"lunar_year":      converted.Year,
				"lunar_month":     converted.Month,
				"lunar_day":       converted.Day,
				"lunar_year_name": lunar.YearName(ly),
				"year":            solar.Year(),
				"month":           int(solar.Month()),
				"day":             solar.Day(),
			})
			return
		}
		y, err1 := strconv.Atoi(c.Query("year"))
		m, err2 := strconv.Atoi(c.Query("month"))
		d, err3 := strconv.Atoi(c.Query("day"))
		if err1 != nil || err2 != nil || err3 != nil {
			response.ErrorBadRequest(c, "日期参数无效")
			return
		}
		if y < 1901 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31 {
			response.ErrorBadRequest(c, "日期参数无效")
			return
		}
		converted := lunar.FromTime(time.Date(y, time.Month(m), d, 12, 0, 0, 0, loc))
		response.Success(c, gin.H{
			"lunar_year":      converted.Year,
			"lunar_month":     converted.Month,
			"lunar_day":       converted.Day,
			"lunar_year_name": lunar.YearName(converted.Year),
			"year":            y,
			"month":           m,
			"day":             d,
		})
	}
}

// handleCompletedHistory 返回「已完成」记录，支持按时间段筛选。
//
// 参数：range = all | today | yesterday | week | lastweek | month | lastmonth | year | custom
// （默认 all 表示不限时间），custom 时另需 from / to（YYYY-MM-DD，按上海时区解释，含当天）；
// 另支持 list_id 与 q（标题模糊搜索）。
//
// 返回 { items, span }：items 是完成记录，span 是这次实际生效的区间（含当天），
// 前端把它显示在筛选器下方，用户能直接核对「这个时间段到底是哪几天」。
func handleCompletedHistory(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		loc, err := time.LoadLocation("Asia/Shanghai")
		if err != nil {
			response.ErrorInternal(c, "时区数据不可用")
			return
		}
		rng, err := ParseCompletedRange(c.Query("range"), c.Query("from"), c.Query("to"))
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		items, err := listCompletedHistory(db, currentUserID(c), rng, c.Query("q"), parseListFilter(c))
		if err != nil {
			response.ErrorInternal(c, "读取完成记录失败")
			return
		}
		response.Success(c, gin.H{
			"items": items,
			"span":  DescribeCompletedRange(rng, loc),
		})
	}
}

// handleCalendarItems 返回日历网格覆盖区间内的到期提醒（含已完成）。
// from / to 为 YYYY-MM-DD（上海时区），区间左闭右开；跨度上限 70 天，
// 一次最多覆盖两个多月的网格，避免客户端构造超大区间把库扫一遍。
func handleCalendarItems(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		loc, err := time.LoadLocation("Asia/Shanghai")
		if err != nil {
			response.ErrorInternal(c, "时区数据不可用")
			return
		}
		from, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(c.Query("from")), loc)
		if err != nil {
			response.ErrorBadRequest(c, "开始日期无效")
			return
		}
		to, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(c.Query("to")), loc)
		if err != nil {
			response.ErrorBadRequest(c, "结束日期无效")
			return
		}
		if !to.After(from) {
			response.ErrorBadRequest(c, "结束日期必须晚于开始日期")
			return
		}
		if to.Sub(from) > 70*24*time.Hour {
			response.ErrorBadRequest(c, "日历一次最多查询 70 天")
			return
		}
		items, err := listCalendarItems(db, currentUserID(c), from, to, parseListFilter(c))
		if err != nil {
			response.ErrorInternal(c, "读取日历失败")
			return
		}
		response.Success(c, items)
	}
}

func handleSummary(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := currentUserID(c)
		loc, _ := time.LoadLocation("Asia/Shanghai")
		now := time.Now()
		local := now.In(loc)
		endToday := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
		var counts struct {
			Today     int64
			Planned   int64
			OpenTotal int64
			Completed int64
			Overdue   int64
		}
		// 「已完成」角标必须和列表同口径（reminders.completed_at ∪ completions 历史），
		// 否则重复提醒的完成记录会让侧栏数字和页面条数对不上。这里把历史计数作为
		// 子查询并进同一条聚合语句，保持 /summary 仍然只有 2 条查询
		// （见 performance_test.go 的 TestSummaryUsesTwoAggregateQueries）。
		if err := db.Model(&Reminder{}).
			Select(`
				COALESCE(SUM(CASE WHEN completed_at IS NULL AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END), 0) AS today,
				COALESCE(SUM(CASE WHEN completed_at IS NULL AND due_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS planned,
				COALESCE(SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END), 0) AS open_total,
				COALESCE(SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END), 0)
					+ (SELECT COUNT(*) FROM completions WHERE user_id = ?) AS completed,
				COALESCE(SUM(CASE WHEN completed_at IS NULL AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END), 0) AS overdue`, endToday, userID, now).
			Where("user_id = ? AND deleted_at IS NULL", userID).
			Scan(&counts).Error; err != nil {
			response.ErrorInternal(c, "统计提醒失败")
			return
		}
		var unread int64
		if err := db.Model(&Notification{}).Where("user_id = ? AND read_at IS NULL", userID).Count(&unread).Error; err != nil {
			response.ErrorInternal(c, "统计通知失败")
			return
		}
		response.Success(c, gin.H{
			"today":     counts.Today,
			"planned":   counts.Planned,
			"all":       counts.OpenTotal,
			"completed": counts.Completed,
			"overdue":   counts.Overdue,
			"unread":    unread,
		})
	}
}

func handleNotifications(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var rows []Notification
		if err := db.Where("user_id = ?", currentUserID(c)).Order("id DESC").Limit(100).Find(&rows).Error; err != nil {
			response.ErrorInternal(c, "读取通知失败")
			return
		}
		response.Success(c, rows)
	}
}

func handleUnreadCount(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var count int64
		if err := db.Model(&Notification{}).Where("user_id = ? AND read_at IS NULL", currentUserID(c)).Count(&count).Error; err != nil {
			response.ErrorInternal(c, "读取未读数量失败")
			return
		}
		response.Success(c, gin.H{"count": count})
	}
}

func handleReadNotification(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		now := time.Now()
		result := db.Model(&Notification{}).Where("id = ? AND user_id = ?", id, currentUserID(c)).Update("read_at", &now)
		if result.Error != nil {
			response.ErrorInternal(c, "更新通知失败")
			return
		}
		if result.RowsAffected == 0 {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "通知不存在")
			return
		}
		publishDataChanged(currentUserID(c), "notification", "read", id, originClientID(c))
		response.Success(c, gin.H{"read": true})
	}
}

func handleReadAllNotifications(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		now := time.Now()
		if err := db.Model(&Notification{}).Where("user_id = ? AND read_at IS NULL", currentUserID(c)).Update("read_at", &now).Error; err != nil {
			response.ErrorInternal(c, "更新通知失败")
			return
		}
		publishDataChanged(currentUserID(c), "notification", "read-all", 0, originClientID(c))
		response.Success(c, gin.H{"read": true})
	}
}
