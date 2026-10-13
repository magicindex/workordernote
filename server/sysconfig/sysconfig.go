package sysconfig

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"sync"

	"gorm.io/gorm"

	"smallgo/server/database"
)

func generateJWTSecret() (string, error) {
	return randomHex(16)
}

// randomHex 生成长度为 n 字节的随机密钥的十六进制串（2n 个字符）。
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// generatedSecrets 是「默认值不是固定常量，而是每次安装随机生成」的配置项。
// 它们只在数据库里还没有这一行时生成一次：升级既有安装不会把已有身份/令牌换掉，
// 否则两台机器刚配好的同步会因为重启而失效。
var generatedSecrets = map[string]func() (string, error){
	"jwt_secret":       generateJWTSecret,
	"sync_instance_id": func() (string, error) { return randomHex(8) },
	"sync_token":       func() (string, error) { return randomHex(16) },
}

// InitDefaultConfigs seeds one row per registered system-scope config.
// Existing rows are never touched, so admin edits survive restarts.
func InitDefaultConfigs(db *gorm.DB) error {
	for _, def := range ListConfigs(ScopeSystem) {
		value := def.Default
		if gen, ok := generatedSecrets[def.Key]; ok {
			var err error
			value, err = gen()
			if err != nil {
				return fmt.Errorf("generate %s: %w", def.Key, err)
			}
		}
		var existing database.SystemConfig
		result := db.Where("user_id = ? AND key = ?", 0, def.Key).First(&existing)
		if result.Error == gorm.ErrRecordNotFound {
			row := database.SystemConfig{UserID: 0, Key: def.Key, Value: value, Public: def.Public}
			if err := db.Create(&row).Error; err != nil {
				return err
			}
		} else if result.Error != nil {
			return result.Error
		}
	}
	return nil
}

func GetPublicConfigs(db *gorm.DB) (map[string]string, error) {
	var configs []database.SystemConfig
	if err := db.Where("public = ?", true).Find(&configs).Error; err != nil {
		return nil, err
	}
	result := make(map[string]string)
	for _, c := range configs {
		if isInternalKey(c.Key) {
			continue
		}
		result[c.Key] = c.Value
	}
	return result, nil
}

func GetSystemConfigs(db *gorm.DB) (map[string]string, error) {
	var configs []database.SystemConfig
	if err := db.Where("user_id = ?", 0).Find(&configs).Error; err != nil {
		return nil, err
	}
	result := make(map[string]string)
	for _, c := range configs {
		if isInternalKey(c.Key) {
			continue
		}
		result[c.Key] = c.Value
	}
	return result, nil
}

func GetUserConfigs(db *gorm.DB, userID uint) (map[string]string, error) {
	var configs []database.SystemConfig
	if err := db.Where("user_id = ?", userID).Find(&configs).Error; err != nil {
		return nil, err
	}
	result := make(map[string]string)
	for _, c := range configs {
		result[c.Key] = c.Value
	}
	return result, nil
}

func GetConfig(db *gorm.DB, key string, userID uint) (string, error) {
	var config database.SystemConfig
	if err := db.Where("user_id = ? AND key = ?", userID, key).First(&config).Error; err != nil {
		return "", err
	}
	return config.Value, nil
}

// changeHooks 是「配置刚写完」的回调：进程内缓存的那些读取路径（例如提醒的
// 「开始提醒时间」30 秒缓存）靠它立刻失效，不用等 TTL 过期。
//
// 为什么需要：改完设置马上新建一条提醒时，缓存里还是旧值 —— 那条提醒会被按旧口径
// 排进投递队列，而且**排完就定了**（要再编辑一次才会重排），用户看到的是「我明明改了设置」。
var (
	changeHooksMu sync.Mutex
	changeHooks   []func(key string, userID uint)
)

// RegisterChangeHook 注册一个配置写入后的回调（在 init 里注册，进程内只调一次）。
func RegisterChangeHook(fn func(key string, userID uint)) {
	changeHooksMu.Lock()
	changeHooks = append(changeHooks, fn)
	changeHooksMu.Unlock()
}

// notifyConfigChanged 在配置成功写入后调用（同包内 handlers 用）。
func notifyConfigChanged(key string, userID uint) {
	changeHooksMu.Lock()
	hooks := append([]func(string, uint){}, changeHooks...)
	changeHooksMu.Unlock()
	for _, fn := range hooks {
		fn(key, userID)
	}
}

func UpdateConfig(db *gorm.DB, key string, value string, userID uint) error {
	// 时刻统一补零成 HH:MM（"6:00" → "06:00"）：它会被拼进 SQL、也会被字符串比较，
	// 同一个时刻两种写法迟早出事（见 NormalizeClock）。
	if def, ok := GetConfigDef(key); ok && def.Type == TypeTime {
		if normalized, ok := NormalizeClock(value); ok {
			value = normalized
		}
	}
	var config database.SystemConfig
	result := db.Where("user_id = ? AND key = ?", userID, key).First(&config)
	if result.Error == gorm.ErrRecordNotFound {
		config = database.SystemConfig{
			UserID: userID,
			Key:    key,
			Value:  value,
		}
		return db.Create(&config).Error
	}
	if result.Error != nil {
		return result.Error
	}
	return db.Model(&config).Update("value", value).Error
}

// ConfigMeta is the API view of a registered config definition joined with
// its effective value.
type ConfigMeta struct {
	Key         string    `json:"key"`
	Scope       Scope     `json:"scope"`
	Type        ValueType `json:"type"`
	Value       string    `json:"value"`
	Default     string    `json:"default"`
	Public      bool      `json:"public"`
	Group       string    `json:"group"`
	Label       string    `json:"label"`
	Description string    `json:"description"`
	Options     []string  `json:"options,omitempty"`
}

func buildConfigMeta(def ConfigDef, value string) ConfigMeta {
	return ConfigMeta{
		Key:         def.Key,
		Scope:       def.Scope,
		Type:        def.Type,
		Value:       value,
		Default:     def.Default,
		Public:      def.Public,
		Group:       def.Group,
		Label:       def.Label,
		Description: def.Description,
		Options:     def.Options,
	}
}
