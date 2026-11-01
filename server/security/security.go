package security

import (
	"crypto/rand"
	"errors"
	"fmt"
	"log"
	"math/big"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"smallgo/server/auth"
	"smallgo/server/database"
	"smallgo/server/response"
	"smallgo/server/sysconfig"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	configEmailResetEnabled = "password_reset_email_enabled"
	configCodeTTLMinutes    = "password_reset_code_ttl_minutes"

	defaultCodeTTLMinutes = 10
	maxCodeTTLMinutes     = 60
	codeCooldown          = time.Minute
	maxCodeAttempts       = 5
	codeLength            = 6
)

var (
	errEmailResetDisabled = errors.New("邮箱找回密码已关闭，请联系管理员")
	errInvalidResetCode   = errors.New("验证码无效或已过期，请重新获取")
	errTooManyAttempts    = errors.New("验证码错误次数过多，请重新获取")
)

// recoveryMailer 给用户所有 active 接收邮箱发一封纯文本邮件。
// sent=false 表示这个账号没有绑定邮箱；调用方不应把这个结果直接暴露给访客，
// 否则接口会变成「用户名是否存在/有没有邮箱」的探测器。
type recoveryMailer func(db *gorm.DB, userID uint, subject, body string) (sent bool, err error)

// 由 main.go 注入 reminder.SendMailToUser。security 不能直接 import reminder：
// reminder 的测试 import 根 server 包，而根 server 包 import security，
// 直接依赖会绕成 test import cycle。
var sendRecoveryMail recoveryMailer = func(*gorm.DB, uint, string, string) (bool, error) {
	return false, nil
}

func SetRecoveryMailer(fn recoveryMailer) {
	if fn != nil {
		sendRecoveryMail = fn
	}
}

func emailResetEnabled(db *gorm.DB) bool {
	value, err := sysconfig.GetConfig(db, configEmailResetEnabled, 0)
	return err != nil || value != "false"
}

func resetCodeTTL(db *gorm.DB) time.Duration {
	value, err := sysconfig.GetConfig(db, configCodeTTLMinutes, 0)
	if err != nil {
		return defaultCodeTTLMinutes * time.Minute
	}
	minutes, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || minutes < 1 || minutes > maxCodeTTLMinutes {
		return defaultCodeTTLMinutes * time.Minute
	}
	return time.Duration(minutes) * time.Minute
}

func validateNewPassword(password string) error {
	if utf8.RuneCountInString(password) < 6 {
		return fmt.Errorf("密码长度不能少于6位")
	}
	if len(password) > 72 {
		return fmt.Errorf("密码长度不能超过72字节")
	}
	return nil
}

func newResetCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", codeLength, n.Int64()), nil
}

func activeUserByName(db *gorm.DB, username string) (*database.User, error) {
	var user database.User
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := db.Where("username = ? AND status = ?", username, 1).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// issueResetCode 生成验证码并发送。返回 sent=false 时，调用方仍要回统一的
// 「已发送」提示：用户不存在、没绑邮箱、刚发过都在这一层被抹平。
func issueResetCode(db *gorm.DB, username string) (bool, error) {
	user, err := activeUserByName(db, username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}

	var last database.PasswordResetCode
	if err := db.Where("user_id = ? AND consumed_at IS NULL", user.ID).
		Order("created_at DESC").First(&last).Error; err == nil &&
		time.Since(last.CreatedAt) < codeCooldown {
		return false, nil
	}

	code, err := newResetCode()
	if err != nil {
		return false, err
	}
	hash, err := auth.HashPassword(code)
	if err != nil {
		return false, err
	}
	ttl := resetCodeTTL(db)
	row := database.PasswordResetCode{
		UserID:    user.ID,
		CodeHash:  hash,
		ExpiresAt: time.Now().Add(ttl),
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", user.ID).Delete(&database.PasswordResetCode{}).Error; err != nil {
			return err
		}
		return tx.Create(&row).Error
	}); err != nil {
		return false, err
	}

	subject := "工作序记｜找回密码验证码"
	body := fmt.Sprintf("你正在找回工作序记的登录密码。\r\n\r\n验证码：%s\r\n有效期：%d 分钟\r\n\r\n如果不是你本人操作，请忽略这封邮件。",
		code, int(ttl/time.Minute))
	sent, err := sendRecoveryMail(db, user.ID, subject, body)
	if err != nil {
		_ = db.Delete(&row).Error
		return false, err
	}
	if !sent {
		_ = db.Delete(&row).Error
		return false, nil
	}
	return true, nil
}

func ResetPasswordByEmail(db *gorm.DB, username, code, newPassword string) error {
	if err := validateNewPassword(newPassword); err != nil {
		return err
	}
	user, err := activeUserByName(db, username)
	if err != nil {
		return errInvalidResetCode
	}

	var row database.PasswordResetCode
	if err := db.Where("user_id = ? AND consumed_at IS NULL", user.ID).
		Order("created_at DESC").First(&row).Error; err != nil {
		return errInvalidResetCode
	}
	if time.Now().After(row.ExpiresAt) {
		_ = db.Delete(&row).Error
		return errInvalidResetCode
	}
	if row.Attempts >= maxCodeAttempts {
		return errTooManyAttempts
	}
	if !auth.VerifyPassword(row.CodeHash, strings.TrimSpace(code)) {
		_ = db.Model(&row).UpdateColumn("attempts", gorm.Expr("attempts + 1")).Error
		return errInvalidResetCode
	}

	hash, err := auth.HashPassword(newPassword)
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		consumed := tx.Model(&database.PasswordResetCode{}).
			Where("id = ? AND consumed_at IS NULL", row.ID).
			Update("consumed_at", time.Now())
		if consumed.Error != nil {
			return consumed.Error
		}
		if consumed.RowsAffected != 1 {
			return errInvalidResetCode
		}
		if err := tx.Model(&database.User{}).Where("id = ?", user.ID).Updates(map[string]interface{}{
			"password":     hash,
			"auth_version": gorm.Expr("auth_version + 1"),
		}).Error; err != nil {
			return err
		}
		return tx.Where("user_id = ?", user.ID).Delete(&database.PasswordResetCode{}).Error
	})
}

func handleSendCode(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Username string `json:"username" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.ErrorBadRequest(c, "请输入用户名")
			return
		}
		if !emailResetEnabled(db) {
			response.ErrorBadRequest(c, errEmailResetDisabled.Error())
			return
		}
		if _, err := issueResetCode(db, req.Username); err != nil {
			// 发送失败也不能把「账号存在/不存在」暴露给访客：统一回成功，
			// 具体 SMTP 错误只写服务端日志，由管理员在通知方式页排查。
			log.Printf("security: send password reset code: %v", err)
		}
		response.Success(c, gin.H{"expires_in": int(resetCodeTTL(db) / time.Second)})
	}
}

func handleEmailReset(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Username    string `json:"username" binding:"required"`
			Code        string `json:"code" binding:"required"`
			NewPassword string `json:"new_password" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.ErrorBadRequest(c, "请填写用户名、验证码和新密码")
			return
		}
		if !emailResetEnabled(db) {
			response.ErrorBadRequest(c, errEmailResetDisabled.Error())
			return
		}
		if err := ResetPasswordByEmail(db, req.Username, req.Code, req.NewPassword); err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		response.Success(c, nil)
	}
}

// RegisterRoutes 只保留邮箱验证码找回密码。安全问题流程已移除：
// 旧 security_questions 表仅作历史数据保留，账号删除时仍会清理。
func RegisterRoutes(public *gin.RouterGroup, db *gorm.DB) {
	public.POST("/security/forgot/send-code", handleSendCode(db))
	public.POST("/security/forgot/email-reset", handleEmailReset(db))
}
