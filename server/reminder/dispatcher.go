package reminder

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"smallgo/server/logger"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var dispatchMu sync.Mutex

func dispatchDueJobs(db *gorm.DB) {
	if !dispatchMu.TryLock() {
		return
	}
	defer dispatchMu.Unlock()

	// Delivery jobs are persisted as UTC instants. SQLite compares timestamp
	// values as text in this query, so mixing local and UTC offsets can make a
	// future reminder appear due immediately.
	now := time.Now().UTC()
	staleBefore := now.Add(-5 * time.Minute)
	_ = db.Model(&DeliveryJob{}).
		Where("status = ? AND locked_at < ?", "processing", staleBefore).
		Updates(map[string]interface{}{"status": "retry", "next_attempt_at": now, "worker_id": "", "locked_at": nil}).Error

	var jobs []DeliveryJob
	if err := db.Where(
		"(status = ? AND run_at <= ?) OR (status = ? AND next_attempt_at <= ?)",
		"pending", now, "retry", now,
	).Order("run_at ASC, id ASC").Limit(100).Find(&jobs).Error; err != nil {
		logger.Error("reminder: scan delivery jobs: %v", err)
		return
	}
	// 「开始提醒时间」（个人偏好 reminder_all_day_time，默认 09:00）之前**不发任何提醒**：
	// 用户 2026-10-12 要求的免打扰 —— 0:00 起静默，到点后这些任务仍是 pending，
	// 下一轮（每分钟一次）一起发出去。每个用户的静默判断只算一次（同一轮里可能有好几条）。
	//
	// 用户 2026-10-16 的免打扰（手动开关 + 后台时间段，「权责级别优先在所有通知以上」）
	// 也挡在这一层：dndBlocked 为真就整轮跳过，任务继续留 pending，到点后照常补发。
	quietNow := time.Now()
	quietUsers := map[uint]bool{}
	isQuiet := func(userID uint) bool {
		if cached, ok := quietUsers[userID]; ok {
			return cached
		}
		value := inQuietHours(db, userID, quietNow) || dndBlocked(db, userID, quietNow)
		quietUsers[userID] = value
		return value
	}

	for _, job := range jobs {
		if isQuiet(job.UserID) {
			continue
		}
		processJob(db, job)
	}
}

func processJob(db *gorm.DB, candidate DeliveryJob) {
	now := time.Now().UTC()
	workerID := fmt.Sprintf("local-%d", now.UnixNano())
	result := db.Model(&DeliveryJob{}).
		Where("id = ? AND status IN ?", candidate.ID, []string{"pending", "retry"}).
		Updates(map[string]interface{}{"status": "processing", "locked_at": &now, "worker_id": workerID})
	if result.Error != nil || result.RowsAffected != 1 {
		return
	}

	var job DeliveryJob
	if err := db.First(&job, candidate.ID).Error; err != nil {
		return
	}
	var item Reminder
	if err := db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", job.ReminderID, job.UserID).First(&item).Error; err != nil {
		finishCancelled(db, job.ID, "REMINDER_NOT_FOUND")
		return
	}
	if item.CompletedAt != nil || item.DueAt == nil {
		finishCancelled(db, job.ID, "REMINDER_CHANGED")
		return
	}
	// 两种「预期之内」的时刻：
	//   · 不晚于结束时间 —— **首次提醒**（用户 2026-10-13：开始提醒时间那天先弹一次，
	//     例如结束 23:59、开始提醒 06:00 → 06:00 就弹）以及稍后提醒；
	//   · 晚于结束时间 —— 过期重复提醒的链条（到期时间 + k×间隔）。
	// 其余（既晚于结束时间、又不在重复链上）才判成条目已改的陈旧任务。
	// 「首次提醒」现在允许晚于结束时间（新建后至少 10 分钟那条口径，见
	// firstRemindSchedule）：只要这条任务的时间戳与当前应有的首次提醒时刻一致，
	// 它就是有效的，不能当成「条目已改」丢掉。
	expectedFirst := firstRemindSchedule(db, item)
	if job.ScheduledFor.After(*item.DueAt) &&
		!sameInstant(job.ScheduledFor, expectedFirst) &&
		!(item.RepeatNotifyMinutes > 0 && job.ScheduledFor.After(*item.DueAt)) {
		finishCancelled(db, job.ID, "REMINDER_CHANGED")
		return
	}
	if !sameInstant(*item.DueAt, job.ScheduledFor) && job.ScheduledFor.Before(*item.DueAt) {
		// 早于结束时间：只可能是首次提醒（或稍后提醒），仍然有效 —— 但要是这条的
		// 结束时间已经被改到比它更早，那它才是陈旧的。
		stamp := deadlineStamp(item)
		if stamp != nil && job.ScheduledFor.After(*stamp) {
			finishCancelled(db, job.ID, "REMINDER_CHANGED")
			return
		}
	}
	var link ReminderChannel
	if err := db.Where("reminder_id = ? AND user_id = ? AND channel = ? AND enabled = ?", item.ID, item.UserID, job.Channel, true).First(&link).Error; err != nil {
		finishCancelled(db, job.ID, "CHANNEL_DISABLED")
		return
	}

	started := time.Now().UTC()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	sendResult, err := sendChannel(ctx, db, job.Channel, job.UserID, item, job.IdempotencyKey, parseChannelTargets(link.Targets))
	cancel()
	finished := time.Now().UTC()
	attemptNo := job.AttemptCount + 1

	attempt := DeliveryAttempt{
		JobID: job.ID, AttemptNo: attemptNo, StartedAt: started, FinishedAt: finished,
		LatencyMS: finished.Sub(started).Milliseconds(),
	}
	if err == nil {
		attempt.Result = "success"
		attempt.ResponseSummary = "sent"
		_ = db.Transaction(func(tx *gorm.DB) error {
			if e := tx.Create(&attempt).Error; e != nil {
				return e
			}
			if e := tx.Model(&DeliveryJob{}).Where("id = ?", job.ID).Updates(map[string]interface{}{
				"status": "succeeded", "attempt_count": attemptNo,
				"external_message_id": sendResult.ExternalID, "locked_at": nil, "worker_id": "",
				"last_error_code": "", "last_error_message": "",
			}).Error; e != nil {
				return e
			}
			// The send succeeded and the user has not completed the reminder
			// yet, so queue the next notification for repeat-notify reminders.
			return scheduleRepeatNotify(tx, item, job)
		})
		if job.Channel != ChannelInApp {
			_ = db.Model(&ChannelBinding{}).Where("user_id = ? AND channel = ?", job.UserID, job.Channel).Updates(map[string]interface{}{"last_error_code": "", "last_error_at": nil}).Error
		}
		return
	}

	var classified *deliveryError
	if !errors.As(err, &classified) {
		classified = &deliveryError{Code: "DELIVERY_FAILED", Message: safeError(err)}
	}
	if job.Channel != ChannelInApp {
		_ = db.Model(&ChannelBinding{}).Where("user_id = ? AND channel = ?", job.UserID, job.Channel).Updates(map[string]interface{}{"last_error_code": classified.Code + "：" + truncateRunes(classified.Message, 100), "last_error_at": &finished}).Error
	}
	attempt.ProviderCode = classified.Code
	attempt.ResponseSummary = truncateRunes(classified.Message, 150)
	if classified.Permanent || attemptNo >= 3 {
		attempt.Result = "permanent"
		var failureNotification *Notification
		txErr := db.Transaction(func(tx *gorm.DB) error {
			if e := tx.Create(&attempt).Error; e != nil {
				return e
			}
			if e := tx.Model(&DeliveryJob{}).Where("id = ?", job.ID).Updates(map[string]interface{}{
				"status": "failed", "attempt_count": attemptNo, "locked_at": nil, "worker_id": "",
				"last_error_code": classified.Code, "last_error_message": truncateRunes(classified.Message, 280),
			}).Error; e != nil {
				return e
			}
			if job.Channel != ChannelInApp {
				n := Notification{
					UserID: job.UserID, ReminderID: &job.ReminderID, Type: "channel_failed",
					Title: "“" + truncateRunes(item.Title, 40) + "”发送失败",
					Body:  channelLabel(job.Channel) + "：" + truncateRunes(classified.Message, 120),
				}
				if e := tx.Create(&n).Error; e != nil {
					return e
				}
				failureNotification = &n
			}
			return nil
		})
		if txErr == nil && failureNotification != nil {
			publishNotification(*failureNotification)
		}
		return
	}

	attempt.Result = "transient"
	delays := []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute}
	next := time.Now().UTC().Add(delays[attemptNo-1])
	_ = db.Transaction(func(tx *gorm.DB) error {
		if e := tx.Create(&attempt).Error; e != nil {
			return e
		}
		return tx.Model(&DeliveryJob{}).Where("id = ?", job.ID).Updates(map[string]interface{}{
			"status": "retry", "attempt_count": attemptNo, "next_attempt_at": &next,
			"locked_at": nil, "worker_id": "", "last_error_code": classified.Code,
			"last_error_message": truncateRunes(classified.Message, 280),
		}).Error
	})
}

func finishCancelled(db *gorm.DB, jobID uint, code string) {
	_ = db.Model(&DeliveryJob{}).Where("id = ?", jobID).Updates(map[string]interface{}{
		"status": "cancelled", "locked_at": nil, "worker_id": "", "last_error_code": code,
	}).Error
}

// scheduleRepeatNotify queues the next notification for an uncompleted
// repeat-notify reminder: one interval after the occurrence that just fired,
// repeating until the user completes, edits or deletes the reminder — each of
// those rebuilds or cancels pending jobs and thereby ends the chain. The
// upsert keeps the chain idempotent and merges with a rebuilt job that lands
// on the same occurrence (for example a daily rule with a one-day interval).
func scheduleRepeatNotify(tx *gorm.DB, item Reminder, job DeliveryJob) error {
	if item.RepeatNotifyMinutes <= 0 || item.DueAt == nil {
		return nil
	}
	interval := time.Duration(item.RepeatNotifyMinutes) * time.Minute
	next := job.ScheduledFor.Add(interval)
	now := time.Now().UTC()
	// 「提前几天开始提醒」的窗口内**每天只在「开始提醒时间」提醒一次**
	// （用户 2026-10-13；见 firstRemindAt 的窗口口径）：提前几天是为了让人心里有数，
	// 不是从三天前就按「提醒频率」每 15 分钟弹一次 —— 那会变成几百条通知。
	// 到了到期日那天的首次提醒时刻（normal），再恢复「首次提醒 + 提醒频率」的老口径。
	if normal := normalFirstRemindAt(tx, item); !normal.IsZero() && next.Before(normal) {
		next = job.ScheduledFor.AddDate(0, 0, 1)
		// 停机跨过几天时，把窗口内的“每天一次”追到下一个未来的点，而不是补发一串。
		for !next.After(now) {
			next = next.AddDate(0, 0, 1)
		}
		if next.After(normal) {
			next = normal
		}
	} else if !next.After(now) {
		// 逾期一段时间后才开启/重建链条时，被跳过的间隔不再逐个补发（避免一次性
		// 轰炸一串过期通知），直接从现在起排下一个完整间隔。
		next = now.Add(interval)
	}
	raw := fmt.Sprintf("%d|%s|%s|chain", item.ID, job.Channel, next.UTC().Format(time.RFC3339Nano))
	sum := sha256.Sum256([]byte(raw))
	nextJob := DeliveryJob{
		UserID: item.UserID, ReminderID: item.ID, Channel: job.Channel,
		ScheduledFor: next, RunAt: next, Status: "pending",
		IdempotencyKey: hex.EncodeToString(sum[:]),
	}
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "reminder_id"}, {Name: "channel"}, {Name: "scheduled_for"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"run_at": next, "status": "pending", "attempt_count": 0,
			"next_attempt_at": nil, "locked_at": nil, "worker_id": "",
			"idempotency_key": nextJob.IdempotencyKey, "last_error_code": "",
			"last_error_message": "", "external_message_id": "",
		}),
	}).Create(&nextJob).Error
}

func sameInstant(a, b time.Time) bool {
	return a.UTC().Equal(b.UTC())
}

func channelLabel(channel string) string {
	switch channel {
	case ChannelEmail:
		return "电子邮件"
	case ChannelSMS:
		return "手机短信"
	case ChannelFeishu:
		return "飞书机器人"
	case ChannelQQ:
		return "QQ 机器人"
	case ChannelDingTalk:
		return "钉钉群机器人"
	default:
		return "站内消息"
	}
}
