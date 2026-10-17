package reminder

import (
	"net/http"
	"strings"
	"time"

	"smallgo/server/database"
	"smallgo/server/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 「提醒@他」（用户 2026-10-13 要求）—— 多人之间互相推提醒用的一张表。
//
// 定位：**只做人与人之间的消息提醒**，不是任务清单的一部分。所以它不挂清单、
// 不进「今天/计划」这些视图，也不参与重复规则；它只回答两件事：
//
//	我提醒别人什么了（别人收到没、做完没）；
//	别人提醒我什么了（我收到没、做完没）。
//
// 三个时间点就是全部状态机，没有别的字段：
//
//	created_at 发出 → read_at 对方点「已收到」（回执发回给发起人）
//	                → done_at 对方点「已完成」（再回执一次给发起人）
//
// 两个方向的回执都写一条站内通知给发起人，于是「消息面板（通知中心）」里天然
// 就能看到对方收没收到、做没做完 —— 用户要求的「反馈到消息面板」指的就是这个，
// 不必再单独造一套消息通道。
//
// 不允许自己提醒自己：服务端在 handleCreateNudge 里挡（前端也不给选自己）。
const (
	nudgeContentMax = 200
	nudgeNoteMax    = 500
	// 通知里带的正文长度：站内通知的 Body 只有 500 字符，标题更短，
	// 超长的提醒内容截断即可（原文在「提醒@他」页面里看得到）。
	nudgeNotifyTitleRunes = 30
)

type Nudge struct {
	ID         uint   `gorm:"primarykey" json:"id"`
	FromUserID uint   `gorm:"not null;index:idx_nudges_from" json:"from_user_id"`
	ToUserID   uint   `gorm:"not null;index:idx_nudges_to" json:"to_user_id"`
	Content    string `gorm:"size:200;not null" json:"content"`
	Note       string `gorm:"size:500" json:"note"`
	// DueAt 是发起人希望对方什么时候做完（可选，前端按日期+时间填）。
	// 它**不参与调度**：到点不会自动弹窗、也不算逾期 —— 提醒本身由对方那一侧的
	// 站内通知承担。留着它是让接收人一眼看到「他说的是什么时候」。
	DueAt     *time.Time     `json:"due_at,omitempty"`
	ReadAt    *time.Time     `json:"read_at,omitempty"`
	DoneAt    *time.Time     `json:"done_at,omitempty"`
	CreatedAt time.Time      `gorm:"index" json:"created_at"`
	DeletedAt gorm.DeletedAt `json:"-"`

	// 「保存到清单」（用户 2026-10-13）：接收人可以把别人推来的提醒存进自己的某个清单，
	// 变成一条真正的待办任务；ReminderID 指向那条任务，ListID/ListName 记下存到了哪里。
	//
	// 状态同步：任务在清单里被勾完 → nudges.done_at 跟着写上（见 service.go 的
	// syncNudgeFromReminder），于是「提醒@他」页面上这张卡也变成「已完成」、
	// 发起人同样收到「已完成」回执 —— 用户要求的「清单 完成同步当前页卡片状态」。
	ReminderID *uint  `gorm:"index" json:"reminder_id,omitempty"`
	ListID     uint   `json:"list_id,omitempty"`
	ListName   string `gorm:"size:60" json:"list_name,omitempty"`
}

// NudgeDTO 给界面用：把两个用户名带上，省得前端再查一次用户表。
// Direction 决定这条显示在哪一列（sent=我提醒他人 / received=别人提醒我）。
type NudgeDTO struct {
	Nudge
	FromUsername string `json:"from_username"`
	ToUsername   string `json:"to_username"`
	Direction    string `json:"direction"`
	// CanDelete 只有「发起人撤回（对方还没做完）」与「接收人删除」两种情况为真，
	// 与提醒的 can_delete 同一套做法：界面按它显隐按钮，而不是点了才报错。
	// 注意删除是**软删这一条记录本身**：删完两边（发起人 / 接收人）都不再看到它，
	// 界面上的措辞也照这个来（撤回 / 删除，hover 提示写了「你和他都不再看到这条」）。
	CanDelete bool `json:"can_delete"`
	// SavedDone 是「存到清单的那条任务已经完成了」（用户 2026-10-13：「清单 完成同步
	// 当前页卡片状态」）。没存到清单时为 false —— 界面据此把卡片画成已完成。
	SavedDone bool `json:"saved_done"`
}

// NudgeUser 是「提醒@他」里可选的对象：只要账号还在、状态正常就能被提醒。
type NudgeUser struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
}

func nudgeDTOs(db *gorm.DB, rows []Nudge, me uint) []NudgeDTO {
	out := make([]NudgeDTO, 0, len(rows))
	if len(rows) == 0 {
		return out
	}
	// 一次把所有涉及到的用户名查出来（不做 N+1）。
	ids := make([]uint, 0, len(rows)*2)
	for _, row := range rows {
		ids = append(ids, row.FromUserID, row.ToUserID)
	}
	names := map[uint]string{}
	var users []database.User
	if err := db.Select("id, username").Where("id IN ?", ids).Find(&users).Error; err == nil {
		for _, u := range users {
			names[u.ID] = u.Username
		}
	}
	// 「保存到清单」的任务状态：一次把这批 nudge 关联的任务查出来，避免 N+1。
	savedDone := map[uint]bool{}
	reminderIDs := make([]uint, 0, len(rows))
	for _, row := range rows {
		if row.ReminderID != nil {
			reminderIDs = append(reminderIDs, *row.ReminderID)
		}
	}
	if len(reminderIDs) > 0 {
		var linked []Reminder
		if err := db.Select("id, completed_at").Where("id IN ?", reminderIDs).Find(&linked).Error; err == nil {
			for _, r := range linked {
				savedDone[r.ID] = r.CompletedAt != nil
			}
		}
	}
	for _, row := range rows {
		direction := "received"
		if row.FromUserID == me {
			direction = "sent"
		}
		linkedDone := row.ReminderID != nil && savedDone[*row.ReminderID]
		out = append(out, NudgeDTO{
			Nudge:        row,
			FromUsername: names[row.FromUserID],
			ToUsername:   names[row.ToUserID],
			Direction:    direction,
			// 接收人随时可以把自己的那一侧删掉；发起人只能在对方还没做完时撤回。
			CanDelete: row.FromUserID == me && row.DoneAt == nil || row.ToUserID == me,
			SavedDone: linkedDone,
		})
	}
	return out
}

// handleListNudges 一次给全两列 + 三个角标数字（侧栏「提醒@他」的角标要它）。
func handleListNudges(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		me := currentUserID(c)
		var sent, received []Nudge
		if err := db.Where("from_user_id = ?", me).Order("created_at DESC, id DESC").Limit(300).Find(&sent).Error; err != nil {
			response.ErrorInternal(c, "读取提醒@他失败")
			return
		}
		if err := db.Where("to_user_id = ?", me).Order("created_at DESC, id DESC").Limit(300).Find(&received).Error; err != nil {
			response.ErrorInternal(c, "读取提醒@他失败")
			return
		}
		type counts struct {
			ReceivedPending int64
			ReceivedUnread  int64
			SentPending     int64
			SentDone        int64
		}
		var n counts
		if err := db.Model(&Nudge{}).
			Select(`COALESCE(SUM(CASE WHEN to_user_id = ? AND done_at IS NULL THEN 1 ELSE 0 END), 0) AS received_pending,
				COALESCE(SUM(CASE WHEN to_user_id = ? AND read_at IS NULL AND done_at IS NULL THEN 1 ELSE 0 END), 0) AS received_unread,
				COALESCE(SUM(CASE WHEN from_user_id = ? AND done_at IS NULL THEN 1 ELSE 0 END), 0) AS sent_pending,
				COALESCE(SUM(CASE WHEN from_user_id = ? AND done_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS sent_done`,
				me, me, me, me).
			Scan(&n).Error; err != nil {
			response.ErrorInternal(c, "统计提醒@他失败")
			return
		}
		response.Success(c, gin.H{
			"sent":     nudgeDTOs(db, sent, me),
			"received": nudgeDTOs(db, received, me),
			"counts": gin.H{
				"received_pending": n.ReceivedPending,
				"received_unread":  n.ReceivedUnread,
				"sent_pending":     n.SentPending,
				"sent_done":        n.SentDone,
			},
		})
	}
}

// handleNudgeUsers 返回可以提醒的对象（自己除外）。
// 关闭了「提醒@他」的人：入口藏起来，别人在 @ 列表里也看不到他。
//
// 这从系统偏好改成了个人偏好（用户 2026-10-17 要求）：每个账号自己决定要不要
// 出现在这个栏目里，默认开着。列表与发提醒两处都要按本人配置过一遍，不然只藏
// 入口、名单里仍有他，等于没关。
func nudgeReceives(db *gorm.DB, userID uint) bool {
	return userConfigValue(db, userID, "nudge_enabled") != "false"
}

// filterNudgeUsers 一次把候选人的配置查出来，别在循环里逐个人查（N+1）。
func filterNudgeUsers(db *gorm.DB, users []NudgeUser) []NudgeUser {
	if len(users) == 0 {
		return users
	}
	ids := make([]uint, 0, len(users))
	for _, u := range users {
		ids = append(ids, u.ID)
	}
	var off []database.SystemConfig
	if err := db.Where("key = ? AND value = ? AND user_id IN ?", "nudge_enabled", "false", ids).
		Find(&off).Error; err != nil {
		// 读不到配置时按默认（开）放行：不能因为一次查询失败把整个名单清空。
		return users
	}
	if len(off) == 0 {
		return users
	}
	hidden := make(map[uint]bool, len(off))
	for _, row := range off {
		hidden[row.UserID] = true
	}
	kept := users[:0]
	for _, u := range users {
		if !hidden[u.ID] {
			kept = append(kept, u)
		}
	}
	return kept
}

func handleNudgeUsers(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		me := currentUserID(c)
		users := []NudgeUser{}
		if err := db.Model(&database.User{}).
			Select("id, username").
			Where("status = 1 AND id <> ?", me).
			Order("id ASC").
			Scan(&users).Error; err != nil {
			response.ErrorInternal(c, "读取用户列表失败")
			return
		}
		response.Success(c, filterNudgeUsers(db, users))
	}
}

func handleCreateNudge(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		me := currentUserID(c)
		var in struct {
			ToUserID uint       `json:"to_user_id"`
			Content  string     `json:"content"`
			Note     string     `json:"note"`
			DueAt    *time.Time `json:"due_at"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "提醒参数无效")
			return
		}
		in.Content = strings.TrimSpace(in.Content)
		in.Note = strings.TrimSpace(in.Note)
		if in.ToUserID == 0 {
			response.ErrorBadRequest(c, "请先选择要提醒的人")
			return
		}
		// 「此页面功能仅限于多人消息提醒用途，不能自己提醒自己」——服务端挡死，
		// 不只是前端不显示自己。
		if in.ToUserID == me {
			response.ErrorBadRequest(c, "不能提醒自己，请选择其他用户")
			return
		}
		if in.Content == "" || len([]rune(in.Content)) > nudgeContentMax {
			response.ErrorBadRequest(c, "提醒内容应为 1–200 个字符")
			return
		}
		if len([]rune(in.Note)) > nudgeNoteMax {
			response.ErrorBadRequest(c, "备注最多 500 个字符")
			return
		}
		var target database.User
		if err := db.Where("id = ? AND status = 1", in.ToUserID).First(&target).Error; err != nil {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "提醒对象不存在或已停用")
			return
		}
		if !nudgeReceives(db, target.ID) {
			response.ErrorBadRequest(c, "对方关闭了「提醒@他」，收不到提醒")
			return
		}
		row := Nudge{
			FromUserID: me, ToUserID: target.ID,
			Content: in.Content, Note: in.Note, DueAt: in.DueAt,
		}
		if err := db.Create(&row).Error; err != nil {
			response.ErrorInternal(c, "发送提醒失败")
			return
		}
		var sender database.User
		_ = db.Select("id, username").Where("id = ?", me).First(&sender).Error
		body := row.Note
		if body == "" {
			body = "去「提醒@他」页面查看并处理"
		}
		notifyNudge(db, target.ID, "nudge_received",
			"「"+sender.Username+"」提醒你："+truncateRunes(row.Content, nudgeNotifyTitleRunes), body)
		// 接收人那一侧的列表与角标要立刻刷新（换个设备/窗口也能看到）。
		publishDataChanged(target.ID, "nudge", "created", row.ID, "")
		publishDataChanged(me, "nudge", "created", row.ID, originClientID(c))
		var list []Nudge
		list = append(list, row)
		response.Success(c, nudgeDTOs(db, list, me)[0])
	}
}

// handleReadNudge 接收人点「已收到」：写 read_at，并给发起人一条回执通知。
func handleReadNudge(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		me := currentUserID(c)
		row, ok := loadNudgeFor(db, c, me, true)
		if !ok {
			return
		}
		if row.ReadAt == nil {
			now := time.Now()
			if err := db.Model(&Nudge{}).Where("id = ?", row.ID).Update("read_at", &now).Error; err != nil {
				response.ErrorInternal(c, "标记已收到失败")
				return
			}
			row.ReadAt = &now
			var reader database.User
			_ = db.Select("id, username").Where("id = ?", me).First(&reader).Error
			notifyNudge(db, row.FromUserID, "nudge_read",
				"「"+reader.Username+"」已收到你的提醒", truncateRunes(row.Content, nudgeNotifyTitleRunes))
			publishDataChanged(row.FromUserID, "nudge", "read", row.ID, "")
		}
		publishDataChanged(me, "nudge", "read", row.ID, originClientID(c))
		var list []Nudge
		list = append(list, *row)
		response.Success(c, nudgeDTOs(db, list, me)[0])
	}
}

// handleDoneNudge 接收人点「已完成」：写 done_at（顺带补 read_at），
// 再给发起人一条「已完成」回执。
func handleDoneNudge(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		me := currentUserID(c)
		row, ok := loadNudgeFor(db, c, me, true)
		if !ok {
			return
		}
		if row.DoneAt == nil {
			now := time.Now()
			updates := map[string]interface{}{"done_at": &now}
			if row.ReadAt == nil {
				updates["read_at"] = &now
				row.ReadAt = &now
			}
			if err := db.Model(&Nudge{}).Where("id = ?", row.ID).Updates(updates).Error; err != nil {
				response.ErrorInternal(c, "标记已完成失败")
				return
			}
			row.DoneAt = &now
			var reader database.User
			_ = db.Select("id, username").Where("id = ?", me).First(&reader).Error
			notifyNudge(db, row.FromUserID, "nudge_done",
				"「"+reader.Username+"」已完成你提醒的事", truncateRunes(row.Content, nudgeNotifyTitleRunes))
			publishDataChanged(row.FromUserID, "nudge", "done", row.ID, "")
		}
		publishDataChanged(me, "nudge", "done", row.ID, originClientID(c))
		var list []Nudge
		list = append(list, *row)
		response.Success(c, nudgeDTOs(db, list, me)[0])
	}
}

// handleSaveNudgeToReminder 「保存到清单」（用户 2026-10-13）：接收人把别人推来的提醒
// 变成自己清单里的一条待办任务。
//
// 只有**接收人**能存（发起人自己那条本来就在自己的清单里）；已经存过的不再重复建，
// 直接把现有的那条返回（幂等）。存下来的任务：
//
//	· 标题 = 提醒内容，备注 = 备注 +「来自 X 的提醒」；
//	· 结束时间 = 提醒里写的期望时间（有就用），否则**今天 23:59**（与新建提醒一致）；
//	· 只上站内通知（和别处一样，其它渠道要用户自己绑定）。
func handleSaveNudgeToReminder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		me := currentUserID(c)
		row, ok := loadNudgeFor(db, c, me, true)
		if !ok {
			return
		}
		var in struct {
			ListID uint `json:"list_id"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "参数无效")
			return
		}
		var list List
		if err := db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", in.ListID, me).First(&list).Error; err != nil {
			response.ErrorBadRequest(c, "请选择一个自己的清单")
			return
		}
		// 已经存过：把那条任务原样返回（幂等，不重复建）。
		if row.ReminderID != nil {
			var existing []Nudge
			existing = append(existing, *row)
			response.Success(c, nudgeDTOs(db, existing, me)[0])
			return
		}
		var sender database.User
		_ = db.Select("id, username").Where("id = ?", row.FromUserID).First(&sender).Error
		due := row.DueAt
		if due == nil {
			loc, _ := time.LoadLocation("Asia/Shanghai")
			local := time.Now().In(loc)
			today := time.Date(local.Year(), local.Month(), local.Day(), 23, 59, 0, 0, loc)
			due = &today
		}
		notes := row.Note
		if sender.Username != "" {
			if notes != "" {
				notes += "\n"
			}
			notes += "来自「" + sender.Username + "」的提醒@他"
		}
		title := truncateRunes(row.Content, 100)
		created, err := createReminder(db, me, SaveReminderInput{
			Title: title, Notes: notes, ListID: list.ID, Kind: KindTask,
			DueAt: due, RepeatRule: "none", Channels: []string{ChannelInApp},
		})
		if err != nil {
			response.ErrorInternal(c, "保存到清单失败")
			return
		}
		if err := db.Model(&Nudge{}).Where("id = ?", row.ID).
			Updates(map[string]interface{}{"reminder_id": created.ID, "list_id": list.ID, "list_name": list.Name}).Error; err != nil {
			response.ErrorInternal(c, "保存到清单失败")
			return
		}
		updated := *row
		updated.ReminderID = &created.ID
		updated.ListID = list.ID
		updated.ListName = list.Name
		publishDataChanged(me, "nudge", "saved", row.ID, originClientID(c))
		publishDataChanged(row.FromUserID, "nudge", "saved", row.ID, "")
		var list2 []Nudge
		list2 = append(list2, updated)
		response.Success(c, nudgeDTOs(db, list2, me)[0])
	}
}

// handleRemindNudgeAgain 「提醒一下」（用户 2026-10-13）：我推给别人的提醒，再即时推一次 ——
// 对方立刻收到一条站内通知（前端会弹窗/提示），不用等下一次自然提醒。
func handleRemindNudgeAgain(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		me := currentUserID(c)
		row, ok := loadNudgeFor(db, c, me, false)
		if !ok {
			return
		}
		if row.FromUserID != me {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "提醒不存在")
			return
		}
		if row.DoneAt != nil {
			response.ErrorBadRequest(c, "对方已经完成了，不用再提醒")
			return
		}
		var sender database.User
		_ = db.Select("id, username").Where("id = ?", me).First(&sender).Error
		body := row.Note
		if body == "" {
			body = "去「提醒@他」页面查看并处理"
		}
		notifyNudge(db, row.ToUserID, "nudge_reminded",
			"「"+sender.Username+"」又提醒了你一次："+truncateRunes(row.Content, nudgeNotifyTitleRunes), body)
		publishDataChanged(row.ToUserID, "nudge", "reminded", row.ID, "")
		publishDataChanged(me, "nudge", "reminded", row.ID, originClientID(c))
		var list []Nudge
		list = append(list, *row)
		response.Success(c, nudgeDTOs(db, list, me)[0])
	}
}

// handleDeleteNudge 发起人撤回（对方还没做完）或接收人删除（两边一起不再显示）。
func handleDeleteNudge(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		me := currentUserID(c)
		row, ok := loadNudgeFor(db, c, me, false)
		if !ok {
			return
		}
		if row.FromUserID == me && row.DoneAt != nil {
			response.ErrorBadRequest(c, "对方已经完成了，不能撤回")
			return
		}
		if err := db.Delete(&Nudge{}, row.ID).Error; err != nil {
			response.ErrorInternal(c, "删除提醒失败")
			return
		}
		other := row.ToUserID
		if row.ToUserID == me {
			other = row.FromUserID
		}
		publishDataChanged(me, "nudge", "deleted", row.ID, originClientID(c))
		publishDataChanged(other, "nudge", "deleted", row.ID, "")
		response.Success(c, nil)
	}
}

// loadNudgeFor 取一条**当前用户可以操作**的提醒@他。
// requireRecipient=true 表示只有接收人（被提醒的那个）能动：读回执、完成都只属于他，
// 发起人越权一律 404（不泄露「这条存在但不是你的」）。
func loadNudgeFor(db *gorm.DB, c *gin.Context, me uint, requireRecipient bool) (*Nudge, bool) {
	id := c.Param("id")
	var row Nudge
	if err := db.Where("id = ?", id).First(&row).Error; err != nil {
		response.Error(c, http.StatusNotFound, response.CodeNotFound, "提醒不存在")
		return nil, false
	}
	if requireRecipient {
		if row.ToUserID != me {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "提醒不存在")
			return nil, false
		}
		return &row, true
	}
	if row.ToUserID != me && row.FromUserID != me {
		response.Error(c, http.StatusNotFound, response.CodeNotFound, "提醒不存在")
		return nil, false
	}
	return &row, true
}

// notifyNudge 写一条站内通知并实时推给那个人（在线时立刻出现在消息面板）。
// 通知失败不影响主流程：提醒本身已经落库了，不该因为一条通知回滚。
//
// 免打扰（用户 2026-10-16，见 dnd.go）：免打扰期间**照样写通知**（通知中心里留着，
// 未读角标照常累积），只是不实时推给前端 —— 前端弹窗与提示音都从实时事件来，
// 不推就等于不打扰；等用户自己关了免打扰，进来还能在通知中心看到。
func notifyNudge(db *gorm.DB, userID uint, kind, title, body string) {
	if userID == 0 {
		return
	}
	notification := Notification{UserID: userID, Type: kind, Title: truncateRunes(title, 100), Body: truncateRunes(body, 200)}
	if err := db.Create(&notification).Error; err != nil {
		return
	}
	if dndBlocked(db, userID, time.Now()) {
		return
	}
	publishNotification(notification)
}

// syncNudgeFromReminder 把「保存到清单」那条任务的完成状态**同步回 nudge 卡片**
// （用户 2026-10-13：「清单 完成同步当前页卡片状态」）：
//
//	完成   → nudge 也标完成，并给发起人发一条「已完成」回执（消息面板里看得到）；
//	撤销完成 → 清掉 done_at，卡片回到「待处理」。
//
// 只认「这条任务确实是从我收到的那条提醒存出来的」：用 reminder_id + to_user_id 双重限定，
// 免得别的账号的任务恰好对上 id。
func syncNudgeFromReminder(db *gorm.DB, ownerID, reminderID uint, completed bool) {
	var rows []Nudge
	if err := db.Where("reminder_id = ? AND to_user_id = ?", reminderID, ownerID).Find(&rows).Error; err != nil {
		return
	}
	if len(rows) == 0 {
		return
	}
	now := time.Now()
	var owner database.User
	_ = db.Select("id, username").Where("id = ?", ownerID).First(&owner).Error
	for _, row := range rows {
		if completed {
			if row.DoneAt != nil {
				continue
			}
			updates := map[string]interface{}{"done_at": &now}
			if row.ReadAt == nil {
				updates["read_at"] = &now
			}
			if err := db.Model(&Nudge{}).Where("id = ?", row.ID).Updates(updates).Error; err != nil {
				continue
			}
			notifyNudge(db, row.FromUserID, "nudge_done",
				"「"+owner.Username+"」已完成你提醒的事", truncateRunes(row.Content, nudgeNotifyTitleRunes))
			publishDataChanged(row.FromUserID, "nudge", "done", row.ID, "")
			publishDataChanged(row.ToUserID, "nudge", "done", row.ID, "")
			continue
		}
		if row.DoneAt == nil {
			continue
		}
		if err := db.Model(&Nudge{}).Where("id = ?", row.ID).
			Update("done_at", gorm.Expr("NULL")).Error; err != nil {
			continue
		}
		publishDataChanged(row.FromUserID, "nudge", "restored", row.ID, "")
		publishDataChanged(row.ToUserID, "nudge", "restored", row.ID, "")
	}
}
