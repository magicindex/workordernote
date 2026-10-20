package reminder

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

const (
	ChannelInApp    = "inapp"
	ChannelEmail    = "email"
	ChannelSMS      = "sms"
	ChannelFeishu   = "feishu"
	ChannelQQ       = "qq"
	ChannelDingTalk = "dingtalk"
)

var supportedChannels = map[string]bool{
	ChannelInApp: true, ChannelEmail: true, ChannelSMS: true,
	ChannelFeishu: true, ChannelQQ: true, ChannelDingTalk: true,
}

// Kind discriminates the two things a row in the reminders table can be:
//
//   - KindTask is an ordinary reminder. It stays open until it is completed,
//     and may carry a due time, a repeat rule and notification channels.
//   - KindNote is a plain record ("记事"). It has no schedule and never
//     notifies; it counts as completed from the moment it is created, so it
//     files itself under「已完成」and stays out of every open-task view.
const (
	KindTask = "task"
	KindNote = "note"
)

var supportedKinds = map[string]bool{KindTask: true, KindNote: true}

// SyncUID 是这一行在「双机同步」里的身份标识，见 sync_identity.go。
// 它的取值只在本应用的同步协议里有意义，不出现在任何业务接口的 JSON 里。
//
// 为什么不能用自增 ID：两台 NAS 各自的自增序列互不相关，同一个 5 在 A 上可能是
// <今天的任务>、在 B 上是 <上周的记事>。同步必须按一个跨实例稳定的键配对。
//
// 索引用普通索引而不是唯一索引：AutoMigrate 会给历史行补空串，多行空串在唯一
// 索引上直接建不出来；配对由应用层（按 sync_uid + 用户查一行）保证。
type List struct {
	ID        uint   `gorm:"primarykey" json:"id"`
	SyncUID   string `gorm:"size:40;index" json:"-"`
	UserID    uint   `gorm:"not null;index:idx_reminder_lists_user_position" json:"-"`
	Name      string `gorm:"size:40;not null" json:"name"`
	Color     string `gorm:"size:16;not null;default:blue" json:"color"`
	Icon      string `gorm:"size:32;not null;default:list" json:"icon"`
	Position  int    `gorm:"not null;default:0;index:idx_reminder_lists_user_position" json:"position"`
	IsDefault bool   `gorm:"not null;default:false" json:"is_default"`
	// 模板：general（普通清单）或 credit_card（信用卡清单，里面放卡片实体）
	Template string `gorm:"size:16;not null;default:general" json:"template"`
	// AI 提示词：这一栏的数据交给「小秘」分析时，额外告诉模型该怎么看它
	// （用户 2026-10-17：「为每个不同栏目增加 ai 提示词」）。空串表示不加要求。
	// 存在清单上而不是系统配置里：新建清单天然就能带，多个清单填同一段文字即为
	// 「共用一个提示词」（各自改，互不影响）。
	AIPrompt string `gorm:"column:ai_prompt;size:600;not null;default:''" json:"ai_prompt"`

	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `gorm:"index" json:"-"`
}

type Reminder struct {
	ID      uint   `gorm:"primarykey" json:"id"`
	SyncUID string `gorm:"size:40;index" json:"-"`
	UserID  uint   `gorm:"not null;index:idx_reminders_user_due;index:idx_reminders_user_completed" json:"-"`
	ListID  uint   `gorm:"not null;index" json:"list_id"`
	Title   string `gorm:"size:200;not null" json:"title"`
	Notes   string `gorm:"type:text" json:"notes"`
	// 信用卡生成的提醒：CardID 指向卡片；CardRole 是 statement（账单日）/
	// due（还款日）/ advance（还款日前几天提醒）。日历与列表据此给不同标记色。
	CardID   uint   `gorm:"index" json:"card_id,omitempty"`
	CardRole string `gorm:"size:16" json:"card_role"`
	// Kind is "task" (default) or "note"; see the KindTask / KindNote
	// constants. The column default keeps every pre-existing row on task
	// semantics, so adding this field needs no data migration.
	Kind     string     `gorm:"size:8;not null;default:task" json:"kind"`
	Priority int        `gorm:"not null;default:0" json:"priority"`
	DueAt    *time.Time `gorm:"index:idx_reminders_user_due" json:"due_at"`
	AllDay   bool       `gorm:"not null;default:false" json:"all_day"`
	// StartAt / EndAt 是「时间段」任务的起止时间（计划页专用，用户要求计划任务
	// 用自定义时间或时间段，而不是「今天/明天」这类相对快捷项）。两者要么都空
	// （普通的单点时间任务，看 DueAt），要么都填且 EndAt 晚于 StartAt。
	//
	// 有区间时 DueAt 会被规范成 StartAt：列表排序、今天/计划视图、日历格子与
	// 通知投递都只认 DueAt，不必让每一处都去理解区间。
	//
	// 新列由 AutoMigrate 自动加（SQLite ADD COLUMN，旧行为 NULL），因此不需要
	// 额外的 database.Upgrades 记录。
	StartAt    *time.Time `json:"start_at,omitempty"`
	EndAt      *time.Time `json:"end_at,omitempty"`
	RepeatRule string     `gorm:"size:16;not null;default:none" json:"repeat_rule"`
	// Calendar selects which calendar the repeat rule follows: "solar"
	// (Gregorian, default) or "lunar" (Chinese lunar calendar). Only
	// monthly/yearly observe the lunar calendar; daily and weekly are
	// calendar-independent and always stay "solar".
	Calendar string `gorm:"size:8;not null;default:solar" json:"calendar"`
	// LunarAnchor stores the lunar month/day this reminder recurs on when
	// Calendar is "lunar" and the rule is monthly/yearly, encoded as "M:D"
	// where a negative month denotes the leap month. For monthly rules only
	// the day part is used. Empty for every other combination.
	LunarAnchor string `gorm:"size:8" json:"lunar_anchor,omitempty"`
	// RepeatNotifyMinutes re-notifies an uncompleted reminder on a fixed
	// interval after each due time; 0 disables the behaviour.
	RepeatNotifyMinutes int `gorm:"not null;default:0" json:"repeat_notify_minutes"`
	// Accent 是**条目自己挑的过渡色**（用户 2026-10-11 要求：仪式感卡片支持多种过渡色、
	// 新建/编辑时自己选）。存色名 key（见 card_accents.go 的白名单），空 = 用默认色。
	// 只影响「人生要有仪式感」卡片的观感，不参与排序/提醒逻辑；新列同样由 AutoMigrate 自动加。
	Accent string `gorm:"size:24" json:"accent,omitempty"`
	// Background 是仪式感卡片的**背景图**（用户 2026-10-13 要求）：
	// 空 = 用配色渐变；"preset:<key>" = 内置主题图（随前端产物走，不会被删）；
	// "/uploads/..." = 用户上传的图片（卡片删除时清理，见 background.go）。
	Background string `gorm:"size:255" json:"background,omitempty"`
	// BgBlur / BgMask 是背景图的**蒙板**两个指标（用户 2026-10-13 要求
	// 「卡片背景增加蒙板功能，可调整虚化、透明度两个指标」）：
	//   BgBlur 虚化：给背景图加多少像素的高斯模糊（0–24，0 = 不虚化）
	//   BgMask 透明度：压在背景图上的那层暗色蒙板的**透明程度**百分比
	//                 （0–100：越大越清透、背景越亮；越小蒙板越浓、字越清楚）
	// 默认写在建表里：老卡片迁移过来就是 blur=0 / mask=45（透明度 45%，
	// 也就是蒙板浓度 55%，与上一版写死在样式里的观感一致）。
	BgBlur int `gorm:"not null;default:0" json:"bg_blur,omitempty"`
	BgMask int `gorm:"not null;default:45" json:"bg_mask,omitempty"`
	// BgAlpha 是**整张卡片背景的透明度**（用户 2026-10-19 要求：「增加卡片透明度调整，
	// 可以把整个卡片调整为透明（不含文字）」）：100 = 不透明，0 = 只留文字。
	// 只作用于卡片的背景层（配色渐变 / 背景图 / 蒙板），文字、图标、按钮不受影响。
	BgAlpha      int               `gorm:"not null;default:100" json:"bg_alpha,omitempty"`
	CompletedAt  *time.Time        `gorm:"index:idx_reminders_user_completed" json:"completed_at"`
	SnoozedUntil *time.Time        `json:"snoozed_until"`
	Position     int               `gorm:"not null;default:0" json:"position"`
	Version      uint              `gorm:"not null;default:1" json:"version"`
	CreatedAt    time.Time         `json:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
	DeletedAt    *time.Time        `gorm:"index" json:"-"`
	Channels     []ReminderChannel `gorm:"foreignKey:ReminderID" json:"-"`
}

type ReminderChannel struct {
	ID         uint   `gorm:"primarykey" json:"id"`
	ReminderID uint   `gorm:"not null;uniqueIndex:idx_reminder_channel" json:"reminder_id"`
	UserID     uint   `gorm:"not null;index" json:"-"`
	Channel    string `gorm:"size:16;not null;uniqueIndex:idx_reminder_channel" json:"channel"`
	Enabled    bool   `gorm:"not null;default:true" json:"enabled"`
	// Targets stores a JSON array of ChannelBinding IDs this reminder delivers
	// to. Only meaningful for the email channel; empty means every active
	// binding of the user.
	Targets   string    `gorm:"type:text" json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Completion struct {
	ID            uint       `gorm:"primarykey" json:"id"`
	SyncUID       string     `gorm:"size:40;index" json:"-"`
	ReminderID    uint       `gorm:"not null;index" json:"reminder_id"`
	UserID        uint       `gorm:"not null;index" json:"-"`
	ScheduledFor  *time.Time `json:"scheduled_for"`
	CompletedAt   time.Time  `gorm:"index" json:"completed_at"`
	TitleSnapshot string     `gorm:"size:200;not null" json:"title"`

	// DeletedAt 让完成记录可以「撤回」：标记已还之后又点撤销时，这一步写下的历史
	// 要能跟着撤回（见 card_handlers.go 的 retractCardPayment）。
	//
	// **必须是软删除**：硬删除在同步里表达不出来（快照按行发，删掉的行没有任何痕迹），
	// 于是「标记已还 → 同步到对端 → 再撤销已还」会在对端留下一条幽灵记录。
	// 有 deleted_at 之后，快照会把它当作墓碑带上（`Deleted: true`），对端据此一并撤回。
	//
	// 这里用 gorm.DeletedAt（而不是本项目其它模型的 *time.Time）：完成记录在所有读取
	// 路径上都必须「看不见被撤回的」，交给 GORM 自动加 `deleted_at IS NULL` 最省心；
	// 快照/落地/补 UID 那三处需要看到墓碑，显式写 Unscoped() 即可。
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type ChannelBinding struct {
	ID            uint       `gorm:"primarykey" json:"id"`
	UserID        uint       `gorm:"not null;index:idx_channel_bindings_user_channel" json:"-"`
	Channel       string     `gorm:"size:16;not null;index:idx_channel_bindings_user_channel" json:"channel"`
	Target        string     `gorm:"type:text;not null" json:"-"`
	TargetMasked  string     `gorm:"size:120;not null" json:"target_masked"`
	Status        string     `gorm:"size:16;not null;default:active;index" json:"status"`
	VerifiedAt    *time.Time `json:"verified_at"`
	LastTestedAt  *time.Time `json:"last_tested_at"`
	LastErrorCode string     `gorm:"size:64" json:"last_error_code,omitempty"`
	LastErrorAt   *time.Time `json:"last_error_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// ProviderConfig stores administrator-managed provider credentials. The secret
// is encrypted with the installation key and never returned by APIs.
type ProviderConfig struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	Provider  string    `gorm:"size:32;not null;uniqueIndex" json:"provider"`
	Secret    string    `gorm:"type:text;not null" json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// QQBindCode links a signed-in Reminder user to a QQ C2C conversation without
// ever asking that person to find a platform OpenID.
type QQBindCode struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	UserID    uint      `gorm:"not null;index" json:"-"`
	Code      string    `gorm:"size:12;not null;uniqueIndex" json:"code"`
	ExpiresAt time.Time `gorm:"not null;index" json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type DeliveryJob struct {
	ID                uint       `gorm:"primarykey" json:"id"`
	UserID            uint       `gorm:"not null;index" json:"-"`
	ReminderID        uint       `gorm:"not null;uniqueIndex:idx_delivery_occurrence" json:"reminder_id"`
	Channel           string     `gorm:"size:16;not null;uniqueIndex:idx_delivery_occurrence;index" json:"channel"`
	ScheduledFor      time.Time  `gorm:"not null;uniqueIndex:idx_delivery_occurrence;index" json:"scheduled_for"`
	RunAt             time.Time  `gorm:"not null;index:idx_delivery_due" json:"run_at"`
	Status            string     `gorm:"size:16;not null;default:pending;index:idx_delivery_due" json:"status"`
	AttemptCount      int        `gorm:"not null;default:0" json:"attempt_count"`
	NextAttemptAt     *time.Time `gorm:"index" json:"next_attempt_at,omitempty"`
	LockedAt          *time.Time `json:"locked_at,omitempty"`
	WorkerID          string     `gorm:"size:64" json:"worker_id,omitempty"`
	IdempotencyKey    string     `gorm:"size:64;not null;uniqueIndex" json:"idempotency_key"`
	LastErrorCode     string     `gorm:"size:64" json:"last_error_code,omitempty"`
	LastErrorMessage  string     `gorm:"size:300" json:"last_error_message,omitempty"`
	ExternalMessageID string     `gorm:"size:200" json:"external_message_id,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type DeliveryAttempt struct {
	ID              uint      `gorm:"primarykey" json:"id"`
	JobID           uint      `gorm:"not null;index" json:"job_id"`
	AttemptNo       int       `gorm:"not null" json:"attempt_no"`
	StartedAt       time.Time `json:"started_at"`
	FinishedAt      time.Time `json:"finished_at"`
	Result          string    `gorm:"size:16;not null" json:"result"`
	ProviderCode    string    `gorm:"size:100" json:"provider_code,omitempty"`
	LatencyMS       int64     `json:"latency_ms"`
	ResponseSummary string    `gorm:"size:300" json:"response_summary,omitempty"`
}

type Notification struct {
	ID            uint       `gorm:"primarykey" json:"id"`
	UserID        uint       `gorm:"not null;index:idx_notifications_user_read" json:"-"`
	ReminderID    *uint      `gorm:"index" json:"reminder_id,omitempty"`
	DeliveryJobID *uint      `gorm:"uniqueIndex" json:"delivery_job_id,omitempty"`
	Type          string     `gorm:"size:32;not null" json:"type"`
	Title         string     `gorm:"size:200;not null" json:"title"`
	Body          string     `gorm:"size:500" json:"body"`
	ReadAt        *time.Time `gorm:"index:idx_notifications_user_read" json:"read_at,omitempty"`
	CreatedAt     time.Time  `gorm:"index" json:"created_at"`
}

type ReminderDTO struct {
	Reminder
	Channels       []string          `json:"channels"`
	ChannelTargets map[string][]uint `json:"channel_targets,omitempty"`
	ListName       string            `json:"list_name"`
	// ListColor 是所属清单的色名（blue/violet/…）。列表页用它给任务标题上色，
	// 与侧栏圆点、日历色块保持同一份取色规则（前端 utils/list-colors.ts）。
	ListColor string `json:"list_color"`
	// CycleIndex 是「这是第几次」：循环项目（计划里的循环任务、仪式感里的生日/纪念日）
	// 已完成过 N 次，这一次就是第 N+1 次。非循环项目固定为 0（前端不显示这个角标）。
	// 值由 listReminders 里一条聚合查询一次算出（不给每行单独查，避免 N+1）。
	CycleIndex int `json:"cycle_index"`
	// CanDelete 表示**当前这个请求的用户能不能删这条**（用户 2026-10-13 要求
	// 「删除只对创建提醒用户有效」）：判据是这条的 user_id 与请求用户一致。
	// 服务端删除接口本来就按 user_id 过滤（删别人的一律 404），这个字段是给界面用的 ——
	// 不是创建者就不显示/禁用删除按钮，而不是等点了才报错。
	CanDelete bool `json:"can_delete"`
}

// supportedListColors 是清单颜色的白名单。它与前端 utils/list-colors.ts 的
// LIST_COLOR_NAMES 一一对应：这里多一个，前端取色会回落到蓝色；前端多一个，
// 写入时会被这里拒掉。改颜色名时两边一起改。
var supportedListColors = map[string]bool{
	"blue": true, "violet": true, "rose": true, "amber": true, "emerald": true,
}

// validateListColor 只接受白名单内的色名；空值表示「不修改」，由调用方决定默认值。
func validateListColor(color string) error {
	if color == "" || supportedListColors[color] {
		return nil
	}
	return errors.New("清单颜色无效，可选：blue / violet / rose / amber / emerald")
}

type ListDTO struct {
	List
	OpenCount int64 `json:"open_count"`
	// 信用卡清单才有：这张清单里有几张卡（卡片详情走 /api/reminder/cards）
	CardCount int64 `json:"card_count,omitempty"`
}

// CompletedItemDTO 是「已完成」视图的一行。它有两个来源：
//
//   - Source "history"：completions 历史表，即重复提醒的每一次完成。
//     提醒之后被删除，这条记录依然在（靠 TitleSnapshot 展示）。
//   - Source "reminder"：reminders.completed_at，即非重复提醒的完成，以及全部记事。
//
// 必须合并两个来源：重复提醒完成时不会写 completed_at，而是把 due_at 滚到下一次、
// 往 completions 插一条历史，所以只读 completed_at 的「已完成」会漏掉绝大部分记录
// （本机实测只读 completed_at 得到 2 条，而历史表里有 14 条）。
type CompletedItemDTO struct {
	ID           uint       `json:"id"`
	Source       string     `json:"source"` // history | reminder
	ReminderID   uint       `json:"reminder_id"`
	Title        string     `json:"title"`
	CompletedAt  time.Time  `json:"completed_at"`
	ScheduledFor *time.Time `json:"scheduled_for,omitempty"`
	ListID       uint       `json:"list_id"`
	ListName     string     `json:"list_name"`
	Kind         string     `json:"kind"`
	RepeatRule   string     `json:"repeat_rule"`
	// ReminderExists 表示底层提醒是否还在（未被删除）。前端据此决定这一行能否编辑/删除：
	// 历史记录本身是既成事实，没有可删的东西。
	ReminderExists bool `json:"reminder_exists"`
}

// CalendarItemDTO 是日历视图里的一项，有两种来源：
//
//   - 任务：按 due_at 落在这一天；
//   - 记事：记事没有到期时间（保存时会被清空），按**记录时间**落进日历
//     （记事的 completed_at 就是它的创建时刻）。用户要的是「某天记了什么」，
//     记事不进日历，等于这些工作记录在日历上凭空消失。
//
// 两种都含已完成项——日历要能看到「这天有哪些安排、哪些已经做完」，
// 所以不像列表那样按 completed_at 过滤。
type CalendarItemDTO struct {
	ID       uint   `json:"id"`
	Title    string `json:"title"`
	ListID   uint   `json:"list_id"`
	ListName string `json:"list_name"`
	// ListColor 是清单的色名（blue/violet/rose/amber/emerald），前端沿用
	// 侧栏那套 listColor 映射上色，保证同一清单处处同色。
	ListColor string `json:"list_color"`
	// ListIcon 是清单的图标 key（见 list_icons.go）：日历格子用图标代替原来的圆点。
	ListIcon string    `json:"list_icon"`
	DueAt    time.Time `json:"due_at"`
	// StartAt / EndAt 是时间段任务的起止（计划页的「开始—结束」）；没有区间时为空。
	StartAt *time.Time `json:"start_at,omitempty"`
	EndAt   *time.Time `json:"end_at,omitempty"`
	// DueDate 是到期日在上海时区下的 YYYY-MM-DD。日历按这个字符串归格，
	// 不走浏览器时区换算——否则用户在非 +08 时区打开会整体错一天。
	DueDate    string `json:"due_date"`
	AllDay     bool   `json:"all_day"`
	Completed  bool   `json:"completed"`
	Kind       string `json:"kind"`
	Priority   int    `json:"priority"`
	RepeatRule string `json:"repeat_rule"`
	// Notes 是备注原文，导出「本月」表格时要带上（日历界面上不展示）。
	Notes string `json:"notes,omitempty"`
	// CompletedAt 只对任务有意义，用于导出表格的「完成时间」列；
	// 记事的记录时间放在 DueAt 里，见 listCalendarItems。
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	// CardRole 是信用卡生成的项：statement=账单日、due=还款日、advance=提前提醒。
	// 日历据此给这些日子固定配色（账单日琥珀 / 还款日玫红 / 提前提醒橙色），
	// 与清单色区分开——同一张卡的几个日子要一眼分得清。
	CardRole string `json:"card_role,omitempty"`
	CardID   uint   `json:"card_id,omitempty"`
}

type ChannelStatus struct {
	Channel      string `json:"channel"`
	Label        string `json:"label"`
	Configured   bool   `json:"configured"`
	Bound        bool   `json:"bound"`
	Status       string `json:"status"`
	TargetMasked string `json:"target_masked,omitempty"`
	BotLink      string `json:"bot_link,omitempty"`
	Description  string `json:"description"`
	// Bindings lists every bound target for channels that allow more than
	// one (currently email). Each item exposes only the masked address.
	Bindings []ChannelBindingItem `json:"bindings,omitempty"`
}

type ChannelBindingItem struct {
	ID           uint   `json:"id"`
	TargetMasked string `json:"target_masked"`
	Status       string `json:"status"`
}
