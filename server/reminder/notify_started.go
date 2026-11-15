package reminder

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"smallgo/server/logger"
	"smallgo/server/sysconfig"

	"gorm.io/gorm"
)

// 「当天任务提醒」（用户 2026-11-15）：
// 任务**开始后** X 小时仍未完成时，补一条站内提醒；0 = 关闭。
// 选项 1/2/4/8 小时，按 StartAt 触发；距开始不足 X 小时不提醒。
// 每个任务每天最多一条（type=reminder_started），与逾期提醒互不影响。

func notifyStartedTasks(db *gorm.DB) {
	notifyStartedAt(db, time.Now())
}

func notifyStartedAt(db *gorm.DB, now time.Time) {
	if db == nil {
		return
	}
	loc := shanghai()
	localNow := now.In(loc)
	startOfDay := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)

	var rows []Reminder
	if err := db.Where("deleted_at IS NULL AND completed_at IS NULL AND kind = ? AND start_at IS NOT NULL", KindTask).
		Find(&rows).Error; err != nil {
		logger.Error("reminder: scan started task candidates: %v", err)
		return
	}

	hoursCache := map[uint]int{}
	hoursOf := func(userID uint) int {
		if n, ok := hoursCache[userID]; ok {
			return n
		}
		n := 0
		if v, err := sysconfig.GetConfig(db, "reminder_same_day_hours", userID); err == nil {
			if parsed, convErr := strconv.Atoi(strings.TrimSpace(v)); convErr == nil && parsed > 0 {
				n = parsed
			}
		}
		hoursCache[userID] = n
		return n
	}

	sent := 0
	for _, item := range rows {
		if item.StartAt == nil {
			continue
		}
		hours := hoursOf(item.UserID)
		if hours <= 0 {
			continue
		}
		trigger := item.StartAt.In(loc).Add(time.Duration(hours) * time.Hour)
		if now.Before(trigger) {
			continue
		}
		// 停服/休眠后不补发太旧的；12 小时足够覆盖 8 小时选项。
		if now.Sub(trigger) > 12*time.Hour {
			continue
		}
		if inQuietHours(db, item.UserID, now) || dndBlocked(db, item.UserID, now) {
			continue
		}
		var already int64
		if err := db.Model(&Notification{}).
			Where("user_id = ? AND reminder_id = ? AND type = ? AND created_at >= ?",
				item.UserID, item.ID, "reminder_started", sqlTimeArg(startOfDay)).
			Count(&already).Error; err != nil {
			continue
		}
		if already > 0 {
			continue
		}
		reminderID := item.ID
		notification := Notification{
			UserID:     item.UserID,
			ReminderID: &reminderID,
			Type:       "reminder_started",
			Title:      fmt.Sprintf("任务已开始 %d 小时仍未完成：%s", hours, truncateRunes(item.Title, 40)),
			Body: fmt.Sprintf("开始于 %s；完成后可忽略这条提醒",
				item.StartAt.In(loc).Format("1月2日 15:04")),
		}
		if err := db.Create(&notification).Error; err != nil {
			logger.Error("reminder: create started notification: %v", err)
			continue
		}
		publishNotification(notification)
		sent++
	}
	if sent > 0 {
		logger.Info("reminder: 当天任务提醒 %d 条", sent)
	}
}
