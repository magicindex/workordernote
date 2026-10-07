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

// GET /cards?list_id=
func handleListCards(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		listID, _ := strconv.Atoi(c.Query("list_id"))
		cards, err := listCards(db, currentUserID(c), uint(listID), time.Now())
		if err != nil {
			response.ErrorInternal(c, "读取卡片失败")
			return
		}
		response.Success(c, cards)
	}
}

// POST /cards —— 建卡并立刻生成提醒（账单日 / 还款日 / 提前提醒）
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
		// 卡片必须挂在当前用户自己的清单下
		if err := assertListOwner(db, userID, in.ListID); err != nil {
			writeServiceError(c, err)
			return
		}
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
			if err := tx.Model(&Reminder{}).
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
		if err := db.Model(&row).Updates(map[string]interface{}{"paid_at": nil, "paid_amount": 0}).Error; err != nil {
			response.ErrorInternal(c, "取消失败")
			return
		}
		publishDataChanged(card.UserID, "card", "updated", card.ID, originClientID(c))
		response.Success(c, CardStatementDTO{CardStatement: row, CardName: card.Name, Bank: card.Bank, Color: card.Color})
	}
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
