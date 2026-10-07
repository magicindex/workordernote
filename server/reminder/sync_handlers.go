package reminder

import (
	"compress/gzip"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"time"

	"smallgo/server/logger"
	"smallgo/server/response"
	"smallgo/server/version"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var (
	errSyncBadEncoding = errors.New("报文声明的 gzip 编码无法解析")
	errSyncEmptyBody   = errors.New("同步报文为空")
)

// requireSyncToken 是给对端机器看的鉴权：两台机器共用一个同步令牌
// （sync_token），不走用户会话——对端没有本机的账号，也不该有。
//
// 未启用同步（方向为 off）时一律拒绝：否则任何知道默认令牌的机器都能把数据
// 推进来。这样「本机是否接受同步」就只由本机的设置决定，不需要对端配合。
func requireSyncToken(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		settings, err := loadSyncSettings(db)
		if err != nil {
			response.ErrorInternal(c, "读取同步设置失败")
			c.Abort()
			return
		}
		if !settings.enabled() {
			response.ErrorForbidden(c, "本机未启用同步：请在「系统配置 → 双机同步」里选择同步方向")
			c.Abort()
			return
		}
		if settings.Token == "" {
			response.ErrorInternal(c, "本机同步令牌为空，请重新生成")
			c.Abort()
			return
		}
		provided := strings.TrimSpace(c.GetHeader(syncTokenHeader))
		// 常量时间比较：普通字符串比较会在第一个不同的字符处返回，
		// 理论上可以被逐字节试探出令牌。
		if subtle.ConstantTimeCompare([]byte(provided), []byte(settings.Token)) != 1 {
			response.ErrorUnauthorized(c, "同步令牌不正确")
			c.Abort()
			return
		}
		c.Next()
	}
}

func setupSyncPublicRoutes(api *gin.RouterGroup, db *gorm.DB) {
	// 安卓客户端信息与 APK 下载：公开（新装的手机还没登录，扫码就得能下）
	api.GET("/reminder/android", handleAndroidClient(db))
	api.GET("/reminder/android/apk", handleAndroidDownloadAPK(db))
	api.GET("/reminder/android/qrcode", handleAndroidQRCode(db))

	peer := api.Group("/reminder/sync", requireSyncToken(db))
	peer.GET("/info", handleSyncInfo(db))
	// 账号概览：给对端的「新设备导入」向导看有哪些账号、各有多少数据
	peer.GET("/profiles", handleSyncProfiles(db))
	peer.GET("/snapshot", handleSyncSnapshot(db))
	peer.POST("/apply", handleSyncApply(db))
}

func setupSyncAdminRoutes(api *gin.RouterGroup, db *gorm.DB) {
	group := api.Group("/reminder/admin/sync")
	group.GET("", handleSyncSettings(db))
	// 新设备导入：预览对端账号 / 执行导入（建账号 + 写设置 + 立刻拉一次）
	group.POST("/import/preview", handleSyncImportPreview(db))
	group.POST("/import", handleSyncImport(db))
	group.PUT("", handleSyncSaveSettings(db))
	group.POST("/test", handleSyncTest(db))
	group.POST("/run", handleSyncRun(db))
	group.POST("/token", handleSyncRegenerateToken(db))
}

func handleSyncInfo(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		settings, err := loadSyncSettings(db)
		if err != nil {
			response.ErrorInternal(c, "读取同步设置失败")
			return
		}
		info := syncPeerInfo{
			Format: syncFormat, InstanceID: settings.InstanceID,
			AppName: version.AppName, AppVersion: version.Version,
			SiteTitle:   syncConfigValue(db, "site_title"),
			GeneratedAt: time.Now(),
		}
		var users []struct {
			Username string
			Role     string
		}
		if err := db.Table("users").Select("username, role").Find(&users).Error; err != nil {
			response.ErrorInternal(c, "读取账号失败")
			return
		}
		for _, u := range users {
			info.Users = append(info.Users, syncUser{Username: u.Username, Role: u.Role})
		}
		counts := []struct {
			model interface{}
			into  *int
		}{
			{&List{}, &info.Lists},
			{&Reminder{}, &info.Reminders},
			{&Completion{}, &info.Completions},
		}
		for _, item := range counts {
			var total int64
			if err := db.Model(item.model).Count(&total).Error; err != nil {
				response.ErrorInternal(c, "统计数据量失败")
				return
			}
			*item.into = int(total)
		}
		response.Success(c, info)
	}
}

func handleSyncSnapshot(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		snap, err := buildSyncSnapshot(db)
		if err != nil {
			response.ErrorInternal(c, "生成同步数据失败")
			return
		}
		response.Success(c, snap)
	}
}

func handleSyncApply(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, err := readSyncBody(c)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		var snap syncSnapshot
		if err := json.Unmarshal(raw, &snap); err != nil {
			response.ErrorBadRequest(c, "同步报文解析失败："+err.Error())
			return
		}
		stats, err := applySyncSnapshot(db, snap)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		publishSyncChanges(stats)

		settings, err := loadSyncSettings(db)
		if err != nil {
			response.ErrorInternal(c, "读取同步设置失败")
			return
		}
		var userCount int64
		_ = db.Table("users").Count(&userCount).Error
		receipt := syncPushReceipt{
			InstanceID: settings.InstanceID, AppName: version.AppName,
			AppVersion: version.Version, SiteTitle: syncConfigValue(db, "site_title"),
			GeneratedAt: time.Now(), Users: int(userCount), Stats: stats,
		}
		if stats.total() > 0 || stats.Skipped > 0 {
			logSyncApplied(c.ClientIP(), stats)
		}
		response.Success(c, receipt)
	}
}

func handleSyncSettings(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		settings, err := loadSyncSettings(db)
		if err != nil {
			response.ErrorInternal(c, "读取同步设置失败")
			return
		}
		response.Success(c, buildSyncSettingsView(db, settings))
	}
}

func handleSyncSaveSettings(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in syncSettingsInput
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "请求无效")
			return
		}
		if err := saveSyncSettings(db, in); err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		settings, err := loadSyncSettings(db)
		if err != nil {
			response.ErrorInternal(c, "读取同步设置失败")
			return
		}
		response.Success(c, buildSyncSettingsView(db, settings))
	}
}

func handleSyncTest(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		result, err := testSyncPeer(db)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		response.Success(c, result)
	}
}

// handleSyncRun 手动触发一次同步。
//
// 同步失败也返回 200 + result.status="error"：这个接口的返回值是给管理员看的
// 完整结果，一次同步完全可能「拉取成功、推送失败」，用 HTTP 状态码表达不了
// 这种部分成功，而把已经落地的计数丢掉更糟。前端按 status 字段决定提示颜色。
func handleSyncRun(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		result, _ := runSync(db, "manual")
		response.Success(c, result)
	}
}

func handleSyncRegenerateToken(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := newSyncUID()
		if err != nil {
			response.ErrorInternal(c, "生成同步令牌失败")
			return
		}
		if err := saveSyncSettings(db, syncSettingsInput{
			Direction:       syncConfigValue(db, "sync_direction"),
			PeerURL:         syncConfigValue(db, "sync_peer_url"),
			Token:           token,
			IntervalMinutes: atoiOrZero(syncConfigValue(db, "sync_interval_minutes")),
		}); err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		settings, err := loadSyncSettings(db)
		if err != nil {
			response.ErrorInternal(c, "读取同步设置失败")
			return
		}
		response.Success(c, buildSyncSettingsView(db, settings))
	}
}

// readSyncBody 读取同步报文。对端的报文是 gzip 过的（见 sync_client.go），
// 这里按声明的编码解压，并给解压结果设上限。
func readSyncBody(c *gin.Context) ([]byte, error) {
	var reader io.Reader = c.Request.Body
	if strings.EqualFold(c.GetHeader("Content-Encoding"), "gzip") {
		zr, err := gzip.NewReader(c.Request.Body)
		if err != nil {
			return nil, errSyncBadEncoding
		}
		defer zr.Close()
		reader = zr
	}
	raw, err := io.ReadAll(io.LimitReader(reader, syncRequestBodyLimit))
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, errSyncEmptyBody
	}
	return raw, nil
}

func logSyncApplied(clientIP string, stats syncApplyStats) {
	message := describeStats(stats)
	if len(stats.UnmappedUsers) > 0 {
		message += "；对端账号在本机不存在：" + strings.Join(stats.UnmappedUsers, "、")
	}
	logger.Info("sync: 收到来自 %s 的同步数据：%s", clientIP, message)
}

// atoiOrZero 解析配置里的整数，坏值当作 0（0 = 只手动同步）。
func atoiOrZero(raw string) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0
	}
	return value
}
