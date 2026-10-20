package reminder

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"smallgo/server/response"
)

// 信用卡接口：卡片、账单期（金额与还款）、还款计划。
//
// 权限与其它清单/提醒一致：都属于当前登录用户（currentUserID），
// 所有查询都带 user_id 条件，删改前先确认归属。

func registerCardRoutes(group *gin.RouterGroup, db *gorm.DB) {
	group.GET("/cards", handleListCards(db))
	group.POST("/cards", handleCreateCard(db))
	// 信用卡页头部那条时间卡片的数据：**账单已出、当期未还**的卡（含逾期）
	group.GET("/cards/billing", handleBillingCards(db))
	// 0.13.x 的老路径保留一个版本：升级瞬间浏览器可能还揣着旧前端，
	// 直接 404 会让头部卡片空掉（下个版本可以删）。
	group.GET("/cards/week", handleBillingCards(db))
	group.PATCH("/cards/:id", handleUpdateCard(db))
	group.DELETE("/cards/:id", handleDeleteCard(db))
	// 重建这张卡的提醒（账单日/还款日/提前提醒）
	group.POST("/cards/:id/plan", handleRegenerateCardPlan(db))
	// 还款计划：未来 N 期
	group.GET("/cards/:id/schedule", handleCardSchedule(db))
	// 某一期的金额 / 标记已还 / 取消已还
	group.PUT("/cards/:id/statements/:period", handleSaveCardStatement(db))
	group.POST("/cards/:id/statements/:period/pay", handlePayCardStatement(db))
	group.POST("/cards/:id/statements/:period/unpay", handleUnpayCardStatement(db))
}

type cardInput struct {
	ListID       uint   `json:"list_id"`
	Name         string `json:"name"`
	Bank         string `json:"bank"`
	No           string `json:"no"`
	Holder       string `json:"holder"`
	Limit        int64  `json:"limit_cents"`
	StatementDay int    `json:"statement_day"`
	DueDay       int    `json:"due_day"`
	AdvanceDays  *int   `json:"advance_days"`
	AutoRepeat   *bool  `json:"auto_repeat"`
	Notes        string `json:"notes"`
	Color        string `json:"color"`
}

func (in cardInput) validate() error {
	if !validCardDay(in.StatementDay) || !validCardDay(in.DueDay) {
		return errors.New("请填写账单日与还款日（每月 1–31 号）")
	}
	if strings.TrimSpace(in.Bank) == "" && strings.TrimSpace(in.Name) == "" {
		return errors.New("请至少填写银行或卡名")
	}
	if in.AdvanceDays != nil && (*in.AdvanceDays < 0 || *in.AdvanceDays > 30) {
		return errors.New("提前提醒天数应在 0–30 之间")
	}
	if in.Limit < 0 {
		return errors.New("额度不能为负数")
	}
	return nil
}

func cardColor(name string) string {
	name = strings.TrimSpace(name)
	if _, ok := supportedListColors[name]; ok {
		return name
	}
	return "blue"
}

// GET /cards?list_id= —— 不带 list_id 就是「信用卡账单」这一栏的全部卡片
func handleListCards(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := currentUserID(c)
		listID, _ := strconv.Atoi(c.Query("list_id"))
		if listID == 0 {
			bucket, err := ensureCardBucket(db, userID)
			if err != nil {
				response.ErrorInternal(c, "读取信用卡账单失败")
				return
			}
			listID = int(bucket.ID)
		}
		cards, err := listCards(db, userID, uint(listID), time.Now())
		if err != nil {
			response.ErrorInternal(c, "读取卡片失败")
			return
		}
		response.Success(c, cards)
	}
}

// GET /cards/billing —— 头部时间卡片：账单已出、当期未还的卡（含逾期），已排好序。
func handleBillingCards(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := currentUserID(c)
		out, err := billingCards(db, userID, time.Now())
		if err != nil {
			response.ErrorInternal(c, "读取待还卡片失败")
			return
		}
		response.Success(c, out)
	}
}

// POST /cards —— 建卡并立刻生成提醒（账单日 / 还款日 / 提前提醒）
//
// 卡片一律归到「信用卡账单」这一栏：请求里不再需要 list_id，带了也忽略
// （以前是先在「新建清单」里建一个信用卡清单，现在没这一步了）。
func handleCreateCard(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in cardInput
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "卡片参数无效")
			return
		}
		if err := in.validate(); err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		userID := currentUserID(c)
		// 注意：个人开关只管**显示**（侧栏那一行、卡片页、以及卡片提醒要不要出现在列表/日历里），
		// 不是接口权限——所以关着开关也允许建卡。否则同步/导入带过来的账号（还没打开开关）
		// 连卡都建不了，而同步本身又会把卡片直接落库，语义就自相矛盾了。
		bucket, err := ensureCardBucket(db, userID)
		if err != nil {
			response.ErrorInternal(c, "准备信用卡账单栏目失败")
			return
		}
		in.ListID = bucket.ID
		advance := 3
		if in.AdvanceDays != nil {
			advance = *in.AdvanceDays
		}
		autoRepeat := true
		if in.AutoRepeat != nil {
			autoRepeat = *in.AutoRepeat
		}
		var maxPosition int
		_ = db.Model(&Card{}).Where("user_id = ? AND list_id = ?", userID, in.ListID).
			Select("COALESCE(MAX(position), 0)").Scan(&maxPosition).Error

		card := Card{
			UserID: userID, ListID: in.ListID,
			Name: strings.TrimSpace(in.Name), Bank: strings.TrimSpace(in.Bank),
			No: strings.TrimSpace(in.No), Holder: strings.TrimSpace(in.Holder), Limit: in.Limit,
			StatementDay: in.StatementDay, DueDay: in.DueDay,
			AdvanceDays: advance, AutoRepeat: autoRepeat,
			Notes: strings.TrimSpace(in.Notes), Color: cardColor(in.Color), Position: maxPosition + 1,
		}
		if err := db.Create(&card).Error; err != nil {
			response.ErrorInternal(c, "创建卡片失败")
			return
		}
		if _, err := generateCardPlan(db, &card, time.Now()); err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		publishDataChanged(userID, "card", "created", card.ID, originClientID(c))
		dto, err := buildCardDTO(db, card, time.Now())
		if err != nil {
			response.ErrorInternal(c, "读取卡片失败")
			return
		}
		response.Success(c, dto)
	}
}

// PATCH /cards/:id
func handleUpdateCard(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		var in struct {
			Name         *string `json:"name"`
			Bank         *string `json:"bank"`
			No           *string `json:"no"`
			Holder       *string `json:"holder"`
			Limit        *int64  `json:"limit_cents"`
			StatementDay *int    `json:"statement_day"`
			DueDay       *int    `json:"due_day"`
			AdvanceDays  *int    `json:"advance_days"`
			AutoRepeat   *bool   `json:"auto_repeat"`
			Notes        *string `json:"notes"`
			Color        *string `json:"color"`
			ListID       *uint   `json:"list_id"`
			// 明确要求重建提醒（改了账单日/还款日/提前提醒之后前端会带上）
			RegeneratePlan bool `json:"regenerate_plan"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "卡片参数无效")
			return
		}
		userID := currentUserID(c)
		var card Card
		if err := db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", id, userID).First(&card).Error; err != nil {
			writeServiceError(c, err)
			return
		}
		updates := map[string]interface{}{}
		if in.Name != nil {
			updates["name"] = strings.TrimSpace(*in.Name)
		}
		if in.Bank != nil {
			updates["bank"] = strings.TrimSpace(*in.Bank)
		}
		if in.No != nil {
			updates["no"] = strings.TrimSpace(*in.No)
		}
		if in.Holder != nil {
			updates["holder"] = strings.TrimSpace(*in.Holder)
		}
		if in.Limit != nil {
			if *in.Limit < 0 {
				response.ErrorBadRequest(c, "额度不能为负数")
				return
			}
			updates["limit"] = *in.Limit
		}
		daysChanged := false
		if in.StatementDay != nil {
			if !validCardDay(*in.StatementDay) {
				response.ErrorBadRequest(c, "账单日应为每月 1–31 号")
				return
			}
			daysChanged = daysChanged || *in.StatementDay != card.StatementDay
			updates["statement_day"] = *in.StatementDay
		}
		if in.DueDay != nil {
			if !validCardDay(*in.DueDay) {
				response.ErrorBadRequest(c, "还款日应为每月 1–31 号")
				return
			}
			daysChanged = daysChanged || *in.DueDay != card.DueDay
			updates["due_day"] = *in.DueDay
		}
		if in.AdvanceDays != nil {
			if *in.AdvanceDays < 0 || *in.AdvanceDays > 30 {
				response.ErrorBadRequest(c, "提前提醒天数应在 0–30 之间")
				return
			}
			daysChanged = daysChanged || *in.AdvanceDays != card.AdvanceDays
			updates["advance_days"] = *in.AdvanceDays
		}
		if in.AutoRepeat != nil {
			updates["auto_repeat"] = *in.AutoRepeat
		}
		if in.Notes != nil {
			updates["notes"] = strings.TrimSpace(*in.Notes)
		}
		if in.Color != nil {
			updates["color"] = cardColor(*in.Color)
		}
		if in.ListID != nil {
			if err := assertListOwner(db, userID, *in.ListID); err != nil {
				writeServiceError(c, err)
				return
			}
			updates["list_id"] = *in.ListID
		}
		if len(updates) > 0 {
			if err := db.Model(&card).Updates(updates).Error; err != nil {
				response.ErrorInternal(c, "更新卡片失败")
				return
			}
		}
		db.First(&card, id)
		// 账单日/还款日/提前提醒/自动循环变了：重建提醒（只改备注之类不动提醒 ID）
		if in.RegeneratePlan || daysChanged || in.AutoRepeat != nil || in.ListID != nil {
			if _, err := generateCardPlan(db, &card, time.Now()); err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
		}
		publishDataChanged(userID, "card", "updated", card.ID, originClientID(c))
		dto, err := buildCardDTO(db, card, time.Now())
		if err != nil {
			response.ErrorInternal(c, "读取卡片失败")
			return
		}
		response.Success(c, dto)
	}
}

// DELETE /cards/:id —— 软删卡片，并连带删掉它生成的提醒
func handleDeleteCard(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		userID := currentUserID(c)
		var card Card
		if err := db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", id, userID).First(&card).Error; err != nil {
			writeServiceError(c, err)
			return
		}
		now := time.Now()
		err := db.Transaction(func(tx *gorm.DB) error {
			// 这些提醒马上要软删，它们名下还没处理的「到点」通知必须一起标为已读：
			// 否则弹窗照样会弹出来，用户点「知道了」时提醒已经不在了 —— 服务端返回
			// 404「提醒或清单不存在」，弹窗就卡在那儿关不掉（用户实际报过）。
			// 单条提醒删除走的是 deleteReminder()，它内部会调 retireDueNotifications；
			// 删卡片是批量软删，必须在这里自己补上。
			var reminderIDs []uint
			if err := tx.Model(&Reminder{}).
				Where("user_id = ? AND card_id = ? AND deleted_at IS NULL", userID, card.ID).
				Pluck("id", &reminderIDs).Error; err != nil {
				return err
			}
			if len(reminderIDs) > 0 {
				if err := tx.Model(&Notification{}).
					Where("user_id = ? AND reminder_id IN ? AND type = ? AND read_at IS NULL", userID, reminderIDs, "reminder_due").
					Update("read_at", &now).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(&Reminder{}).
				Where("user_id = ? AND card_id = ? AND deleted_at IS NULL", userID, card.ID).
				Updates(map[string]interface{}{"deleted_at": now, "updated_at": now}).Error; err != nil {
				return err
			}
			// 账单期（card_statements）必须一起软删：之前只删卡片和它的提醒，
			// 账单期留在库里成了「没有卡的账单期」——界面上看不见，却会一直跟着
			// 同步快照发给对端（实测：回归里删掉 3 张测试卡后，沙箱多出 6 条孤儿
			// 账单期，生产 14 条而沙箱 20 条）。
			if err := tx.Model(&CardStatement{}).
				Where("user_id = ? AND card_id = ? AND deleted_at IS NULL", userID, card.ID).
				Updates(map[string]interface{}{"deleted_at": now, "updated_at": now}).Error; err != nil {
				return err
			}
			return tx.Model(&Card{}).Where("id = ?", card.ID).
				Updates(map[string]interface{}{"deleted_at": now, "updated_at": now}).Error
		})
		if err != nil {
			response.ErrorInternal(c, "删除卡片失败")
			return
		}
		publishDataChanged(userID, "card", "deleted", card.ID, originClientID(c))
		response.Success(c, gin.H{"deleted": true})
	}
}

// POST /cards/:id/plan
func handleRegenerateCardPlan(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		var card Card
		if err := db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", id, currentUserID(c)).First(&card).Error; err != nil {
			writeServiceError(c, err)
			return
		}
		created, err := generateCardPlan(db, &card, time.Now())
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		publishDataChanged(card.UserID, "reminder", "created", card.ID, originClientID(c))
		response.Success(c, gin.H{"generated": len(created), "reminders": created})
	}
}

// GET /cards/:id/schedule?months=12 —— 还款计划：已出的、当期的、未来的都列出来
func handleCardSchedule(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		userID := currentUserID(c)
		var card Card
		if err := db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", id, userID).First(&card).Error; err != nil {
			writeServiceError(c, err)
			return
		}
		months, _ := strconv.Atoi(c.Query("months"))
		if months <= 0 || months > 36 {
			months = 12
		}
		periods, err := cardPeriods(db, card, time.Now(), months)
		if err != nil {
			response.ErrorInternal(c, "读取还款计划失败")
			return
		}
		response.Success(c, gin.H{"card": buildCardView(db, card, time.Now()), "periods": periods})
	}
}

func buildCardView(db *gorm.DB, card Card, now time.Time) CardDTO {
	dto, err := buildCardDTO(db, card, now)
	if err != nil {
		return CardDTO{Card: card, Summary: cardSummary(card, now)}
	}
	return dto
}

// PUT /cards/:id/statements/:period —— 记这一期的金额
func handleSaveCardStatement(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		card, ok := cardFromContext(c, db)
		if !ok {
			return
		}
		var in struct {
			Amount  int64  `json:"amount_cents"`
			Minimum int64  `json:"minimum_cents"`
			Note    string `json:"note"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "账单参数无效")
			return
		}
		if in.Amount < 0 || in.Minimum < 0 {
			response.ErrorBadRequest(c, "金额不能为负数")
			return
		}
		row, err := upsertStatement(db, card.UserID, card, c.Param("period"), in.Amount, in.Minimum, strings.TrimSpace(in.Note))
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		publishDataChanged(card.UserID, "card", "updated", card.ID, originClientID(c))
		response.Success(c, CardStatementDTO{CardStatement: row, CardName: card.Name, Bank: card.Bank, Color: card.Color})
	}
}

// POST /cards/:id/statements/:period/pay —— 标记这一期已还
func handlePayCardStatement(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		card, ok := cardFromContext(c, db)
		if !ok {
			return
		}
		var in struct {
			Amount int64 `json:"amount_cents"`
		}
		_ = c.ShouldBindJSON(&in)
		row, err := payStatement(db, card.UserID, card, c.Param("period"), in.Amount, time.Now())
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		publishDataChanged(card.UserID, "card", "paid", card.ID, originClientID(c))
		response.Success(c, CardStatementDTO{CardStatement: row, CardName: card.Name, Bank: card.Bank, Color: card.Color})
	}
}

// POST /cards/:id/statements/:period/unpay —— 取消已还（点错了能撤回）
//
// 撤回必须是**完整**的：标记已还时我们写了完成记录、并把「还款日」提醒滚到了
// 下一期。只清 paid_at 的话，用户会看到「完成记录里还留着一笔、本期却再没有
// 还款日提醒」——像是已经还过了。所以这里把这两样一起撤回。
func handleUnpayCardStatement(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		card, ok := cardFromContext(c, db)
		if !ok {
			return
		}
		period := c.Param("period")
		var row CardStatement
		if err := db.Where("user_id = ? AND card_id = ? AND period = ? AND deleted_at IS NULL", card.UserID, card.ID, period).
			First(&row).Error; err != nil {
			writeServiceError(c, err)
			return
		}
		_, dueDate, err := parsePeriodDates(card, period)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		var rolled *Reminder
		err = db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&CardStatement{}).Where("id = ?", row.ID).
				Updates(map[string]interface{}{"paid_at": nil, "paid_amount": 0}).Error; err != nil {
				return err
			}
			item, changed, err := retractCardPayment(tx, card, dueDate)
			if err != nil {
				return err
			}
			if changed {
				rolled = &item
			}
			return nil
		})
		if err != nil {
			response.ErrorInternal(c, "取消失败")
			return
		}
		publishDataChanged(card.UserID, "card", "updated", card.ID, originClientID(c))
		if rolled != nil {
			publishDataChanged(card.UserID, "reminder", "updated", rolled.ID, originClientID(c))
		}
		response.Success(c, CardStatementDTO{CardStatement: row, CardName: card.Name, Bank: card.Bank, Color: card.Color})
	}
}

// retractCardPayment 撤回「标记已还」在提醒侧留下的痕迹：
// 删掉这一期的完成记录，并把「还款日」提醒滚回这一期（同时刷新投递任务）。
// 只有真的找到并删掉了完成记录才动提醒——否则说明这一期的还款本来就不是
// 当前这条提醒完成的（例如补还很久以前的某一期），硬滚回去会把提醒改错。
func retractCardPayment(tx *gorm.DB, card Card, dueDate time.Time) (Reminder, bool, error) {
	var item Reminder
	if err := tx.Where("user_id = ? AND card_id = ? AND card_role = ? AND deleted_at IS NULL",
		card.UserID, card.ID, cardRoleDue).First(&item).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return item, false, nil
		}
		return item, false, err
	}
	// 完成记录里的 scheduled_for 就是当时那条提醒的 due_at，按自然日匹配。
	//
	// 注意这里是**软删**（Completion 有 DeletedAt）：删掉的行会作为墓碑进快照，
	// 对端收到后才会把那条幽灵记录一并撤回。硬删在同步里表达不出来。
	res := tx.Where("user_id = ? AND reminder_id = ? AND "+tsUTC("scheduled_for")+" >= datetime(?) AND "+tsUTC("scheduled_for")+" < datetime(?)",
		card.UserID, item.ID, sqlTimeArg(dueDate), sqlTimeArg(dueDate.AddDate(0, 0, 1))).Delete(&Completion{})
	if res.Error != nil {
		return item, false, res.Error
	}
	if res.RowsAffected == 0 {
		return item, false, nil
	}
	// 滚回本期时保持卡片提醒的时间口径：**还款日 23:59**（用户 2026-10-13）。
	// dueDate 来自账单期的还款日，是当天 0 点，直接用会把它改回半夜。
	fixedDue := time.Date(dueDate.Year(), dueDate.Month(), dueDate.Day(), cardDueClockHour, cardDueClockMinute, 0, 0, dueDate.Location())
	item.DueAt = &fixedDue
	item.CompletedAt = nil
	item.SnoozedUntil = nil
	item.Version++
	if err := tx.Save(&item).Error; err != nil {
		return item, false, err
	}
	var channelRows []ReminderChannel
	if err := tx.Where("reminder_id = ? AND user_id = ? AND enabled = ?", item.ID, card.UserID, true).
		Find(&channelRows).Error; err != nil {
		return item, false, err
	}
	channels := make([]string, 0, len(channelRows))
	for _, ch := range channelRows {
		channels = append(channels, ch.Channel)
	}
	if err := rebuildJobs(tx, item, channels); err != nil {
		return item, false, err
	}
	return item, true, nil
}

// cardFromContext 按 :id 取卡片并确认归属当前用户。
func cardFromContext(c *gin.Context, db *gorm.DB) (Card, bool) {
	var card Card
	id, ok := parseID(c)
	if !ok {
		return card, false
	}
	if err := db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", id, currentUserID(c)).First(&card).Error; err != nil {
		writeServiceError(c, err)
		return card, false
	}
	return card, true
}
