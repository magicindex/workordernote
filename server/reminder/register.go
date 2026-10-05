package reminder

import (
	"time"

	"smallgo/server/apps"
	"smallgo/server/database"
	"smallgo/server/scheduler"
	"smallgo/server/sysconfig"

	"gorm.io/gorm"
)

var appDB *gorm.DB

func init() {
	database.Upgrades = append(database.Upgrades, database.Upgrade{
		Version: "0.1.2", Name: "rename_default_site_title",
		Upgrade: func(db *gorm.DB) error {
			// Preserve administrator customisations; only migrate the old default.
			return db.Model(&database.SystemConfig{}).
				Where("user_id = ? AND key = ? AND value = ?", 0, "site_title", "Reminder").
				Update("value", "提醒事项").Error
		},
	})

	database.Upgrades = append(database.Upgrades, database.Upgrade{
		Version: "0.3.0", Name: "allow_multiple_email_bindings",
		// The old unique index on (user_id, channel) capped every channel at
		// one binding; email now keeps one row per receiving address. The
		// replacement composite index is created by AutoMigrate, so only the
		// legacy unique index needs dropping here.
		Upgrade: func(db *gorm.DB) error {
			return db.Exec("DROP INDEX IF EXISTS idx_user_channel_binding").Error
		},
	})

	database.Upgrades = append(database.Upgrades, database.Upgrade{
		Version: "0.3.2", Name: "normalize_lunar_calendar_column",
		// The old "yearly_lunar" rule spelling becomes rule=yearly plus
		// calendar=lunar, matching the new picker model where the calendar
		// is a separate choice from the repeat interval.
		Upgrade: func(db *gorm.DB) error {
			return db.Exec(`UPDATE reminders SET calendar = 'lunar', repeat_rule = 'yearly' WHERE repeat_rule = 'yearly_lunar'`).Error
		},
	})

	// 以下进入本分支（WorkOrderNote / 工作序记）自己的版本序列：从 0.0.1 起，
	// 按 major.minor.patch 递增。继承自上游的 0.1.2 / 0.3.0 / 0.3.2 三条仍保留
	// 原编号，它们由 database.isInheritedUpgrade 豁免版本比较（见 upgrade.go）。
	database.Upgrades = append(database.Upgrades, database.Upgrade{
		Version: "0.0.1", Name: "rename_default_site_title_to_workordernote",
		// 本分支把默认站点名从「提醒事项」改为「工作序记」。只改仍是旧默认值的
		// 那条记录：管理员自己起过名字的站点保持不动。
		Upgrade: func(db *gorm.DB) error {
			return db.Model(&database.SystemConfig{}).
				Where("user_id = ? AND key = ? AND value = ?", 0, "site_title", "提醒事项").
				Update("value", "工作序记").Error
		},
	})

	database.Upgrades = append(database.Upgrades, database.Upgrade{
		Version: "0.0.2", Name: "drop_stats_config",
		// 本分支移除了向上游统计端点上报的匿名使用统计，stats_enabled 这个
		// 配置项已不存在，把库里遗留的那一行删掉——否则系统配置里会永远挂着
		// 一个怎么点都不生效的开关。
		Upgrade: func(db *gorm.DB) error {
			return db.Where("key = ?", "stats_enabled").Delete(&database.SystemConfig{}).Error
		},
	})

	database.RegisterModels(
		&List{}, &Reminder{}, &ReminderChannel{}, &Completion{},
		&ChannelBinding{}, &ProviderConfig{}, &QQBindCode{}, &DeliveryJob{}, &DeliveryAttempt{}, &Notification{},
	)

	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "reminder_default_channels", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeString,
		Default: "inapp", Group: "notification", Label: "默认提醒渠道",
		Description: "新提醒默认使用的渠道，多个渠道以英文逗号分隔",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "reminder_all_day_time", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeString,
		Default: "09:00", Group: "notification", Label: "全天提醒时间",
		Description: "只有日期的提醒在当天何时通知",
	})

	apps.Register(apps.App{
		Name:        "reminder",
		DisplayName: "工作序记",
		Icon:        "check-circle",
		RoutePrefix: "/reminders",
		NavPosition: 10,
		Setup:       setupSyncPublicRoutes,
		SetupAuth:   setupAuthRoutes,
		SetupAdmin:  setupAdminRoutes,
		Migrate: func(db *gorm.DB) error {
			appDB = db
			// 同步标识的补写放在迁移之后：AutoMigrate 在这一步才加上 sync_uid 列。
			if err := BackfillSyncUIDs(db); err != nil {
				return err
			}
			return nil
		},
	})

	scheduler.Register(scheduler.Job{
		Name:       "reminder-delivery",
		Interval:   time.Minute,
		RunAtStart: true,
		Run: func() {
			if appDB != nil {
				dispatchDueJobs(appDB)
			}
		},
	})
	registerSyncScheduler()
	scheduler.Register(scheduler.Job{
		Name: "reminder-qq-gateway", Interval: 30 * time.Second,
		Run: func() {
			if appDB != nil {
				ensureQQGateway(appDB)
			}
		},
	})
}
