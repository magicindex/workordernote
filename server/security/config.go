package security

import "smallgo/server/sysconfig"

// 邮箱找回密码的两项系统设置。SMTP 发件配置和接收邮箱不在这里：它们沿用
// 「通知方式 → 邮件」已有的一套，避免出现两份互相打架的邮件设置。
func init() {
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "password_reset_email_enabled", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeBool,
		Default: "true", Public: true,
		Group: "security", Label: "邮箱找回密码",
		Description: "允许用户通过已绑定的接收邮箱收取验证码来重置密码；发件邮箱与接收邮箱沿用「通知方式 → 邮件」的设置",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "password_reset_code_ttl_minutes", Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeInt,
		Default: "10", Public: true,
		Group: "security", Label: "验证码有效期（分钟）",
		Description: "找回密码验证码的有效时间，可填 1–60 分钟（默认 10 分钟）",
	})
}
