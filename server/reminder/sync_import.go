package reminder

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"smallgo/server/auth"
	"smallgo/server/database"
	"smallgo/server/response"
	"smallgo/server/version"
)

// 新设备导入（「从另一台设备导入」向导）。
//
// 场景：新装了一台飞牛/NAS，希望把老机器上的清单与内容搬过来。
// 步骤是：填对端地址 + 同步令牌 → 看到对端有哪些账号、各有多少数据 →
// 勾选要导入的账号（本机没有同名账号时顺便建一个）→ 拉全量 + 写好定时同步设置。
//
// 注意：同步本身按**用户名**对齐（见 sync_apply.go），所以「导入哪个账号」这件事
// 必须由人明确指定一次——自动把对端所有账号都在本机建出来，等于凭空造账号，
// 角色、密码、飞牛绑定都说不清。这个向导把这一次选择交给管理员。

// syncProfileUser 是对端某个账号的数据概览。
type syncProfileUser struct {
	Username    string `json:"username"`
	Role        string `json:"role"`
	Lists       int64  `json:"lists"`
	Reminders   int64  `json:"reminders"`
	Completions int64  `json:"completions"`
	ExistsLocal bool   `json:"exists_local"`
}

// syncProfiles 是对端自报的「有哪些账号、各有多少数据」。
type syncProfiles struct {
	InstanceID string            `json:"instance_id"`
	AppName    string            `json:"app_name"`
	Version    string            `json:"version"`
	Users      []syncProfileUser `json:"users"`
}

// buildSyncProfiles 统计本机各账号的数据量（给对端的导入向导看）。
func buildSyncProfiles(db *gorm.DB) (syncProfiles, error) {
	info := version.GetVersion()
	out := syncProfiles{
		InstanceID: "",
		AppName:    fmt.Sprint(info["appName"]),
		Version:    fmt.Sprint(info["version"]),
		Users:      []syncProfileUser{},
	}
	// 实例标识复用同步设置里的那一份（没有就现生成并存下来，见 loadSyncSettings）
	if settings, err := loadSyncSettings(db); err == nil {
		out.InstanceID = settings.InstanceID
	}

	var users []database.User
	if err := db.Order("id").Find(&users).Error; err != nil {
		return out, err
	}
	for _, u := range users {
		var lists, reminders, completions int64
		if err := db.Model(&List{}).Where("user_id = ? AND deleted_at IS NULL", u.ID).Count(&lists).Error; err != nil {
			return out, err
		}
		if err := db.Model(&Reminder{}).Where("user_id = ? AND deleted_at IS NULL", u.ID).Count(&reminders).Error; err != nil {
			return out, err
		}
		if err := db.Model(&Completion{}).Where("user_id = ?", u.ID).Count(&completions).Error; err != nil {
			return out, err
		}
		out.Users = append(out.Users, syncProfileUser{
			Username: u.Username, Role: u.Role,
			Lists: lists, Reminders: reminders, Completions: completions,
		})
	}
	return out, nil
}

// GET /reminder/sync/profiles —— 公开组但需要同步令牌：给对端的导入向导用
func handleSyncProfiles(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		profiles, err := buildSyncProfiles(db)
		if err != nil {
			response.ErrorInternal(c, "读取账号概览失败")
			return
		}
		response.Success(c, profiles)
	}
}

// fetchProfiles 从对端拉账号概览。
func (c *syncPeerClient) fetchProfiles(ctx context.Context) (syncProfiles, error) {
	var out syncProfiles
	raw, err := c.do(ctx, http.MethodGet, "/api/reminder/sync/profiles", nil, nil)
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, fmt.Errorf("对端返回的账号概览无法解析：%w", err)
	}
	return out, nil
}

// POST /reminder/admin/sync/import/preview —— 连上对端看看有哪些账号
func handleSyncImportPreview(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in struct {
			PeerURL string `json:"peer_url"`
			Token   string `json:"token"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "请求无效")
			return
		}
		client, err := newSyncPeerClient(syncSettings{PeerURL: strings.TrimSpace(in.PeerURL), Token: strings.TrimSpace(in.Token)})
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		profiles, err := client.fetchProfiles(c.Request.Context())
		if err != nil {
			response.ErrorBadRequest(c, "连接对端失败："+err.Error())
			return
		}
		// 标出本机是否已有同名账号：向导据此决定「直接用」还是「顺便建一个」
		local, err := usernameByName(db)
		if err != nil {
			response.ErrorInternal(c, "读取本机账号失败")
			return
		}
		for i := range profiles.Users {
			_, profiles.Users[i].ExistsLocal = local[profiles.Users[i].Username]
		}
		response.Success(c, profiles)
	}
}

// randomPassword 生成一个可读的随机初始密码（给导入时没填密码的账号用）。
func randomPassword() (string, error) {
	const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	var sb strings.Builder
	for i := 0; i < 12; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		sb.WriteByte(alphabet[n.Int64()])
	}
	return sb.String(), nil
}

// POST /reminder/admin/sync/import —— 执行导入：建账号（可选）+ 写同步设置 + 立刻拉一次全量
func handleSyncImport(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in struct {
			PeerURL         string            `json:"peer_url"`
			Token           string            `json:"token"`
			Usernames       []string          `json:"usernames"`
			Passwords       map[string]string `json:"passwords"`
			CreateMissing   *bool             `json:"create_missing"`
			Direction       string            `json:"direction"`
			IntervalMinutes int               `json:"interval_minutes"`
		}
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "请求无效")
			return
		}
		peerURL := strings.TrimSpace(in.PeerURL)
		token := strings.TrimSpace(in.Token)
		if peerURL == "" || token == "" {
			response.ErrorBadRequest(c, "请填写对端地址与同步令牌")
			return
		}
		if len(in.Usernames) == 0 {
			response.ErrorBadRequest(c, "请至少选择一个要导入的账号")
			return
		}
		createMissing := in.CreateMissing == nil || *in.CreateMissing

		client, err := newSyncPeerClient(syncSettings{PeerURL: peerURL, Token: token})
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		profiles, err := client.fetchProfiles(c.Request.Context())
		if err != nil {
			response.ErrorBadRequest(c, "连接对端失败："+err.Error())
			return
		}
		byName := make(map[string]syncProfileUser, len(profiles.Users))
		for _, u := range profiles.Users {
			byName[u.Username] = u
		}
		local, err := usernameByName(db)
		if err != nil {
			response.ErrorInternal(c, "读取本机账号失败")
			return
		}

		type createdAccount struct {
			Username  string `json:"username"`
			Password  string `json:"password,omitempty"`
			Generated bool   `json:"generated"`
			Role      string `json:"role"`
		}
		created := []createdAccount{}
		imported := []string{}

		for _, name := range in.Usernames {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			peerUser, ok := byName[name]
			if !ok {
				response.ErrorBadRequest(c, fmt.Sprintf("对端没有账号「%s」", name))
				return
			}
			if _, exists := local[name]; !exists {
				if !createMissing {
					response.ErrorBadRequest(c, fmt.Sprintf("本机没有账号「%s」，请先创建或勾选「自动创建」", name))
					return
				}
				pwd := strings.TrimSpace(in.Passwords[name])
				generated := false
				if pwd == "" {
					pwd, err = randomPassword()
					if err != nil {
						response.ErrorInternal(c, "生成初始密码失败")
						return
					}
					generated = true
				} else if len([]rune(pwd)) < 6 {
					response.ErrorBadRequest(c, fmt.Sprintf("账号「%s」的初始密码至少 6 位", name))
					return
				}
				hashed, err := auth.HashPassword(pwd)
				if err != nil {
					response.ErrorInternal(c, "创建账号失败")
					return
				}
				role := peerUser.Role
				if role == "" {
					role = "user"
				}
				row := database.User{
					Username: name, Password: hashed, Role: role, Status: 1,
					APIKey: auth.GenerateAPIKey(), AuthVersion: 1,
				}
				if err := db.Create(&row).Error; err != nil {
					response.ErrorBadRequest(c, fmt.Sprintf("创建账号「%s」失败：%v", name, err))
					return
				}
				entry := createdAccount{Username: name, Role: role, Generated: generated}
				if generated {
					entry.Password = pwd // 只在这次响应里回一次，前端提示管理员记下/改掉
				}
				created = append(created, entry)
			}
			imported = append(imported, name)
		}

		// 写同步设置：默认双向、5 分钟，与手工配置时同一套校验
		direction := strings.TrimSpace(in.Direction)
		if direction == "" {
			direction = "both"
		}
		interval := in.IntervalMinutes
		if interval <= 0 {
			interval = 5
		}
		if err := saveSyncSettings(db, syncSettingsInput{
			Direction: direction, PeerURL: peerURL, Token: token, IntervalMinutes: interval,
		}); err != nil {
			response.ErrorBadRequest(c, "写入同步设置失败："+err.Error())
			return
		}

		// 立刻拉一次：账号刚建好、本机还是空的，这一步就把清单与内容补齐
		result, _ := runSync(db, "import")

		response.Success(c, gin.H{
			"created_accounts": created,
			"imported_users":   imported,
			"peer":             gin.H{"instance_id": profiles.InstanceID, "app_name": profiles.AppName, "version": profiles.Version},
			"sync":             result,
		})
	}
}
