package timetable

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"smallgo/server/database"
	"smallgo/server/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	PermissionOwner = "owner"
	PermissionRead  = "read"
	PermissionWrite = "write"

	maxSharesPerTable = 20
)

// accessibleTable 找一张当前账号能看到的表：自己的，或别人共享给自己的。
// 返回值 permission 为 owner/read/write；表不存在或没共享给自己都返回 false。
func accessibleTable(db *gorm.DB, userID uint, rawID string) (Timetable, string, bool) {
	var table Timetable
	if err := db.Where("id = ?", rawID).First(&table).Error; err != nil {
		return Timetable{}, "", false
	}
	table.Periods = parsePeriods(table.PeriodsJSON)
	if len(table.Periods) == 0 {
		table.Periods = defaultPeriods()
	}
	if table.UserID == userID {
		return table, PermissionOwner, true
	}
	var share TimetableShare
	if err := db.Where("timetable_id = ? AND user_id = ?", table.ID, userID).First(&share).Error; err != nil {
		return Timetable{}, "", false
	}
	if share.Permission != PermissionWrite {
		return table, PermissionRead, true
	}
	return table, PermissionWrite, true
}

func userDisplayName(db *gorm.DB, userID uint) string {
	var user database.User
	if err := db.Select("username").First(&user, userID).Error; err != nil {
		return ""
	}
	return user.Username
}

func handleListShares(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		table, permission, ok := accessibleTable(db, userID, c.Param("id"))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "课程表不存在")
			return
		}
		if permission != PermissionOwner {
			response.ErrorForbidden(c, "只有创建者可以管理共享")
			return
		}
		type row struct {
			ID         uint      `json:"id"`
			UserID     uint      `json:"user_id"`
			Username   string    `json:"username"`
			Permission string    `json:"permission"`
			CreatedAt  time.Time `json:"created_at"`
		}
		var rows []row
		if err := db.Table("timetable_shares").
			Select("timetable_shares.id, timetable_shares.user_id, users.username, timetable_shares.permission, timetable_shares.created_at").
			Joins("JOIN users ON users.id = timetable_shares.user_id").
			Where("timetable_shares.timetable_id = ?", table.ID).
			Order("timetable_shares.id asc").Scan(&rows).Error; err != nil {
			response.ErrorInternal(c, "读取共享列表失败")
			return
		}
		out := make([]gin.H, 0, len(rows))
		for _, r := range rows {
			p := r.Permission
			if p != PermissionWrite {
				p = PermissionRead
			}
			out = append(out, gin.H{
				"id": r.ID, "user_id": r.UserID, "username": r.Username,
				"permission": p, "created_at": r.CreatedAt,
			})
		}
		response.Success(c, gin.H{"shares": out})
	}
}

func normalizeSharePermission(raw string) (string, bool) {
	switch strings.TrimSpace(raw) {
	case PermissionRead, "":
		return PermissionRead, true
	case PermissionWrite:
		return PermissionWrite, true
	default:
		return "", false
	}
}

func handleAddShare(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		table, permission, ok := accessibleTable(db, userID, c.Param("id"))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "课程表不存在")
			return
		}
		if permission != PermissionOwner {
			response.ErrorForbidden(c, "只有创建者可以共享课程表")
			return
		}
		var req struct {
			Username   string `json:"username"`
			Permission string `json:"permission"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.ErrorBadRequest(c, "请求格式不对")
			return
		}
		username := strings.TrimSpace(req.Username)
		if username == "" {
			response.ErrorBadRequest(c, "请输入对方的登录用户名")
			return
		}
		perm, valid := normalizeSharePermission(req.Permission)
		if !valid {
			response.ErrorBadRequest(c, "权限只能是只读或读写")
			return
		}
		var target database.User
		if err := db.Where("username = ? AND status = 1", username).First(&target).Error; err != nil {
			response.ErrorBadRequest(c, "没有找到这个账号")
			return
		}
		if target.ID == userID {
			response.ErrorBadRequest(c, "不能共享给自己")
			return
		}
		var existing TimetableShare
		if err := db.Where("timetable_id = ? AND user_id = ?", table.ID, target.ID).First(&existing).Error; err == nil {
			response.ErrorBadRequest(c, "已经共享给这个账号了")
			return
		}
		var count int64
		if err := db.Model(&TimetableShare{}).Where("timetable_id = ?", table.ID).Count(&count).Error; err != nil {
			response.ErrorInternal(c, "保存共享失败")
			return
		}
		if count >= maxSharesPerTable {
			response.ErrorBadRequest(c, "一张表最多共享给 20 个账号")
			return
		}
		share := TimetableShare{TimetableID: table.ID, UserID: target.ID, Permission: perm}
		if err := db.Create(&share).Error; err != nil {
			response.ErrorInternal(c, "保存共享失败")
			return
		}
		response.Success(c, gin.H{
			"id": share.ID, "user_id": target.ID, "username": target.Username,
			"permission": share.Permission, "created_at": share.CreatedAt,
		})
	}
}

func ownedShare(db *gorm.DB, userID uint, rawID string) (TimetableShare, bool) {
	var share TimetableShare
	if err := db.Where("id = ?", rawID).First(&share).Error; err != nil {
		return TimetableShare{}, false
	}
	if _, permission, ok := accessibleTable(db, userID, fmt.Sprint(share.TimetableID)); !ok || permission != PermissionOwner {
		return TimetableShare{}, false
	}
	return share, true
}

func handleUpdateShare(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		share, ok := ownedShare(db, userID, c.Param("id"))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "共享记录不存在")
			return
		}
		var req struct {
			Permission string `json:"permission"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.ErrorBadRequest(c, "请求格式不对")
			return
		}
		perm, valid := normalizeSharePermission(req.Permission)
		if !valid || strings.TrimSpace(req.Permission) == "" {
			response.ErrorBadRequest(c, "权限只能是只读或读写")
			return
		}
		if err := db.Model(&TimetableShare{}).Where("id = ?", share.ID).
			Update("permission", perm).Error; err != nil {
			response.ErrorInternal(c, "保存共享失败")
			return
		}
		response.Success(c, gin.H{"id": share.ID, "permission": perm})
	}
}

func handleDeleteShare(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		share, ok := ownedShare(db, userID, c.Param("id"))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "共享记录不存在")
			return
		}
		if err := db.Delete(&TimetableShare{}, share.ID).Error; err != nil {
			response.ErrorInternal(c, "删除共享失败")
			return
		}
		response.Success(c, gin.H{"deleted": true})
	}
}
