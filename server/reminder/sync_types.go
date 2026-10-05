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
	Format      int              `json:"format"`
	InstanceID  string           `json:"instance_id"`
	AppName     string           `json:"app_name"`
	AppVersion  string           `json:"app_version"`
	SiteTitle   string           `json:"site_title"`
	GeneratedAt time.Time        `json:"generated_at"`
	Users       []syncUser       `json:"users"`
	Lists       []syncList       `json:"lists"`
	Reminders   []syncReminder   `json:"reminders"`
	Completions []syncCompletion `json:"completions"`
}

// syncUser 只用于「对端有哪些账号、本机能配上几个」的展示与跳过统计。
// 同步不会在对端创建账号：账号带密码、角色与飞牛绑定关系，自动造一个空壳
// 账号既解释不清也无法登录，反而让人以为数据丢了。
type syncUser struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

type syncList struct {
	UID       string    `json:"uid"`
	Owner     string    `json:"owner"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	Icon      string    `json:"icon"`
	Position  int       `json:"position"`
	IsDefault bool      `json:"is_default"`
	Deleted   bool      `json:"deleted"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type syncReminder struct {
	UID                 string     `json:"uid"`
	Owner               string     `json:"owner"`
	ListUID             string     `json:"list_uid"`
	Title               string     `json:"title"`
	Notes               string     `json:"notes"`
	Kind                string     `json:"kind"`
	Priority            int        `json:"priority"`
	DueAt               *time.Time `json:"due_at,omitempty"`
	AllDay              bool       `json:"all_day"`
	RepeatRule          string     `json:"repeat_rule"`
	Calendar            string     `json:"calendar"`
	LunarAnchor         string     `json:"lunar_anchor,omitempty"`
	RepeatNotifyMinutes int        `json:"repeat_notify_minutes"`
	CompletedAt         *time.Time `json:"completed_at,omitempty"`
	SnoozedUntil        *time.Time `json:"snoozed_until,omitempty"`
	Position            int        `json:"position"`
	Version             uint       `json:"version"`
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
}

// syncApplyStats 是对端应用一份报文后的回执，也是本机展示「同步了什么」的依据。
type syncApplyStats struct {
	ListsCreated       int      `json:"lists_created"`
	ListsUpdated       int      `json:"lists_updated"`
	ListsDeleted       int      `json:"lists_deleted"`
	RemindersCreated   int      `json:"reminders_created"`
	RemindersUpdated   int      `json:"reminders_updated"`
	RemindersDeleted   int      `json:"reminders_deleted"`
	CompletionsCreated int      `json:"completions_created"`
	Skipped            int      `json:"skipped"`
	UnmappedUsers      []string `json:"unmapped_users,omitempty"`

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
		s.CompletionsCreated
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
