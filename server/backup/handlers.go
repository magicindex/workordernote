package backup

import (
	"errors"
	"net/http"
	"path/filepath"
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

	// 恢复：先列出本机备份，再按文件名恢复，或者上传一份备份恢复。
	admin.GET("/backup/files", func(c *gin.Context) {
		files, err := ListLocal(db)
		if err != nil {
			response.ErrorInternal(c, "读取备份目录失败："+err.Error())
			return
		}
		response.Success(c, files)
	})
	admin.POST("/backup/restore", func(c *gin.Context) {
		var req struct {
			File string `json:"file"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.File == "" {
			response.ErrorBadRequest(c, "请选择要恢复的备份文件")
			return
		}
		res, err := RestoreLocal(db, req.File, time.Now())
		if err != nil {
			writeRestoreError(c, err)
			return
		}
		response.Success(c, res)
	})
	admin.POST("/backup/upload-restore", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadBytes)
		fh, err := c.FormFile("file")
		if err != nil {
			response.ErrorBadRequest(c, "请选择备份文件（上传失败或文件过大）")
			return
		}
		if fh.Size > maxUploadBytes {
			response.ErrorBadRequest(c, "备份文件过大")
			return
		}
		f, err := fh.Open()
		if err != nil {
			response.ErrorBadRequest(c, "读取上传文件失败")
			return
		}
		defer f.Close()
		res, err := RestoreUpload(db, f, filepath.Base(fh.Filename), time.Now())
		if err != nil {
			writeRestoreError(c, err)
			return
		}
		response.Success(c, res)
	})
}

func writeRestoreError(c *gin.Context, err error) {
	if errors.Is(err, errRestoreBusy) {
		response.Error(c, http.StatusConflict, response.CodeBadRequest, err.Error())
		return
	}
	response.ErrorInternal(c, "恢复失败："+err.Error())
}
