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
	ID         uint           `gorm:"primarykey" json:"id"`
	FromUserID uint           `gorm:"not null;index:idx_nudges_from" json:"from_user_id"`
	ToUserID   uint           `gorm:"not null;index:idx_nudges_to" json:"to_user_id"`
	Content    string         `gorm:"size:200;not null" json:"content"`
	Note       string         `gorm:"size:500" json:"note"`
	// DueAt 是发起人希望对方什么时候做完（可选，前端按日期+时间填）。
	// 它**不参与调度**：到点不会自动弹窗、也不算逾期 —— 提醒本身由对方那一侧的
	// 站内通知承担。留着它是让接收人一眼看到「他说的是什么时候」。
	DueAt     *time.Time     `json:"due_at,omitempty"`
	ReadAt    *time.Time     `json:"read_at,omitempty"`
	DoneAt    *time.Time     `json:"done_at,omitempty"`
	CreatedAt time.Time      `gorm:"index" json:"created_at"`
	DeletedAt gorm.DeletedAt `json:"-"`
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
	for _, row := range rows {
		direction := "received"
		if row.FromUserID == me {
			direction = "sent"
		}
		out = append(out, NudgeDTO{
			Nudge:        row,
			FromUsername: names[row.FromUserID],
			ToUsername:   names[row.ToUserID],
			Direction:    direction,
			// 接收人随时可以把自己的那一侧删掉；发起人只能在对方还没做完时撤回。
			CanDelete: row.FromUserID == me && row.DoneAt == nil || row.ToUserID == me,
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
		response.Success(c, users)
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
func notifyNudge(db *gorm.DB, userID uint, kind, title, body string) {
	if userID == 0 {
		return
	}
	notification := Notification{UserID: userID, Type: kind, Title: truncateRunes(title, 100), Body: truncateRunes(body, 200)}
	if err := db.Create(&notification).Error; err != nil {
		return
	}
	publishNotification(notification)
}
