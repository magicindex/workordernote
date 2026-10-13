package reminder

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"smallgo/server/logger"
	"smallgo/server/sysconfig"

	"gorm.io/gorm"
)

// 本文件是「什么时间才允许提醒」这一层：
//
//   · **开始提醒时间**（reminder_all_day_time，个人偏好，默认 09:00）：
//     每天这个时间之前不发任何提醒 —— 用户 2026-10-12 要求的「类似手机的免打扰」，
//     0:00 起静默，到点后把攒着的提醒依次发出去（见 dispatcher.go 的调用点）。
//   · **逾期提醒时间**（task_overdue_time，个人偏好，默认 23:59）：
//     到期日当天过了这个点还没完成就算逾期（判定见 handlers.go 的 overdueDeadlineExpr），
//     并且**发一条「已逾期」站内提醒**（notifyOverdue，每个任务每天最多一条）。

const (
	// overdueNotifyLookback：只对「刚刚进入逾期」的任务发提醒。deadline 已经过了很久的
	// （早就躺在「已逾期」分组里了）不再补发 —— 服务重启或停机一天后不会一次炸出一堆。
	overdueNotifyLookback = 12 * time.Hour
	// quietCacheTTL：开始提醒时间的进程内缓存。
	quietCacheTTL = 30 * time.Second
)

var (
	quietMu    sync.Mutex
	quietCache = map[uint]quietEntry{}
)

type quietEntry struct {
	start string
	at    time.Time
}

// clockParts 把 "HH:MM" 拆成时、分。
func clockParts(v string) (int, int, bool) {
	parts := strings.Split(strings.TrimSpace(v), ":")
	if len(parts) != 2 {
		return 0, 0, false
	}
	h, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	m, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, false
	}
	return h, m, true
}

// quietStart 读个人偏好「开始提醒时间」（reminder_all_day_time）。
// 没写过这一行就用注册表默认值（09:00）。
func quietStart(db *gorm.DB, userID uint) string {
	quietMu.Lock()
	if entry, ok := quietCache[userID]; ok && time.Since(entry.at) < quietCacheTTL {
		start := entry.start
		quietMu.Unlock()
		return start
	}
	quietMu.Unlock()

	start := "09:00"
	if def, ok := sysconfig.GetConfigDef("reminder_all_day_time"); ok && def.Default != "" {
		start = def.Default
	}
	if v, err := sysconfig.GetConfig(db, "reminder_all_day_time", userID); err == nil {
		if normalized, ok := sysconfig.NormalizeClock(v); ok {
			start = normalized
		}
	}

	quietMu.Lock()
	quietCache[userID] = quietEntry{start: start, at: time.Now()}
	quietMu.Unlock()
	return start
}

// effectiveStamp 是条目「生效时间」的原始值：稍后提醒 > 时间段结束 > 时间段开始 > 到期时间。
// 与列表/日历口径一致（见 handlers.go 的 effectiveDue）。
func effectiveStamp(item Reminder) *time.Time {
	for _, stamp := range []*time.Time{item.SnoozedUntil, item.EndAt, item.StartAt, item.DueAt} {
		if stamp != nil {
			return stamp
		}
	}
	return nil
}

// firstRemindAt 算「这一条的**第一次提醒时刻**」（用户 2026-10-13 明确：
// 「开始提醒时间」＝当天第一次提醒弹窗的时间，从早上就开始提醒）。
//
// 取「生效时间」与「生效日当天的开始提醒时间」里**更早**的那个：
// 例如结束时间 23:59、开始提醒时间 06:00 → 到期那天 06:00 就先弹一次；
// 结束时间本来就早于开始提醒时间（比如凌晨 05:00 到期）→ 还是到点弹。
// 之后的重复由 scheduleRepeatNotify 按「提醒频率」接着排；逾期判定不受影响。
//
// 返回零值表示这条没有时间（不该排提醒）。
func firstRemindAt(db *gorm.DB, item Reminder) time.Time {
	stamp := effectiveStamp(item)
	if stamp == nil {
		return time.Time{}
	}
	start := quietStart(db, item.UserID)
	// 00:00 = 不提前提醒（与「不静默」同一个约定）：首次提醒就是结束时间本身。
	if start == "00:00" {
		return stamp.UTC()
	}
	h, m, ok := clockParts(start)
	if !ok {
		return stamp.UTC()
	}
	local := stamp.In(shanghai())
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), h, m, 0, 0, shanghai())
	if dayStart.Before(*stamp) {
		return dayStart.UTC()
	}
	return stamp.UTC()
}

// inQuietHours 判断此刻是否在「开始提醒时间」之前的静默窗口里：每天 [00:00, start)。
//
// start 写成 00:00 时不静默（否则一整天都不提醒，等于把功能关掉，不是用户的本意）。
func inQuietHours(db *gorm.DB, userID uint, now time.Time) bool {
	start := quietStart(db, userID)
	if start == "00:00" {
		return false
	}
	h, m, ok := clockParts(start)
	if !ok {
		return false
	}
	local := now.In(shanghai())
	return local.Hour()*60+local.Minute() < h*60+m
}

// overdueDeadlineOf 算出这条任务的「逾期判定时刻」（与 SQL 里的 overdueDeadlineExpr 同一口径）：
// 生效时间所在那一天（本地日期）的「逾期提醒时间」；写 00:00 时就是生效时刻本身。
func overdueDeadlineOf(item Reminder, cutoff string) time.Time {
	stamp := item.SnoozedUntil
	if stamp == nil {
		stamp = item.EndAt
	}
	if stamp == nil {
		stamp = item.StartAt
	}
	if stamp == nil {
		stamp = item.DueAt
	}
	if stamp == nil {
		return time.Time{}
	}
	if cutoff == "00:00" {
		return *stamp
	}
	h, m, ok := clockParts(cutoff)
	if !ok {
		h, m = 23, 59
	}
	loc := shanghai()
	local := stamp.In(loc)
	return time.Date(local.Year(), local.Month(), local.Day(), h, m, 0, 0, loc)
}

// notifyOverdue 是 scheduler 的每分钟任务（见 register.go）：给「刚刚进入逾期」的
// 未完成任务各发一条站内提醒。
func notifyOverdue(db *gorm.DB) {
	notifyOverdueAt(db, time.Now())
}

// notifyOverdueAt 是 notifyOverdue 的主体，now 显式传入便于测试。
//
// 规则：
//   - 每个任务**每天最多一条**（type=reminder_overdue，按本地日去重）；
//   - 静默窗口（开始提醒时间之前）里不发，等静默结束那一轮再发；
//   - 只补发 12 小时内进入逾期的（停服一天后不会一次炸出一大串「早就逾期」的旧任务）。
func notifyOverdueAt(db *gorm.DB, now time.Time) {
	if db == nil {
		return
	}
	loc := shanghai()
	localNow := now.In(loc)
	startOfDay := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)

	var rows []Reminder
	if err := db.Where("deleted_at IS NULL AND completed_at IS NULL AND kind = ? AND due_at IS NOT NULL", KindTask).
		Find(&rows).Error; err != nil {
		logger.Error("reminder: scan overdue candidates: %v", err)
		return
	}

	type userPolicy struct {
		grace  time.Duration
		cutoff string
		quiet  bool
	}
	policies := map[uint]userPolicy{}
	policyOf := func(userID uint) userPolicy {
		if p, ok := policies[userID]; ok {
			return p
		}
		grace, cutoff := overduePolicy(db, userID)
		p := userPolicy{grace: grace, cutoff: cutoff, quiet: inQuietHours(db, userID, now)}
		policies[userID] = p
		return p
	}

	sent := 0
	for _, item := range rows {
		p := policyOf(item.UserID)
		if p.quiet {
			continue
		}
		deadline := overdueDeadlineOf(item, p.cutoff)
		if deadline.IsZero() {
			continue
		}
		becomesOverdue := deadline.Add(p.grace)
		if now.Before(becomesOverdue) {
			continue
		}
		if now.Sub(becomesOverdue) > overdueNotifyLookback {
			continue
		}
		var already int64
		if err := db.Model(&Notification{}).
			Where("user_id = ? AND reminder_id = ? AND type = ? AND created_at >= ?",
				item.UserID, item.ID, "reminder_overdue", sqlTimeArg(startOfDay)).
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
			Type:       "reminder_overdue",
			Title:      "已逾期：" + truncateRunes(item.Title, 40),
			Body: fmt.Sprintf("到期日 %s，逾期提醒时间 %s%s",
				deadline.In(loc).Format("1月2日"), p.cutoff, graceLabel(p.grace)),
		}
		if err := db.Create(&notification).Error; err != nil {
			logger.Error("reminder: create overdue notification: %v", err)
			continue
		}
		publishNotification(notification)
		sent++
	}
	if sent > 0 {
		logger.Info("reminder: 逾期提醒 %d 条", sent)
	}
}

func graceLabel(grace time.Duration) string {
	if grace <= 0 {
		return ""
	}
	return fmt.Sprintf("，宽限 %d 分钟后判定", int(grace.Minutes()))
}
