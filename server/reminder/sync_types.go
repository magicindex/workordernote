package reminder

import "time"

// syncFormat 是同步报文的版本号。对端报出的版本与本机不一致时直接拒绝，
// 而不是「尽量解析」：字段语义变了以后半懂不懂地合并，比不同步更危险
// （例如把 deleted 当未知字段忽略，就会在对端复活已删除的数据）。
const syncFormat = 1

// syncSnapshot 是同步的完整报文：一次同步交换**全量**数据，而不是增量。
//
// 为什么不做增量：本应用的量级是「一个人的任务清单」（本机实测 40 条提醒、
// 14 条完成记录，报文 gzip 后几 KB），全量交换的代价可以忽略；而增量需要一个
// 可靠的游标（含删除墓碑、时钟偏差、首次同步补历史），任何一处出错都会造成
// 静默的数据缺失。全量交换是自愈的：每次同步都用对端的现状校正本机。
type syncSnapshot struct {
	Format         int                 `json:"format"`
	InstanceID     string              `json:"instance_id"`
	AppName        string              `json:"app_name"`
	AppVersion     string              `json:"app_version"`
	SiteTitle      string              `json:"site_title"`
	GeneratedAt    time.Time           `json:"generated_at"`
	Users          []syncUser          `json:"users"`
	Lists          []syncList          `json:"lists"`
	Cards          []syncCard          `json:"cards"`
	Reminders      []syncReminder      `json:"reminders"`
	CardStatements []syncCardStatement `json:"card_statements"`
	Completions    []syncCompletion    `json:"completions"`

	// 课程表、个人偏好与系统设置（用户 2026-10-19：除密码外全部同步）。
	Timetables       []syncTimetable      `json:"timetables"`
	TimetableEntries []syncTimetableEntry `json:"timetable_entries"`
	UserConfigs      []syncUserConfig     `json:"user_configs"`
	SystemConfigs    []syncSystemConfig   `json:"system_configs"`
}

type syncCoursePeriod struct {
	Section string `json:"section"`
	Start   string `json:"start"`
	End     string `json:"end"`
}

type syncTimetable struct {
	UID           string             `json:"uid"`
	Owner         string             `json:"owner"`
	Name          string             `json:"name"`
	Location      string             `json:"location"`
	Position      int                `json:"position"`
	LessonMinutes int                `json:"lesson_minutes"`
	BreakMinutes  int                `json:"break_minutes"`
	PeriodCount   int                `json:"period_count"`
	Periods       []syncCoursePeriod `json:"periods,omitempty"`
	Deleted       bool               `json:"deleted,omitempty"`
	CreatedAt     time.Time          `json:"created_at"`
	UpdatedAt     time.Time          `json:"updated_at"`
}

type syncTimetableEntry struct {
	UID          string    `json:"uid"`
	Owner        string    `json:"owner"`
	TimetableUID string    `json:"timetable_uid"`
	Title        string    `json:"title"`
	Kind         string    `json:"kind"`
	Weekday      int       `json:"weekday"`
	WeekStart    string    `json:"week_start,omitempty"`
	StartTime    string    `json:"start_time"`
	EndTime      string    `json:"end_time"`
	Location     string    `json:"location"`
	Teacher      string    `json:"teacher"`
	Note         string    `json:"note"`
	Color        string    `json:"color"`
	Deleted      bool      `json:"deleted,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// syncUserConfig 是一个人的偏好设置（主题、字号、通知分钟、栏目开关…）。
// 同步的是「值 + 改动时间」，按 LWW 合并；同步自身的配置永远不在此列。
type syncUserConfig struct {
	Owner     string    `json:"owner"`
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

// syncSystemConfig 是站点级设置（站点名、周起始日、逾期口径…）。
// internal / 密钥类键不会出现在报文里，见 syncConfigSecrets。
type syncSystemConfig struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

var syncConfigSecrets = map[string]bool{
	"jwt_secret":             true,
	"sync_token":             true,
	"sync_instance_id":       true,
	"assistant_api_key":      true,
	"assistant_api_key2":     true,
	"qq_bot_token":           true,
	"smtp_password":          true,
	"backup_webdav_password": true,
	"email_password":         true,
	"sms_password":           true,
	"feishu_secret":          true,
	"dingtalk_secret":        true,
}

// syncCard 是一张信用卡。卡片挂在清单下，所以用 list_uid 指过去。
type syncCard struct {
	UID          string    `json:"uid"`
	Owner        string    `json:"owner"`
	ListUID      string    `json:"list_uid"`
	Name         string    `json:"name"`
	Bank         string    `json:"bank"`
	No           string    `json:"no"`
	Holder       string    `json:"holder"`
	Limit        int64     `json:"limit_cents"`
	StatementDay int       `json:"statement_day"`
	DueDay       int       `json:"due_day"`
	AdvanceDays  int       `json:"advance_days"`
	AutoRepeat   bool      `json:"auto_repeat"`
	Notes        string    `json:"notes"`
	Color        string    `json:"color"`
	Position     int       `json:"position"`
	Deleted      bool      `json:"deleted"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// syncCardStatement 是某张卡某一期的账单（金额与还款状态）。
type syncCardStatement struct {
	UID           string     `json:"uid"`
	Owner         string     `json:"owner"`
	CardUID       string     `json:"card_uid"`
	Period        string     `json:"period"`
	StatementDate time.Time  `json:"statement_date"`
	DueDate       time.Time  `json:"due_date"`
	Amount        int64      `json:"amount_cents"`
	Minimum       int64      `json:"minimum_cents"`
	PaidAt        *time.Time `json:"paid_at,omitempty"`
	PaidAmount    int64      `json:"paid_amount_cents"`
	Note          string     `json:"note"`
	Deleted       bool       `json:"deleted"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// syncUser 只用于「对端有哪些账号、本机能配上几个」的展示与跳过统计。
// 同步不会在对端创建账号：账号带密码、角色与飞牛绑定关系，自动造一个空壳
// 账号既解释不清也无法登录，反而让人以为数据丢了。
type syncUser struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

type syncList struct {
	UID       string `json:"uid"`
	Owner     string `json:"owner"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Icon      string `json:"icon"`
	Position  int    `json:"position"`
	IsDefault bool   `json:"is_default"`
	// 信用卡清单的卡片信息：不同步的话，另一台机器上就只剩一个空清单，
	// 看不到卡号/账单日，也生成不了还款计划。
	Template         string    `json:"template,omitempty"`
	CardName         string    `json:"card_name,omitempty"`
	CardBank         string    `json:"card_bank,omitempty"`
	CardNo           string    `json:"card_no,omitempty"`
	CardStatementDay int       `json:"card_statement_day,omitempty"`
	CardDueDay       int       `json:"card_due_day,omitempty"`
	CardNotes        string    `json:"card_notes,omitempty"`
	CardAutoRepeat   bool      `json:"card_auto_repeat,omitempty"`
	Deleted          bool      `json:"deleted"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type syncReminder struct {
	UID        string `json:"uid"`
	Owner      string `json:"owner"`
	ListUID    string `json:"list_uid"`
	Title      string `json:"title"`
	Notes      string `json:"notes"`
	BottomText string `json:"bottom_text,omitempty"`
	Icon       string `json:"icon,omitempty"`
	CardRole   string `json:"card_role,omitempty"`
	// 信用卡生成的提醒属于哪张卡：用 UID 指过去（对端要换成自己的卡片 ID）
	CardUID  string     `json:"card_uid,omitempty"`
	Kind     string     `json:"kind"`
	Priority int        `json:"priority"`
	DueAt    *time.Time `json:"due_at,omitempty"`
	AllDay   bool       `json:"all_day"`
	// 时间段任务的起止（计划页专用）；旧版本对端没有这两个字段，缺省即 NULL。
	StartAt             *time.Time `json:"start_at,omitempty"`
	EndAt               *time.Time `json:"end_at,omitempty"`
	RepeatRule          string     `json:"repeat_rule"`
	Calendar            string     `json:"calendar"`
	LunarAnchor         string     `json:"lunar_anchor,omitempty"`
	RepeatNotifyMinutes int        `json:"repeat_notify_minutes"`
	// Accent：仪式感卡片挑的过渡色（旧版本对端不认，忽略即可）
	Accent string `json:"accent,omitempty"`
	// Background：仪式感卡片的背景图（preset:<key> 或 /uploads/...）。
	// 只同步**路径**：内置图两端都有；上传的图片文件不传，对端会回落到配色渐变
	// （见 background.go 的说明）。
	Background string `json:"background,omitempty"`
	// BgBlur / BgMask：背景图的蒙板（虚化像素 / 蒙板浓度百分比，见 models.go）。
	// 老版本对端不认这两个字段，忽略即可（本机保持自己的值）。
	BgBlur       int        `json:"bg_blur,omitempty"`
	BgMask       int        `json:"bg_mask,omitempty"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
	SnoozedUntil *time.Time `json:"snoozed_until,omitempty"`
	Position     int        `json:"position"`
	Version      uint       `json:"version"`
	// Channels 只带渠道名（inapp/email/...），不带 Targets：Targets 存的是本机
	// channel_bindings 的自增 ID，到了对端指向的是别人的绑定。对端按渠道名重建，
	// 邮箱留空即「该用户在该机器上绑定的全部地址」。
	Channels  []string  `json:"channels"`
	Deleted   bool      `json:"deleted"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type syncCompletion struct {
	UID           string     `json:"uid"`
	Owner         string     `json:"owner"`
	ReminderUID   string     `json:"reminder_uid"`
	TitleSnapshot string     `json:"title_snapshot"`
	ScheduledFor  *time.Time `json:"scheduled_for,omitempty"`
	CompletedAt   time.Time  `json:"completed_at"`
	// Deleted 是墓碑：这条完成记录在源端被撤回了（例如「撤销已还」），
	// 对端收到后要把自己那份也撤回。老版本不认识这个字段，收到也只是当普通记录跳过，
	// 不会把「撤销」当成「又完成了一次」。
	Deleted bool `json:"deleted,omitempty"`
}

// syncApplyStats 是对端应用一份报文后的回执，也是本机展示「同步了什么」的依据。
type syncApplyStats struct {
	ListsCreated       int `json:"lists_created"`
	ListsUpdated       int `json:"lists_updated"`
	ListsDeleted       int `json:"lists_deleted"`
	RemindersCreated   int `json:"reminders_created"`
	RemindersUpdated   int `json:"reminders_updated"`
	RemindersDeleted   int `json:"reminders_deleted"`
	CompletionsCreated int `json:"completions_created"`
	CompletionsDeleted int `json:"completions_deleted"`

	CardsCreated          int      `json:"cards_created"`
	CardsUpdated          int      `json:"cards_updated"`
	CardsDeleted          int      `json:"cards_deleted"`
	CardStatementsCreated int      `json:"card_statements_created"`
	CardStatementsUpdated int      `json:"card_statements_updated"`
	CardStatementsDeleted int      `json:"card_statements_deleted"`
	TimetablesCreated     int      `json:"timetables_created"`
	TimetablesUpdated     int      `json:"timetables_updated"`
	TimetablesDeleted     int      `json:"timetables_deleted"`
	EntriesCreated        int      `json:"entries_created"`
	EntriesUpdated        int      `json:"entries_updated"`
	EntriesDeleted        int      `json:"entries_deleted"`
	ConfigsUpdated        int      `json:"configs_updated"`
	Skipped               int      `json:"skipped"`
	UnmappedUsers         []string `json:"unmapped_users,omitempty"`

	// AffectedUsers 不发给对端，只用于本机在同步落地后推送实时刷新事件。
	AffectedUsers []uint `json:"-"`
}

func (s *syncApplyStats) add(other syncApplyStats) {
	s.ListsCreated += other.ListsCreated
	s.ListsUpdated += other.ListsUpdated
	s.ListsDeleted += other.ListsDeleted
	s.RemindersCreated += other.RemindersCreated
	s.RemindersUpdated += other.RemindersUpdated
	s.RemindersDeleted += other.RemindersDeleted
	s.CompletionsCreated += other.CompletionsCreated
	s.CompletionsDeleted += other.CompletionsDeleted
	s.CardsCreated += other.CardsCreated
	s.CardsUpdated += other.CardsUpdated
	s.CardsDeleted += other.CardsDeleted
	s.CardStatementsCreated += other.CardStatementsCreated
	s.CardStatementsUpdated += other.CardStatementsUpdated
	s.CardStatementsDeleted += other.CardStatementsDeleted
	s.TimetablesCreated += other.TimetablesCreated
	s.TimetablesUpdated += other.TimetablesUpdated
	s.TimetablesDeleted += other.TimetablesDeleted
	s.EntriesCreated += other.EntriesCreated
	s.EntriesUpdated += other.EntriesUpdated
	s.EntriesDeleted += other.EntriesDeleted
	s.ConfigsUpdated += other.ConfigsUpdated
	s.Skipped += other.Skipped
	if len(other.UnmappedUsers) > 0 {
		seen := make(map[string]bool, len(s.UnmappedUsers))
		for _, u := range s.UnmappedUsers {
			seen[u] = true
		}
		for _, u := range other.UnmappedUsers {
			if !seen[u] {
				s.UnmappedUsers = append(s.UnmappedUsers, u)
				seen[u] = true
			}
		}
	}
	s.AffectedUsers = append(s.AffectedUsers, other.AffectedUsers...)
}

// total 返回这次同步实际落地的改动条数（跳过的不算）。
func (s syncApplyStats) total() int {
	return s.ListsCreated + s.ListsUpdated + s.ListsDeleted +
		s.RemindersCreated + s.RemindersUpdated + s.RemindersDeleted +
		s.CompletionsCreated + s.CompletionsDeleted +
		s.CardsCreated + s.CardsUpdated + s.CardsDeleted +
		s.CardStatementsCreated + s.CardStatementsUpdated + s.CardStatementsDeleted +
		s.TimetablesCreated + s.TimetablesUpdated + s.TimetablesDeleted +
		s.EntriesCreated + s.EntriesUpdated + s.EntriesDeleted + s.ConfigsUpdated
}

// syncResult 是一次同步的完整结果，序列化后存进 sync_last_detail 并返回给前端。
type syncResult struct {
	At         time.Time `json:"at"`
	Trigger    string    `json:"trigger"` // manual | auto
	Direction  string    `json:"direction"`
	Status     string    `json:"status"` // ok | error
	Message    string    `json:"message,omitempty"`
	DurationMS int64     `json:"duration_ms"`

	// Peer 是本次通信拿到的对端概况（推送方向的回执里也带着）。
	PeerInstanceID string `json:"peer_instance_id,omitempty"`
	PeerAppName    string `json:"peer_app_name,omitempty"`
	PeerAppVersion string `json:"peer_app_version,omitempty"`
	PeerSiteTitle  string `json:"peer_site_title,omitempty"`
	PeerUsers      int    `json:"peer_users,omitempty"`
	MatchedUsers   int    `json:"matched_users,omitempty"`
	// PeerClockSkewSeconds 是「对端自报生成时间」减本机时间。双向合并靠时间戳
	// 判断谁更新，两台机器差得多就会出现「改完又被旧数据盖回去」。
	PeerClockSkewSeconds int `json:"peer_clock_skew_seconds,omitempty"`

	// Pulled 是「从对端拉到本机」实际改动的条数，Pushed 是「本机推到对端」的。
	Pulled *syncApplyStats `json:"pulled,omitempty"`
	Pushed *syncApplyStats `json:"pushed,omitempty"`
}

// syncPeerInfo 是 /api/reminder/sync/snapshot 里除了数据本体之外的元信息，
// 单独取出来方便「测试连接」不必拉全量数据。
type syncPeerInfo struct {
	Format      int        `json:"format"`
	InstanceID  string     `json:"instance_id"`
	AppName     string     `json:"app_name"`
	AppVersion  string     `json:"app_version"`
	SiteTitle   string     `json:"site_title"`
	GeneratedAt time.Time  `json:"generated_at"`
	Users       []syncUser `json:"users"`
	Lists       int        `json:"lists"`
	Reminders   int        `json:"reminders"`
	Completions int        `json:"completions"`
}
