package reminder

import (
	"time"

	"smallgo/server/version"

	"gorm.io/gorm"
)

// buildSyncSnapshot 读出本机的全部可同步数据，组装成一份同步报文。
//
// 同步哪些、不同步哪些，是一条条权衡出来的：
//
//   - 同步：清单、提醒/记事、完成历史、提醒所选的渠道名。
//     这些是用户真正的内容资产，换一台机器应该一模一样。
//   - 不同步：账号与密码、通知渠道绑定（邮箱/短信/机器人凭据）、管理员维护的
//     provider 密钥、投递记录、站内通知、操作日志、系统配置、飞牛绑定关系。
//     它们是「这台机器的运行环境」，不是内容。把对端的短信凭据搬过来会在错误的
//     机器上发消息；把对端的令牌搬过来等于把两台机器的管理员权限混成一个。
//
// 顺序固定为 用户 → 清单 → 提醒 → 完成历史：应用时按同一顺序落地，
// 提醒要靠清单、完成历史要靠提醒，先有后引用。
func buildSyncSnapshot(db *gorm.DB) (syncSnapshot, error) {
	settings, err := loadSyncSettings(db)
	if err != nil {
		return syncSnapshot{}, err
	}
	snap := syncSnapshot{
		Format:      syncFormat,
		InstanceID:  settings.InstanceID,
		AppName:     version.AppName,
		AppVersion:  version.Version,
		SiteTitle:   syncConfigValue(db, "site_title"),
		GeneratedAt: time.Now(),
	}

	users, err := usernameByID(db)
	if err != nil {
		return snap, err
	}
	snap.Users = make([]syncUser, 0, len(users))
	{
		var rows []struct {
			ID       uint
			Username string
			Role     string
		}
		if err := db.Table("users").Select("id, username, role").Find(&rows).Error; err != nil {
			return snap, err
		}
		for _, r := range rows {
			snap.Users = append(snap.Users, syncUser{Username: r.Username, Role: r.Role})
		}
	}
	var lists []List
	if err := db.Find(&lists).Error; err != nil {
		return snap, err
	}
	listUID := make(map[uint]string, len(lists))
	snap.Lists = make([]syncList, 0, len(lists))
	for _, l := range lists {
		listUID[l.ID] = l.SyncUID
		snap.Lists = append(snap.Lists, syncList{
			UID:              l.SyncUID,
			Owner:            users[l.UserID],
			Name:             l.Name,
			Color:            l.Color,
			Icon:             l.Icon,
			Position:         l.Position,
			IsDefault:        l.IsDefault,
			Template:         l.Template,
			CardName:         l.CardName,
			CardBank:         l.CardBank,
			CardNo:           l.CardNo,
			CardStatementDay: l.CardStatementDay,
			CardDueDay:       l.CardDueDay,
			CardNotes:        l.CardNotes,
			CardAutoRepeat:   l.CardAutoRepeat,
			Deleted:          l.DeletedAt != nil,
			CreatedAt:        l.CreatedAt,
			UpdatedAt:        l.UpdatedAt,
		})
	}

	var reminders []Reminder
	if err := db.Find(&reminders).Error; err != nil {
		return snap, err
	}
	channelRows, err := loadChannelNames(db)
	if err != nil {
		return snap, err
	}
	snap.Reminders = make([]syncReminder, 0, len(reminders))
	for _, r := range reminders {
		snap.Reminders = append(snap.Reminders, syncReminder{
			UID:                 r.SyncUID,
			Owner:               users[r.UserID],
			ListUID:             listUID[r.ListID],
			Title:               r.Title,
			Notes:               r.Notes,
			CardRole:            r.CardRole,
			Kind:                r.Kind,
			Priority:            r.Priority,
			DueAt:               r.DueAt,
			AllDay:              r.AllDay,
			RepeatRule:          r.RepeatRule,
			Calendar:            r.Calendar,
			LunarAnchor:         r.LunarAnchor,
			RepeatNotifyMinutes: r.RepeatNotifyMinutes,
			CompletedAt:         r.CompletedAt,
			SnoozedUntil:        r.SnoozedUntil,
			Position:            r.Position,
			Version:             r.Version,
			Channels:            channelRows[r.ID],
			Deleted:             r.DeletedAt != nil,
			CreatedAt:           r.CreatedAt,
			UpdatedAt:           r.UpdatedAt,
		})
	}

	var completions []Completion
	if err := db.Find(&completions).Error; err != nil {
		return snap, err
	}
	reminderUID := make(map[uint]string, len(reminders))
	for _, r := range reminders {
		reminderUID[r.ID] = r.SyncUID
	}
	snap.Completions = make([]syncCompletion, 0, len(completions))
	for _, c := range completions {
		snap.Completions = append(snap.Completions, syncCompletion{
			UID:           c.SyncUID,
			Owner:         users[c.UserID],
			ReminderUID:   reminderUID[c.ReminderID],
			TitleSnapshot: c.TitleSnapshot,
			ScheduledFor:  c.ScheduledFor,
			CompletedAt:   c.CompletedAt,
		})
	}
	return snap, nil
}

// loadChannelNames 读「提醒 ID → 已启用渠道名」。只带名字不带 Targets，
// 原因见 syncReminder.Channels。
func loadChannelNames(db *gorm.DB) (map[uint][]string, error) {
	var rows []ReminderChannel
	if err := db.Where("enabled = ?", true).Order("reminder_id ASC, channel ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[uint][]string)
	for _, row := range rows {
		out[row.ReminderID] = append(out[row.ReminderID], row.Channel)
	}
	return out, nil
}
