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

	// 0.15.2：把历史上录入的**记事**（kind=note）全部归到「记事本」栏目。
	// 用户要求「把以前录入的记事本信息也调整到当前栏目中，时间不修改，内容不变」——
	// 只改 list_id，其余字段（时间、标题、备注、completed_at）一个字都不动。
	// 每个用户各自建/复用自己的记事本栏目；重复执行是幂等的（已经在里面的不会再动）。
	database.Upgrades = append(database.Upgrades, database.Upgrade{
		Version: "0.15.2", Name: "move_notes_into_notebook_bucket",
		Upgrade: func(db *gorm.DB) error {
			var userIDs []uint
			if err := db.Model(&Reminder{}).
				Where("kind = ? AND deleted_at IS NULL", KindNote).
				Distinct().Pluck("user_id", &userIDs).Error; err != nil {
				return err
			}
			for _, userID := range userIDs {
				bucket, err := ensureNoteBucket(db, userID)
				if err != nil {
					return err
				}
				if err := db.Model(&Reminder{}).
					Where("user_id = ? AND kind = ? AND deleted_at IS NULL AND list_id <> ?", userID, KindNote, bucket.ID).
					Update("list_id", bucket.ID).Error; err != nil {
					return err
				}
			}
			return nil
		},
	})

	database.RegisterModels(
		&List{}, &Reminder{}, &ReminderChannel{}, &Completion{},
		// 信用卡：卡片与每期账单（金额/还款状态）
		&Card{}, &CardStatement{},
		&ChannelBinding{}, &ProviderConfig{}, &QQBindCode{}, &DeliveryJob{}, &DeliveryAttempt{}, &Notification{},
	)

	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "reminder_default_channels", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeString,
		Default: "inapp", Group: "notification", Label: "默认提醒渠道",
		Description: "新提醒默认使用的渠道，多个渠道以英文逗号分隔",
	})
	// 「开始提醒时间」（用户 2026-10-12 要求）：**每天这个时间之前不发任何提醒**，
	// 类似手机的免打扰 —— 0:00 起静默，到这个点之后才把到点的提醒依次通知出去
	// （到点的、全天的、逾期的都算，见 dispatcher.go 的 inQuietHours）。
	//
	// 这个键以前叫「全天提醒时间」：注册了但代码里从没读过，是个死配置。语义按用户
	// 要求改成「开始提醒时间」，**键名保留**（改键名要迁移，不值当）。
	//
	// **默认 00:00 = 不静默**（老用户 / 没设置过的安装行为完全不变）；用户自己在
	// 偏好设置里填了 06:00 之类才生效（他这台机器上库里已有 08:00）。
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "reminder_all_day_time", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeTime,
		Default: "00:00", Group: "notification", Label: "开始提醒时间",
		Description: "每天这个时间之前不提醒（相当于免打扰）；00:00 = 不静默。到点后按各自的提醒时间依次通知",
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
	// 背景图兜底回收（用户 2026-10-13）：卡片被**对端同步删除**时走的是墓碑落库、
	// 不经过 API 的清理钩子，靠这个每天一次的回收把没人引用的上传图片删掉（见 background.go）。
	scheduler.Register(scheduler.Job{
		Name:     "reminder-background-gc",
		Interval: 24 * time.Hour,
		Run: func() {
			if appDB != nil {
				gcUnreferencedBackgrounds(appDB)
			}
		},
	})
	// 逾期提醒（用户 2026-10-12）：到期日当天过了「逾期提醒时间」还没完成的任务，
	// 各发一条站内提醒（每个任务每天最多一条，见 notify_window.go）。
	scheduler.Register(scheduler.Job{
		Name:     "reminder-overdue-notify",
		Interval: time.Minute,
		Run: func() {
			if appDB != nil {
				notifyOverdue(appDB)
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
