package sysconfig

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Scope identifies who a config belongs to: the whole installation (system,
// admin-managed) or an individual user.
type Scope string

const (
	ScopeSystem Scope = "system"
	ScopeUser   Scope = "user"
)

// ValueType describes the syntax of a config value for validation and UI
// rendering.
type ValueType string

const (
	TypeString ValueType = "string"
	TypeBool   ValueType = "bool"
	TypeInt    ValueType = "int"
	TypeSelect ValueType = "select"
	// TypeTime 是「一天里的某个时刻」HH:MM（0-23:0-59）。前端渲染成原生
	// <input type="time">，服务端校验并统一补零成 HH:MM（"6:00" → "06:00"）。
	TypeTime ValueType = "time"
)

// sunLocationOptions 是「日出日落位置」可选城市。
//
// 这里是**校验用的取值表**，只认 id；中文名与经纬度在前端
// web/src/utils/sun.ts 的 SUN_CITIES 里。两边必须一一对应：后端多一个 id，
// 用户在设置里选了会存进去、但前端算不出坐标（会退回默认城市）；
// 前端多一个 id，则设置里根本选不到。改城市时两个文件一起改。
//
// 顺序按直辖市 → 华东 → 华南 → 华中 → 华北 → 东北 → 西北 → 西南排，
// 下拉框里看着顺一点，不是字典序。
func sunLocationOptions() []string {
	return []string{
		"beijing", "shanghai", "tianjin", "chongqing",
		"nanjing", "suzhou", "wuxi", "changzhou", "nantong", "yangzhou", "xuzhou", "kunshan",
		"hangzhou", "ningbo", "wenzhou", "hefei", "fuzhou", "xiamen", "nanchang",
		"jinan", "qingdao", "yantai",
		"guangzhou", "shenzhen", "dongguan", "foshan", "zhuhai", "shantou", "nanning", "haikou",
		"wuhan", "changsha", "zhengzhou", "luoyang",
		"shijiazhuang", "taiyuan", "hohhot",
		"shenyang", "dalian", "changchun", "harbin",
		"xian", "lanzhou", "xining", "yinchuan", "urumqi",
		"chengdu", "kunming", "guiyang", "lhasa",
	}
}

// ConfigDef is the static definition of a registered config key.
type ConfigDef struct {
	Key         string
	Scope       Scope
	Type        ValueType
	Default     string
	Public      bool
	Internal    bool
	Group       string
	Label       string
	Description string
	Options     []string
}

var configRegistry = map[string]ConfigDef{}

// RegisterConfig adds a config definition. It panics on duplicate keys —
// registration happens in init() so a duplicate is a programming error that
// must surface immediately.
func RegisterConfig(def ConfigDef) {
	if _, exists := configRegistry[def.Key]; exists {
		panic(fmt.Sprintf("sysconfig: duplicate config key %q", def.Key))
	}
	configRegistry[def.Key] = def
}

// ListConfigs returns all registered definitions for a scope, sorted by key
// for deterministic output.
func ListConfigs(scope Scope) []ConfigDef {
	defs := make([]ConfigDef, 0)
	for _, def := range configRegistry {
		if def.Scope == scope {
			defs = append(defs, def)
		}
	}
	sort.Slice(defs, func(i, j int) bool { return defs[i].Key < defs[j].Key })
	return defs
}

// GetConfigDef returns the registered definition for a key.
func GetConfigDef(key string) (ConfigDef, bool) {
	def, ok := configRegistry[key]
	return def, ok
}

// isInternalKey reports whether a key is registered as internal-only (never
// exposed through any API listing, never writable via the config API).
func isInternalKey(key string) bool {
	def, ok := configRegistry[key]
	return ok && def.Internal
}

// NormalizeClock 把 "6:00" / "06:00" 这样的写法统一成 "HH:MM"，非法值返回 false。
//
// 为什么要统一：时刻会参与 SQL 拼接（见 reminder.overdueDeadlineExpr）与字符串比较，
// 同一个时刻两种写法会让缓存与比较出现意外。
func NormalizeClock(value string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return "", false
	}
	h, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	m, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return "", false
	}
	return fmt.Sprintf("%02d:%02d", h, m), true
}

// Validate checks a raw value against the definition's type. Booleans accept
// only "true"/"false" (consumers compare against those exact strings);
// selects accept only one of the declared options.
func Validate(def ConfigDef, value string) error {
	switch def.Type {
	case TypeBool:
		if value != "true" && value != "false" {
			return fmt.Errorf("config %q must be \"true\" or \"false\"", def.Key)
		}
	case TypeInt:
		if _, err := strconv.Atoi(value); err != nil {
			return fmt.Errorf("config %q must be an integer", def.Key)
		}
	case TypeTime:
		if _, ok := NormalizeClock(value); !ok {
			return fmt.Errorf("config %q must be a time of day like 06:00", def.Key)
		}
	case TypeSelect:
		for _, opt := range def.Options {
			if value == opt {
				return nil
			}
		}
		return fmt.Errorf("config %q must be one of %v", def.Key, def.Options)
	}
	return nil
}

func init() {
	RegisterConfig(ConfigDef{
		Key: "site_title", Scope: ScopeSystem, Type: TypeString,
		Default: "工作序记", Public: true,
		Group: "general", Label: "站点标题",
		Description: "显示在浏览器标题和页面头部的站点名称",
	})
	RegisterConfig(ConfigDef{
		Key: "site_description", Scope: ScopeSystem, Type: TypeString,
		Default: "简洁可靠的多渠道提醒应用", Public: true,
		Group: "general", Label: "站点描述",
		Description: "站点的简短介绍",
	})
	RegisterConfig(ConfigDef{
		Key: "allow_register", Scope: ScopeSystem, Type: TypeBool,
		Default: "true", Public: true,
		Group: "access", Label: "允许注册",
		Description: "允许新用户创建账号",
	})
	RegisterConfig(ConfigDef{
		Key: "require_login", Scope: ScopeSystem, Type: TypeBool,
		Default: "true", Public: true,
		Group: "access", Label: "需要登录",
		Description: "要求访客登录后才能使用应用",
	})
	// 登录有效期：勾了「记住登录」用天数、没勾用小时数。两个都放在访问控制组里，
	// 管理员按自己的安全要求在「系统配置 → 访问控制」里调。
	RegisterConfig(ConfigDef{
		Key: "login_remember_days", Scope: ScopeSystem, Type: TypeInt,
		Default: "7", Public: true,
		Group: "access", Label: "记住登录的有效天数",
		Description: "登录时勾选「记住登录」后，登录状态保持多少天（默认 7 天）",
	})
	RegisterConfig(ConfigDef{
		Key: "login_session_hours", Scope: ScopeSystem, Type: TypeInt,
		Default: "12", Public: true,
		Group: "access", Label: "不记住登录的有效小时数",
		Description: "没勾「记住登录」时登录状态保持多少小时；关掉浏览器就要重新登录（默认 12 小时）",
	})
	RegisterConfig(ConfigDef{
		Key: "jwt_secret", Scope: ScopeSystem, Type: TypeString,
		Internal: true,
		Group:    "internal", Label: "JWT Secret",
		Description: "Secret used to sign session tokens (auto-generated)",
	})
	// 「任务过期多久算逾期」：新建任务的默认时间是**当前时刻**（取整到分），
	// 刚建完就已经过了几秒 —— 不给宽限的话所有新任务一建出来就顶着「已逾期」。
	// 这里配一个宽限时长：过了这个时长才标逾期（排序与今天页口径不变）。
	RegisterConfig(ConfigDef{
		Key: "task_overdue_after_minutes", Scope: ScopeSystem, Type: TypeSelect,
		Default: "30", Options: []string{"0", "15", "30", "60", "120", "240"},
		Public: true,
		Group:  "reminder", Label: "任务过期多久算逾期",
		Description: "到期后多久开始标「已逾期」（默认 30 分钟；新建任务的默认时间是当前时刻，留一点宽限更自然）",
	})
	// 说明（2026-10-13）：原来这里有个「新建提醒默认结束时间」(task_expire_time)。
	// 用户明确要求「今天/明天/本周末这些芯片的时间一律 23:59，除非自己手动改」，
	// 所以默认时刻直接写死在前端（HomeView.DEFAULT_DUE_TIME），这个配置项删掉了。
	// 留个记录：老库里可能还有 task_expire_time 那一行，没人读，无害。
	RegisterConfig(ConfigDef{
		Key: "theme_mode", Scope: ScopeUser, Type: TypeSelect,
		Default: "system", Options: []string{"system", "light", "dark", "sun"},
		Group: "appearance", Label: "主题模式",
		Description: "界面配色方案；「日出日落」会按下方的位置自动切换浅色/深色",
	})
	RegisterConfig(ConfigDef{
		Key: "sun_location", Scope: ScopeUser, Type: TypeSelect,
		Default: "shanghai", Options: sunLocationOptions(),
		Group: "appearance", Label: "日出日落位置",
		Description: "「日出日落」主题按这里的经纬度计算；选离你最近的城市即可（不参与其它功能）",
	})
	RegisterConfig(ConfigDef{
		Key: "calendar_font_size", Scope: ScopeUser, Type: TypeSelect,
		Default: "medium", Options: []string{"small", "medium", "large", "xlarge"},
		Group: "appearance", Label: "日历任务字号",
		Description: "日历视图里每天那些任务文字的字体大小",
	})
	RegisterConfig(ConfigDef{
		Key: "calendar_week_start", Scope: ScopeSystem, Type: TypeSelect,
		Default: "monday", Options: []string{"monday", "sunday"},
		Public: true,
		Group:  "appearance", Label: "周起始日",
		Description: "日历里一周从哪天开始（周一或周日），周视图的第一列也跟着它",
	})
	RegisterConfig(ConfigDef{
		Key: "default_view", Scope: ScopeUser, Type: TypeSelect,
		// 用户 2026-10-13 加了「首页」看板（14 天待办 + 已逾期两列）并要求
		// 「打开默认显示页」——所以默认值从 list 改成 home，老库里显式写成 list 的
		// 由 0.27.0 的迁移一并改到 home（仍可在偏好里自己改回列表视图）。
		Default: "home", Options: []string{"home", "list", "calendar"},
		Group: "appearance", Label: "默认首页",
		Description: "打开应用时先进哪个视图（首页看板 / 列表视图 / 日历视图）；之后仍可随时用右上角按钮切换",
	})
	// 提醒频率：控制「到点的提醒多久再提醒一次」与「点『知道了』之后多久再提醒」。
	// 都是个人偏好（每人一份），选项值是分钟数。
	RegisterConfig(ConfigDef{
		Key: "reminder_notify_minutes", Scope: ScopeUser, Type: TypeSelect,
		Default: "10", Options: []string{"5", "10", "15", "30", "60"},
		Public: true,
		Group:  "reminder", Label: "提醒频率",
		Description: "到点的提醒如果没处理，隔多久再弹一次（也是新建提醒时「过期提醒频率」的默认值）",
	})
	RegisterConfig(ConfigDef{
		Key: "reminder_ack_minutes", Scope: ScopeUser, Type: TypeSelect,
		Default: "0", Options: []string{"0", "30", "60", "120", "240"},
		Public: true,
		Group:  "reminder", Label: "点「知道了」后的提醒频率",
		Description: "弹窗上点「知道了」之后多久再提醒；「第二天」表示当天不再提示、第二天同一时间继续提醒",
	})
	// 「逾期提醒时间」（用户 2026-10-12 要求）：**到期日当天到了这个点还没完成就算逾期**，
	// 同时发一条「已逾期」提醒（每个任务每天一条）。
	//
	// 与「任务过期时间」的旧口径差别：旧口径是 MAX(到期时刻, 当天过期时间) —— 到期时刻写得
	// 比这个点晚的任务（例如默认 23:59）永远不会在这个点之前被标逾期，用户设了 20:30 也
	// 看不到效果。新口径按**日期**算：只看「到期日是今天、现在过了这个点」，与任务写了几点无关。
	RegisterConfig(ConfigDef{
		Key: "task_overdue_time", Scope: ScopeUser, Type: TypeTime,
		Default: "23:59",
		Public:  true,
		Group:   "reminder", Label: "逾期提醒时间",
		Description: "到期日当天超过这个时间还没完成，就算逾期、并提醒一次（默认 23:59；再叠加上面的「任务过期多久算逾期」宽限分钟数）",
	})
	// 信用卡账单：侧栏里那个**固定栏目**，不是普通清单——不用在「新建清单」里选模板，
	// 卡片一律归到这一栏里。
	//
	// **这是每个人的个人偏好，不是系统开关**。默认开（用户要求：信用卡账单与记事本
	// 都默认开启）；不想用的人在「偏好设置」里关掉即可。关掉后栏目与卡片提醒一起隐藏，
	// 数据保留（见 server/reminder/card_bucket.go）。
	//
	// 注意：这里改的是「注册表默认值」。库里已经显式写过这一行的用户（true/false）
	// 一切照旧——读取路径一律「用户自己的值 → 没写过才用默认」（见 reminder 包的
	// userConfigValue / handleBootstrap），所以老用户的显式选择不会被这次改默认值覆盖。
	RegisterConfig(ConfigDef{
		Key: "credit_card_enabled", Scope: ScopeUser, Type: TypeBool,
		Default: "true", Public: true,
		Group: "features", Label: "信用卡账单栏目",
		Description: "在侧栏显示固定的「信用卡账单」栏目（新建卡片都在这里）；关掉后栏目与卡片提醒一起隐藏，数据保留",
	})
	// 记事本：侧栏里另一个**固定栏目**（不是普通清单），放的是 kind=note 的记事。
	//
	// 与信用卡同一套范式（见 server/reminder/note_bucket.go）：模板 notebook、
	// 个人偏好 notebook_enabled 控制显示、关掉只隐藏不删数据。默认开。
	// 「人生要有仪式感」栏目：生日、纪念日、节日、考试这些「一年一次」的事项，
	// 用倒计时卡片看还有多少天。与记事本一样是个人偏好，关掉只隐藏、不删数据。
	RegisterConfig(ConfigDef{
		Key: "ceremony_enabled", Scope: ScopeUser, Type: TypeBool,
		Default: "true", Public: true,
		Group: "features", Label: "人生要有仪式感栏目",
		Description: "在侧栏显示「人生要有仪式感」栏目（生日/纪念日/节日/考试等倒计时卡片）；关掉后栏目隐藏，数据保留",
	})
	RegisterConfig(ConfigDef{
		Key: "notebook_enabled", Scope: ScopeUser, Type: TypeBool,
		Default: "true", Public: true,
		Group: "features", Label: "随手记事本栏目",
		Description: "在侧栏显示固定的「随手记事本」栏目（新建的记事都收在这里）；关掉后栏目隐藏，记事数据保留",
	})
	RegisterConfig(ConfigDef{
		Key: "nudge_enabled", Scope: ScopeUser, Type: TypeBool,
		Default: "true", Public: true,
		Group: "features", Label: "提醒@他",
		Description: "在侧栏「我的清单」下显示「提醒@他」页面（多人之间互相推提醒）；关掉后入口隐藏，别人在 @ 列表里也看不到你，已发提醒数据保留",
	})
	// 垃圾箱自动清空：0 表示不自动清空；大于 0 时每天把删除超过 N 天的提醒
	// 打上 purged_at 墓碑（垃圾箱隐藏，但仍随双机同步，不会被对端快照复活）。
	RegisterConfig(ConfigDef{
		Key: "trash_auto_clear_days", Scope: ScopeUser, Type: TypeInt,
		Default: "0", Public: true,
		Group: "features", Label: "垃圾箱自动清空",
		Description: "删除的提醒在垃圾箱保留多少天后自动清空；填 0 表示不自动清空（默认）",
	})
	RegisterConfig(ConfigDef{
		Key: "log_retention_days", Scope: ScopeSystem, Type: TypeInt,
		Default: "30",
		Group:   "system", Label: "日志与操作记录保留天数",
		Description: "运行日志与操作日志自动清理的最大保留天数，0 表示永久保留",
	})

	// ---- 双机同步（两台工作序记之间同步清单/任务/记事/完成记录）----
	//
	// 全部登记为 Internal：它们既不该出现在「系统配置」那张注册表驱动的列表里
	// （令牌是密钥，其余项需要专门的界面讲清方向、配对与结果），也不允许通过
	// 通用配置接口 PUT /api/configs 改动。读写只走 /api/reminder/admin/sync/*
	// 与 /api/reminder/sync/*，见 reminder/sync_settings.go。
	//
	// 仍然登记在注册表里是为了拿到「唯一权威的键名 + 默认值 + 类型校验」：
	// InitDefaultConfigs 会按 ScopeSystem 建行，sysconfig.Validate 直接复用。
	RegisterConfig(ConfigDef{
		Key: "sync_instance_id", Scope: ScopeSystem, Type: TypeString,
		Internal: true,
		Group:    "sync", Label: "本机实例标识",
		Description: "本机在这次同步配对里的身份，首次启动时自动生成，勿手动修改",
	})
	RegisterConfig(ConfigDef{
		Key: "sync_token", Scope: ScopeSystem, Type: TypeString,
		Internal: true,
		Group:    "sync", Label: "同步令牌",
		Description: "两台机器共用的通信密钥，必须完全一致；首次启动自动生成",
	})
	RegisterConfig(ConfigDef{
		Key: "sync_direction", Scope: ScopeSystem, Type: TypeSelect,
		Default: "off", Options: []string{"off", "push", "pull", "both"},
		Internal: true,
		Group:    "sync", Label: "同步方向",
		Description: "off 关闭；push 本机推给对端；pull 从对端拉取；both 双向",
	})
	RegisterConfig(ConfigDef{
		Key: "sync_peer_url", Scope: ScopeSystem, Type: TypeString,
		Internal: true,
		Group:    "sync", Label: "对端地址",
		Description: "对端工作序记的访问地址，例如 http://192.168.3.201:8906",
	})
	RegisterConfig(ConfigDef{
		Key: "sync_interval_minutes", Scope: ScopeSystem, Type: TypeInt,
		Default:  "0",
		Internal: true,
		Group:    "sync", Label: "自动同步间隔（分钟）",
		Description: "0 表示只在手动点「立即同步」时同步",
	})
	RegisterConfig(ConfigDef{
		Key: "sync_last_at", Scope: ScopeSystem, Type: TypeString,
		Internal: true,
		Group:    "sync", Label: "上次同步时间",
		Description: "最近一次同步的结束时间（RFC3339），仅用于展示",
	})
	RegisterConfig(ConfigDef{
		Key: "sync_last_status", Scope: ScopeSystem, Type: TypeString,
		Internal: true,
		Group:    "sync", Label: "上次同步结果",
		Description: "ok / error / partial，仅用于展示",
	})
	RegisterConfig(ConfigDef{
		Key: "sync_last_detail", Scope: ScopeSystem, Type: TypeString,
		Internal: true,
		Group:    "sync", Label: "上次同步明细",
		Description: "最近一次同步的 JSON 明细（各方向增删改计数、失败原因）",
	})
	RegisterConfig(ConfigDef{
		Key: "sync_peer_instance_id", Scope: ScopeSystem, Type: TypeString,
		Internal: true,
		Group:    "sync", Label: "对端实例标识",
		Description: "最近一次成功通信时对端报出的实例标识，仅用于展示",
	})
	RegisterConfig(ConfigDef{
		Key: "sync_peer_summary", Scope: ScopeSystem, Type: TypeString,
		Internal: true,
		Group:    "sync", Label: "对端概况",
		Description: "对端的应用名/版本/账号数，仅用于展示",
	})
}
