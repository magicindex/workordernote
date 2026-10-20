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

	advanceMu    sync.Mutex
	advanceCache = map[uint]advanceEntry{}
)

type quietEntry struct {
	start string
	at    time.Time
}

// advanceEntry 是「提前几天开始提醒」的进程内缓存（与开始提醒时间同一个 TTL）。
type advanceEntry struct {
	days int
	at   time.Time
}

// resetWindowCache 让下一次读取重新查库（配置刚改完、测试用）。
func resetWindowCache(userID uint) {
	quietMu.Lock()
	delete(quietCache, userID)
	quietMu.Unlock()
	advanceMu.Lock()
	delete(advanceCache, userID)
	advanceMu.Unlock()
}

// advanceDaysMax 是「提前几天」的上限：再长也没有意义，还能挡住手滑写进去的 99999
// （那样「提前窗口」会直接落到几年前，反而变成「立刻提醒」）。
const advanceDaysMax = 60

// advanceDays 读个人偏好「提前几天开始提醒」（reminder_advance_days，默认 0 = 不提前）。
func advanceDays(db *gorm.DB, userID uint) int {
	advanceMu.Lock()
	if entry, ok := advanceCache[userID]; ok && time.Since(entry.at) < quietCacheTTL {
		days := entry.days
		advanceMu.Unlock()
		return days
	}
	advanceMu.Unlock()

	days := 0
	if v, err := sysconfig.GetConfig(db, "reminder_advance_days", userID); err == nil {
		if n, convErr := strconv.Atoi(strings.TrimSpace(v)); convErr == nil && n > 0 {
			days = n
		}
	}
	if days > advanceDaysMax {
		days = advanceDaysMax
	}

	advanceMu.Lock()
	advanceCache[userID] = advanceEntry{days: days, at: time.Now()}
	advanceMu.Unlock()
	return days
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
//
// **只在「投递调度」这条链上用**（见 rebuildJobs 的 run_at）。列表/分组/逾期一律走
// deadlineStamp（不看稍后提醒）—— 用户 2026-10-14：「逾期项目点击稍后提醒后不应该移出
// 逾期栏目，只是再次提醒时间延迟；未逾期项目同样，不改变创建、到期时间，只是延迟提醒时间」。
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
	normal := normalFirstRemindAt(db, item)
	if normal.IsZero() {
		return normal
	}
	stamp := deadlineStamp(item)
	start := quietStart(db, item.UserID)
	h, m, clockOK := clockParts(start)
	if !clockOK {
		h, m = 0, 0
	}
	// 信用卡还款提醒的窗口起点（用户 2026-10-13：「信用卡还款从账单日开始，直到还款日」）：
	// 还款日那条从**本期账单日**开始提醒，还款提醒那条从**还款日 − N 天**开始。
	// 与全局的「提前几天开始提醒」比，它是**按卡片算的**（账单日到还款日的天数每张卡不同），
	// 所以先判它。同样只在「创建时窗口还没到」的时候才用。
	if stamp != nil && !item.CreatedAt.IsZero() {
		if windowStart, ok := cardRemindWindowStart(db, item); ok {
			start := time.Date(windowStart.Year(), windowStart.Month(), windowStart.Day(), h, m, 0, 0, shanghai())
			if start.After(item.CreatedAt) && start.Before(*stamp) {
				return start.UTC()
			}
		}
	}
	// 「提前几天开始提醒」（用户 2026-10-13）：到期日往前 N 天那天的「开始提醒时间」
	// 就是提前窗口的起点。**只在创建时离到期日还超过 N 天的时候才用它** ——
	// 创建时已经在 N 天之内（今天到期、明天到期…）的按正常流程走，也就是
	// normalFirstRemindAt 那套老口径（到期日当天那个点）。
	//
	// 注意这一段在「开始提醒时间 = 00:00」之前判：00:00 的含义是「到期日当天不提前
	// 提醒、也不静默」，而「提前 N 天」是另一件事 —— 用户既然设了提前天数，就用
	// 00:00 作为那一天的时刻（也就是窗口从 (到期日-N) 的 0 点开）。
	if stamp != nil {
		if days := advanceDays(db, item.UserID); days > 0 && !item.CreatedAt.IsZero() {
			local := stamp.In(shanghai())
			windowDay := local.AddDate(0, 0, -days)
			windowStart := time.Date(windowDay.Year(), windowDay.Month(), windowDay.Day(), h, m, 0, 0, shanghai())
			if windowStart.After(item.CreatedAt) && windowStart.Before(*stamp) {
				return windowStart.UTC()
			}
		}
	}
	return normal
}

// normalFirstRemindAt 是**正常流程**的首次提醒时刻（不看提前天数）：到期日当天那个
// 「开始提醒时间」，比结束时间还早就用它，否则就是结束时间本身。
// 提前窗口的边界、以及「窗口内每天只提醒一次到哪天为止」都用它。
func normalFirstRemindAt(db *gorm.DB, item Reminder) time.Time {
	stamp := deadlineStamp(item)
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

// firstRemindDelay 是「新建之后至少隔多久才第一次提醒」（用户 2026-10-13 要求
// 「新建提醒，10分钟以后开始第一次提醒」）。刚建完立刻弹窗，用户还没离开编辑页面、
// 也没来得及看内容，既烦又容易误点「知道了」。
const firstRemindDelay = 10 * time.Minute

// firstRemindSchedule 返回这条提醒**当前应有的首次提醒时刻**，是调度与「这条投递任务
// 还算不算数」两处共用的唯一口径（不一致就会出现「刚排好就被当成陈旧任务丢掉」）：
//
//	firstRemindAt（结束时间 / 当天开始提醒时间里更早的那个，见上）
//	→ 不早于「创建时间 + 10 分钟」（新建后先给人 10 分钟）
//	→ 不晚于结束时间（结束时间还在未来时把 10 分钟那条夹回来；已经过期的保持
//	  10 分钟，让「新建后不再立刻弹」这条优先）
func firstRemindSchedule(db *gorm.DB, item Reminder) time.Time {
	scheduled := firstRemindAt(db, item)
	if scheduled.IsZero() {
		return time.Time{}
	}
	// 稍后提醒**不参与**这个口径（用户 2026-10-14：它只延迟提醒时间）：投递时刻由
	// rebuildJobs 的 run_at（= snoozed_until）负责，这里算的始终是「正常流程」的首次提醒。
	if earliest := item.CreatedAt.Add(firstRemindDelay); scheduled.Before(earliest) {
		scheduled = earliest.UTC()
	}
	// 结束时间还没到、却被 10 分钟这条顶到了结束时间之后 → 夹回结束时间本身
	// （例如 15:25 建一条 15:30 到期的：10 分钟后是 15:35，就该在 15:30 提醒）。
	// 结束时间**已经过去**时不夹（那种条目按 10 分钟这条走：不再立刻弹，见用例 ③）。
	if item.DueAt != nil &&
		scheduled.After(item.DueAt.UTC()) && item.DueAt.After(time.Now()) {
		scheduled = item.DueAt.UTC()
	}
	return scheduled
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

// deadlineStamp 是「逾期基准时间」：时间段结束 > 时间段开始 > 到期时间 ——
// 也就是 effectiveStamp 那条链**去掉「稍后提醒」**。
//
// 为什么不算稍后提醒（用户 2026-10-13：「逾期项目点击知道了，提醒依然保留在逾期栏目，
// 只是按后台设定时间进行下一次提示」）：弹窗上点「知道了」原来会把它「稍后提醒」到
// 设定时间（默认第二天），于是那条**明明已经逾期**的任务就从「已逾期」分组里消失了 ——
// 用户看到的是「点一下知道了，欠着的事就不算逾期了」。稍后提醒只该决定「什么时候再提醒我」，
// 不该改变「这件事已经逾期」这个事实。
func deadlineStamp(item Reminder) *time.Time {
	for _, stamp := range []*time.Time{item.EndAt, item.StartAt, item.DueAt} {
		if stamp != nil {
			return stamp
		}
	}
	return nil
}

// overdueDeadlineOf 算出这条任务的「逾期判定时刻」（与 SQL 里的 overdueDeadlineExpr 同一口径）：
// 生效时间所在那一天（本地日期）的「逾期提醒时间」；写 00:00 时就是生效时刻本身。
func overdueDeadlineOf(item Reminder, cutoff string) time.Time {
	stamp := deadlineStamp(item)
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
		// quiet 一并算上用户 2026-10-16 的免打扰（手动开关 + 后台时间段，见 dnd.go）：
		// 免打扰期间逾期提醒整轮跳过，到点后按原来的「当天最多一条」口径补发。
		quiet := inQuietHours(db, userID, now) || dndBlocked(db, userID, now)
		p := userPolicy{grace: grace, cutoff: cutoff, quiet: quiet}
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
