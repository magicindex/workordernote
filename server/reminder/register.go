package reminder

import (
	"time"

	"smallgo/server/apps"
	"smallgo/server/database"
	"smallgo/server/scheduler"
	"smallgo/server/sysconfig"
	"smallgo/server/timetable"

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

	// 0.40.0：免打扰时间段从系统配置（user_id=0）改成个人偏好。老库里的系统级设置
	// 一次性抄给每个现有用户，免得升级后「本来开着的静默时段」悄悄变成关。
	// 之后各改各的：新用户从注册表默认值开始（默认关），互不影响。
	database.Upgrades = append(database.Upgrades, database.Upgrade{
		Version: "0.40.0", Name: "dnd_window_to_user_scope",
		Upgrade: func(db *gorm.DB) error {
			var userIDs []uint
			if err := db.Table("users").Pluck("id", &userIDs).Error; err != nil {
				return err
			}
			for _, userID := range userIDs {
				if userID == 0 {
					continue
				}
				for _, key := range []string{"dnd_enabled", "dnd_start_time", "dnd_end_time"} {
					var exists int64
					if err := db.Model(&database.SystemConfig{}).
						Where("user_id = ? AND key = ?", userID, key).Count(&exists).Error; err != nil {
						return err
					}
					if exists > 0 {
						continue
					}
					var src database.SystemConfig
					if err := db.Where("user_id = ? AND key = ?", 0, key).First(&src).Error; err != nil {
						continue // 老库没有这一项：交给注册表默认值
					}
					if err := db.Create(&database.SystemConfig{
						UserID: userID, Key: key, Value: src.Value, Public: true,
					}).Error; err != nil {
						return err
					}
				}
			}
			return nil
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
		Version: "0.40.0", Name: "dnd_window_to_user_scope",
		// 免打扰时间段 2026-10-19 由「系统配置」挪到「偏好设置」，改成每人一份。
		// 上线前管理员设过的那份值（user_id = 0）复制给现有每个账号，
		// 免得升级后所有人突然都不再免打扰；之后各改各的，互不影响。
		Upgrade: func(db *gorm.DB) error {
			return copySystemDNDToUsers(db)
		},
	})

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

	// 0.27.0：用户 2026-10-13 要求「打开默认显示页」＝新的「首页」看板，所以把老库里
	// 显式写成 list 的默认首页一并改到 home（这条只改**恰好是旧默认值 list** 的行；
	// 已经手动改成 calendar 的不动；改完用户仍可在偏好设置里改回去）。
	database.Upgrades = append(database.Upgrades, database.Upgrade{
		Version: "0.27.0", Name: "default_view_home_dashboard",
		Upgrade: func(db *gorm.DB) error {
			// 用显式 SQL：Model(&SystemConfig{}) 这种复合主键（user_id + key）的模型，
			// 传空结构体时 GORM 会带上零值主键条件，导致一条都匹配不上（本轮就踩了：
			// 迁移记录了、值却没改）。这里要改的是**用户自己那条**（user_id = 1 之类），
			// 所以不能按 user_id = 0 限定。
			return db.Exec("UPDATE system_configs SET value = ? WHERE key = ? AND value = ?",
				"home", "default_view", "list").Error
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

	// 免打扰（用户 2026-10-16）：「首行铃铛（消息）旁边放一个喇叭标志，点击进入静音标志，
	// 退出显示喇叭，点击进入免打扰模式。后台增加免打扰时间段。」
	//
	// 这里登记的是**时间段**那半边（个人级：每个人在「偏好设置 → 免打扰」里改，2026-10-19
	// 从系统配置挪过来），跨天写法（22:00–07:00）按跨天解释；起止写一样＝不启用时间段。
	// 总开关**默认关**：打开后夜里到清晨的提醒会整段不发（改变现有行为），由用户自己决定。
	// 手动开关那半边是个人级 dnd_manual（下面那条，Internal），只走 /reminder/dnd 接口。
	// 「权责级别优先在所有通知以上」的四个口子见 dnd.go 的文件头注释。
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "dnd_enabled", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeBool,
		Default: "false", Group: "dnd", Label: "免打扰时间段",
		Description: "打开后这段时间内不发任何提醒（含逾期提醒、提醒@他、投递队列里的提醒），通知只记进通知中心，到点后照常发",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "dnd_start_time", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeTime,
		Default: "22:00", Group: "dnd", Label: "免打扰开始时间",
		Description: "从这个时间开始安静；允许晚于结束时间表示跨天，例如 22:00 到第二天 07:00",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: "dnd_end_time", Scope: sysconfig.ScopeUser, Type: sysconfig.TypeTime,
		Default: "07:00", Group: "dnd", Label: "免打扰结束时间",
		Description: "到这个时间结束；与开始时间填成一样表示不用这个时间段",
	})
	// 个人级手动开关：Internal（不出现在任何配置列表里，也不能经通用配置接口读写），
	// 只由 /api/reminder/dnd 读写 —— 与双机同步那批设置项同一个范式。
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keyDNDManual, Scope: sysconfig.ScopeUser, Type: sysconfig.TypeBool,
		Default: "false", Internal: true, Group: "dnd", Label: "手动免打扰",
		Description: "首行那个喇叭/静音按钮的状态（在页面上点按钮切换）",
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
			return timetable.BackfillSyncUIDs(db)
		},
	})

	// 「开始提醒时间」与「提前几天开始提醒」是 30 秒进程内缓存的（它们在调度热路径上）。
	// 配置一改就让缓存失效，否则「改完设置马上新建的提醒」会按旧口径排进投递队列，
	// 而且排完就定了（要再编辑一次才会重排）—— 见 sysconfig.RegisterChangeHook。
	sysconfig.RegisterChangeHook(func(key string, userID uint) {
		if key == "reminder_all_day_time" || key == "reminder_advance_days" {
			resetWindowCache(userID)
		}
		// 栏目开关是 2 秒进程内缓存；改完设置要立刻按新值过滤，不能等缓存过期。
		switch key {
		case "credit_card_enabled":
			resetCardFeatureCache()
		case "ceremony_enabled":
			resetCeremonyFeatureCache()
		case "notebook_enabled":
			resetNoteFeatureCache()
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
