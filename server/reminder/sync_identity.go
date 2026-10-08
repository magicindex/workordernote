package reminder

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"time"

	"smallgo/server/database"
	"smallgo/server/logger"

	"gorm.io/gorm"
)

// 双机同步的跨实例身份（sync_uid）。
//
// 为什么需要它，而不是直接用自增主键：两台 NAS 上的自增序列互不相关，
// A 的 list_id=2 和 B 的 list_id=2 是两条毫不相干的数据。同步要能回答
// 「对端这条数据我这边有没有」，就必须有一个跨安装稳定的键。
//
// 取值分两种来源：
//
//  1. 功能上线之后新建的行：BeforeCreate 钩子分配 32 位随机十六进制（见
//     ensureSyncUID）。数据目录整体复制到另一台时，随机值也一起复制过去，
//     两台机器上还是同一个键——这正是我们想要的。
//  2. 功能上线之前就存在的历史行：BackfillSyncUIDs 在启动时按**内容**算一个
//     确定性摘要补上。用确定性摘要而不是随机值的唯一原因，是覆盖「先在两台
//     机器上各跑过一段时间、后来才想同步」这个场景之外的另一种常见部署：
//     把已有安装的数据目录整份复制到新机器。那种情况下两条记录内容完全一致，
//     确定性摘要会让它们得到同一个键，首次同步不会把同一批数据复制成两份。

// newSyncUID 生成一个新的跨实例标识：16 字节随机数的十六进制（32 字符）。
func newSyncUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ensureSyncUID 只在该行还没有标识时分配一个。同步写入的行自带对端的标识，
// 这里必须原样保留，否则每次同步都会在对端多出一份副本。
func ensureSyncUID(uid *string) error {
	if uid == nil || *uid != "" {
		return nil
	}
	value, err := newSyncUID()
	if err != nil {
		return err
	}
	*uid = value
	return nil
}

// BeforeCreate 钩子让所有新建路径（普通接口、记事、完成历史、同步写入）
// 自动带上标识，不必逐个改动调用点。同步写入时字段已有值，这里不会覆盖。
func (l *List) BeforeCreate(*gorm.DB) error       { return ensureSyncUID(&l.SyncUID) }
func (r *Reminder) BeforeCreate(*gorm.DB) error   { return ensureSyncUID(&r.SyncUID) }
func (c *Completion) BeforeCreate(*gorm.DB) error { return ensureSyncUID(&c.SyncUID) }

// 信用卡：卡片与账单期也要有同步标识，否则快照里 UID 为空、对端整批跳过
// （卡片就同步不过去，提醒也会丢掉 card_id —— 踩过）。
func (c *Card) BeforeCreate(*gorm.DB) error          { return ensureSyncUID(&c.SyncUID) }
func (s *CardStatement) BeforeCreate(*gorm.DB) error { return ensureSyncUID(&s.SyncUID) }

// syncDigest 把若干字段拼成一个确定性摘要（32 位十六进制）。字段之间用 0x1f
// 分隔，避免 ("ab","c") 与 ("a","bc") 撞成同一个值。
func syncDigest(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0x1f})
	}
	return hex.EncodeToString(h.Sum(nil))[:32]
}

// digestStamp 把时间统一成 UTC 的 RFC3339Nano 再参与摘要。
//
// 必须统一时区：同一个时刻在两台机器上可能带不同的偏移量（本机容器 TZ 是
// Asia/Shanghai，而 due_at 是按 UTC 存的），直接 Format 会算出不同的摘要，
// 复制部署的两台机器就对不上了。
func digestStamp(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

// BackfillSyncUIDs 给同步功能上线之前的历史数据补标识，幂等，启动时调用一次。
//
// 顺序不能反：完成历史要引用所属提醒的标识，所以提醒先补。
func BackfillSyncUIDs(db *gorm.DB) error {
	usernames, err := usernameByID(db)
	if err != nil {
		return err
	}

	// ---- 信用卡（卡片按 用户+银行+卡名+创建时间 生成稳定摘要）----
	var cards []Card
	if err := db.Where("sync_uid IS NULL OR sync_uid = ''").Find(&cards).Error; err != nil {
		return err
	}
	for i := range cards {
		uid := syncDigest("card", usernames[cards[i].UserID], cards[i].Bank, cards[i].Name,
			strconv.FormatUint(uint64(cards[i].ListID), 10), digestStamp(&cards[i].CreatedAt))
		if err := db.Model(&Card{}).Where("id = ?", cards[i].ID).
			UpdateColumn("sync_uid", uid).Error; err != nil {
			return err
		}
	}
	var statements []CardStatement
	if err := db.Where("sync_uid IS NULL OR sync_uid = ''").Find(&statements).Error; err != nil {
		return err
	}
	for i := range statements {
		uid := syncDigest("card_statement", usernames[statements[i].UserID],
			strconv.FormatUint(uint64(statements[i].CardID), 10), statements[i].Period)
		if err := db.Model(&CardStatement{}).Where("id = ?", statements[i].ID).
			UpdateColumn("sync_uid", uid).Error; err != nil {
			return err
		}
	}

	// ---- 清单 ----
	var lists []List
	if err := db.Where("sync_uid IS NULL OR sync_uid = ''").Find(&lists).Error; err != nil {
		return err
	}
	for i := range lists {
		uid := syncDigest("list", usernames[lists[i].UserID], lists[i].Name,
			digestStamp(&lists[i].CreatedAt))
		// UpdateColumn 而不是 Update：不触发时间戳自动更新，历史行不会因为
		// 补标识而看起来「刚刚被改过」，否则首次同步会让对端整批覆盖。
		if err := db.Model(&List{}).Where("id = ?", lists[i].ID).
			UpdateColumn("sync_uid", uid).Error; err != nil {
			return err
		}
	}

	// ---- 提醒 / 记事 ----
	listNames, err := listNameByID(db)
	if err != nil {
		return err
	}
	var reminders []Reminder
	if err := db.Where("sync_uid IS NULL OR sync_uid = ''").Find(&reminders).Error; err != nil {
		return err
	}
	reminderUID := make(map[uint]string, len(reminders))
	for i := range reminders {
		item := &reminders[i]
		uid := syncDigest("reminder", usernames[item.UserID], item.Title, item.Kind,
			item.Notes, item.RepeatRule, digestStamp(item.DueAt), digestStamp(&item.CreatedAt),
			listNames[item.ListID])
		if err := db.Model(&Reminder{}).Where("id = ?", item.ID).
			UpdateColumn("sync_uid", uid).Error; err != nil {
			return err
		}
		reminderUID[item.ID] = uid
	}

	// ---- 完成历史 ----
	// 用 Unscoped：被撤回（软删）的完成记录同样要靠 UID 才能把墓碑同步出去。
	var completions []Completion
	if err := db.Unscoped().Where("sync_uid IS NULL OR sync_uid = ''").Find(&completions).Error; err != nil {
		return err
	}
	for i := range completions {
		item := &completions[i]
		reminderKey := reminderUID[item.ReminderID]
		if reminderKey == "" {
			// 所属提醒的标识早就有了（不是本次补的），补一次查询即可。
			var owner Reminder
			if err := db.Select("sync_uid").Where("id = ?", item.ReminderID).First(&owner).Error; err == nil {
				reminderKey = owner.SyncUID
			}
		}
		uid := syncDigest("completion", usernames[item.UserID], reminderKey, item.TitleSnapshot,
			digestStamp(item.ScheduledFor), digestStamp(&item.CompletedAt))
		if err := db.Model(&Completion{}).Where("id = ?", item.ID).
			UpdateColumn("sync_uid", uid).Error; err != nil {
			return err
		}
	}

	total := len(lists) + len(reminders) + len(completions)
	if total > 0 {
		logger.Info("sync: 已为 %d 条历史数据（清单 %d / 提醒 %d / 完成记录 %d）补齐同步标识",
			total, len(lists), len(reminders), len(completions))
	}
	return nil
}

func usernameByID(db *gorm.DB) (map[uint]string, error) {
	type row struct {
		ID       uint
		Username string
	}
	var rows []row
	if err := db.Model(&database.User{}).Select("id, username").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[uint]string, len(rows))
	for _, r := range rows {
		out[r.ID] = r.Username
	}
	return out, nil
}

func usernameByName(db *gorm.DB) (map[string]database.User, error) {
	var users []database.User
	if err := db.Find(&users).Error; err != nil {
		return nil, err
	}
	out := make(map[string]database.User, len(users))
	for _, u := range users {
		out[u.Username] = u
	}
	return out, nil
}

func listNameByID(db *gorm.DB) (map[uint]string, error) {
	type row struct {
		ID   uint
		Name string
	}
	var rows []row
	if err := db.Model(&List{}).Select("id, name").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[uint]string, len(rows))
	for _, r := range rows {
		out[r.ID] = r.Name
	}
	return out, nil
}
