package reminder

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"smallgo/server/sysconfig"
	"smallgo/server/version"

	"gorm.io/gorm"
)

// 双机同步的设置项。它们全部登记为 sysconfig 的 Internal 配置（见
// sysconfig/registry.go），不走通用配置接口，读写只经这里。
const (
	syncDirectionOff  = "off"
	syncDirectionPush = "push"
	syncDirectionPull = "pull"
	syncDirectionBoth = "both"
)

type syncSettings struct {
	InstanceID      string
	Token           string
	Direction       string
	PeerURL         string
	IntervalMinutes int
	LastAt          string
	LastStatus      string
	LastDetail      string
	PeerInstanceID  string
	PeerSummary     string
}

// enabled 表示本机参与了同步（接收与发起都据此放行）。off 就是关闭，
// 不再单独设一个「启用」开关：两个开关能组合出「已启用但方向是关闭」这种
// 自相矛盾的状态，用户没法判断到底同没同步。
func (s syncSettings) enabled() bool {
	return s.Direction != "" && s.Direction != syncDirectionOff
}

func (s syncSettings) pulls() bool {
	return s.Direction == syncDirectionPull || s.Direction == syncDirectionBoth
}

func (s syncSettings) pushes() bool {
	return s.Direction == syncDirectionPush || s.Direction == syncDirectionBoth
}

// syncConfigValue 读一个同步配置项，读不到时退回注册表里的默认值。
func syncConfigValue(db *gorm.DB, key string) string {
	def, ok := sysconfig.GetConfigDef(key)
	value := ""
	if ok {
		value = def.Default
	}
	if v, err := sysconfig.GetConfig(db, key, 0); err == nil && v != "" {
		value = v
	}
	return value
}

func loadSyncSettings(db *gorm.DB) (syncSettings, error) {
	interval, err := strconv.Atoi(syncConfigValue(db, "sync_interval_minutes"))
	if err != nil {
		interval = 0
	}
	s := syncSettings{
		InstanceID:      syncConfigValue(db, "sync_instance_id"),
		Token:           syncConfigValue(db, "sync_token"),
		Direction:       syncConfigValue(db, "sync_direction"),
		PeerURL:         syncConfigValue(db, "sync_peer_url"),
		IntervalMinutes: interval,
		LastAt:          syncConfigValue(db, "sync_last_at"),
		LastStatus:      syncConfigValue(db, "sync_last_status"),
		LastDetail:      syncConfigValue(db, "sync_last_detail"),
		PeerInstanceID:  syncConfigValue(db, "sync_peer_instance_id"),
		PeerSummary:     syncConfigValue(db, "sync_peer_summary"),
	}
	if s.Direction == "" {
		s.Direction = syncDirectionOff
	}
	if s.InstanceID == "" {
		// 极端情况：配置行被手工删了。生成一个并落库，否则两台机器的身份会
		// 都变成空串，LWW 的平局裁决无从下手。
		uid, err := newSyncUID()
		if err != nil {
			return s, err
		}
		if err := sysconfig.UpdateConfig(db, "sync_instance_id", uid, 0); err != nil {
			return s, err
		}
		s.InstanceID = uid
	}
	return s, nil
}

// normalizeSyncPeerURL 把用户填的地址整理成可直接请求的形式，并挡掉明显
// 填错的输入。允许带路径前缀（飞牛网关下的应用地址就是 /app/xxx）。
func normalizeSyncPeerURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	if !strings.Contains(value, "://") {
		// 常见输入：192.168.1.10:8906。补上 http://，省得用户被「格式不对」卡住。
		value = "http://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("对端地址无法解析：%v", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("对端地址必须以 http:// 或 https:// 开头")
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("对端地址缺少主机名，例如 http://192.168.1.10:8906")
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

// validateSyncToken 只做最低限度的健全性检查。令牌是两台机器共用的密钥，
// 本机无法判断对端填的是不是同一个值——不一致会在同步时以 401 明确报出来。
func validateSyncToken(token string) error {
	if len(token) < 8 {
		return fmt.Errorf("同步令牌至少 8 位；请两台机器填同一个值")
	}
	if strings.ContainsAny(token, " \t\r\n") {
		return fmt.Errorf("同步令牌不能包含空格或换行")
	}
	return nil
}

type syncSettingsInput struct {
	Direction       string `json:"direction"`
	PeerURL         string `json:"peer_url"`
	Token           string `json:"token"`
	IntervalMinutes int    `json:"interval_minutes"`
}

// saveSyncSettings 校验并落盘。任何一项不合法都整体拒绝：半套设置（例如方向
// 改成了双向但地址是错的）下次自动同步会静默失败，比直接报错更难排查。
func saveSyncSettings(db *gorm.DB, in syncSettingsInput) error {
	def, ok := sysconfig.GetConfigDef("sync_direction")
	if !ok {
		return fmt.Errorf("同步方向配置未注册")
	}
	if err := sysconfig.Validate(def, in.Direction); err != nil {
		return fmt.Errorf("同步方向取值无效")
	}
	peerURL, err := normalizeSyncPeerURL(in.PeerURL)
	if err != nil {
		return err
	}
	token := strings.TrimSpace(in.Token)
	if in.Direction != syncDirectionOff {
		if peerURL == "" {
			return fmt.Errorf("启用同步需要填写对端地址")
		}
		// 令牌留空表示「不改」：校验要看**实际生效**的那个值（新填的，或库里已有的）。
		// 只校验入参会导致「只想改对端地址、不带令牌」的调用方莫名其妙收到
		// 「令牌至少 8 位」；只看库里的又会在令牌被清空后放过一个空令牌。
		effective := token
		if effective == "" {
			effective = syncConfigValue(db, "sync_token")
		}
		if err := validateSyncToken(effective); err != nil {
			return err
		}
	}
	if in.IntervalMinutes < 0 {
		return fmt.Errorf("自动同步间隔不能为负数")
	}
	if in.IntervalMinutes > 0 && in.IntervalMinutes < 5 {
		// 低于 5 分钟没有实际价值，却能让两台机器一直在互相拉全量数据。
		return fmt.Errorf("自动同步间隔至少 5 分钟，0 表示只手动同步")
	}

	values := map[string]string{
		"sync_direction":        in.Direction,
		"sync_peer_url":         peerURL,
		"sync_interval_minutes": strconv.Itoa(in.IntervalMinutes),
	}
	// 令牌留空表示「不改」：前端不回显完整令牌，用户只改方向时不该顺手把
	// 令牌清掉。要改令牌就填入新值。
	if token != "" {
		values["sync_token"] = token
	}
	for key, value := range values {
		if err := sysconfig.UpdateConfig(db, key, value, 0); err != nil {
			return err
		}
	}
	return nil
}

// recordSyncResult 记下这次同步的结果。last_detail 存 JSON 而不是纯文本：
// 前端要按方向分别展示「拉取改了几条 / 推送改了几条」。
func recordSyncResult(db *gorm.DB, result syncResult) {
	if result.At.IsZero() {
		result.At = time.Now()
	}
	raw, err := json.Marshal(result)
	if err != nil {
		raw = []byte(`{}`)
	}
	_ = sysconfig.UpdateConfig(db, "sync_last_at", result.At.Format(time.RFC3339), 0)
	_ = sysconfig.UpdateConfig(db, "sync_last_status", result.Status, 0)
	_ = sysconfig.UpdateConfig(db, "sync_last_detail", string(raw), 0)
	if result.PeerInstanceID != "" {
		_ = sysconfig.UpdateConfig(db, "sync_peer_instance_id", result.PeerInstanceID, 0)
		summary := result.PeerAppName
		if result.PeerAppVersion != "" {
			summary = strings.TrimSpace(summary + " " + result.PeerAppVersion)
		}
		if result.PeerUsers > 0 {
			summary = fmt.Sprintf("%s（%d 个账号）", summary, result.PeerUsers)
		}
		_ = sysconfig.UpdateConfig(db, "sync_peer_summary", summary, 0)
	}
}

// syncSettingsView 是给「系统配置 → 双机同步」面板的完整视图。
type syncSettingsView struct {
	InstanceID      string      `json:"instance_id"`
	Token           string      `json:"token"`
	Direction       string      `json:"direction"`
	PeerURL         string      `json:"peer_url"`
	IntervalMinutes int         `json:"interval_minutes"`
	LastAt          string      `json:"last_at,omitempty"`
	LastStatus      string      `json:"last_status,omitempty"`
	LastResult      *syncResult `json:"last_result,omitempty"`
	PeerInstanceID  string      `json:"peer_instance_id,omitempty"`
	PeerSummary     string      `json:"peer_summary,omitempty"`
	AppVersion      string      `json:"app_version"`
	// LocalUsers 本机账号名，面板据此提示「对端有没有同名账号」。
	LocalUsers []string `json:"local_users"`
	// Running 表示此刻有同步正在跑，此时按钮应禁用。
	Running bool `json:"running"`
}

func buildSyncSettingsView(db *gorm.DB, s syncSettings) syncSettingsView {
	view := syncSettingsView{
		InstanceID:      s.InstanceID,
		Token:           s.Token,
		Direction:       s.Direction,
		PeerURL:         s.PeerURL,
		IntervalMinutes: s.IntervalMinutes,
		LastAt:          s.LastAt,
		LastStatus:      s.LastStatus,
		PeerInstanceID:  s.PeerInstanceID,
		PeerSummary:     s.PeerSummary,
		AppVersion:      version.Version,
		Running:         syncRunning.Load(),
	}
	if s.LastDetail != "" {
		var result syncResult
		if err := json.Unmarshal([]byte(s.LastDetail), &result); err == nil {
			view.LastResult = &result
		}
	}
	if users, err := usernameByID(db); err == nil {
		names := make([]string, 0, len(users))
		for _, name := range users {
			names = append(names, name)
		}
		sort.Strings(names)
		view.LocalUsers = names
	}
	return view
}
