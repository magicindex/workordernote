package reminder

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"smallgo/server/logger"
	"smallgo/server/scheduler"

	"gorm.io/gorm"
)

// syncRunning 表示此刻有同步正在执行。同步是「取对端全量 → 合并 → 推回全量」
// 的多步操作，两次并发执行会互相看到对方处理到一半的数据；手动点击、定时任务
// 与两台机器互相触发都可能撞上，所以用一个进程内的标志串行化。
var syncRunning atomic.Bool

const syncHTTPTimeout = 150 * time.Second

// runSync 执行一次同步。无论成功失败都会把结果记进 sync_last_*，
// 前端的「上次同步」永远有据可查，而不是只在成功时才更新。
func runSync(db *gorm.DB, trigger string) (syncResult, error) {
	started := time.Now()
	settings, err := loadSyncSettings(db)
	result := syncResult{At: started, Trigger: trigger, Direction: settings.Direction, Status: "error"}
	if err != nil {
		result.Message = "读取同步设置失败：" + err.Error()
		recordSyncResult(db, result)
		return result, err
	}
	if !settings.enabled() {
		result.Message = "尚未启用同步：请先把「同步方向」设为推送、拉取或双向"
		recordSyncResult(db, result)
		return result, fmt.Errorf("%s", result.Message)
	}
	if !syncRunning.CompareAndSwap(false, true) {
		result.Message = "已有一次同步正在进行，请稍后再试"
		return result, fmt.Errorf("%s", result.Message)
	}
	defer syncRunning.Store(false)

	client, err := newSyncPeerClient(settings)
	if err != nil {
		result.Message = err.Error()
		recordSyncResult(db, result)
		return result, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), syncHTTPTimeout)
	defer cancel()

	if settings.pulls() {
		pulled, info, err := pullFromPeer(ctx, db, client)
		if err != nil {
			result.Message = "拉取失败：" + err.Error()
			result.DurationMS = time.Since(started).Milliseconds()
			recordSyncResult(db, result)
			logger.Error("sync: %s", result.Message)
			return result, err
		}
		result.Pulled = &pulled
		applyPeerInfo(&result, info, db, started)
	}

	if settings.pushes() {
		// 必须重新取一次快照：上面刚把对端的改动合并进来，这一份才是合并后的
		// 现状。两台都设成双向时，推回去之后两边就收敛到同一个状态。
		snap, err := buildSyncSnapshot(db)
		if err != nil {
			result.Message = "生成本机数据快照失败：" + err.Error()
			result.DurationMS = time.Since(started).Milliseconds()
			recordSyncResult(db, result)
			return result, err
		}
		receipt, err := client.pushSnapshot(ctx, snap, settings.InstanceID)
		if err != nil {
			result.Message = "推送失败：" + err.Error()
			result.DurationMS = time.Since(started).Milliseconds()
			recordSyncResult(db, result)
			logger.Error("sync: %s", result.Message)
			return result, err
		}
		pushed := receipt.Stats
		result.Pushed = &pushed
		applyPeerReceipt(&result, receipt, db, started)
	}

	result.Status = "ok"
	result.Message = describeSyncResult(result)
	result.DurationMS = time.Since(started).Milliseconds()
	recordSyncResult(db, result)
	logger.Info("sync: 同步完成（%s）：%s", trigger, result.Message)
	return result, nil
}

func pullFromPeer(ctx context.Context, db *gorm.DB, client *syncPeerClient) (syncApplyStats, syncPeerInfo, error) {
	snap, err := client.fetchSnapshot(ctx)
	if err != nil {
		return syncApplyStats{}, syncPeerInfo{}, err
	}
	stats, err := applySyncSnapshot(db, snap)
	if err != nil {
		return syncApplyStats{}, syncPeerInfo{}, err
	}
	// 事件在事务提交之后才发：事务回滚时不该让页面以为数据变了。
	publishSyncChanges(stats)
	return stats, snapshotInfo(snap), nil
}

func snapshotInfo(snap syncSnapshot) syncPeerInfo {
	return syncPeerInfo{
		Format: snap.Format, InstanceID: snap.InstanceID, AppName: snap.AppName,
		AppVersion: snap.AppVersion, SiteTitle: snap.SiteTitle, GeneratedAt: snap.GeneratedAt,
		Users: snap.Users, Lists: len(snap.Lists), Reminders: len(snap.Reminders),
		Completions: len(snap.Completions),
	}
}

func applyPeerInfo(result *syncResult, info syncPeerInfo, db *gorm.DB, started time.Time) {
	result.PeerInstanceID = info.InstanceID
	result.PeerAppName = info.AppName
	result.PeerAppVersion = info.AppVersion
	result.PeerSiteTitle = info.SiteTitle
	result.PeerUsers = len(info.Users)
	result.PeerClockSkewSeconds = int(info.GeneratedAt.Sub(started).Seconds())
	matched, _ := countMatchedUsers(db, info.Users)
	result.MatchedUsers = matched
}

func applyPeerReceipt(result *syncResult, receipt syncPushReceipt, db *gorm.DB, started time.Time) {
	if result.PeerInstanceID == "" {
		result.PeerInstanceID = receipt.InstanceID
		result.PeerAppName = receipt.AppName
		result.PeerAppVersion = receipt.AppVersion
		result.PeerSiteTitle = receipt.SiteTitle
		result.PeerClockSkewSeconds = int(receipt.GeneratedAt.Sub(started).Seconds())
	}
	// 推送方向的「对端有几个账号、匹配上几个」由对端的回执反推：回执里只带
	// 未匹配的账号名，本机据此提示用户去对端建号。
	if result.PeerUsers == 0 {
		result.PeerUsers = receipt.Users
	}
	if receipt.Users > 0 {
		unmatched := len(receipt.Stats.UnmappedUsers)
		result.MatchedUsers = 0
		if receipt.Users > unmatched {
			result.MatchedUsers = receipt.Users - unmatched
		}
	}
}

// describeSyncResult 生成一句人话，用于日志与「上次同步」摘要。
func describeSyncResult(result syncResult) string {
	parts := make([]string, 0, 2)
	if result.Pulled != nil {
		parts = append(parts, "从对端拉取 "+describeStats(*result.Pulled))
	}
	if result.Pushed != nil {
		parts = append(parts, "推送到对端 "+describeStats(*result.Pushed))
	}
	text := strings.Join(parts, "；")
	if unmapped := result.unmappedUsers(); len(unmapped) > 0 {
		text += fmt.Sprintf("；对端有、本机没有的账号：%s（这些数据被跳过）",
			strings.Join(unmapped, "、"))
	}
	if text == "" {
		text = "没有可同步的方向"
	}
	return text
}

// unmappedUsers 汇总两个方向报回来的未匹配账号，供摘要提示。
func (r syncResult) unmappedUsers() []string {
	seen := map[string]bool{}
	out := []string{}
	for _, stats := range []*syncApplyStats{r.Pulled, r.Pushed} {
		if stats == nil {
			continue
		}
		for _, name := range stats.UnmappedUsers {
			if !seen[name] {
				seen[name] = true
				out = append(out, name)
			}
		}
	}
	return out
}

func describeStats(stats syncApplyStats) string {
	return fmt.Sprintf("新增 %d / 更新 %d / 删除 %d / 跳过 %d",
		stats.ListsCreated+stats.RemindersCreated+stats.CompletionsCreated,
		stats.ListsUpdated+stats.RemindersUpdated,
		stats.ListsDeleted+stats.RemindersDeleted,
		stats.Skipped)
}

func countMatchedUsers(db *gorm.DB, peerUsers []syncUser) (matched int, missing []string) {
	local, err := usernameByName(db)
	if err != nil {
		return 0, nil
	}
	for _, u := range peerUsers {
		if _, ok := local[u.Username]; ok {
			matched++
		} else {
			missing = append(missing, u.Username)
		}
	}
	return matched, missing
}

// syncTestResult 是「测试连接」的返回：对端是谁、版本、账号能不能配上、
// 时钟差多少。时钟差单独报出来，因为双向同步靠时间戳裁决谁更新，
// 两台机器差得多了会出现「刚改完又被旧数据盖回去」。
type syncTestResult struct {
	InstanceID       string    `json:"instance_id"`
	AppName          string    `json:"app_name"`
	AppVersion       string    `json:"app_version"`
	SiteTitle        string    `json:"site_title"`
	PeerUsers        []string  `json:"peer_users"`
	MatchedUsers     []string  `json:"matched_users"`
	MissingUsers     []string  `json:"missing_users"`
	Lists            int       `json:"lists"`
	Reminders        int       `json:"reminders"`
	Completions      int       `json:"completions"`
	ClockSkewSeconds int       `json:"clock_skew_seconds"`
	CheckedAt        time.Time `json:"checked_at"`
}

func testSyncPeer(db *gorm.DB) (syncTestResult, error) {
	settings, err := loadSyncSettings(db)
	if err != nil {
		return syncTestResult{}, err
	}
	client, err := newSyncPeerClient(settings)
	if err != nil {
		return syncTestResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	started := time.Now()
	info, err := client.fetchInfo(ctx)
	if err != nil {
		return syncTestResult{}, err
	}
	if info.InstanceID == settings.InstanceID {
		return syncTestResult{}, fmt.Errorf("对端实例标识与本机相同：对端地址填成了本机自己")
	}
	if info.Format != syncFormat {
		return syncTestResult{}, fmt.Errorf("对端报文版本 %d 与本机 %d 不兼容，请先把两端升级到同一版本", info.Format, syncFormat)
	}
	out := syncTestResult{
		InstanceID: info.InstanceID, AppName: info.AppName, AppVersion: info.AppVersion,
		SiteTitle: info.SiteTitle, Lists: info.Lists, Reminders: info.Reminders,
		Completions:      info.Completions,
		ClockSkewSeconds: int(info.GeneratedAt.Sub(started).Seconds()),
		CheckedAt:        time.Now(),
		// 三个列表显式初始化成空切片：Go 的 nil 切片会序列化成 null，
		// 前端写 `peer_users.length` 时就会在「一个都没匹配上」的分支上直接抛异常
		// （实测：账号全部匹配时 missing_users 是 null，整块面板当场白掉）。
		PeerUsers:    []string{},
		MatchedUsers: []string{},
		MissingUsers: []string{},
	}
	local, err := usernameByName(db)
	if err == nil {
		for _, u := range info.Users {
			out.PeerUsers = append(out.PeerUsers, u.Username)
			if _, ok := local[u.Username]; ok {
				out.MatchedUsers = append(out.MatchedUsers, u.Username)
			} else {
				out.MissingUsers = append(out.MissingUsers, u.Username)
			}
		}
	}
	return out, nil
}

// autoSyncTick 是定时任务的每一次心跳：只在「已启用 + 配了间隔 + 距上次同步
// 够久」时才真的同步。用一分钟的心跳去逼近用户设置的间隔，而不是为每个间隔值
// 注册一个定时器——间隔改了不必重建调度器。
func autoSyncTick(db *gorm.DB) {
	if db == nil {
		return
	}
	settings, err := loadSyncSettings(db)
	if err != nil || !settings.enabled() || settings.IntervalMinutes <= 0 {
		return
	}
	if settings.LastAt != "" {
		if last, err := time.Parse(time.RFC3339, settings.LastAt); err == nil {
			if time.Since(last) < time.Duration(settings.IntervalMinutes)*time.Minute {
				return
			}
		}
	}
	if syncRunning.Load() {
		return
	}
	if _, err := runSync(db, "auto"); err != nil {
		logger.Warn("sync: 自动同步失败：%v", err)
	}
}

// registerSyncScheduler 注册自动同步的心跳任务。
func registerSyncScheduler() {
	scheduler.Register(scheduler.Job{
		Name: "reminder-sync", Interval: time.Minute, RunAtStart: true,
		Run: func() { autoSyncTick(appDB) },
	})
}
