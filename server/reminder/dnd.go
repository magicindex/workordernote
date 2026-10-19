package reminder

import (
	"time"

	"smallgo/server/database"
	"smallgo/server/logger"
	"smallgo/server/response"
	"smallgo/server/sysconfig"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 免打扰（用户 2026-10-16）：「首行消息（铃铛）旁边放一个喇叭标志，点击进入静音标志，
// 退出显示喇叭，点击进入免打扰模式。后台增加免打扰时间段。权责级别优先在 所有通知以上。」
//
// 两个来源，任一成立就是免打扰：
//   - 手动：个人级 dnd_manual —— 首行那个按钮，开了就一直开着，要用户自己再点一下才关；
//   - 时间段：个人级 dnd_enabled + dnd_start_time + dnd_end_time（「偏好设置 → 免打扰」），
//     支持跨天（22:00–07:00 这样写）。**时间段默认是关的**（起止先填 22:00–07:00 备着）：
//     开了它，夜里到清晨的提醒（含逾期补发）会整段不发，属于会改变现有行为的设置，
//     得用户自己决定 —— 想要就说一声，别替他默认成「安静的夜晚」。
//
// 「优先在所有通知以上」落在四个口子上（这是本功能的意义所在）：
//   - 投递任务（dispatcher.go 的 dispatchDueJobs）：整轮跳过，任务继续留 pending，
//     免打扰结束后的下一轮一起发出去 —— 不丢，只是推迟；
//   - 逾期提醒（notify_window.go 的 notifyOverdueAt）：同一轮里按用户跳过；
//   - 提醒@他（nudge.go 的 notifyNudge）：通知照样记进通知中心，但不实时推送；
//   - 前端（MainLayout.vue）：免打扰期间不弹窗、不响铃，通知中心的未读角标照常累积，
//     免打扰结束后再进来还能在通知中心看到。
//
// 与「开始提醒时间」（reminder_all_day_time，0:00–该点 不发提醒）是两回事：那个是每天
// 早上的固定静默边界，这个是用户手动开关 + 个人时间段，且优先级更高（两者任一成立都不发）。
// 时间段是**每个人自己的**（2026-10-19 从系统配置挪到偏好设置），所以投递链路都按 userID 取。
const (
	// keyDNDManual 个人级：首行那个喇叭/静音按钮（用户自己点）。
	keyDNDManual = "dnd_manual"
	// keyDNDEnabled 个人级：「免打扰时间段」总开关（偏好设置里改）。
	keyDNDEnabled = "dnd_enabled"
	// keyDNDStart / keyDNDEnd 个人级：时间段起止（HH:MM，可跨天）。
	keyDNDStart = "dnd_start_time"
	keyDNDEnd   = "dnd_end_time"
)

// DNDState 是给前端的一份完整状态：按钮该显示喇叭还是静音、现在为什么安静。
type DNDState struct {
	Manual        bool   `json:"manual"`
	WindowEnabled bool   `json:"window_enabled"`
	WindowStart   string `json:"window_start"`
	WindowEnd     string `json:"window_end"`
	InWindow      bool   `json:"in_window"`
	Active        bool   `json:"active"`
	Reason        string `json:"reason"`
}

// dndWindow 读某个用户的免打扰时间段（个人级配置）。
// 没写过这一行就用注册表默认值（**默认关**，起止 22:00–07:00 只是备着）。
func dndWindow(db *gorm.DB, userID uint) (bool, string, string) {
	enabled := false
	if def, ok := sysconfig.GetConfigDef(keyDNDEnabled); ok {
		enabled = def.Default == "true"
	}
	if v, err := sysconfig.GetConfig(db, keyDNDEnabled, userID); err == nil {
		enabled = v == "true"
	}

	start, end := "22:00", "07:00"
	if def, ok := sysconfig.GetConfigDef(keyDNDStart); ok && def.Default != "" {
		start = def.Default
	}
	if v, err := sysconfig.GetConfig(db, keyDNDStart, userID); err == nil {
		if normalized, ok := sysconfig.NormalizeClock(v); ok {
			start = normalized
		}
	}
	if def, ok := sysconfig.GetConfigDef(keyDNDEnd); ok && def.Default != "" {
		end = def.Default
	}
	if v, err := sysconfig.GetConfig(db, keyDNDEnd, userID); err == nil {
		if normalized, ok := sysconfig.NormalizeClock(v); ok {
			end = normalized
		}
	}
	return enabled, start, end
}

// inDNDWindow 判断此刻是否落在免打扰时间段里。
//
// 支持跨天：22:00–07:00 是常见写法（晚上到第二天早上），不是空区间。
// 起止相同（07:00–07:00）或整段写成 00:00–00:00 都当作**不生效** —— 那是
// 「这个时间段不要用」的意思，与「开始提醒时间」写成 00:00 就不静默同一个口径。
func inDNDWindow(now time.Time, start, end string) bool {
	startHour, startMin, ok1 := clockParts(start)
	endHour, endMin, ok2 := clockParts(end)
	if !ok1 || !ok2 {
		return false
	}
	from := startHour*60 + startMin
	to := endHour*60 + endMin
	if from == to {
		return false
	}
	local := now.In(shanghai())
	current := local.Hour()*60 + local.Minute()
	if from < to {
		return current >= from && current < to
	}
	return current >= from || current < to
}

// dndManual 读某个用户的手动免打扰开关（个人级配置，默认关）。
func dndManual(db *gorm.DB, userID uint) bool {
	if userID == 0 {
		return false
	}
	value, err := sysconfig.GetConfig(db, keyDNDManual, userID)
	if err != nil {
		return false
	}
	return value == "true"
}

// loadDNDState 组装一份完整状态（按钮显示 + 时间段时间 + 此刻是否生效 + 原因说明）。
func loadDNDState(db *gorm.DB, userID uint, now time.Time) DNDState {
	enabled, start, end := dndWindow(db, userID)
	manual := dndManual(db, userID)
	inWindow := enabled && inDNDWindow(now, start, end)
	state := DNDState{
		Manual:        manual,
		WindowEnabled: enabled,
		WindowStart:   start,
		WindowEnd:     end,
		InWindow:      inWindow,
	}
	switch {
	case manual && inWindow:
		state.Reason = "手动免打扰 + 免打扰时间段 " + start + "–" + end
	case manual:
		state.Reason = "手动免打扰"
	case inWindow:
		state.Reason = "免打扰时间段 " + start + "–" + end
	}
	state.Active = manual || inWindow
	return state
}

// dndBlocked 是投递链路上的判断：现在是不是一个通知都不该发出去。
func dndBlocked(db *gorm.DB, userID uint, now time.Time) bool {
	return loadDNDState(db, userID, now).Active
}

// handleDNDState 给首行那个喇叭/静音按钮用：一次把「手动开关 + 后台时间段 + 此刻是否生效」拿全。
func handleDNDState(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		response.Success(c, loadDNDState(db, currentUserID(c), time.Now()))
	}
}

// handleSetDND 只改手动开关（时间段在「偏好设置 → 免打扰」里改，走通用配置接口）。
func handleSetDND(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in struct {
			Manual *bool `json:"manual"`
		}
		if err := c.ShouldBindJSON(&in); err != nil || in.Manual == nil {
			response.ErrorBadRequest(c, "免打扰参数无效")
			return
		}
		value := "false"
		if *in.Manual {
			value = "true"
		}
		userID := currentUserID(c)
		if err := sysconfig.UpdateConfig(db, keyDNDManual, value, userID); err != nil {
			response.ErrorInternal(c, "保存免打扰设置失败")
			return
		}
		state := loadDNDState(db, userID, time.Now())
		logger.Info("reminder: 免打扰手动开关 user=%d manual=%v active=%v", userID, *in.Manual, state.Active)
		response.Success(c, state)
	}
}

// copySystemDNDToUsers 把旧的系统级免打扰时间段（user_id = 0）复制到每个账号。
// 只补缺：某人已经有一份自己的设置时不动（升级可重复执行）。见 register.go 的 0.40.0 迁移。
func copySystemDNDToUsers(db *gorm.DB) error {
	if err := sysconfig.InitDefaultConfigs(db); err != nil {
		return err
	}
	var users []database.User
	if err := db.Find(&users).Error; err != nil {
		return err
	}
	for _, key := range []string{keyDNDEnabled, keyDNDStart, keyDNDEnd} {
		value, err := sysconfig.GetConfig(db, key, 0)
		if err != nil {
			continue
		}
		for _, user := range users {
			if user.ID == 0 {
				continue
			}
			if _, err := sysconfig.GetConfig(db, key, user.ID); err == nil {
				continue // 这个人已经有一份（升级前手动设过 / 另一个实例同步过来）
			}
			if err := sysconfig.UpdateConfig(db, key, value, user.ID); err != nil {
				return err
			}
		}
	}
	return nil
}
