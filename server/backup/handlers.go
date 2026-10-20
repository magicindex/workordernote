package backup

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"smallgo/server/response"
	"smallgo/server/sysconfig"
)

// RegisterRoutes 只给管理员：备份会导出整机数据，且 WebDAV 凭据属于系统配置。
func RegisterRoutes(admin *gin.RouterGroup, db *gorm.DB) {
	admin.GET("/backup/status", func(c *gin.Context) {
		lastAt, _ := sysconfig.GetConfig(db, "backup_last_at", 0)
		status, _ := sysconfig.GetConfig(db, "backup_last_status", 0)
		detail, _ := sysconfig.GetConfig(db, "backup_last_detail", 0)
		response.Success(c, gin.H{
			"last_at":     lastAt,
			"last_status": status,
			"last_detail": detail,
			"local_dir":   localDir(db),
		})
	})
	admin.POST("/backup/run", func(c *gin.Context) {
		// 手动备份不受「自动备份」开关影响，但至少要有一个落点。
		localOn, _ := sysconfig.GetConfig(db, "backup_local_enabled", 0)
		davOn, _ := sysconfig.GetConfig(db, "backup_webdav_enabled", 0)
		if localOn != "true" && davOn != "true" {
			response.ErrorBadRequest(c, "请先开启「备份到本机」或「备份到 WebDAV」")
			return
		}
		now := time.Now()
		res, err := Run(db, now)
		if err != nil {
			setStatus(db, now, "failed", err.Error())
			response.Error(c, http.StatusInternalServerError, response.CodeInternalError, "备份失败："+err.Error())
			return
		}
		response.Success(c, res)
	})
}
