package reminder

import (
	"strconv"

	"gorm.io/gorm"

	"smallgo/server/database"
)

// 信用卡与账单期的同步落地。规则与清单/提醒完全一致：
//   · 按 SyncUID 认同一行；两台机器各自建的卡不会自动认领（卡片没有「默认卡」这种概念）；
//   · 内容一致就只追平时间戳、计「跳过」，不写业务字段；
//   · 冲突时谁的时间戳更新谁说了算，平局用实例标识裁决（incomingWins）；
//   · 删除是软删（墓碑），也会同步过去。
//
// 顺序上卡片必须在清单之后、提醒之前：卡片挂清单（要 listIDs），
// 提醒挂卡片（要 cardIDs）。

func sameCard(local *Card, incoming syncCard, listID uint) bool {
	return local.ListID == listID &&
		local.Name == incoming.Name &&
		local.Bank == incoming.Bank &&
		local.No == incoming.No &&
		local.Holder == incoming.Holder &&
		local.Limit == incoming.Limit &&
		local.StatementDay == incoming.StatementDay &&
		local.DueDay == incoming.DueDay &&
		local.AdvanceDays == incoming.AdvanceDays &&
		local.AutoRepeat == incoming.AutoRepeat &&
		local.Notes == incoming.Notes &&
		local.Color == incoming.Color &&
		local.Position == incoming.Position &&
		// 删除标记也要比！漏了这一条时，「对端删掉、本机内容一模一样」会被判成
		// 「内容一致，跳过」，于是**删不掉**（真实数据上踩到：回归测试卡在 200 上留着）。
		// 清单与提醒的 sameList/sameReminder 一直有这个比较，卡片和账单期漏了。
		(local.DeletedAt != nil) == incoming.Deleted
}

func applySyncCards(tx *gorm.DB, snap syncSnapshot, users map[string]database.User, listIDs map[string]uint, myInstance string, stats *syncApplyStats) (map[string]uint, error) {
	var locals []Card
	if err := tx.Find(&locals).Error; err != nil {
		return nil, err
	}
	byUID := make(map[string]*Card, len(locals))
	for i := range locals {
		if locals[i].SyncUID != "" {
			byUID[locals[i].SyncUID] = &locals[i]
		}
	}

	out := make(map[string]uint, len(snap.Cards))
	for _, incoming := range snap.Cards {
		if incoming.UID == "" {
			stats.Skipped++
			continue
		}
		owner, ok := users[incoming.Owner]
		if !ok {
			markUnmapped(stats, incoming.Owner)
			continue
		}
		listID, ok := listIDs[incoming.ListUID]
		if !ok || listID == 0 {
			// 清单本身被跳过（对端已删、或本机没有这条清单）：卡片过不来是预期，
			// 不是账号对不上，别把 owner 报成「本机没有这个账号」。
			stats.Skipped++
			continue
		}
		existing := byUID[incoming.UID]
		if existing == nil {
			if incoming.Deleted {
				// 本机从来没有过这张卡，对方的删除对本机没有意义
				continue
			}
			row := Card{
				SyncUID: incoming.UID, UserID: owner.ID, ListID: listID,
				Name: incoming.Name, Bank: incoming.Bank, No: incoming.No, Holder: incoming.Holder,
				Limit: incoming.Limit, StatementDay: incoming.StatementDay, DueDay: incoming.DueDay,
				AdvanceDays: incoming.AdvanceDays, AutoRepeat: incoming.AutoRepeat,
				Notes: incoming.Notes, Color: cardColor(incoming.Color), Position: incoming.Position,
				CreatedAt: incoming.CreatedAt, UpdatedAt: incoming.UpdatedAt,
			}
			if err := tx.Create(&row).Error; err != nil {
				return nil, err
			}
			byUID[incoming.UID] = &row
			out[incoming.UID] = row.ID
			stats.CardsCreated++
			stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
			continue
		}

		out[incoming.UID] = existing.ID
		if sameCard(existing, incoming, listID) {
			if incomingWins(existing.UpdatedAt, incoming.UpdatedAt, snap.InstanceID, myInstance) {
				if err := tx.Model(&Card{}).Where("id = ?", existing.ID).
					UpdateColumn("updated_at", incoming.UpdatedAt).Error; err != nil {
					return nil, err
				}
			}
			stats.Skipped++
			continue
		}
		if !incomingWins(existing.UpdatedAt, incoming.UpdatedAt, snap.InstanceID, myInstance) {
			stats.Skipped++
			continue
		}
		updates := map[string]interface{}{
			"list_id": listID, "name": incoming.Name, "bank": incoming.Bank, "no": incoming.No,
			"holder": incoming.Holder, "limit": incoming.Limit,
			"statement_day": incoming.StatementDay, "due_day": incoming.DueDay,
			"advance_days": incoming.AdvanceDays, "auto_repeat": incoming.AutoRepeat,
			"notes": incoming.Notes, "color": cardColor(incoming.Color), "position": incoming.Position,
			"updated_at": incoming.UpdatedAt,
		}
		if incoming.Deleted {
			updates["deleted_at"] = incoming.UpdatedAt
			stats.CardsDeleted++
		} else {
			updates["deleted_at"] = nil
			stats.CardsUpdated++
		}
		if err := tx.Model(&Card{}).Where("id = ?", existing.ID).Updates(updates).Error; err != nil {
			return nil, err
		}
		stats.AffectedUsers = append(stats.AffectedUsers, existing.UserID)
	}
	return out, nil
}

func sameCardStatement(local *CardStatement, incoming syncCardStatement, cardID uint) bool {
	return local.CardID == cardID &&
		local.Period == incoming.Period &&
		local.Amount == incoming.Amount &&
		local.Minimum == incoming.Minimum &&
		local.Note == incoming.Note &&
		equalTimePtr(local.PaidAt, incoming.PaidAt) &&
		local.PaidAmount == incoming.PaidAmount &&
		// 同上：账单期的删除墓碑也要参与「是否一致」的判断
		(local.DeletedAt != nil) == incoming.Deleted
}

func applySyncCardStatements(tx *gorm.DB, snap syncSnapshot, users map[string]database.User, cardIDs map[string]uint, myInstance string, stats *syncApplyStats) error {
	var locals []CardStatement
	if err := tx.Find(&locals).Error; err != nil {
		return err
	}
	byUID := make(map[string]*CardStatement, len(locals))
	byCardPeriod := make(map[string]*CardStatement, len(locals))
	for i := range locals {
		if locals[i].SyncUID != "" {
			byUID[locals[i].SyncUID] = &locals[i]
		}
		byCardPeriod[periodKey(locals[i].CardID, locals[i].Period)] = &locals[i]
	}

	for _, incoming := range snap.CardStatements {
		owner, ok := users[incoming.Owner]
		if !ok {
			markUnmapped(stats, incoming.Owner)
			continue
		}
		cardID, ok := cardIDs[incoming.CardUID]
		if !ok || cardID == 0 {
			// 卡没过来（对端已删或本机没这张卡）：账单期跟着跳过即可。
			stats.Skipped++
			continue
		}
		existing := byUID[incoming.UID]
		if existing == nil {
			// 老报文/老数据可能没有 UID：按「卡片 + 账单期」找同一条
			existing = byCardPeriod[periodKey(cardID, incoming.Period)]
		}
		if existing == nil {
			if incoming.Deleted {
				continue
			}
			row := CardStatement{
				SyncUID: incoming.UID, UserID: owner.ID, CardID: cardID, Period: incoming.Period,
				StatementDate: incoming.StatementDate, DueDate: incoming.DueDate,
				Amount: incoming.Amount, Minimum: incoming.Minimum,
				PaidAt: incoming.PaidAt, PaidAmount: incoming.PaidAmount, Note: incoming.Note,
				CreatedAt: incoming.CreatedAt, UpdatedAt: incoming.UpdatedAt,
			}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			stats.CardStatementsCreated++
			stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
			continue
		}
		if sameCardStatement(existing, incoming, cardID) {
			if incomingWins(existing.UpdatedAt, incoming.UpdatedAt, snap.InstanceID, myInstance) {
				if err := tx.Model(&CardStatement{}).Where("id = ?", existing.ID).
					UpdateColumn("updated_at", incoming.UpdatedAt).Error; err != nil {
					return err
				}
			}
			stats.Skipped++
			continue
		}
		if !incomingWins(existing.UpdatedAt, incoming.UpdatedAt, snap.InstanceID, myInstance) {
			stats.Skipped++
			continue
		}
		updates := map[string]interface{}{
			"card_id": cardID, "period": incoming.Period,
			"statement_date": incoming.StatementDate, "due_date": incoming.DueDate,
			"amount": incoming.Amount, "minimum": incoming.Minimum,
			"paid_at": incoming.PaidAt, "paid_amount": incoming.PaidAmount, "note": incoming.Note,
			"updated_at": incoming.UpdatedAt,
		}
		if incoming.Deleted {
			updates["deleted_at"] = incoming.UpdatedAt
			stats.CardStatementsDeleted++
		} else {
			updates["deleted_at"] = nil
			stats.CardStatementsUpdated++
		}
		if err := tx.Model(&CardStatement{}).Where("id = ?", existing.ID).Updates(updates).Error; err != nil {
			return err
		}
		stats.AffectedUsers = append(stats.AffectedUsers, existing.UserID)
	}
	return nil
}

func periodKey(cardID uint, period string) string {
	return strconv.FormatUint(uint64(cardID), 10) + "|" + period
}
