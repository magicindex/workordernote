package reminder

import (
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"smallgo/server/database"
	"smallgo/server/logger"
	"smallgo/server/response"
)

// TrashItem 是垃圾箱里的一条已删除提醒。删除是软删除，所以这里能看到原始
// 清单、到期时间与完成状态；恢复后回到原清单（原清单也删了则回到默认清单）。
type TrashItem struct {
	ID          uint       `json:"id"`
	Title       string     `json:"title"`
	Notes       string     `json:"notes,omitempty"`
	Kind        string     `json:"kind"`
	ListID      uint       `json:"list_id"`
	ListName    string     `json:"list_name"`
	DueAt       *time.Time `json:"due_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	DeletedAt   time.Time  `json:"deleted_at"`
}

func handleListTrash(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := currentUserID(c)
		var rows []Reminder
		purged, err := purgeExpiredTrash(db, userID, time.Now())
		if err != nil {
			logger.Error("reminder: 自动清空垃圾箱失败 user=%d: %v", userID, err)
			purged = 0
		}
		if err := db.Unscoped().
			Where("user_id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL", userID).
			Order("deleted_at DESC, id DESC").Find(&rows).Error; err != nil {
			response.ErrorInternal(c, "读取垃圾箱失败")
			return
		}
		ids := make([]uint, 0, len(rows))
		for _, r := range rows {
			if r.ListID > 0 {
				ids = append(ids, r.ListID)
			}
		}
		names := map[uint]string{}
		if len(ids) > 0 {
			var lists []List
			if err := db.Unscoped().Where("user_id = ? AND id IN ?", userID, ids).Find(&lists).Error; err == nil {
				for _, l := range lists {
					names[l.ID] = l.Name
				}
			}
		}
		items := make([]TrashItem, 0, len(rows))
		for _, r := range rows {
			deleted := time.Time{}
			if r.DeletedAt != nil {
				deleted = *r.DeletedAt
			}
			items = append(items, TrashItem{
				ID: r.ID, Title: r.Title, Notes: r.Notes, Kind: r.Kind,
				ListID: r.ListID, ListName: names[r.ListID],
				DueAt: r.DueAt, CompletedAt: r.CompletedAt,
				DeletedAt: deleted,
			})
		}
		response.Success(c, gin.H{"items": items, "purged": purged})
	}
}

// clearTrash 把当前用户垃圾箱里的条目全部标记为已清空。保留 deleted_at 作为同步墓碑，
// 再加 purged_at；硬删除会被对端同步快照重新带回，所以不能直接删行。
func clearTrash(db *gorm.DB, userID uint, now time.Time) (int64, error) {
	res := db.Unscoped().Model(&Reminder{}).
		Where("user_id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL", userID).
		Updates(map[string]interface{}{
			"purged_at": now, "updated_at": now,
			"version": gorm.Expr("version + 1"),
		})
	return res.RowsAffected, res.Error
}

func trashRetentionDays(db *gorm.DB, userID uint) int {
	days, err := strconv.Atoi(strings.TrimSpace(userConfigValue(db, userID, "trash_auto_clear_days")))
	if err != nil || days <= 0 {
		return 0
	}
	if days > 3650 {
		return 3650
	}
	return days
}

// purgeExpiredTrash 按用户配置把删除超过 N 天的提醒标记为已清空；N=0 不处理。
func purgeExpiredTrash(db *gorm.DB, userID uint, now time.Time) (int64, error) {
	days := trashRetentionDays(db, userID)
	if days <= 0 {
		return 0, nil
	}
	cutoff := now.Add(-time.Duration(days) * 24 * time.Hour)
	res := db.Unscoped().Model(&Reminder{}).
		Where("user_id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL AND deleted_at <= ?", userID, cutoff).
		Updates(map[string]interface{}{
			"purged_at": now, "updated_at": now,
			"version": gorm.Expr("version + 1"),
		})
	return res.RowsAffected, res.Error
}

func purgeExpiredTrashAll(db *gorm.DB) {
	var users []database.User
	if err := db.Where("status = 1").Find(&users).Error; err != nil {
		logger.Error("reminder: 读取用户失败，跳过垃圾箱自动清空: %v", err)
		return
	}
	now := time.Now()
	for _, u := range users {
		n, err := purgeExpiredTrash(db, u.ID, now)
		if err != nil {
			logger.Error("reminder: 自动清空垃圾箱失败 user=%d: %v", u.ID, err)
			continue
		}
		if n > 0 {
			logger.Info("reminder: 自动清空垃圾箱 user=%d count=%d", u.ID, n)
		}
	}
}

func handleClearTrash(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := currentUserID(c)
		n, err := clearTrash(db, userID, time.Now())
		if err != nil {
			response.ErrorInternal(c, "清空垃圾箱失败")
			return
		}
		publishDataChanged(userID, "reminder", "purged", 0, originClientID(c))
		response.Success(c, gin.H{"purged": n})
	}
}

func handleRestoreTrash(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		userID := currentUserID(c)
		item, err := restoreDeletedReminder(db, userID, id)
		if err != nil {
			writeServiceError(c, err)
			return
		}
		publishDataChanged(userID, "reminder", "restored", id, originClientID(c))
		response.Success(c, item)
	}
}

// restoreDeletedReminder 把软删除的提醒放回清单。只恢复提醒本身，不恢复已撤回的
// 完成历史；记事按原状态（完成记录）恢复，任务保留删除前的完成状态。
func restoreDeletedReminder(db *gorm.DB, userID, reminderID uint) (ReminderDTO, error) {
	err := db.Transaction(func(tx *gorm.DB) error {
		var item Reminder
		if err := tx.Unscoped().
			Where("id = ? AND user_id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL", reminderID, userID).
			First(&item).Error; err != nil {
			return err
		}
		// 原清单可能也被删了，避免恢复后落进一个看不见的清单。
		var list List
		if err := tx.Where("id = ? AND user_id = ? AND deleted_at IS NULL", item.ListID, userID).First(&list).Error; err != nil {
			def, derr := ensureDefaultList(tx, userID)
			if derr != nil {
				return derr
			}
			item.ListID = def.ID
		}
		item.DeletedAt = nil
		item.Version++
		if err := tx.Unscoped().Model(&Reminder{}).
			Where("id = ? AND user_id = ?", item.ID, userID).
			Updates(map[string]interface{}{"deleted_at": nil, "list_id": item.ListID, "version": item.Version}).Error; err != nil {
			return err
		}
		if item.Kind == KindNote || item.CompletedAt != nil {
			return nil
		}
		var channelRows []ReminderChannel
		if err := tx.Where("reminder_id = ? AND user_id = ? AND enabled = ?", item.ID, userID, true).Find(&channelRows).Error; err != nil {
			return err
		}
		channels := make([]string, 0, len(channelRows))
		for _, row := range channelRows {
			channels = append(channels, row.Channel)
		}
		return rebuildJobs(tx, item, channels)
	})
	if err != nil {
		return ReminderDTO{}, err
	}
	return getReminder(db, userID, reminderID)
}
