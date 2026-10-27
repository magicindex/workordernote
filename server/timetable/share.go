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

// handleListAllShares 返回「我拥有的所有课程表」的共享名单，供批量共享弹窗一次展示。
func handleListAllShares(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		type row struct {
			ID          uint      `json:"id"`
			TimetableID uint      `json:"timetable_id"`
			TableName   string    `json:"table_name"`
			UserID      uint      `json:"user_id"`
			Username    string    `json:"username"`
			Permission  string    `json:"permission"`
			CreatedAt   time.Time `json:"created_at"`
		}
		var rows []row
		if err := db.Table("timetable_shares").
			Select("timetable_shares.id, timetable_shares.timetable_id, timetables.name AS table_name, timetable_shares.user_id, users.username, timetable_shares.permission, timetable_shares.created_at").
			Joins("JOIN timetables ON timetables.id = timetable_shares.timetable_id").
			Joins("JOIN users ON users.id = timetable_shares.user_id").
			Where("timetables.user_id = ?", userID).
			Order("timetable_shares.timetable_id asc, timetable_shares.id asc").Scan(&rows).Error; err != nil {
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
				"id": r.ID, "timetable_id": r.TimetableID, "table_name": r.TableName,
				"user_id": r.UserID, "username": r.Username,
				"permission": p, "created_at": r.CreatedAt,
			})
		}
		response.Success(c, gin.H{"shares": out})
	}
}

// handleBatchShare 勾选多张课程表，一次共享给同一个账号、同一个权限。
// 已有记录时更新权限（不再报「已共享」），方便批量调整。
func handleBatchShare(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		var req struct {
			Username     string `json:"username"`
			Permission   string `json:"permission"`
			TimetableIDs []uint `json:"timetable_ids"`
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
		ids := make([]uint, 0, len(req.TimetableIDs))
		seen := make(map[uint]bool, len(req.TimetableIDs))
		for _, id := range req.TimetableIDs {
			if id == 0 || seen[id] {
				continue
			}
			seen[id] = true
			ids = append(ids, id)
		}
		if len(ids) == 0 {
			response.ErrorBadRequest(c, "请至少选择一张课程表")
			return
		}
		if len(ids) > maxTablesPerUser {
			response.ErrorBadRequest(c, "一次最多选择 12 张课程表")
			return
		}
		var owned int64
		if err := db.Model(&Timetable{}).Where("user_id = ? AND id IN ?", userID, ids).Count(&owned).Error; err != nil {
			response.ErrorInternal(c, "保存共享失败")
			return
		}
		if int(owned) != len(ids) {
			response.ErrorForbidden(c, "只能共享自己的课程表")
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
		added, updated := 0, 0
		err := db.Transaction(func(tx *gorm.DB) error {
			for _, tableID := range ids {
				var share TimetableShare
				err := tx.Where("timetable_id = ? AND user_id = ?", tableID, target.ID).First(&share).Error
				if err == nil {
					if share.Permission != perm {
						if err := tx.Model(&TimetableShare{}).Where("id = ?", share.ID).Update("permission", perm).Error; err != nil {
							return err
						}
						updated++
					}
					continue
				}
				if err != gorm.ErrRecordNotFound {
					return err
				}
				var count int64
				if err := tx.Model(&TimetableShare{}).Where("timetable_id = ?", tableID).Count(&count).Error; err != nil {
					return err
				}
				if count >= maxSharesPerTable {
					return fmt.Errorf("有一张表已经共享给 20 个账号了")
				}
				if err := tx.Create(&TimetableShare{TimetableID: tableID, UserID: target.ID, Permission: perm}).Error; err != nil {
					return err
				}
				added++
			}
			return nil
		})
		if err != nil {
			if strings.Contains(err.Error(), "20 个账号") {
				response.ErrorBadRequest(c, err.Error())
			} else {
				response.ErrorInternal(c, "保存共享失败")
			}
			return
		}
		response.Success(c, gin.H{"added": added, "updated": updated, "user_id": target.ID, "username": target.Username, "permission": perm})
	}
}
