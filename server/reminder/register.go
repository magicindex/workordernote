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

	// 0.26.0：信用卡提醒口径修正（用户 2026-10-13）——
	//   ① 「账单日」提醒不再生成（账单日只在卡片页面用）、「还款日前 N 天提醒」也被
	//      「从账单日提醒到还款日」的新窗口取代 —— 这两类老数据在这里软删；
	//   ② 还款日提醒的到期时间原来是当天 **0 点**，改成 **23:59**（与新建提醒一致）。
	// 只动 card_id 指向的、还没删的提醒；已经完成的保持完成状态（只改时刻）。
	database.Upgrades = append(database.Upgrades, database.Upgrade{
		Version: "0.26.0", Name: "fix_card_plan_reminders",
		Upgrade: func(db *gorm.DB) error {
			now := time.Now()
			if err := db.Model(&Reminder{}).
				Where("card_id <> 0 AND card_role IN ? AND deleted_at IS NULL", []string{cardRoleStatement, cardRoleAdvance}).
				Updates(map[string]interface{}{"deleted_at": now, "updated_at": now}).Error; err != nil {
				return err
			}
			var rows []Reminder
			if err := db.Where("card_id <> 0 AND deleted_at IS NULL AND due_at IS NOT NULL").Find(&rows).Error; err != nil {
				return err
			}
			loc, _ := time.LoadLocation("Asia/Shanghai")
			for i := range rows {
				due := rows[i].DueAt.In(loc)
				if due.Hour() == cardDueClockHour && due.Minute() == cardDueClockMinute {
					continue
				}
				fixed := time.Date(due.Year(), due.Month(), due.Day(), cardDueClockHour, cardDueClockMinute, 0, 0, loc)
				if err := db.Model(&Reminder{}).Where("id = ?", rows[i].ID).
					Updates(map[string]interface{}{"due_at": fixed, "updated_at": now}).Error; err != nil {
					return err
				}
			}
			return nil
		},
	})

	database.RegisterModels(
		&List{}, &Reminder{}, &ReminderChannel{}, &Completion{},
		// 「提醒@他」：多人之间互相推的提醒消息（见 nudge.go）
		&Nudge{},
		// 信用卡：卡片与每期账单（金额/还款状态）
		&Card{}, &CardStatement{},
		&ChannelBinding{}, &ProviderConfig{}, &QQBindCode{}, &DeliveryJob{}, &DeliveryAttempt{}, &Notification{},
	)

	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "reminder_default_channels", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeString,
		Default: "inapp", Group: "reminder", Label: "默认提醒渠道",
		Description: "新提醒默认使用的渠道，多个渠道以英文逗号分隔",
	})
	// 「开始提醒时间」（用户 2026-10-12 起用、2026-10-13 明确）：**当天第一次提醒弹窗的时间**
	// —— 到期日当天的任务，从这个点就开始提醒（取「结束时间」与「当天这个点」里更早的
	// 那个，见 notify_window.go 的 firstRemindAt），之后按「提醒频率」重复；
	// 同时它也是每天的免打扰边界：0:00–这个点之间不发任何提醒（dispatcher.go 的 inQuietHours）。
	//
	// 这个键以前叫「全天提醒时间」：注册了但代码里从没读过，是个死配置。**键名保留**
	// （改键名要迁移，不值当）。**默认 00:00 = 不提前也不静默**（没设置过的安装行为不变）。
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "reminder_all_day_time", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeTime,
		Default: "00:00", Group: "reminder", Label: "开始提醒时间",
		Description: "当天第一次提醒的时间：到期日当天到这个点就先提醒一次（之后按提醒频率重复）；这个点之前不提醒",
	})
	// 「提前几天开始提醒」（用户 2026-10-13）：与「开始提醒时间」配套 —— 到期日往前数 N 天，
	// 从那天 的「开始提醒时间」起就开始提醒（提前几天，心里有数）。
	//
	// **只在「离到期日超过 N 天」时生效**：创建时就已经在 N 天之内的（今天到期、明天到期…）
	// 按正常流程走 —— 就是原来的口径，到期日当天那个「开始提醒时间」才第一次提醒。
	// 0 = 不提前（默认，老行为一点不变）。
	//
	// 窗口内**每天只在「开始提醒时间」提醒一次**（不是从三天前就按「提醒频率」每 15 分钟
	// 弹一次）；到了到期日那天，恢复「首次提醒 + 提醒频率」的老口径（见 dispatcher.go
	// 的 scheduleRepeatNotify）。
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "reminder_advance_days", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeInt,
		Default: "0", Public: true, Group: "reminder", Label: "提前几天开始提醒",
		Description: "到期日前几天开始提醒（0 = 不提前）。只在离到期日超过这个天数时生效；创建时已经在几天内的按正常流程（到期日当天的开始提醒时间）。窗口内每天只在开始提醒时间提醒一次",
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

	// 「开始提醒时间」与「提前几天开始提醒」是 30 秒进程内缓存的（它们在调度热路径上）。
	// 配置一改就让缓存失效，否则「改完设置马上新建的提醒」会按旧口径排进投递队列，
	// 而且排完就定了（要再编辑一次才会重排）—— 见 sysconfig.RegisterChangeHook。
	sysconfig.RegisterChangeHook(func(key string, userID uint) {
		if key == "reminder_all_day_time" || key == "reminder_advance_days" {
			resetWindowCache(userID)
		}
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
