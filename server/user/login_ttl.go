package user

import (
	"strconv"
	"time"

	"gorm.io/gorm"

	"smallgo/server/sysconfig"
)

// loginTokenTTL 按「记住登录 / 不记住」算出这次登录签发的令牌有效期。
//
// 取值来自系统配置（访问控制组）：login_remember_days 默认 7 天、
// login_session_hours 默认 12 小时。配置读不到或值不合理时退回默认值——
// 登录这件事不能因为一个配置项坏了就失败。
func loginTokenTTL(db *gorm.DB, remember bool) time.Duration {
	if remember {
		return time.Duration(configInt(db, "login_remember_days", 7, 1, 3650)) * 24 * time.Hour
	}
	return time.Duration(configInt(db, "login_session_hours", 12, 1, 24*365)) * time.Hour
}

// configInt 读一个整数配置并夹到 [min,max]；读不到或解析失败就用 fallback。
func configInt(db *gorm.DB, key string, fallback, min, max int) int {
	raw, err := sysconfig.GetConfig(db, key, 0)
	if err != nil {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		return fallback
	}
	return n
}
