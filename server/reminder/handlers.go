package reminder

import (
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"smallgo/server/lunar"
	"smallgo/server/response"
	"smallgo/server/sysconfig"

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
	// 清单顺序（用户 2026-10-10 要求）：偏好设置里用 ↑/↓ 调顺序，一次提交整串 id
	group.PUT("/lists/order", handleReorderLists(db))
	// 信用卡：一个清单可以放多张卡，卡片与账单期的接口见 card_handlers.go
	registerCardRoutes(group, db)
	group.DELETE("/lists/:id", handleDeleteList(db))

	group.GET("/items", handleListReminders(db))
	// 有数据的月份范围：给「全部」页底部的左右翻月用（用户要求只在有数据的月份之间翻）。
	group.GET("/items/months", handleItemMonths(db))
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

	// 「提醒@他」：多人之间互相推提醒（见 nudge.go）。开关是系统偏好 nudge_enabled。
	group.GET("/nudges", handleListNudges(db))
	group.POST("/nudges", handleCreateNudge(db))
	group.GET("/nudges/users", handleNudgeUsers(db))
	// 「保存到清单」（接收人把别人推来的提醒存成自己的任务）与「提醒一下」（发起人再即时推一次）
	group.POST("/nudges/:id/save", handleSaveNudgeToReminder(db))
	group.POST("/nudges/:id/remind", handleRemindNudgeAgain(db))
	group.POST("/nudges/:id/read", handleReadNudge(db))
	group.POST("/nudges/:id/done", handleDoneNudge(db))
	group.DELETE("/nudges/:id", handleDeleteNudge(db))

	group.GET("/notifications", handleNotifications(db))
	group.GET("/notifications/unread-count", handleUnreadCount(db))
	group.POST("/notifications/:id/read", handleReadNotification(db))
	group.POST("/notifications/read-all", handleReadAllNotifications(db))

	// 免打扰（用户 2026-10-16）：首行铃铛旁边那个喇叭/静音按钮的状态与开关；
	// 时间段那半边在「系统配置 → 免打扰」，判断与拦截见 dnd.go。
	group.GET("/dnd", handleDNDState(db))
	group.PUT("/dnd", handleSetDND(db))

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
	// 安卓客户端安装包的上传/下架（见 android_client.go）
	api.POST("/reminder/admin/android/apk", handleAndroidUploadAPK(db))
	api.DELETE("/reminder/admin/android/apk", handleAndroidDeleteAPK(db))
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
		// 顺序**完全按 position**（用户 2026-10-10 要求：后台偏好里能调清单顺序）。
		// 原来这里是 `is_default DESC, position ASC`：默认清单被钉在最前面，于是「把默认清单
		// 往上/往下调」在界面上看不出变化。默认清单的身份仍用 is_default 表达（侧栏有 ⭐ 标记、
		// 下拉里默认选中它），不再靠排序体现。
		if err := db.Where("user_id = ? AND deleted_at IS NULL", userID).Order("position ASC, id ASC").Find(&lists).Error; err != nil {
			response.ErrorInternal(c, "读取清单失败")
			return
		}
		// 「记事本」是侧栏里的固定栏目：偏好开着却没有这一行时补建一次，
		// 保证它默认就在（否则要等用户先记一笔才冒出来）。关掉偏好时不建、也不显示，
		// 数据一条不删。名字/图标是旧值（0.15.4 之前的行）也在这里纠正一次：
		// ensureNoteBucket 只在值不对时才写库，稳态下这里不产生任何写入。
		// 记事本 / 人生要有仪式感两个固定栏目：偏好开着却没有这一行就补建，
		// 已有但名字或图标是旧值（同步来的、更早版本建的）也顺手纠正一次。
		// 稳态下这里不产生任何写入（ensure*Bucket 只在值不对时才写库）。
		ensureFixedBucket := func(template, wantName, wantIcon string, ensure func(*gorm.DB, uint) (List, error)) {
			idx := -1
			for i, l := range lists {
				if l.Template == template {
					idx = i
					break
				}
			}
			if idx >= 0 && (lists[idx].Name != wantName || lists[idx].Icon != wantIcon) {
				if bucket, err := ensure(db, userID); err == nil {
					lists[idx].Name = bucket.Name
					lists[idx].Icon = bucket.Icon
				}
			}
			if idx < 0 {
				if bucket, err := ensure(db, userID); err == nil {
					lists = append(lists, bucket)
					sort.SliceStable(lists, func(i, j int) bool {
						if lists[i].IsDefault != lists[j].IsDefault {
							return lists[i].IsDefault
						}
						if lists[i].Position != lists[j].Position {
							return lists[i].Position < lists[j].Position
						}
						return lists[i].ID < lists[j].ID
					})
				}
			}
		}
		if notebookFeatureEnabled(db, userID) {
			ensureFixedBucket(listTemplateNote, noteBucketListName, noteBucketIcon, ensureNoteBucket)
		}
		if ceremonyFeatureEnabled(db, userID) {
			ensureFixedBucket(listTemplateCeremony, ceremonyBucketListName, ceremonyBucketIcon, ensureCeremonyBucket)
		}
		// 关掉的内置栏目不应再出现在清单列表里（用户 2026-10-26：后台开关没有效果）。
		// 只影响返回结果，清单行与条目一条不删；重新打开立即恢复。
		cardOn := creditCardFeatureEnabled(db, userID)
		ceremonyOn := ceremonyFeatureEnabled(db, userID)
		kept := lists[:0]
		for _, l := range lists {
			if l.Template == listTemplateCard && !cardOn {
				continue
			}
			if l.Template == listTemplateCeremony && !ceremonyOn {
				continue
			}
			kept = append(kept, l)
		}
		lists = kept
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
		// 信用卡清单显示「几张卡」：一次聚合查出来，别在循环里逐条查
		var cardRows []struct {
			ListID uint
			Total  int64
		}
		if err := db.Model(&Card{}).
			Select("list_id, COUNT(*) AS total").
			Where("user_id = ? AND deleted_at IS NULL", userID).
			Group("list_id").Scan(&cardRows).Error; err != nil {
			response.ErrorInternal(c, "统计清单失败")
			return
		}
		cardCounts := make(map[uint]int64, len(cardRows))
		for _, row := range cardRows {
			cardCounts[row.ListID] = row.Total
		}
		result := make([]ListDTO, 0, len(lists))
		for _, list := range lists {
			// 信用卡/记事本栏目在侧栏与页面标题上恒用固定名字：老数据里它可能是用户
			// 自己起的名字，这里统一成固定栏目的名字。
			if list.Template == listTemplateCard {
				list.Name = cardBucketListName
			}
			if list.Template == listTemplateNote {
				list.Name = noteBucketListName
			}
			if list.Template == listTemplateCeremony {
				list.Name = ceremonyBucketListName
			}
			result = append(result, ListDTO{List: list, OpenCount: openCounts[list.ID], CardCount: cardCounts[list.ID]})
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
			// AI 提示词（可选）：这一栏的数据交给小秘分析时，额外告诉模型该怎么看。
			AIPrompt string `json:"ai_prompt"`
			// Template 仅为兼容旧客户端保留：现在信用卡是侧栏那个**固定栏目**
			// （见 card_bucket.go），不在「新建清单」里选模板，所以这里一律建普通清单。
			Template string `json:"template"`
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
		if err := validateListColor(in.Color); err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		in.Icon = normalizeListIcon(in.Icon)
		aiPrompt, err := normalizeListAIPrompt(in.AIPrompt)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		var maxPosition int
		_ = db.Model(&List{}).Where("user_id = ?", currentUserID(c)).Select("COALESCE(MAX(position), 0)").Scan(&maxPosition).Error
		list := List{
			UserID: currentUserID(c), Name: in.Name, Color: in.Color, Icon: in.Icon,
			Position: maxPosition + 1, Template: listTemplateGeneral, AIPrompt: aiPrompt,
		}
		if err := db.Create(&list).Error; err != nil {
			response.ErrorInternal(c, "创建清单失败")
			return
		}
		publishDataChanged(list.UserID, "list", "created", list.ID, originClientID(c))
		response.Success(c, ListDTO{List: list})
	}
}

// handleReorderLists 按前端给的 id 顺序重排清单（用户 2026-10-10 要求：
// 后台偏好里能调整清单顺序）。
//
//   - 只接受**当前用户自己的、未删除的**清单 id；系统固定栏目（信用卡/随手记事本/
//     人生要有仪式感）也能排，但侧栏里它们是固定那几行，排它们不影响显示顺序；
//   - 位置写成 1..N（原子的：整个顺序一次提交，避免前端逐条改造成中间态）；
//   - 缺的清单（前端没传的，比如刚好在另一台机器上新建的）排在后面，按原位置补齐，
//     不会因为一次重排把别人的清单顺序打乱。
func handleReorderLists(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in struct {
			IDs []uint `json:"ids"`
		}
		if err := c.ShouldBindJSON(&in); err != nil || len(in.IDs) == 0 {
			response.ErrorBadRequest(c, "清单顺序参数无效")
			return
		}
		userID := currentUserID(c)
		var lists []List
		if err := db.Where("user_id = ? AND deleted_at IS NULL", userID).
			Order("position ASC, id ASC").Find(&lists).Error; err != nil {
			response.ErrorInternal(c, "读取清单失败")
			return
		}
		byID := make(map[uint]List, len(lists))
		for _, l := range lists {
			byID[l.ID] = l
		}
		ordered := make([]List, 0, len(lists))
		seen := make(map[uint]bool, len(lists))
		for _, id := range in.IDs {
			if l, ok := byID[id]; ok && !seen[id] {
				ordered = append(ordered, l)
				seen[id] = true
			}
		}
		for _, l := range lists { // 没在请求里出现的，按原顺序接在后面
			if !seen[l.ID] {
				ordered = append(ordered, l)
			}
		}
		err := db.Transaction(func(tx *gorm.DB) error {
			for i, l := range ordered {
				pos := i + 1
				if l.Position == pos {
					continue
				}
				if err := tx.Model(&List{}).Where("id = ? AND user_id = ?", l.ID, userID).
					Update("position", pos).Error; err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			response.ErrorInternal(c, "保存清单顺序失败")
			return
		}
		publishDataChanged(userID, "list", "reordered", 0, originClientID(c))
		response.Success(c, gin.H{"ordered": len(ordered)})
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
			// AI 提示词：指针区分「没传」与「传了空串（清空提示词）」。
			AIPrompt *string `json:"ai_prompt"`
			// 信用卡字段：旧客户端才会传，现在一律忽略（卡片走 /cards 接口，模板不再是清单属性）
			Template         *string `json:"template"`
			CardName         *string `json:"card_name"`
			CardBank         *string `json:"card_bank"`
			CardNo           *string `json:"card_no"`
			CardStatementDay *int    `json:"card_statement_day"`
			CardDueDay       *int    `json:"card_due_day"`
			CardNotes        *string `json:"card_notes"`
			CardAutoRepeat   *bool   `json:"card_auto_repeat"`
			// 明确要求重建还款计划（改了账单日/还款日之后前端会带上）
			RegeneratePlan bool `json:"regenerate_plan"`
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
			if err := validateListColor(in.Color); err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			updates["color"] = in.Color
		}
		if strings.TrimSpace(in.Icon) != "" {
			if !validListIcon(strings.TrimSpace(in.Icon)) {
				response.ErrorBadRequest(c, "清单图标不在可选范围内")
				return
			}
			updates["icon"] = strings.TrimSpace(in.Icon)
		}
		if in.Position != nil {
			updates["position"] = *in.Position
		}
		if in.AIPrompt != nil {
			aiPrompt, err := normalizeListAIPrompt(*in.AIPrompt)
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			updates["ai_prompt"] = aiPrompt
		}

		// Template 同样忽略：模板不再由客户端改（信用卡栏目由 ensureCardBucket 维护），
		// 否则旧客户端能把普通清单改成「信用卡清单」，凭空多出第二个卡片栏目。
		if err := db.Model(&list).Updates(updates).Error; err != nil {
			response.ErrorInternal(c, "更新清单失败")
			return
		}
		db.First(&list, id)
		publishDataChanged(list.UserID, "list", "updated", list.ID, originClientID(c))
		response.Success(c, ListDTO{List: list})
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

// wantCompleted 解析列表接口的 status 参数：all = 连已完成的也返回（界面上
// 「未完成 / 全部」开关的「全部」），其余（含缺省）都是只看未完成。
// 只认 all，避免 open/active 之类同义词各自实现出一套不一致的口径。
func wantCompleted(c *gin.Context) bool {
	return strings.EqualFold(strings.TrimSpace(c.Query("status")), "all")
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
	return parseUintCSV(raw)
}

// parseUintCSV 解析 "1,2,3" 这类正整数列表：跳过非法项与重复项，全空/全非法
// 返回 nil（调用方一律把 nil 当作「不筛选」）。
func parseUintCSV(raw string) []uint {
	raw = strings.TrimSpace(raw)
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

// handleListReminders 列出提醒/记事。
//
// 时间窗口参数有两种写法，二选一：
//
//	month=YYYY-MM     旧的按月翻页（兼容保留；内部换算成 from/to）
//	from=&to=         泛化后的区间（YYYY-MM-DD，上海时区，含起不含止）
//
// from/to 与 month 都给时以 from/to 为准。sort=created_desc 用于记事本页
// （按生效时间倒序，最新的在最上面）。
func handleListReminders(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		from := strings.TrimSpace(c.Query("from"))
		to := strings.TrimSpace(c.Query("to"))
		if from == "" && to == "" {
			from, to = monthWindow(c.Query("month"))
		}
		// 先校验一次日期，非法参数明确 400（否则会被 listReminders 当成内部错误）。
		if _, err := parseListWindow(from, to); err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		items, err := listReminders(db, currentUserID(c), c.DefaultQuery("view", "today"),
			c.Query("q"), parseListFilter(c), wantCompleted(c), from, to,
			strings.TrimSpace(c.Query("sort")))
		if err != nil {
			response.ErrorInternal(c, "读取提醒失败")
			return
		}
		response.Success(c, items)
	}
}

// GET /items/months —— 这个账号有数据的月份范围（首/末月）。
//
// 「全部」页按月翻页时，左右箭头只在这两端之间可用（用户要求：只在有数据的月份
// 之间翻）。归月口径要与列表一致：有到期时间按 due_at，记事没有到期时间就按它的
// 记录时间 completed_at。没有任何数据时返回空串，前端据此禁用翻月。
func handleItemMonths(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := currentUserID(c)
		// 用两次「排序取一条」而不是 MIN/MAX + Scan：SQLite 把时间存成带偏移量的
		// 文本，聚合函数回来的字符串 GORM 解析不进 *time.Time（实测 500）。
		// 归月口径与列表一致：有到期时间按 due_at，记事按它的记录时间 completed_at。
		effective := "COALESCE(due_at, completed_at, created_at)"
		var oldest, newest Reminder
		if err := db.Select("due_at, completed_at, created_at").
			Where("user_id = ? AND deleted_at IS NULL", userID).
			Order(tsUTC(effective) + " ASC").First(&oldest).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				response.Success(c, gin.H{"first": "", "last": ""})
				return
			}
			response.ErrorInternal(c, "读取月份范围失败")
			return
		}
		if err := db.Select("due_at, completed_at, created_at").
			Where("user_id = ? AND deleted_at IS NULL", userID).
			Order(tsUTC(effective) + " DESC").First(&newest).Error; err != nil {
			response.ErrorInternal(c, "读取月份范围失败")
			return
		}
		loc := shanghai()
		response.Success(c, gin.H{
			"first": effectiveTime(oldest).In(loc).Format("2006-01"),
			"last":  effectiveTime(newest).In(loc).Format("2006-01"),
		})
	}
}

// effectiveTime 取一条提醒「归月」用的时间：优先到期时间，其次完成时间，最后创建时间
// （记事没有到期时间，用的是它创建即完成的时间）。
func effectiveTime(r Reminder) time.Time {
	if r.DueAt != nil {
		return *r.DueAt
	}
	if r.CompletedAt != nil {
		return *r.CompletedAt
	}
	return r.CreatedAt
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

// overdueGrace 读「任务过期多久算逾期」的系统配置（分钟）。
// 读不到或值非法时按 0 处理（等于「一到点就算逾期」，即改动前的行为）。
//
// 它出现在 /summary 这种热路径上，而 /summary 的「固定 2 条聚合查询」是有用例钉住的
// （TestSummaryUsesTwoAggregateQueries）—— 所以和「记事本栏目开关」一样做一层 2 秒
// 的进程内缓存：多出来的那次配置查询只在缓存过期时发生，稳态下不多查。
//
// 2026-10-12 起缓存按**用户**分开：逾期时刻是个人偏好（task_overdue_time），
// 不再是一个全局值。
var (
	overduePolicyMu    sync.Mutex
	overduePolicyCache = map[uint]overduePolicyEntry{}
	overduePolicyTTL   = 2 * time.Second
)

type overduePolicyEntry struct {
	grace  time.Duration
	cutoff string
	at     time.Time
}

func overdueGrace(db *gorm.DB, userID uint) time.Duration {
	grace, _ := overduePolicy(db, userID)
	return grace
}

// overduePolicy 一次返回「宽限时长 + 逾期提醒时间（HH:MM，个人偏好）」。
//
//	· 宽限（task_overdue_after_minutes，系统配置，默认 30 分钟）：刚建出来的任务
//	  不该立刻顶着「已逾期」。
//	· 逾期提醒时间（task_overdue_time，**个人偏好**，默认 23:59）：到期日当天过了
//	  这个点就算逾期（见 overdueDeadlineExpr）。读不到时用注册表默认值。
func overduePolicy(db *gorm.DB, userID uint) (time.Duration, string) {
	overduePolicyMu.Lock()
	if entry, ok := overduePolicyCache[userID]; ok && time.Since(entry.at) < overduePolicyTTL {
		overduePolicyMu.Unlock()
		return entry.grace, entry.cutoff
	}
	overduePolicyMu.Unlock()

	grace := time.Duration(0)
	cutoff := "23:59"
	if cfg, err := sysconfig.GetPublicConfigs(db); err == nil {
		if mins, err := strconv.Atoi(strings.TrimSpace(cfg["task_overdue_after_minutes"])); err == nil && mins > 0 {
			grace = time.Duration(mins) * time.Minute
		}
	}
	if def, ok := sysconfig.GetConfigDef("task_overdue_time"); ok {
		cutoff = def.Default
	}
	// 个人偏好：没写过这一行时 GetConfig 返回 ErrRecordNotFound，保持默认值。
	if v, err := sysconfig.GetConfig(db, "task_overdue_time", userID); err == nil {
		if normalized, ok := sysconfig.NormalizeClock(v); ok {
			cutoff = normalized
		}
	}

	overduePolicyMu.Lock()
	overduePolicyCache[userID] = overduePolicyEntry{grace: grace, cutoff: cutoff, at: time.Now()}
	overduePolicyMu.Unlock()
	return grace, cutoff
}

// validClock 校验 "HH:MM"（手改数据库塞进非法值会把 SQL 拼坏）。
func validClock(v string) bool {
	if len(v) != 5 || v[2] != ':' {
		return false
	}
	h, err1 := strconv.Atoi(v[0:2])
	m, err2 := strconv.Atoi(v[3:5])
	return err1 == nil && err2 == nil && h >= 0 && h <= 23 && m >= 0 && m <= 59
}

// overdueDeadlineExpr 生成「这一行的逾期判定时刻」SQL 片段。
//
// 规则（用户 2026-10-12 明确）：**到期日当天到了「逾期提醒时间」就算逾期** ——
// 例如逾期提醒时间设 20:30，那么到期日是今天的任务，过了今天 20:30 还没完成就算逾期，
// **不管它的结束时间写的是几点**（新建提醒的默认结束时间是 23:59，如果按「取两者较晚」
// 来算，用户把逾期时间设成 20:30 就永远看不到效果 —— 这正是这次要修的）。
//
// 唯一例外是 **00:00**：它表示「不按天算、就按到期时刻」（沿用这个配置项旧口径里
// 00:00 的含义，也是唯一一个「比一天的开始还早」的合法值，按天算没有意义）。
//
// 时间在库里是**带偏移的文本**，所以先把生效时间归一化成 UTC（tsUTC），
// 再 +8 小时折回上海本地日期、拼上逾期时间、最后 -8 小时折回 UTC 参与比较。
// 传进来的 cutoff 已经过校验/归一化，不会被注入。
func overdueDeadlineExpr(effectiveDue, cutoff string) string {
	utc := tsUTC(effectiveDue)
	if cutoff == "00:00" {
		return "datetime(" + utc + ")"
	}
	localDay := "date(" + utc + ", '+8 hours')"
	return "datetime(" + localDay + " || ' " + cutoff + ":00', '-8 hours')"
}

func handleSummary(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := currentUserID(c)
		loc := shanghai()
		now := time.Now()
		local := now.In(loc)
		// 待办角标与「待办」页同一口径（用户 2026-10-16：这一页显示近 7 天）：
		// 生效时间落在今天起 7 天内的、或已经逾期的。左闭右开：+7 天 = 第 7 天 24 点。
		endTodoWindow := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 7)
		var counts struct {
			Today        int64
			Planned      int64
			OpenTotal    int64
			Completed    int64
			Overdue      int64
			NudgePending int64
		}
		// 「已完成」角标必须和列表同口径（reminders.completed_at ∪ completions 历史），
		// 否则重复提醒的完成记录会让侧栏数字和页面条数对不上。这里把历史计数作为
		// 子查询并进同一条聚合语句，保持 /summary 仍然只有 2 条查询
		// （见 performance_test.go 的 TestSummaryUsesTwoAggregateQueries）。
		hiddenCards := hiddenFeatureListIDs(db, userID)
		completedExpr := `COALESCE(SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END), 0)
					+ (SELECT COUNT(*) FROM completions WHERE user_id = ? AND deleted_at IS NULL)`
		// 参数顺序必须与 SQL 里的占位符顺序一致：today → completed 子查询 → overdue。
		// 口径：待办 = 排期时间 < 今天起第 7 天 24 点（含逾期），逾期 = 排期时间 < 现在。
		// 时间比较一律走 tsUTC() 归一化（SQLite 里时间是带偏移的文本，直接比会按
		// 字符串序错位，见 sql_time.go）。
		// 逾期看的是**过了宽限时间之后**（与前端 isOverdue 同一口径），
		// 而且「到期日当天过了个人偏好里的逾期提醒时间就算逾期」（task_overdue_time，默认 23:59）。
		grace, cutoff := overduePolicy(db, userID)
		overdueBefore := now.Add(-grace)
		selectArgs := []interface{}{sqlTimeArg(endTodoWindow), sqlTimeArg(now), userID}
		if len(hiddenCards) > 0 {
			// 栏目关掉时，它那些卡片提醒的完成记录也不该再计入角标。
			completedExpr = `COALESCE(SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END), 0)
					+ (SELECT COUNT(*) FROM completions WHERE user_id = ? AND deleted_at IS NULL AND reminder_id NOT IN (SELECT id FROM reminders WHERE list_id IN ?))`
			selectArgs = append(selectArgs, hiddenCards)
		}
		// 「提醒@他」里**别人提醒我、我还没做完**的条数（用户 2026-10-13：「提醒消息
		// 归到智能清单显示统计中」）。并成同一条聚合语句里的子查询，不额外发一条
		// COUNT —— /summary 的查询条数有测试盯着（performance_test.go，稳定态 2 条）。
		nudgeExpr := `(SELECT COUNT(*) FROM nudges WHERE to_user_id = ? AND done_at IS NULL AND deleted_at IS NULL) AS nudge_pending`
		selectArgs = append(selectArgs, userID, sqlTimeArg(overdueBefore))
		// 口径与列表一致：用「排期时间」COALESCE(end_at, start_at, due_at) ——
		// **不看 snoozed_until**（用户 2026-10-14：稍后提醒只延迟提醒时间，不改到期时间）。
		effectiveDue := "COALESCE(end_at, start_at, due_at)"
		// 逾期基准**不看 snoozed_until**（用户 2026-10-13：「点知道了，提醒依然保留在逾期栏目」）：
		// 稍后提醒只决定「什么时候再提醒」，不该把一条已经逾期的任务从「已逾期」里摘出去。
		// 与 Go 侧 deadlineStamp 同一口径。
		deadlineDue := "COALESCE(end_at, start_at, due_at)"
		// 「待办」角标与待办页同一口径（2026-10-16 起这一页是近 7 天）：
		// 生效时间在这 7 天之内的 **或已经逾期的**（逾期那一支不看 snoozed_until，
		// 见 deadlineDue 的说明 —— 点「知道了」不该让一条逾期的任务从待办页/角标里消失）。
		todayExpr := "COALESCE(SUM(CASE WHEN completed_at IS NULL AND due_at IS NOT NULL AND (" +
			tsUTC(effectiveDue) + " < datetime(?) OR " + overdueDeadlineExpr(deadlineDue, cutoff) + " < datetime(?)) THEN 1 ELSE 0 END), 0) AS today"
		overdueExpr := "COALESCE(SUM(CASE WHEN completed_at IS NULL AND due_at IS NOT NULL AND " +
			overdueDeadlineExpr(deadlineDue, cutoff) + " < datetime(?) THEN 1 ELSE 0 END), 0) AS overdue"
		q := db.Model(&Reminder{}).
			Select(todayExpr+`,
				COALESCE(SUM(CASE WHEN completed_at IS NULL AND due_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS planned,
				COALESCE(SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END), 0) AS open_total,
				`+completedExpr+` AS completed,
				`+nudgeExpr+`,
				`+overdueExpr, selectArgs...).
			Where("user_id = ? AND deleted_at IS NULL", userID)
		q = excludeHiddenCardReminders(q, hiddenCards)
		if err := q.Scan(&counts).Error; err != nil {
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
			// 侧栏「提醒@他」的角标（别人提醒我、还没做完）。
			"nudge_pending": counts.NudgePending,
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
