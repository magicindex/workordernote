package database

import "time"

type User struct {
	ID       uint   `gorm:"primarykey"`
	Username string `gorm:"uniqueIndex;not null"`
	Password string `gorm:"not null"`
	Role     string `gorm:"default:user"`
	Status   int    `gorm:"default:1"`
	APIKey   string
	// CalendarToken 是手机日历订阅地址里的随机令牌（只读 ICS 用）。空 = 还没生成。
	// 普通索引而不是唯一索引：AutoMigrate 会给历史行补空串，多行空串建不出唯一索引。
	CalendarToken string `gorm:"size:64;index" json:"-"`
	AuthVersion   uint   `gorm:"not null;default:1"`
	FnOSUserID    *uint  `gorm:"uniqueIndex"`
	FnOSUsername  string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// UserSession 记录「用户在应用里主动退出登录」这件事，而不是记录登录本身。
//
// 为什么需要它：飞牛网关域上服务端每个请求都能从 X-Trim-Userid 认出 NAS 用户，
// 于是只要 NAS 会话还在，就永远能隐式认回应用账号——本地登出会被下一次请求
// 重新认回来（前端因此干脆把退出按钮藏了，用户 2026-09-17 强烈反对）。
// 第三方登录（QQ/微信）的常识是：授权只用来确定「你是哪个应用账号」，
// 应用自己的会话必须能独立退出。所以网关隐式认人之前先看这张表：
// 该用户主动登出后，网关身份不再自动换登录态，必须重新走一次显式登录
// （点「使用飞牛 NAS 登录」或输应用账号密码）。
type UserSession struct {
	UserID uint `gorm:"primarykey"`
	// Suppressed 为 true 表示该用户的网关隐式登录被抑制，直到他显式登录。
	Suppressed bool
	// SuppressedAt 是抑制发生的时间，仅用于排查。
	SuppressedAt time.Time
	UpdatedAt    time.Time
}

type SystemConfig struct {
	ID        uint   `gorm:"primarykey"`
	UserID    uint   `gorm:"default:0;uniqueIndex:idx_user_key"`
	Key       string `gorm:"not null;uniqueIndex:idx_user_key"`
	Value     string
	Public    bool `gorm:"default:false"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

type UpgradeRecord struct {
	ID         uint   `gorm:"primarykey"`
	Version    string `gorm:"not null;index"`
	Name       string
	UpgradedAt time.Time
}

// AuditLog records a security- or admin-relevant action for later review.
type AuditLog struct {
	ID         uint   `gorm:"primarykey"`
	UserID     uint   `gorm:"index"`
	Username   string `gorm:"index"`
	Action     string `gorm:"index;not null"`
	TargetType string `gorm:"index"`
	TargetID   uint
	Detail     string
	IP         string
	CreatedAt  time.Time `gorm:"index"`
}

type SecurityQuestion struct {
	ID        uint `gorm:"primarykey"`
	UserID    uint `gorm:"not null;uniqueIndex"`
	Question1 string
	Answer1   string
	Question2 string
	Answer2   string
	Question3 string
	Answer3   string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// PasswordResetCode 是一次性的邮箱验证码。只存 bcrypt 哈希，不存明文；
// consumed_at 非空表示已使用，attempts 记录输错次数；每个用户只保留最新一条，发新码会覆盖旧码。
// 找回密码只依赖「通知方式 → 邮件」里已绑定的接收邮箱，不再有安全问题。
type PasswordResetCode struct {
	ID         uint      `gorm:"primarykey"`
	UserID     uint      `gorm:"not null;index"`
	CodeHash   string    `gorm:"not null"`
	ExpiresAt  time.Time `gorm:"not null;index"`
	Attempts   int       `gorm:"not null;default:0"`
	ConsumedAt *time.Time
	CreatedAt  time.Time
}
