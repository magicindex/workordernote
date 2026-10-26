package reminder

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"smallgo/server/database"

	"gorm.io/gorm"
)

// applySyncSnapshot 把对端的一份报文合并进本机，返回各类改动的条数。
//
// 合并规则（两台机器都必须按同一套规则判断，结果才能收敛）：
//
//  1. 按 sync_uid 配对同一行数据；本机没有就新建（保留对端的创建/更新时间）。
//  2. 本机已有则比时间戳，谁新谁生效；完全相同则比实例标识，大的一方生效。
//     平局必须有一致的裁决，否则两台机器各自「保留本机」就是永久分叉。
//  3. 已删除的行也参与同步（软删除保留 deleted_at，本身就是墓碑），
//     所以「在 A 删掉的任务」不会在下次同步时从 B 复活。
//  4. 对端账号在本机不存在时跳过其数据并计数上报，不自动建账号
//     （账号带密码、角色与飞牛绑定，凭空建一个空壳账号解释不清也无法登录）。
//
// 整个合并放在一个事务里：同步要么整体落地，要么一条都不落，不会留下
// 「清单进来了、里面的提醒没进来」这种半截状态。
func applySyncSnapshot(db *gorm.DB, snap syncSnapshot) (syncApplyStats, error) {
	var stats syncApplyStats
	if snap.Format != syncFormat {
		return stats, fmt.Errorf("对端报文版本 %d 与本机 %d 不兼容，请先把两端升级到同一版本", snap.Format, syncFormat)
	}
	settings, err := loadSyncSettings(db)
	if err != nil {
		return stats, err
	}
	if snap.InstanceID == "" {
		return stats, errors.New("对端没有报出实例标识")
	}
	if snap.InstanceID == settings.InstanceID {
		return stats, errors.New("对端实例标识与本机相同：对端地址可能填成了本机自己的地址")
	}
	users, err := usernameByName(db)
	if err != nil {
		return stats, err
	}

	err = db.Transaction(func(tx *gorm.DB) error {
		listID, err := applySyncLists(tx, snap, users, settings.InstanceID, &stats)
		if err != nil {
			return err
		}
		cardID, err := applySyncCards(tx, snap, users, listID, settings.InstanceID, &stats)
		if err != nil {
			return err
		}
		reminderID, err := applySyncReminders(tx, snap, users, listID, cardID, settings.InstanceID, &stats)
		if err != nil {
			return err
		}
		if err := applySyncCardStatements(tx, snap, users, cardID, settings.InstanceID, &stats); err != nil {
			return err
		}
		if err := applySyncCompletions(tx, snap, users, reminderID, &stats); err != nil {
			return err
		}
		tableID, err := applySyncTimetables(tx, snap, users, settings.InstanceID, &stats)
		if err != nil {
			return err
		}
		if err := applySyncTimetableEntries(tx, snap, users, tableID, settings.InstanceID, &stats); err != nil {
			return err
		}
		if err := applySyncUserConfigs(tx, snap, users, &stats); err != nil {
			return err
		}
		return applySyncSystemConfigs(tx, snap, &stats)
	})
	if err != nil {
		return syncApplyStats{}, err
	}
	stats.AffectedUsers = dedupeUint(stats.AffectedUsers)
	return stats, nil
}

// incomingWins 判断对端的这一行是否应该覆盖本机。
//
// 时间戳相同时用实例标识兜底：两台机器各自「保留本机」会让它们永久分叉，
// 而实例标识是双方都知道的确定值，选大的一方两边都会得出同一个结论。
func incomingWins(local, incoming time.Time, incomingInstance, myInstance string) bool {
	if incoming.After(local) {
		return true
	}
	if incoming.Equal(local) {
		return incomingInstance > myInstance
	}
	return false
}

func markUnmapped(stats *syncApplyStats, username string) {
	stats.Skipped++
	if username == "" {
		// 孤儿数据（早期测试留下的 user_id 指向已不存在的账号）不该被报成
		// 「对端账号在本机不存在」，否则会误导用户去查一个空名字。
		return
	}
	for _, existing := range stats.UnmappedUsers {
		if existing == username {
			return
		}
	}
	stats.UnmappedUsers = append(stats.UnmappedUsers, username)
}

func applySyncLists(tx *gorm.DB, snap syncSnapshot, users map[string]database.User, myInstance string, stats *syncApplyStats) (map[string]uint, error) {
	var locals []List
	if err := tx.Find(&locals).Error; err != nil {
		return nil, err
	}
	byUID := make(map[string]*List, len(locals))
	for i := range locals {
		if locals[i].SyncUID != "" {
			byUID[locals[i].SyncUID] = &locals[i]
		}
	}
	// 本次被删除的清单，用于最后收拢孤儿提醒。
	var deletedListIDs []uint

	out := make(map[string]uint, len(snap.Lists))
	for _, incoming := range snap.Lists {
		if incoming.UID == "" {
			stats.Skipped++
			continue
		}
		owner, ok := users[incoming.Owner]
		if !ok {
			markUnmapped(stats, incoming.Owner)
			continue
		}
		existing := byUID[incoming.UID]
		if existing == nil {
			// 两台机器各自初始化时都会自动建一个默认清单「提醒」（见
			// ensureDefaultList），它们是「同一个默认清单」的两个副本，只是各自
			// 生成了不同标识。认领之后，两边的默认清单就是同一条数据了。
			existing = adoptLocalDefaultList(tx, owner.ID, incoming)
		}
		if existing == nil {
			if incoming.Deleted {
				// 本机从来没有过这条清单，对方的删除对本机没有意义。
				continue
			}
			row := List{
				SyncUID:   incoming.UID,
				UserID:    owner.ID,
				Name:      incoming.Name,
				Color:     incoming.Color,
				Icon:      incoming.Icon,
				Position:  incoming.Position,
				IsDefault: false,
				CreatedAt: incoming.CreatedAt,
				UpdatedAt: incoming.UpdatedAt,
				// 模板也要一起落：信用卡账单栏目（template=credit_card）是对端建的，
				// 漏了它，这一栏在新设备上会变成普通清单，卡片页不再认识它
				// （老用例只按名字断言，所以这个漏字段一直没被发现）。
				Template: normalizeListTemplate(incoming.Template),
			}
			// 默认清单是「本机偏好」，只在新建时采纳对端的标记，而且必须
			// 确认本机此刻还没有默认清单——否则会出现两个默认清单，
			// 新建提醒该进哪个就说不清了。
			if incoming.IsDefault && !hasDefaultList(tx, owner.ID) {
				row.IsDefault = true
			}
			if err := tx.Create(&row).Error; err != nil {
				return nil, err
			}
			byUID[incoming.UID] = &row
			out[incoming.UID] = row.ID
			stats.ListsCreated++
			stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
			continue
		}
		out[incoming.UID] = existing.ID
		if existing.UserID != owner.ID {
			// 同一个标识落到了另一个账号名下（早期测试数据的孤儿行）。不该静默
			// 改写归属，也不该报成「账号不存在」——账号在，是这条数据对不上。
			stats.Skipped++
			continue
		}
		if sameList(existing, incoming) {
			// 内容完全一致：不写业务字段，也不该计成一次「更新」——否则每次同步
			// 都会报一堆「更新 40 条」，用户以为数据一直在被改动。但时间戳要跟着
			// 追平（静默），否则两台机器的「最后修改时间」永久不一致，将来某次
			// 合并的胜负判断会拿着一个过期的基准。
			if incomingWins(existing.UpdatedAt, incoming.UpdatedAt, snap.InstanceID, myInstance) {
				if err := tx.Model(&List{}).Where("id = ?", existing.ID).
					UpdateColumn("updated_at", incoming.UpdatedAt).Error; err != nil {
					return nil, err
				}
			}
			stats.Skipped++
			continue
		}
		if !incomingWins(existing.UpdatedAt, incoming.UpdatedAt, snap.InstanceID, myInstance) {
			stats.Skipped++
			continue
		}
		if incoming.Deleted {
			if existing.DeletedAt == nil {
				// 只软删清单，不在这里搬提醒：同一次报文里的提醒行带着源端的权威
				// 归属（源端删清单时已经把提醒挪到它的默认清单），随后按各自的
				// list_uid 落地即可。这里若抢先「挪到本机默认清单」，就会给提醒
				// 写上一个本机时间戳，把源端那份同样内容的改动判成更旧而丢弃，
				// 两台机器的 updated_at 从此永久差一点点，每次同步都白跑一轮。
				if err := tx.Model(&List{}).Where("id = ?", existing.ID).
					Updates(map[string]interface{}{"deleted_at": incoming.UpdatedAt, "updated_at": incoming.UpdatedAt}).Error; err != nil {
					return nil, err
				}
				deletedListIDs = append(deletedListIDs, existing.ID)
				stats.ListsDeleted++
				stats.AffectedUsers = append(stats.AffectedUsers, existing.UserID)
			} else {
				stats.Skipped++
			}
			continue
		}
		if existing.DeletedAt != nil {
			// 本机删了、对端还在改：时间戳更新的一方说了算，这里对端更新，
			// 于是清单复活——同时要清掉删除标记。
			if err := tx.Model(&List{}).Where("id = ?", existing.ID).
				Updates(map[string]interface{}{
					"name": incoming.Name, "color": incoming.Color, "icon": incoming.Icon,
					"position": incoming.Position, "deleted_at": nil, "updated_at": incoming.UpdatedAt,
					"template": normalizeListTemplate(incoming.Template),
				}).Error; err != nil {
				return nil, err
			}
			stats.ListsUpdated++
			stats.AffectedUsers = append(stats.AffectedUsers, existing.UserID)
			continue
		}
		if err := tx.Model(&List{}).Where("id = ?", existing.ID).
			Updates(map[string]interface{}{
				"name": incoming.Name, "color": incoming.Color, "icon": incoming.Icon,
				"position": incoming.Position, "updated_at": incoming.UpdatedAt,
				"template": normalizeListTemplate(incoming.Template),
			}).Error; err != nil {
			return nil, err
		}
		stats.ListsUpdated++
		stats.AffectedUsers = append(stats.AffectedUsers, existing.UserID)
	}

	if len(deletedListIDs) > 0 {
		if err := repointOrphanReminders(tx, deletedListIDs); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// adoptLocalDefaultList 认领本机同名的默认清单。
//
// 只认「对端标记为默认 + 本机存在同名且仍有效的默认清单」这一种情况：这是两台
// 机器各自初始化留下的同一个默认清单的两个副本，合并是安全的。名字不同的默认
// 清单不合并——那更像是用户真的建了两份不同的清单。
func adoptLocalDefaultList(tx *gorm.DB, userID uint, incoming syncList) *List {
	if !incoming.IsDefault || incoming.Name == "" {
		return nil
	}
	var local List
	if err := tx.Where("user_id = ? AND is_default = ? AND deleted_at IS NULL AND name = ?",
		userID, true, incoming.Name).First(&local).Error; err != nil {
		return nil
	}
	if err := tx.Model(&List{}).Where("id = ?", local.ID).
		UpdateColumn("sync_uid", incoming.UID).Error; err != nil {
		return nil
	}
	local.SyncUID = incoming.UID
	return &local
}

// repointOrphanReminders 把仍挂在「已被对端删除的清单」上的本机提醒挪到默认清单。
//
// 正常路径用不到（源端删清单时已经搬过一遍），但两边各自新建的数据会造出孤儿：
// 本机在清单里新建了一条提醒、还没同步出去，对端就把这个清单删了。不修的话这条
// 提醒会挂在一个已删除的清单上，从界面上直接消失。
func repointOrphanReminders(tx *gorm.DB, listIDs []uint) error {
	var owners []uint
	if err := tx.Model(&Reminder{}).
		Where("list_id IN ? AND deleted_at IS NULL", listIDs).
		Distinct().Pluck("user_id", &owners).Error; err != nil {
		return err
	}
	for _, userID := range owners {
		fallback, err := ensureDefaultList(tx, userID)
		if err != nil {
			return err
		}
		// UpdateColumn：保留提醒自己的 updated_at，不让「收拢孤儿」这件事
		// 把数据伪装成刚被修改过。
		if err := tx.Model(&Reminder{}).
			Where("user_id = ? AND list_id IN ? AND deleted_at IS NULL", userID, listIDs).
			UpdateColumn("list_id", fallback.ID).Error; err != nil {
			return err
		}
	}
	return nil
}

func applySyncReminders(tx *gorm.DB, snap syncSnapshot, users map[string]database.User, listIDs map[string]uint, cardIDs map[string]uint, myInstance string, stats *syncApplyStats) (map[string]uint, error) {
	var locals []Reminder
	if err := tx.Find(&locals).Error; err != nil {
		return nil, err
	}
	localChannels, err := loadChannelNames(tx)
	if err != nil {
		return nil, err
	}
	byUID := make(map[string]*Reminder, len(locals))
	out := make(map[string]uint, len(locals)+len(snap.Reminders))
	for i := range locals {
		if locals[i].SyncUID != "" {
			byUID[locals[i].SyncUID] = &locals[i]
			out[locals[i].SyncUID] = locals[i].ID
		}
	}

	for _, incoming := range snap.Reminders {
		if incoming.UID == "" {
			stats.Skipped++
			continue
		}
		owner, ok := users[incoming.Owner]
		if !ok {
			markUnmapped(stats, incoming.Owner)
			continue
		}
		listID := listIDs[incoming.ListUID]
		existing := byUID[incoming.UID]
		if existing == nil {
			if incoming.Deleted {
				continue
			}
			if normalizeKind(incoming.Kind) == KindNote {
				// 记事本栏目是**本机自己的固定栏目**：对端同步过来的记事也归到本机这一栏，
				// 不跟着对端的清单走（各机的记事本清单 id 不同，跟着走会在本机乱建清单）。
				bucket, err := ensureNoteBucket(tx, owner.ID)
				if err != nil {
					return nil, err
				}
				listID = bucket.ID
			} else if listID == 0 {
				fallback, err := ensureDefaultList(tx, owner.ID)
				if err != nil {
					return nil, err
				}
				listID = fallback.ID
			}
			row := Reminder{
				SyncUID: incoming.UID, UserID: owner.ID, ListID: listID,
				Title: incoming.Title, Notes: incoming.Notes, BottomText: incoming.BottomText, CardRole: incoming.CardRole,
				CardID:   cardIDs[incoming.CardUID],
				Kind:     normalizeKind(incoming.Kind),
				Priority: incoming.Priority, DueAt: incoming.DueAt, AllDay: incoming.AllDay,
				StartAt: incoming.StartAt, EndAt: incoming.EndAt,
				RepeatRule: incoming.RepeatRule, Calendar: incoming.Calendar,
				LunarAnchor: incoming.LunarAnchor, Accent: incoming.Accent,
				Background: incoming.Background,
				BgBlur:     incoming.BgBlur,
				BgMask:     incoming.BgMask,
				RepeatNotifyMinutes: incoming.RepeatNotifyMinutes,
				CompletedAt: incoming.CompletedAt, SnoozedUntil: incoming.SnoozedUntil,
				Position: incoming.Position, Version: incoming.Version,
				CreatedAt: incoming.CreatedAt, UpdatedAt: incoming.UpdatedAt,
			}
			if err := tx.Create(&row).Error; err != nil {
				return nil, err
			}
			if err := replaceChannels(tx, row, SaveReminderInput{Channels: incoming.Channels}); err != nil {
				return nil, err
			}
			if err := scheduleSyncedJobs(tx, row, incoming.Channels); err != nil {
				return nil, err
			}
			byUID[incoming.UID] = &row
			out[incoming.UID] = row.ID
			stats.RemindersCreated++
			stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
			continue
		}
		out[incoming.UID] = existing.ID
		if existing.UserID != owner.ID {
			stats.Skipped++
			continue
		}
		if sameReminder(existing, incoming, listID, localChannels[existing.ID]) {
			if incomingWins(existing.UpdatedAt, incoming.UpdatedAt, snap.InstanceID, myInstance) {
				if err := tx.Model(&Reminder{}).Where("id = ?", existing.ID).
					UpdateColumn("updated_at", incoming.UpdatedAt).Error; err != nil {
					return nil, err
				}
			}
			stats.Skipped++
			continue
		}
		if !incomingWins(existing.UpdatedAt, incoming.UpdatedAt, snap.InstanceID, myInstance) {
			stats.Skipped++
			continue
		}
		if incoming.Deleted {
			if existing.DeletedAt == nil {
				if err := tx.Model(&DeliveryJob{}).
					Where("reminder_id = ? AND user_id = ? AND status IN ?", existing.ID, existing.UserID, []string{"pending", "retry"}).
					Update("status", "cancelled").Error; err != nil {
					return nil, err
				}
				if err := retireDueNotifications(tx, existing.UserID, existing.ID, incoming.UpdatedAt); err != nil {
					return nil, err
				}
				if err := tx.Model(&Reminder{}).Where("id = ?", existing.ID).
					Updates(map[string]interface{}{"deleted_at": incoming.UpdatedAt, "updated_at": incoming.UpdatedAt}).Error; err != nil {
					return nil, err
				}
				stats.RemindersDeleted++
				stats.AffectedUsers = append(stats.AffectedUsers, existing.UserID)
			} else {
				stats.Skipped++
			}
			continue
		}
		if normalizeKind(incoming.Kind) == KindNote {
			bucket, err := ensureNoteBucket(tx, owner.ID)
			if err != nil {
				return nil, err
			}
			listID = bucket.ID
		} else if listID == 0 {
			fallback, err := ensureDefaultList(tx, owner.ID)
			if err != nil {
				return nil, err
			}
			listID = fallback.ID
		}
		// 用 map 而不是结构体更新：结构体更新会跳过零值（清不掉 completed_at、
		// snoozed_until、deleted_at），而且会顺手把 updated_at 改成「现在」，
		// 那会让本机的时间戳凭空领先对端，双向同步时对方的每次修改都被判成更旧。
		if err := tx.Model(&Reminder{}).Where("id = ?", existing.ID).
			Updates(map[string]interface{}{
				"list_id": listID, "title": incoming.Title, "notes": incoming.Notes,
				"bottom_text": incoming.BottomText,
				"card_role": incoming.CardRole, "card_id": cardIDs[incoming.CardUID],
				"kind": normalizeKind(incoming.Kind), "priority": incoming.Priority,
				"due_at": incoming.DueAt, "all_day": incoming.AllDay,
				"start_at": incoming.StartAt, "end_at": incoming.EndAt,
				"repeat_rule": incoming.RepeatRule, "calendar": incoming.Calendar,
				"lunar_anchor":          incoming.LunarAnchor,
				"accent":                incoming.Accent,
				"background":            incoming.Background,
				"bg_blur":               incoming.BgBlur,
				"bg_mask":               incoming.BgMask,
				"repeat_notify_minutes": incoming.RepeatNotifyMinutes,
				"completed_at":          incoming.CompletedAt, "snoozed_until": incoming.SnoozedUntil,
				"position": incoming.Position, "version": incoming.Version,
				"deleted_at": nil, "updated_at": incoming.UpdatedAt,
			}).Error; err != nil {
			return nil, err
		}
		existing.ListID = listID
		existing.Title = incoming.Title
		existing.DueAt = incoming.DueAt
		existing.CompletedAt = incoming.CompletedAt
		existing.SnoozedUntil = incoming.SnoozedUntil
		existing.Version = incoming.Version
		existing.DeletedAt = nil
		if err := replaceChannels(tx, *existing, SaveReminderInput{Channels: incoming.Channels}); err != nil {
			return nil, err
		}
		if err := scheduleSyncedJobs(tx, *existing, incoming.Channels); err != nil {
			return nil, err
		}
		stats.RemindersUpdated++
		stats.AffectedUsers = append(stats.AffectedUsers, existing.UserID)
	}
	return out, nil
}

func applySyncCompletions(tx *gorm.DB, snap syncSnapshot, users map[string]database.User, reminderIDs map[string]uint, stats *syncApplyStats) error {
	if len(snap.Completions) == 0 {
		return nil
	}
	// 本机已有的完成记录：**连软删的一起读**，否则墓碑找不到对应的行，
	// 会以为「本机从来没有过这条」而跳过。
	var locals []Completion
	if err := tx.Unscoped().Where("sync_uid IS NOT NULL AND sync_uid <> ''").Find(&locals).Error; err != nil {
		return err
	}
	byUID := make(map[string]*Completion, len(locals))
	for i := range locals {
		byUID[locals[i].SyncUID] = &locals[i]
	}
	for _, incoming := range snap.Completions {
		if incoming.UID == "" {
			stats.Skipped++
			continue
		}
		existing := byUID[incoming.UID]
		if existing != nil {
			// 撤回是幂等的：对端说这条撤了，本机也把它撤掉（已经撤过就跳过）。
			// 完成历史本身仍不做合并——重复到达的「新增」直接跳过。
			if incoming.Deleted && !existing.DeletedAt.Valid {
				now := time.Now()
				if err := tx.Model(&Completion{}).Where("id = ?", existing.ID).
					Update("deleted_at", now).Error; err != nil {
					return err
				}
				stats.CompletionsDeleted++
				stats.AffectedUsers = append(stats.AffectedUsers, existing.UserID)
			} else {
				stats.Skipped++
			}
			continue
		}
		if incoming.Deleted {
			// 本机从来没有过这条，对方的撤回对本机没有意义。
			stats.Skipped++
			continue
		}
		owner, ok := users[incoming.Owner]
		if !ok {
			markUnmapped(stats, incoming.Owner)
			continue
		}
		reminderID := reminderIDs[incoming.ReminderUID]
		if reminderID == 0 {
			// 提醒本体还没同步过来（通常是首次同步的先后顺序问题），
			// 下一次同步会把它一起带过来。
			stats.Skipped++
			continue
		}
		row := Completion{
			SyncUID: incoming.UID, ReminderID: reminderID, UserID: owner.ID,
			ScheduledFor: incoming.ScheduledFor, CompletedAt: incoming.CompletedAt,
			TitleSnapshot: incoming.TitleSnapshot,
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		byUID[incoming.UID] = &row
		stats.CompletionsCreated++
		stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
	}
	return nil
}

// scheduleSyncedJobs 给同步过来的提醒安排投递任务。
//
// 只给「还没到点」的提醒建任务：同步过来的过期提醒在原机器上已经提醒过，
// 到了对端再补一轮「到点了」只会造成困扰——首次同步时几十条历史任务一起
// 弹出来尤其像故障。已经排队的旧任务一律先取消，同步过来的状态是权威的。
func scheduleSyncedJobs(tx *gorm.DB, item Reminder, channels []string) error {
	if err := tx.Model(&DeliveryJob{}).
		Where("reminder_id = ? AND user_id = ? AND status IN ?", item.ID, item.UserID, []string{"pending", "retry"}).
		Update("status", "cancelled").Error; err != nil {
		return err
	}
	if item.CompletedAt != nil || item.DueAt == nil {
		return nil
	}
	runAt := *item.DueAt
	if item.SnoozedUntil != nil {
		runAt = *item.SnoozedUntil
	}
	// 一分钟的宽限：刚同步过来、正好到点的任务仍然值得提醒。
	if !runAt.After(time.Now().Add(-time.Minute)) {
		return nil
	}
	return rebuildJobs(tx, item, channels)
}

func hasDefaultList(tx *gorm.DB, userID uint) bool {
	var count int64
	if err := tx.Model(&List{}).
		Where("user_id = ? AND is_default = ? AND deleted_at IS NULL", userID, true).
		Count(&count).Error; err != nil {
		return false
	}
	return count > 0
}

// normalizeKind 兜住对端传来的空值或未知类型：kind 决定「任务还是记事」，
// 空值会让这条数据在列表视图里既不算任务也不算记事（查不到），
// 退回 task 至少语义明确。
func normalizeKind(kind string) string {
	if supportedKinds[kind] {
		return kind
	}
	return KindTask
}

// publishSyncChanges 在同步落地后按用户推送实时刷新事件，让已经打开的页面
// 立刻看到同步结果，而不必手动刷新。放在事务之外调用：事件只是失效通知，
// 事务回滚时不该发出去。
func publishSyncChanges(stats syncApplyStats) {
	for _, userID := range stats.AffectedUsers {
		publishDataChanged(userID, "reminder", "synced", 0, "")
	}
}

// sameList / sameReminder 判断「同步关心的字段」是否完全一致。
//
// 为什么必须先比内容再比时间戳：两台机器同步完以后时间戳是一样的，而
// incomingWins 在时间戳相同时要用实例标识做平局裁决，于是每次同步都会走进
// 「更新」分支，把同样的值重写一遍并统计成「更新 N 条」。内容一致就跳过，
// 既少写库，也让「上次同步改了什么」这个数字对用户是可信的。
//
// 清单刻意不比 is_default：它是各机器的本地偏好（哪条清单接新任务），
// 不是内容；比较它会让两边对「本地默认清单改选过」这件事反复覆盖对方。
func sameList(local *List, incoming syncList) bool {
	return local.Name == incoming.Name &&
		local.Color == incoming.Color &&
		local.Icon == incoming.Icon &&
		local.Position == incoming.Position &&
		local.Template == normalizeListTemplate(incoming.Template) &&
		(local.DeletedAt != nil) == incoming.Deleted
}

func sameReminder(local *Reminder, incoming syncReminder, listID uint, channels []string) bool {
	return local.ListID == listID &&
		local.Title == incoming.Title &&
		local.Notes == incoming.Notes &&
		local.BottomText == incoming.BottomText &&
		local.Kind == normalizeKind(incoming.Kind) &&
		local.Priority == incoming.Priority &&
		equalTimePtr(local.DueAt, incoming.DueAt) &&
		local.AllDay == incoming.AllDay &&
		equalTimePtr(local.StartAt, incoming.StartAt) &&
		equalTimePtr(local.EndAt, incoming.EndAt) &&
		local.RepeatRule == incoming.RepeatRule &&
		local.Calendar == incoming.Calendar &&
		local.LunarAnchor == incoming.LunarAnchor &&
		local.Accent == incoming.Accent &&
		local.Background == incoming.Background &&
		local.BgBlur == incoming.BgBlur &&
		local.BgMask == incoming.BgMask &&
		local.RepeatNotifyMinutes == incoming.RepeatNotifyMinutes &&
		equalTimePtr(local.CompletedAt, incoming.CompletedAt) &&
		equalTimePtr(local.SnoozedUntil, incoming.SnoozedUntil) &&
		local.Position == incoming.Position &&
		local.Version == incoming.Version &&
		(local.DeletedAt != nil) == incoming.Deleted &&
		sameChannels(channels, incoming.Channels)
}

func sameChannels(local, incoming []string) bool {
	if len(local) != len(incoming) {
		return false
	}
	a := append([]string(nil), local...)
	b := append([]string(nil), incoming...)
	sort.Strings(a)
	sort.Strings(b)
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func equalTimePtr(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}
