package timetable

import (
	"smallgo/server/database"
	"smallgo/server/sysconfig"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func init() {
	database.RegisterModels(&Timetable{}, &TimetableEntry{})

	// 默认关：课程表只对家里有学生的场景有用，没必要让每个安装都多一个入口。
	// 打开后侧栏出现「课程表」，关掉只隐藏、不删数据（与记事本等栏目同口径）。
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "timetable_enabled", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeBool,
		Default: "false", Public: true,
		Group: "features", Label: "课程表栏目",
		Description: "在侧栏显示「课程表」栏目（可建多张表、按周几排课程与课外活动）；关掉后入口隐藏，数据保留",
	})
}

// RegisterRoutes 所有接口都在登录组里：课程表是每个账号自己的数据，
// 读写都按 user_id 过滤，不存在管理员代管别人的表。
func RegisterRoutes(auth *gin.RouterGroup, db *gorm.DB) {
	auth.GET("/timetable/tables", handleListTables(db))
	auth.POST("/timetable/tables", handleCreateTable(db))
	auth.GET("/timetable/tables/:id", handleGetTable(db))
	auth.PATCH("/timetable/tables/:id", handleUpdateTable(db))
	auth.DELETE("/timetable/tables/:id", handleDeleteTable(db))

	auth.POST("/timetable/tables/:id/entries", handleCreateEntry(db))
	auth.PATCH("/timetable/entries/:id", handleUpdateEntry(db))
	auth.DELETE("/timetable/entries/:id", handleDeleteEntry(db))
}
