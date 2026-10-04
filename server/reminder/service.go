package reminder

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"smallgo/server/lunar"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var repeatRules = map[string]bool{
	"none": true, "daily": true, "weekly": true, "monthly": true, "yearly": true, "yearly_lunar": true,
}

type SaveReminderInput struct {
	Title string `json:"title"`
	Notes string `json:"notes"`
	// Kind is "task" (default) or "note". A note ignores every scheduling
	// field and is stored as already completed.
	Kind     string     `json:"kind"`
	ListID   uint       `json:"list_id"`
	Priority int        `json:"priority"`
	DueAt    *time.Time `json:"due_at"`
	AllDay   bool       `json:"all_day"`
	RepeatRule string     `json:"repeat_rule"`
	// Calendar selects "solar" (default) or "lunar" recurrence for the
	// monthly/yearly rules. The deprecated repeat_rule value "yearly_lunar"
	// is normalized to RepeatRule=yearly + Calendar=lunar on save.
	Calendar string   `json:"calendar"`
	Channels []string `json:"channels"`
	// RepeatNotifyMinutes re-notifies an uncompleted reminder on this interval
	// (in minutes) after each due time; 0 disables it.
	RepeatNotifyMinutes int `json:"repeat_notify_minutes"`
	// ChannelTargets optionally maps a multi-target channel (email) to the
	// ChannelBinding IDs this reminder delivers to. Absent or empty means all.
	ChannelTargets map[string][]uint `json:"channel_targets"`
	// LunarAnchor optionally pins the lunar month/day a lunar reminder
	// recurs on, encoded "M:D" (negative M = leap month). When empty, the
	// anchor is derived from DueAt on save.
	LunarAnchor string `json:"lunar_anchor"`
	Version     uint   `json:"version"`
}

func ensureDefaultList(tx *gorm.DB, userID uint) (List, error) {
	var list List
	err := tx.Where("user_id = ? AND is_default = ? AND deleted_at IS NULL", userID, true).First(&list).Error
	if err == nil {
		return list, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return list, err
	}
	list = List{UserID: userID, Name: "提醒", Color: "blue", Icon: "list", IsDefault: true}
	if err := tx.Create(&list).Error; err != nil {
		// Another request may have created it between lookup and insert.
		if findErr := tx.Where("user_id = ? AND is_default = ? AND deleted_at IS NULL", userID, true).First(&list).Error; findErr == nil {
			return list, nil
		}
		return list, err
	}
	return list, nil
}

func validateReminderInput(in *SaveReminderInput) error {
	in.Title = strings.TrimSpace(in.Title)
	in.Notes = strings.TrimSpace(in.Notes)
	if in.Title == "" {
		return errors.New("请输入提醒标题")
	}
	if len([]rune(in.Title)) > 200 {
		return errors.New("提醒标题不能超过 200 个字符")
	}
	if len([]rune(in.Notes)) > 5000 {
		return errors.New("备注不能超过 5000 个字符")
	}
	if in.Priority < 0 || in.Priority > 3 {
		return errors.New("优先级无效")
	}
	if in.RepeatRule == "" {
		in.RepeatRule = "none"
	}
	if !repeatRules[in.RepeatRule] {
		return errors.New("重复规则无效")
	}
	// "yearly_lunar" is the deprecated pre-v0.3.2 spelling of the lunar
	// yearly rule; normalize it so old clients keep working.
	if in.RepeatRule == "yearly_lunar" {
		in.RepeatRule = "yearly"
		in.Calendar = "lunar"
	}
	// A note is a plain record, not something to be reminded about. Normalize
	// its scheduling fields away before the repeat/calendar validation below,
	// so an old client that still sends a date cannot turn a note into a
	// scheduled reminder (or trip the lunar rule check).
	if in.Kind == "" {
		in.Kind = KindTask
	}
	if !supportedKinds[in.Kind] {
		return errors.New("条目类型无效")
	}
	if in.Kind == KindNote {
		in.DueAt = nil
		in.AllDay = false
		in.RepeatRule = "none"
		in.Calendar = "solar"
		in.LunarAnchor = ""
		in.RepeatNotifyMinutes = 0
		in.Priority = 0
	}
	switch in.Calendar {
	case "", "solar":
		in.Calendar = "solar"
		in.LunarAnchor = ""
	case "lunar":
		if in.RepeatRule != "monthly" && in.RepeatRule != "yearly" {
			return errors.New("农历循环仅支持每月或每年")
		}
		if in.DueAt == nil {
			return errors.New("农历循环需要先选择提醒日期")
		}
		anchor, err := normalizeLunarAnchor(in.LunarAnchor, *in.DueAt)
		if err != nil {
			return err
		}
		in.LunarAnchor = anchor
	default:
		return errors.New("历法无效，仅支持公历或农历")
	}
	if in.RepeatNotifyMinutes < 0 || in.RepeatNotifyMinutes > 60*24*31 {
		return errors.New("过期提醒频率无效，最长 31 天")
	}
	if len(in.Channels) == 0 {
		in.Channels = []string{ChannelInApp}
	}
	seen := map[string]bool{}
	clean := make([]string, 0, len(in.Channels))
	for _, ch := range in.Channels {
		ch = strings.ToLower(strings.TrimSpace(ch))
		if !supportedChannels[ch] {
			return fmt.Errorf("不支持的提醒渠道：%s", ch)
		}
		if !seen[ch] {
			seen[ch] = true
			clean = append(clean, ch)
		}
	}
	sort.Strings(clean)
	in.Channels = clean
	// Per-reminder mailbox selection only applies when the email channel is
	// selected; every other key is ignored.
	if in.ChannelTargets != nil {
		cleaned := map[string][]uint{}
		for _, ch := range in.Channels {
			if ch != ChannelEmail {
				continue
			}
			if ids := dedupeUint(in.ChannelTargets[ch]); len(ids) > 0 {
				cleaned[ch] = ids
			}
		}
		in.ChannelTargets = cleaned
	}
	return nil
}

func dedupeUint(values []uint) []uint {
	seen := map[uint]bool{}
	clean := make([]uint, 0, len(values))
	for _, value := range values {
		if value > 0 && !seen[value] {
			seen[value] = true
			clean = append(clean, value)
		}
	}
	sort.Slice(clean, func(i, j int) bool { return clean[i] < clean[j] })
	return clean
}

func createReminder(db *gorm.DB, userID uint, in SaveReminderInput) (ReminderDTO, error) {
	if err := validateReminderInput(&in); err != nil {
		return ReminderDTO{}, err
	}
	var created Reminder
	err := db.Transaction(func(tx *gorm.DB) error {
		if in.ListID == 0 {
			list, err := ensureDefaultList(tx, userID)
			if err != nil {
				return err
			}
			in.ListID = list.ID
		}
		if err := assertListOwner(tx, userID, in.ListID); err != nil {
			return err
		}
		created = Reminder{
			UserID: userID, ListID: in.ListID, Title: in.Title, Notes: in.Notes,
			Kind:     in.Kind,
			Priority: in.Priority, DueAt: in.DueAt, AllDay: in.AllDay,
			RepeatRule: in.RepeatRule, Calendar: in.Calendar, LunarAnchor: in.LunarAnchor,
			RepeatNotifyMinutes: in.RepeatNotifyMinutes, Version: 1,
		}
		// A note counts as completed the moment it is created. Stamping
		// CompletedAt here files it under「已完成」and, because rebuildJobs
		// returns early for any reminder that already has CompletedAt set,
		// also guarantees a note never schedules a notification.
		if created.Kind == KindNote {
			now := time.Now()
			created.CompletedAt = &now
		}
		if err := tx.Create(&created).Error; err != nil {
			return err
		}
		if err := replaceChannels(tx, created, in); err != nil {
			return err
		}
		return rebuildJobs(tx, created, in.Channels)
	})
	if err != nil {
		return ReminderDTO{}, err
	}
	return getReminder(db, userID, created.ID)
}

func updateReminder(db *gorm.DB, userID, reminderID uint, in SaveReminderInput) (ReminderDTO, error) {
	if err := validateReminderInput(&in); err != nil {
		return ReminderDTO{}, err
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		var existing Reminder
		q := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND user_id = ? AND deleted_at IS NULL", reminderID, userID)
		if err := q.First(&existing).Error; err != nil {
			return err
		}
		if in.Version > 0 && existing.Version != in.Version {
			return errVersionConflict
		}
		if in.ListID == 0 {
			in.ListID = existing.ListID
		}
		if err := assertListOwner(tx, userID, in.ListID); err != nil {
			return err
		}
		existing.Title = in.Title
		existing.Notes = in.Notes
		// Switching type has to move the row between the open and completed
		// views: task -> note stamps CompletedAt (and never touches it again
		// on later edits, so the note keeps its place in the completed log),
		// note -> task clears it so the item becomes an open task.
		wasNote := existing.Kind == KindNote
		existing.Kind = in.Kind
		if in.Kind == KindNote && existing.CompletedAt == nil {
			now := time.Now()
			existing.CompletedAt = &now
		} else if in.Kind == KindTask && wasNote {
			existing.CompletedAt = nil
		}
		existing.ListID = in.ListID
		existing.Priority = in.Priority
		existing.DueAt = in.DueAt
		existing.AllDay = in.AllDay
		existing.RepeatRule = in.RepeatRule
		existing.Calendar = in.Calendar
		existing.LunarAnchor = in.LunarAnchor
		existing.RepeatNotifyMinutes = in.RepeatNotifyMinutes
		existing.SnoozedUntil = nil
		existing.Version++
		if err := tx.Save(&existing).Error; err != nil {
			return err
		}
		if err := replaceChannels(tx, existing, in); err != nil {
			return err
		}
		return rebuildJobs(tx, existing, in.Channels)
	})
	if err != nil {
		return ReminderDTO{}, err
	}
	return getReminder(db, userID, reminderID)
}

var errVersionConflict = errors.New("提醒已在其他位置更新，请刷新后重试")

func assertListOwner(tx *gorm.DB, userID, listID uint) error {
	var count int64
	if err := tx.Model(&List{}).Where("id = ? AND user_id = ? AND deleted_at IS NULL", listID, userID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func replaceChannels(tx *gorm.DB, reminder Reminder, in SaveReminderInput) error {
	if err := tx.Where("reminder_id = ? AND user_id = ?", reminder.ID, reminder.UserID).Delete(&ReminderChannel{}).Error; err != nil {
		return err
	}
	rows := make([]ReminderChannel, 0, len(in.Channels))
	for _, ch := range in.Channels {
		row := ReminderChannel{ReminderID: reminder.ID, UserID: reminder.UserID, Channel: ch, Enabled: true}
		if ch == ChannelEmail && len(in.ChannelTargets[ch]) > 0 {
			ids, err := ownedEmailBindingIDs(tx, reminder.UserID, in.ChannelTargets[ch])
			if err != nil {
				return err
			}
			if len(ids) > 0 {
				raw, err := json.Marshal(ids)
				if err != nil {
					return err
				}
				row.Targets = string(raw)
			}
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Create(&rows).Error
}

// ownedEmailBindingIDs keeps only the IDs that belong to the user's own email
// bindings, so a crafted request cannot reference another account's targets.
func ownedEmailBindingIDs(tx *gorm.DB, userID uint, wanted []uint) ([]uint, error) {
	var ids []uint
	if err := tx.Model(&ChannelBinding{}).
		Where("user_id = ? AND channel = ? AND id IN ?", userID, ChannelEmail, wanted).
		Order("id ASC").Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

func rebuildJobs(tx *gorm.DB, reminder Reminder, channels []string) error {
	if err := tx.Model(&DeliveryJob{}).
		Where("reminder_id = ? AND user_id = ? AND status IN ?", reminder.ID, reminder.UserID, []string{"pending", "retry"}).
		Update("status", "cancelled").Error; err != nil {
		return err
	}
	if reminder.DueAt == nil || reminder.CompletedAt != nil {
		return nil
	}
	// Keep all delivery timestamps in UTC. This matters for SQLite because the
	// scheduler's timestamp predicate compares the stored values as text.
	scheduledFor := reminder.DueAt.UTC()
	runAt := scheduledFor
	if reminder.SnoozedUntil != nil {
		runAt = reminder.SnoozedUntil.UTC()
	}
	for _, ch := range channels {
		raw := fmt.Sprintf("%d|%s|%s|%d", reminder.ID, reminder.DueAt.UTC().Format(time.RFC3339Nano), ch, reminder.Version)
		sum := sha256.Sum256([]byte(raw))
		job := DeliveryJob{
			UserID: reminder.UserID, ReminderID: reminder.ID, Channel: ch,
			ScheduledFor: scheduledFor, RunAt: runAt, Status: "pending",
			IdempotencyKey: hex.EncodeToString(sum[:]),
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "reminder_id"}, {Name: "channel"}, {Name: "scheduled_for"}},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"run_at": runAt, "status": "pending", "attempt_count": 0,
				"next_attempt_at": nil, "locked_at": nil, "worker_id": "",
				"idempotency_key": job.IdempotencyKey, "last_error_code": "",
				"last_error_message": "", "external_message_id": "",
			}),
		}).Create(&job).Error; err != nil {
			return err
		}
	}
	return nil
}

func getReminder(db *gorm.DB, userID, reminderID uint) (ReminderDTO, error) {
	var item Reminder
	if err := db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", reminderID, userID).First(&item).Error; err != nil {
		return ReminderDTO{}, err
	}
	var channels []ReminderChannel
	if err := db.Where("reminder_id = ? AND user_id = ? AND enabled = ?", item.ID, userID, true).Find(&channels).Error; err != nil {
		return ReminderDTO{}, err
	}
	var list List
	_ = db.Where("id = ? AND user_id = ?", item.ListID, userID).First(&list).Error
	dto := ReminderDTO{Reminder: item, ListName: list.Name}
	for _, ch := range channels {
		dto.Channels = append(dto.Channels, ch.Channel)
		if ch.Channel == ChannelEmail {
			if ids := parseChannelTargets(ch.Targets); len(ids) > 0 {
				dto.ChannelTargets = map[string][]uint{ChannelEmail: ids}
			}
		}
	}
	return dto, nil
}

func parseChannelTargets(raw string) []uint {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var ids []uint
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return nil
	}
	return ids
}

func listReminders(db *gorm.DB, userID uint, view, query string, listIDs []uint) ([]ReminderDTO, error) {
	var rows []Reminder
	q := db.Where("user_id = ? AND deleted_at IS NULL", userID)
	now := time.Now()
	loc, _ := time.LoadLocation("Asia/Shanghai")
	localNow := now.In(loc)
	startToday := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)
	endToday := startToday.AddDate(0, 0, 1)
	switch view {
	case "today":
		q = q.Where("completed_at IS NULL AND due_at IS NOT NULL AND due_at < ?", endToday)
	case "planned":
		q = q.Where("completed_at IS NULL AND due_at IS NOT NULL")
	case "completed":
		q = q.Where("completed_at IS NOT NULL")
	default:
		q = q.Where("completed_at IS NULL")
	}
	if len(listIDs) > 0 {
		q = q.Where("list_id IN ?", listIDs)
	}
	if query = strings.TrimSpace(query); query != "" {
		like := "%" + query + "%"
		q = q.Where("(title LIKE ? OR notes LIKE ?)", like, like)
	}
	if err := q.Order("CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, priority DESC, position ASC, id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []ReminderDTO{}, nil
	}

	reminderIDs := make([]uint, 0, len(rows))
	// 这里是「这批提醒涉及到的清单 id」，用于一次性取回清单名；
	// 与入参 listIDs（筛选条件）不是一回事，故另起名字。
	ownerListIDs := make([]uint, 0, len(rows))
	seenLists := make(map[uint]struct{})
	for _, row := range rows {
		reminderIDs = append(reminderIDs, row.ID)
		if _, ok := seenLists[row.ListID]; !ok {
			seenLists[row.ListID] = struct{}{}
			ownerListIDs = append(ownerListIDs, row.ListID)
		}
	}

	var channelRows []ReminderChannel
	if err := db.Where("user_id = ? AND reminder_id IN ? AND enabled = ?", userID, reminderIDs, true).
		Order("reminder_id ASC, id ASC").Find(&channelRows).Error; err != nil {
		return nil, err
	}
	channelsByReminder := make(map[uint][]string, len(rows))
	targetsByReminder := map[uint]map[string][]uint{}
	for _, channel := range channelRows {
		channelsByReminder[channel.ReminderID] = append(channelsByReminder[channel.ReminderID], channel.Channel)
		if channel.Channel == ChannelEmail {
			if ids := parseChannelTargets(channel.Targets); len(ids) > 0 {
				targetsByReminder[channel.ReminderID] = map[string][]uint{ChannelEmail: ids}
			}
		}
	}

	var lists []List
	if err := db.Where("user_id = ? AND id IN ?", userID, ownerListIDs).Find(&lists).Error; err != nil {
		return nil, err
	}
	listNames := make(map[uint]string, len(lists))
	for _, list := range lists {
		listNames[list.ID] = list.Name
	}

	result := make([]ReminderDTO, 0, len(rows))
	for _, row := range rows {
		result = append(result, ReminderDTO{
			Reminder:       row,
			Channels:       channelsByReminder[row.ID],
			ChannelTargets: targetsByReminder[row.ID],
			ListName:       listNames[row.ListID],
		})
	}
	return result, nil
}

// retireDueNotifications 把一条提醒仍未读的到点通知标为已读，供完成、稍后提醒、
// 删除三种处理复用（与提醒的改动放在同一事务里）。这条「到点了」的提醒既然已被
// 处理，通知中心不该再挂着未读角标，其它设备上依赖已读状态的到点补弹（前端
// MainLayout 的 recoverMissedAlerts）也不能再把它弹出来。
func retireDueNotifications(tx *gorm.DB, userID, reminderID uint, at time.Time) error {
	return tx.Model(&Notification{}).
		Where("user_id = ? AND reminder_id = ? AND type = ? AND read_at IS NULL", userID, reminderID, "reminder_due").
		Update("read_at", &at).Error
}

func deleteReminder(db *gorm.DB, userID, reminderID uint) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var item Reminder
		if err := tx.Where("id = ? AND user_id = ? AND deleted_at IS NULL", reminderID, userID).First(&item).Error; err != nil {
			return err
		}
		if err := tx.Model(&DeliveryJob{}).Where("reminder_id = ? AND user_id = ? AND status IN ?", reminderID, userID, []string{"pending", "retry"}).Update("status", "cancelled").Error; err != nil {
			return err
		}
		now := time.Now()
		if err := retireDueNotifications(tx, userID, reminderID, now); err != nil {
			return err
		}
		return tx.Model(&item).Update("deleted_at", &now).Error
	})
}

func completeReminder(db *gorm.DB, userID, reminderID uint) (ReminderDTO, error) {
	err := db.Transaction(func(tx *gorm.DB) error {
		var item Reminder
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ? AND deleted_at IS NULL", reminderID, userID).First(&item).Error; err != nil {
			return err
		}
		if item.Kind == KindNote {
			// A note is complete by definition: there is nothing to confirm.
			// Treat the call as a no-op instead of an error so a stale client
			// that still shows the checkbox cannot break the save.
			return nil
		}
		now := time.Now()
		if item.RepeatRule != "" && item.RepeatRule != "none" && item.DueAt != nil {
			history := Completion{ReminderID: item.ID, UserID: userID, ScheduledFor: item.DueAt, CompletedAt: now, TitleSnapshot: item.Title}
			if err := tx.Create(&history).Error; err != nil {
				return err
			}
			next, err := nextOccurrenceWithCalendar(*item.DueAt, item.RepeatRule, item.Calendar, item.LunarAnchor)
			if err != nil {
				return err
			}
			item.DueAt = &next
			item.CompletedAt = nil
			item.SnoozedUntil = nil
		} else {
			item.CompletedAt = &now
		}
		item.Version++
		if err := tx.Save(&item).Error; err != nil {
			return err
		}
		var channelRows []ReminderChannel
		if err := tx.Where("reminder_id = ? AND user_id = ? AND enabled = ?", item.ID, userID, true).Find(&channelRows).Error; err != nil {
			return err
		}
		channels := make([]string, 0, len(channelRows))
		for _, row := range channelRows {
			channels = append(channels, row.Channel)
		}
		if err := retireDueNotifications(tx, userID, reminderID, now); err != nil {
			return err
		}
		return rebuildJobs(tx, item, channels)
	})
	if err != nil {
		return ReminderDTO{}, err
	}
	return getReminder(db, userID, reminderID)
}

func restoreReminder(db *gorm.DB, userID, reminderID uint) (ReminderDTO, error) {
	err := db.Transaction(func(tx *gorm.DB) error {
		var item Reminder
		if err := tx.Where("id = ? AND user_id = ? AND deleted_at IS NULL", reminderID, userID).First(&item).Error; err != nil {
			return err
		}
		if item.Kind == KindNote {
			// Restoring a note would silently turn a record into an open task
			// with no schedule, which is never what the user meant.
			return errors.New("记事无需恢复，请先改为任务")
		}
		item.CompletedAt = nil
		item.Version++
		if err := tx.Save(&item).Error; err != nil {
			return err
		}
		var channelRows []ReminderChannel
		if err := tx.Where("reminder_id = ? AND user_id = ? AND enabled = ?", item.ID, userID, true).Find(&channelRows).Error; err != nil {
			return err
		}
		channels := make([]string, 0, len(channelRows))
		for _, row := range channelRows {
			channels = append(channels, row.Channel)
		}
		return rebuildJobs(tx, item, channels)
	})
	if err != nil {
		return ReminderDTO{}, err
	}
	return getReminder(db, userID, reminderID)
}

func snoozeReminder(db *gorm.DB, userID, reminderID uint, until time.Time) (ReminderDTO, error) {
	if !until.After(time.Now()) {
		return ReminderDTO{}, errors.New("稍后提醒时间必须晚于当前时间")
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		var item Reminder
		if err := tx.Where("id = ? AND user_id = ? AND completed_at IS NULL AND deleted_at IS NULL", reminderID, userID).First(&item).Error; err != nil {
			return err
		}
		item.SnoozedUntil = &until
		item.Version++
		if err := tx.Save(&item).Error; err != nil {
			return err
		}
		var channelRows []ReminderChannel
		if err := tx.Where("reminder_id = ? AND user_id = ? AND enabled = ?", item.ID, userID, true).Find(&channelRows).Error; err != nil {
			return err
		}
		channels := make([]string, 0, len(channelRows))
		for _, row := range channelRows {
			channels = append(channels, row.Channel)
		}
		if err := retireDueNotifications(tx, userID, reminderID, time.Now()); err != nil {
			return err
		}
		return rebuildJobs(tx, item, channels)
	})
	if err != nil {
		return ReminderDTO{}, err
	}
	return getReminder(db, userID, reminderID)
}

// nextOccurrenceWithCalendar dispatches to the lunar calendar when the
// reminder follows it, and to the plain Gregorian rules otherwise. Lunar
// recurrence never fails hard here: if the anchor is missing or unreadable
// the reminder simply keeps its current due date, which leaves the delivery
// jobs untouched.
func nextOccurrenceWithCalendar(t time.Time, rule, calendar, anchor string) (time.Time, error) {
	if calendar == "lunar" {
		parsed, ok := parseLunarAnchor(anchor)
		if !ok {
			return t, nil
		}
		loc, _ := time.LoadLocation("Asia/Shanghai")
		switch rule {
		case "monthly":
			return lunar.NextMonthlyOccurrence(parsed.Day, t, loc)
		case "yearly":
			return lunar.NextOccurrence(parsed, t, loc)
		}
	}
	return nextOccurrence(t, rule), nil
}

// parseLunarAnchor decodes the stored "M:D" lunar anchor. A missing colon,
// out-of-range month, or non-positive day means the anchor was never stored
// or is corrupt; the caller falls back to keeping the current due date.
func parseLunarAnchor(anchor string) (lunar.Date, bool) {
	monthStr, dayStr, found := strings.Cut(anchor, ":")
	if !found {
		return lunar.Date{}, false
	}
	month, errMonth := strconv.Atoi(monthStr)
	day, errDay := strconv.Atoi(dayStr)
	if errMonth != nil || errDay != nil {
		return lunar.Date{}, false
	}
	absMonth := month
	if absMonth < 0 {
		absMonth = -absMonth
	}
	if absMonth < 1 || absMonth > 12 || day < 1 || day > 30 {
		return lunar.Date{}, false
	}
	return lunar.Date{Year: 0, Month: month, Day: day}, true
}

// normalizeLunarAnchor validates a client-provided lunar anchor or derives
// one from the reminder's due date when the client did not supply one.
func normalizeLunarAnchor(anchor string, due time.Time) (string, error) {
	anchor = strings.TrimSpace(anchor)
	if anchor == "" {
		loc, _ := time.LoadLocation("Asia/Shanghai")
		converted := lunar.FromTime(due.In(loc))
		return fmt.Sprintf("%d:%d", converted.Month, converted.Day), nil
	}
	parsed, ok := parseLunarAnchor(anchor)
	if !ok {
		return "", errors.New("农历锚点格式无效")
	}
	return fmt.Sprintf("%d:%d", parsed.Month, parsed.Day), nil
}

func nextOccurrence(t time.Time, rule string) time.Time {
	switch rule {
	case "daily":
		return t.AddDate(0, 0, 1)
	case "weekly":
		return t.AddDate(0, 0, 7)
	case "monthly":
		day := t.Day()
		firstNext := time.Date(t.Year(), t.Month()+1, 1, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
		lastDay := time.Date(firstNext.Year(), firstNext.Month()+1, 0, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location()).Day()
		if day > lastDay {
			day = lastDay
		}
		return time.Date(firstNext.Year(), firstNext.Month(), day, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
	case "yearly":
		year := t.Year() + 1
		day := t.Day()
		lastDay := time.Date(year, t.Month()+1, 0, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location()).Day()
		if day > lastDay {
			day = lastDay
		}
		return time.Date(year, t.Month(), day, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
	default:
		return t
	}
}

// CompletedRange 是「已完成」页的时间段筛选区间，左闭右开。
type CompletedRange struct {
	Start *time.Time
	End   *time.Time
}

// CompletedRangeSpan 是区间的展示形态：前端在筛选器下面显示
// 「当前区间：2026-10-01 ~ 2026-10-31」，让筛选范围和看到的条数都能被核对。
type CompletedRangeSpan struct {
	Start string `json:"start,omitempty"` // 含当天，YYYY-MM-DD
	End   string `json:"end,omitempty"`   // 含当天，YYYY-MM-DD
	Label string `json:"label"`           // 展示文案；「全部」为「不限时间」
}

// DescribeCompletedRange 把区间渲染成展示描述。区间左闭右开，所以展示的结束
// 日期要回退一天——那才是最后一个被包含的日期（整月的 31 号，而不是下月 1 号）。
func DescribeCompletedRange(rng CompletedRange, loc *time.Location) CompletedRangeSpan {
	if rng.Start == nil && rng.End == nil {
		return CompletedRangeSpan{Label: "不限时间"}
	}
	span := CompletedRangeSpan{}
	if rng.Start != nil {
		span.Start = rng.Start.In(loc).Format("2006-01-02")
	}
	if rng.End != nil {
		span.End = rng.End.In(loc).AddDate(0, 0, -1).Format("2006-01-02")
	}
	switch {
	case span.Start != "" && span.Start == span.End:
		span.Label = span.Start
	case span.Start != "" && span.End != "":
		span.Label = span.Start + " ~ " + span.End
	case span.Start != "":
		span.Label = span.Start + " 起"
	default:
		span.Label = "截至 " + span.End
	}
	return span
}

// ParseCompletedRange 把前端传来的时间段选项换算成上海时区的时间区间。
// 空值与 "all" 表示不限时间，这样老客户端不传参数时行为与改动前一致。
//
// 选项（除"全部"外，都是**整段自然日历区间**，左闭右开）：
//
//	all       不限时间
//	today     今天 00:00 → 明天 00:00
//	yesterday 昨天 00:00 → 今天 00:00
//	week      本周一 00:00 → 下周一 00:00（整周）
//	month     本月 1 日 00:00 → 下月 1 日 00:00（整月）
//	lastmonth 上月 1 日 00:00 → 本月 1 日 00:00（整月）
//	year      1 月 1 日 00:00 → 次年 1 月 1 日 00:00（整年）
//	custom    from 00:00 → to 次日 00:00（含结束当天）
//
// 之所以统一成整段，是因为「到此刻为止」会让边界随时间漂移：同一份数据在
// 月初和月末查「本月」得到不同的终点描述，用户核对时无从判断。
func ParseCompletedRange(option, from, to string) (CompletedRange, error) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return CompletedRange{}, err
	}
	now := time.Now().In(loc)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	endOfToday := startOfToday.AddDate(0, 0, 1)
	startOfThisMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	startOfThisYear := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, loc)
	switch option {
	case "", "all":
		return CompletedRange{}, nil
	case "today":
		return CompletedRange{Start: &startOfToday, End: &endOfToday}, nil
	case "yesterday":
		start := startOfToday.AddDate(0, 0, -1)
		return CompletedRange{Start: &start, End: &startOfToday}, nil
	case "week":
		// 国内习惯以周一为一周的开始；Go 的 Weekday 里 Sunday 是 0。
		offset := (int(now.Weekday()) + 6) % 7
		start := startOfToday.AddDate(0, 0, -offset)
		end := start.AddDate(0, 0, 7)
		return CompletedRange{Start: &start, End: &end}, nil
	case "month":
		end := startOfThisMonth.AddDate(0, 1, 0)
		return CompletedRange{Start: &startOfThisMonth, End: &end}, nil
	case "lastmonth":
		start := startOfThisMonth.AddDate(0, -1, 0)
		return CompletedRange{Start: &start, End: &startOfThisMonth}, nil
	case "year":
		end := startOfThisYear.AddDate(1, 0, 0)
		return CompletedRange{Start: &startOfThisYear, End: &end}, nil
	case "custom":
		start, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(from), loc)
		if err != nil {
			return CompletedRange{}, errors.New("自定义开始日期无效")
		}
		last, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(to), loc)
		if err != nil {
			return CompletedRange{}, errors.New("自定义结束日期无效")
		}
		end := last.AddDate(0, 0, 1) // 结束日期当天整天都算
		if !end.After(start) {
			return CompletedRange{}, errors.New("结束日期不能早于开始日期")
		}
		return CompletedRange{Start: &start, End: &end}, nil
	}
	return CompletedRange{}, errors.New("时间段参数无效")
}

// listCompletedHistory 返回「已完成」记录，来源是 completions 历史表与
// reminders.completed_at 的并集，按完成时间倒序。
//
// 两个来源天然互不重叠：重复提醒完成时走历史表并把 completed_at 留空，
// 非重复提醒与记事则只写 completed_at，因此不会重复计数。
func listCompletedHistory(db *gorm.DB, userID uint, rng CompletedRange, query string, listIDs []uint) ([]CompletedItemDTO, error) {
	var history []Completion
	hq := db.Where("user_id = ?", userID)
	if rng.Start != nil {
		hq = hq.Where("completed_at >= ?", *rng.Start)
	}
	if rng.End != nil {
		hq = hq.Where("completed_at < ?", *rng.End)
	}
	if query = strings.TrimSpace(query); query != "" {
		hq = hq.Where("title_snapshot LIKE ?", "%"+query+"%")
	}
	if err := hq.Order("completed_at DESC").Find(&history).Error; err != nil {
		return nil, err
	}

	var rows []Reminder
	rq := db.Where("user_id = ? AND deleted_at IS NULL AND completed_at IS NOT NULL", userID)
	if rng.Start != nil {
		rq = rq.Where("completed_at >= ?", *rng.Start)
	}
	if rng.End != nil {
		rq = rq.Where("completed_at < ?", *rng.End)
	}
	if len(listIDs) > 0 {
		rq = rq.Where("list_id IN ?", listIDs)
	}
	if query != "" {
		like := "%" + query + "%"
		rq = rq.Where("(title LIKE ? OR notes LIKE ?)", like, like)
	}
	if err := rq.Order("completed_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}

	// 历史行本身不带清单归属，需要回查提醒。提醒可能已被软删除，所以这里
	// 故意不加 deleted_at 过滤——只有这样删掉的提醒的完成记录才还找得到清单名。
	ownerByID := map[uint]Reminder{}
	if len(history) > 0 {
		ids := make([]uint, 0, len(history))
		for _, h := range history {
			ids = append(ids, h.ReminderID)
		}
		var owners []Reminder
		if err := db.Where("user_id = ? AND id IN ?", userID, ids).Find(&owners).Error; err != nil {
			return nil, err
		}
		for _, o := range owners {
			ownerByID[o.ID] = o
		}
	}

	// 一次性取回涉及到的清单名，避免逐行查询。
	wanted := map[uint]struct{}{}
	for _, r := range rows {
		if r.ListID > 0 {
			wanted[r.ListID] = struct{}{}
		}
	}
	for _, h := range history {
		if o, ok := ownerByID[h.ReminderID]; ok && o.ListID > 0 {
			wanted[o.ListID] = struct{}{}
		}
	}
	listNames := map[uint]string{}
	if len(wanted) > 0 {
		ids := make([]uint, 0, len(wanted))
		for id := range wanted {
			ids = append(ids, id)
		}
		var lists []List
		if err := db.Where("user_id = ? AND id IN ?", userID, ids).Find(&lists).Error; err != nil {
			return nil, err
		}
		for _, l := range lists {
			listNames[l.ID] = l.Name
		}
	}

	result := make([]CompletedItemDTO, 0, len(history)+len(rows))
	for _, h := range history {
		item := CompletedItemDTO{
			ID: h.ID, Source: "history", ReminderID: h.ReminderID,
			Title: h.TitleSnapshot, CompletedAt: h.CompletedAt,
			ScheduledFor: h.ScheduledFor, Kind: KindTask,
		}
		if owner, ok := ownerByID[h.ReminderID]; ok {
			item.ListID = owner.ListID
			item.ListName = listNames[owner.ListID]
			item.Kind = owner.Kind
			item.RepeatRule = owner.RepeatRule
			item.ReminderExists = owner.DeletedAt == nil
		}
		// 历史行本身不带清单归属，只能回查后在这里按清单过滤
		if len(listIDs) > 0 && !containsID(listIDs, item.ListID) {
			continue
		}
		result = append(result, item)
	}
	for _, r := range rows {
		if r.CompletedAt == nil {
			continue
		}
		result = append(result, CompletedItemDTO{
			ID: r.ID, Source: "reminder", ReminderID: r.ID,
			Title: r.Title, CompletedAt: *r.CompletedAt, Kind: r.Kind,
			ListID: r.ListID, ListName: listNames[r.ListID],
			RepeatRule: r.RepeatRule, ReminderExists: true,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CompletedAt.After(result[j].CompletedAt)
	})
	return result, nil
}

// 「已完成」角标的计数没有单独的函数：它作为子查询并进了 handleSummary 那条
// 聚合语句里，这样 /summary 仍然只发 2 条查询（口径与 listCompletedHistory 的
// 「不限时间」一致）。

// containsID 判断 id 是否在列表里（清单筛选用的顺序无关小集合）。
func containsID(ids []uint, want uint) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}

// setDefaultList 把指定清单设为该用户唯一的默认清单。默认清单必须恒有且唯一：
// 新建提醒不带清单时、删除清单后归置提醒时都依赖它（见 ensureDefaultList）。
func setDefaultList(db *gorm.DB, userID, listID uint) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var list List
		if err := tx.Where("id = ? AND user_id = ? AND deleted_at IS NULL", listID, userID).First(&list).Error; err != nil {
			return err
		}
		if list.IsDefault {
			return nil
		}
		if err := tx.Model(&List{}).
			Where("user_id = ? AND is_default = ?", userID, true).
			Update("is_default", false).Error; err != nil {
			return err
		}
		return tx.Model(&List{}).Where("id = ? AND user_id = ?", listID, userID).
			Update("is_default", true).Error
	})
}

// listCalendarItems 返回 [from, to) 内到期的提醒，含已完成项，按到期时间升序。
// 记事没有到期日（due_at 恒为 NULL），因此天然不会出现在日历里。
func listCalendarItems(db *gorm.DB, userID uint, from, to time.Time, listIDs []uint) ([]CalendarItemDTO, error) {
	var rows []Reminder
	q := db.Where("user_id = ? AND deleted_at IS NULL AND due_at IS NOT NULL AND due_at >= ? AND due_at < ?",
		userID, from, to)
	if len(listIDs) > 0 {
		q = q.Where("list_id IN ?", listIDs)
	}
	if err := q.Order("due_at ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []CalendarItemDTO{}, nil
	}

	// 清单名与颜色一次性取回，前端按清单给色块上色。
	ids := make([]uint, 0, len(rows))
	seen := make(map[uint]struct{}, len(rows))
	for _, r := range rows {
		if _, ok := seen[r.ListID]; !ok {
			seen[r.ListID] = struct{}{}
			ids = append(ids, r.ListID)
		}
	}
	var lists []List
	if err := db.Where("user_id = ? AND id IN ?", userID, ids).Find(&lists).Error; err != nil {
		return nil, err
	}
	listByID := make(map[uint]List, len(lists))
	for _, l := range lists {
		listByID[l.ID] = l
	}

	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return nil, err
	}
	result := make([]CalendarItemDTO, 0, len(rows))
	for _, r := range rows {
		if r.DueAt == nil {
			continue
		}
		item := CalendarItemDTO{
			ID: r.ID, Title: r.Title, ListID: r.ListID,
			DueAt: *r.DueAt, DueDate: r.DueAt.In(loc).Format("2006-01-02"),
			AllDay: r.AllDay, Completed: r.CompletedAt != nil,
			Kind: r.Kind, Priority: r.Priority, RepeatRule: r.RepeatRule,
		}
		if l, ok := listByID[r.ListID]; ok {
			item.ListName = l.Name
			item.ListColor = l.Color
		}
		result = append(result, item)
	}
	return result, nil
}
