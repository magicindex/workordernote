package timetable

import (
	"smallgo/server/database"
	"smallgo/server/sysconfig"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func init() {
	database.RegisterModels(&Timetable{}, &TimetableEntry{}, &TimetableShare{})

	// 默认开（用户 2026-10-26：「系统内置的几个频道 默认全部开启」）：与信用卡、
	// 记事本、仪式感、提醒@他一致；关掉只隐藏、不删数据。
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "timetable_enabled", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeBool,
		Default: "true", Public: true,
		Group: "features", Label: "课程表栏目",
		Description: "在侧栏显示「课程表」栏目（可建多张表、按周几排课程与课外活动）；关掉后入口隐藏，数据保留",
	})
}

// RegisterRoutes 所有接口都在登录组里：课程表默认只属于创建者；
// 共享给他人后按 timetable_shares 的 read/write 权限放行。
func RegisterRoutes(auth *gin.RouterGroup, db *gorm.DB) {
	auth.GET("/timetable/tables", handleListTables(db))
	auth.POST("/timetable/tables", handleCreateTable(db))
	auth.GET("/timetable/tables/:id", handleGetTable(db))
	auth.PATCH("/timetable/tables/:id", handleUpdateTable(db))
	auth.DELETE("/timetable/tables/:id", handleDeleteTable(db))

	auth.POST("/timetable/tables/:id/entries", handleCreateEntry(db))
	auth.PATCH("/timetable/entries/:id", handleUpdateEntry(db))
	auth.DELETE("/timetable/entries/:id", handleDeleteEntry(db))

	auth.GET("/timetable/tables/:id/shares", handleListShares(db))
	auth.POST("/timetable/tables/:id/shares", handleAddShare(db))
	auth.PATCH("/timetable/shares/:id", handleUpdateShare(db))
	auth.DELETE("/timetable/shares/:id", handleDeleteShare(db))
}
