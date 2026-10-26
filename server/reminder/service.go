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
	// BottomText 是仪式感卡片底部自定义文案；指针区分「没传（不改）」与「传空串（恢复自动）」。
	BottomText *string `json:"bottom_text"`
	// Kind is "task" (default) or "note". A note ignores every scheduling
	// field and is stored as already completed.
	Kind   string `json:"kind"`
	ListID uint   `json:"list_id"`
	// CardRole 只由信用卡还款计划生成时写入（statement/due），
	// 普通新建与编辑不传，保持原值。
	CardRole string     `json:"card_role"`
	Priority int        `json:"priority"`
	DueAt    *time.Time `json:"due_at"`
	AllDay   bool       `json:"all_day"`
	// StartAt / EndAt：时间段任务的起止（计划页专用）。只给 StartAt 等同单点时间；
	// 只给 EndAt 会被拒绝；两者都给时校验 EndAt 晚于 StartAt，并把 DueAt 归到 StartAt。
	StartAt    *time.Time `json:"start_at"`
	EndAt      *time.Time `json:"end_at"`
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
	// Accent 是条目自己挑的过渡色（仪式感卡片用，见 card_accents.go）。
	// **用指针**：编辑时旧客户端/通用编辑器不带这个字段，缺省表示「不改」，
	// 传空字符串才表示「清掉、用默认色」。
	Accent *string `json:"accent"`
	// Background 是仪式感卡片的背景图（"preset:<key>" 或 "/uploads/..."，见 background.go）。
	// 同样用指针：缺省 = 不改，传空字符串 = 清掉背景。
	Background *string `json:"background"`
	// BgBlur / BgMask 是背景图的蒙板（虚化像素数 / 蒙板浓度百分比，见 models.go）。
	// 同样用指针：缺省 = 不改。
	BgBlur *int `json:"bg_blur"`
	BgMask *int `json:"bg_mask"`
	// BgAlpha 整张卡片背景的透明度（0–100，缺省 = 不改；新建时默认 100）。
	BgAlpha *int `json:"bg_alpha"`
	Version uint `json:"version"`
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
	if in.BottomText != nil {
		v := strings.TrimSpace(*in.BottomText)
		if len([]rune(v)) > 120 {
			return errors.New("卡片底部文字最多 120 个字")
		}
		in.BottomText = &v
	}
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
	if in.Accent != nil {
		if err := validateAccent(*in.Accent); err != nil {
			return err
		}
	}
	if in.Background != nil {
		if err := validateBackground(*in.Background); err != nil {
			return err
		}
	}
	if in.BgBlur != nil && (*in.BgBlur < 0 || *in.BgBlur > maxBgBlur) {
		return errors.New("背景虚化超出范围（0–24）")
	}
	if in.BgMask != nil && (*in.BgMask < 0 || *in.BgMask > 100) {
		return errors.New("背景蒙板透明度超出范围（0–100）")
	}
	if in.BgAlpha != nil && (*in.BgAlpha < 0 || *in.BgAlpha > 100) {
		return errors.New("卡片透明度超出范围（0–100）")
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
		in.StartAt = nil
		in.EndAt = nil
		in.RepeatRule = "none"
		in.Calendar = "solar"
		in.LunarAnchor = ""
		in.RepeatNotifyMinutes = 0
		in.Priority = 0
	}
	// 时间段（计划页的「自定义时间段」）：
	//   · 两个都给 → 必须有先后，并把 DueAt 归到开始时间（排序/视图/日历/通知都只认 DueAt）
	//   · 只给开始 → 当作单点时间任务（DueAt = 开始时间），EndAt 清空
	//   · 只给结束 → 拒绝：没有开始时间的「结束」没有意义
	if in.EndAt != nil && in.StartAt == nil {
		return errors.New("请先选择开始时间")
	}
	if in.StartAt != nil {
		start := in.StartAt.In(shanghai())
		in.StartAt = &start
		if in.EndAt == nil {
			in.DueAt = in.StartAt
		} else {
			end := in.EndAt.In(shanghai())
			if !end.After(start) {
				return errors.New("结束时间要晚于开始时间")
			}
			in.EndAt = &end
			in.DueAt = in.StartAt
		}
	} else {
		in.EndAt = nil
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
		// 记事一律落到「记事本」栏目：它是侧栏里的固定栏目（见 note_bucket.go），
		// 用户不需要（也选不到）自己指定清单；旧客户端仍带着 list_id 也归一到这里，
		// 保证「记事本里就是全部记事，其它清单里不会混进记事」。
		if in.Kind == KindNote {
			bucket, err := ensureNoteBucket(tx, userID)
			if err != nil {
				return err
			}
			in.ListID = bucket.ID
		} else if in.ListID == 0 {
			list, err := ensureDefaultList(tx, userID)
			if err != nil {
				return err
			}
			in.ListID = list.ID
		}
		if err := assertListOwner(tx, userID, in.ListID); err != nil {
			return err
		}
		accent := ""
		if in.Accent != nil {
			accent = *in.Accent
		}
		background := ""
		if in.Background != nil {
			background = *in.Background
		}
		// 蒙板两个指标：没传就用默认（不虚化 + 55% 蒙板），与老卡片迁移后的值一致
		bgBlur := defaultBgBlur
		if in.BgBlur != nil {
			bgBlur = *in.BgBlur
		}
		bgMask := defaultBgMask
		if in.BgMask != nil {
			bgMask = *in.BgMask
		}
		bgAlpha := defaultBgAlpha
		if in.BgAlpha != nil {
			bgAlpha = *in.BgAlpha
		}
		bottomText := ""
		if in.BottomText != nil {
			bottomText = *in.BottomText
		}
		created = Reminder{
			UserID: userID, ListID: in.ListID, Title: in.Title, Notes: in.Notes, BottomText: bottomText,
			Accent:     accent,
			Background: background,
			BgBlur:     bgBlur,
			BgMask:     bgMask,
			BgAlpha:    bgAlpha,
			CardRole:   in.CardRole,
			Kind:       in.Kind,
			Priority:   in.Priority, DueAt: in.DueAt, AllDay: in.AllDay,
			StartAt: in.StartAt, EndAt: in.EndAt,
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

// CreateNote 把一段文字存成一条记事，并像普通「新建记事」那样广播数据变更。
//
// 给小秘的「保存到记事本」用（用户 2026-10-17：「ai聊天输出内容增加 保存到记事本
// 功能，自动生成标签」）：标题、备注与标签都由上层按内容自动生成，这里只负责落库
// —— 记事固定进「记事本」栏目、创建即完成，与界面里正常新建的记事没有任何区别。
// originClientID 是发起这次请求的标签页标识，广播时跳过它自己（它已经知道结果）。
func CreateNote(db *gorm.DB, userID uint, title, notes, originClientID string) (ReminderDTO, error) {
	item, err := createReminder(db, userID, SaveReminderInput{Title: title, Notes: notes, Kind: KindNote})
	if err != nil {
		return ReminderDTO{}, err
	}
	publishDataChanged(item.UserID, "reminder", "created", item.ID, originClientID)
	return item, nil
}

func updateReminder(db *gorm.DB, userID, reminderID uint, in SaveReminderInput) (ReminderDTO, error) {
	if err := validateReminderInput(&in); err != nil {
		return ReminderDTO{}, err
	}
	// 换背景时，旧的那张上传图要在**事务提交之后**删掉（删文件撤不回来）：
	// 先把它记下来，提交成功再清理。
	previousBackground := ""
	_ = db.Model(&Reminder{}).Where("id = ? AND user_id = ?", reminderID, userID).
		Pluck("background", &previousBackground).Error
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
		// 改成记事就挪进「记事本」栏目（与新建记事同一口径）；改回任务时留在原清单。
		if in.Kind == KindNote {
			bucket, err := ensureNoteBucket(tx, userID)
			if err != nil {
				return err
			}
			in.ListID = bucket.ID
		} else if in.ListID == 0 {
			in.ListID = existing.ListID
		}
		if err := assertListOwner(tx, userID, in.ListID); err != nil {
			return err
		}
		existing.Title = in.Title
		existing.Notes = in.Notes
		if in.BottomText != nil {
			existing.BottomText = *in.BottomText
		}
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
		existing.StartAt = in.StartAt
		existing.EndAt = in.EndAt
		existing.RepeatRule = in.RepeatRule
		existing.Calendar = in.Calendar
		existing.LunarAnchor = in.LunarAnchor
		existing.RepeatNotifyMinutes = in.RepeatNotifyMinutes
		if in.Accent != nil { // 没传就保留原来的（通用编辑器不带这个字段）
			existing.Accent = *in.Accent
		}
		if in.Background != nil { // 同上：没传就保留
			existing.Background = *in.Background
		}
		if in.BgBlur != nil { // 同上：没传就保留
			existing.BgBlur = *in.BgBlur
		}
		if in.BgMask != nil {
			existing.BgMask = *in.BgMask
		}
		if in.BgAlpha != nil {
			existing.BgAlpha = *in.BgAlpha
		}
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
	if in.Background != nil && previousBackground != "" && previousBackground != *in.Background {
		cleanupUploadedBackground(db, previousBackground, reminderID)
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
	//
	// 首次提醒时刻（用户 2026-10-13 要求）：**「开始提醒时间」= 当天第一次弹窗**。
	// 取「结束时间」与「到期日当天的开始提醒时间」里更早的那个 —— 例如结束时间
	// 23:59、开始提醒时间 06:00，那么到期那天 06:00 就会先弹一次，之后按
	// 「提醒频率」重复（见 scheduleRepeatNotify），过了「逾期提醒时间」再标逾期。
	// 已经过了那个点（比如下午才建今天的任务）就按「现在」排，下一轮调度就弹。
	scheduledFor := firstRemindSchedule(tx, reminder)
	if scheduledFor.IsZero() {
		scheduledFor = reminder.DueAt.UTC()
	}
	// 离「逾期提醒时间」已经不足 10 分钟时**一条普通提醒都不发**（用户 2026-10-13：
	// 「低于10分钟到逾期设定时间的的不再提醒，直接给出逾期提醒」）：这种时候再弹一次
	// 「到点了」紧接着就是「已逾期」，自相矛盾；逾期提醒由 notifyOverdue 按点发出。
	//
	// 比较的基准是**创建时间 + 10 分钟**（「10 分钟以后才开始第一次提醒」这件事本身的
	// 时刻）：逾期时间落在它之前 = 这条提醒还没来得及第一次提醒就已经逾期了。
	// 不用 scheduledFor 去比 —— 「逾期时间写成 00:00 = 到期即逾期」时两者是同一个时刻，
	// 拿它比会把「两小时后到期」的普通提醒也一起挡掉。
	if reminder.SnoozedUntil == nil {
		_, cutoff := overduePolicy(tx, reminder.UserID)
		earliest := reminder.CreatedAt.Add(firstRemindDelay)
		// 只对**还没逾期**的条目生效：逾期时间已经过去的（老任务、或者隔了好几天才重建链条的）
		// 照常排提醒 —— 否则「编辑一条逾期任务」会把它的「提醒频率」链条一起弄没了，
		// 而它的逾期提醒本来就是另一条路（notifyOverdue，每个任务每天一条）。
		if deadline := overdueDeadlineOf(reminder, cutoff); !deadline.IsZero() &&
			deadline.After(time.Now()) && !deadline.After(earliest) {
			return nil
		}
	}
	// 注意：**不把过去时刻夹到「现在」** —— 调度器本来就会捞 run_at <= now 的任务，
	// 夹一下反而会让投递任务的时间戳与「首次提醒时刻」对不上（用例与排查都靠它）。
	runAt := scheduledFor
	if reminder.SnoozedUntil != nil {
		runAt = reminder.SnoozedUntil.UTC()
	}
	for _, ch := range channels {
		raw := fmt.Sprintf("%d|%s|%s|%d", reminder.ID, scheduledFor.Format(time.RFC3339Nano), ch, reminder.Version)
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
	dto := ReminderDTO{Reminder: item, ListName: list.Name, ListColor: list.Color, CanDelete: item.UserID == userID}
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

// listWindow 是列表/记事本页的时间窗口，两端左闭右开（上海时区）；
// nil 表示那一端不限。解析口径与日历 from/to 一致。
type listWindow struct {
	start *time.Time
	end   *time.Time
}

// parseListWindow 把 from / to（YYYY-MM-DD，可空）解析成上海时区的时间窗口。
// 两端都可单独给出；都给时必须 to 晚于 from（含起不含止）。
func parseListWindow(from, to string) (listWindow, error) {
	loc := shanghai()
	var out listWindow
	if raw := strings.TrimSpace(from); raw != "" {
		parsed, err := time.ParseInLocation("2006-01-02", raw, loc)
		if err != nil {
			return listWindow{}, errors.New("开始日期无效，应为 YYYY-MM-DD")
		}
		out.start = &parsed
	}
	if raw := strings.TrimSpace(to); raw != "" {
		parsed, err := time.ParseInLocation("2006-01-02", raw, loc)
		if err != nil {
			return listWindow{}, errors.New("结束日期无效，应为 YYYY-MM-DD")
		}
		out.end = &parsed
	}
	if out.start != nil && out.end != nil && !out.end.After(*out.start) {
		return listWindow{}, errors.New("结束日期必须晚于开始日期")
	}
	return out, nil
}

// monthWindow 把兼容用的旧参数 month=YYYY-MM 换算成 from/to 两个日期串
// （当月 1 日 → 下月 1 日，与原来「按整月筛选」的口径完全一致）。
func monthWindow(month string) (string, string) {
	month = strings.TrimSpace(month)
	if month == "" {
		return "", ""
	}
	start, err := time.ParseInLocation("2006-01", month, shanghai())
	if err != nil {
		return "", ""
	}
	return start.Format("2006-01-02"), start.AddDate(0, 1, 0).Format("2006-01-02")
}

// listReminders 列出一屏提醒/记事。
//
// includeCompleted 对应界面上「未完成 / 全部」开关的「全部」：打开后已完成的行也
// 一起返回（记事创建即完成，所以「我的清单」想看见记事就必须打开它）。
// view=completed（「已完成」页）走的是另一个接口，这里不受开关影响。
//
// from / to（YYYY-MM-DD，可空，上海时区，含起不含止）是泛化后的时间窗口：
// 「全部」页的时间范围条与旧的按月翻页都走它。旧的 month=YYYY-MM 由
// handleListReminders 换算成 from/to，本函数不再单独认 month。
// sort=created_desc 时按生效时间倒序（记事本页专用：记事没有 due_at，
// 默认排序会把它们甩到最后，而记事本要「最新的在最上面」）。
func listReminders(db *gorm.DB, userID uint, view, query string, listIDs []uint, includeCompleted bool, from, to, sort string) ([]ReminderDTO, error) {
	var rows []Reminder
	window, err := parseListWindow(from, to)
	if err != nil {
		return nil, err
	}
	q := db.Where("user_id = ? AND deleted_at IS NULL", userID)
	// 「信用卡账单」栏目被后台关掉时，它自动生成的账单日/还款日提醒也不出现在这里
	// （栏目本身、卡片与金额都还在，重新打开偏好就回来）。
	q = excludeHiddenCardReminders(q, hiddenFeatureListIDs(db, userID))
	now := time.Now()
	loc, _ := time.LoadLocation("Asia/Shanghai")
	localNow := now.In(loc)
	startToday := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)
	endToday := startToday.AddDate(0, 0, 1)
	// 未完成口径：view=completed 恒定只看已完成；其余视图按开关决定是否再筛。
	openOnly := "completed_at IS NULL AND "
	if includeCompleted && view != "completed" {
		openOnly = ""
	}
	// 计划页的「全部」只收**本月**已完成的预设：不加这个窗口的话完成记录会一直
	// 滚下去，页面就不再是「计划」了（用户要求：全部应包含本月已完成项目）。
	monthEndOfNow := time.Date(localNow.Year(), localNow.Month(), 1, 0, 0, 0, 0, loc).AddDate(0, 1, 0)
	monthStartOfNow := monthEndOfNow.AddDate(0, -1, 0)
	// 时间比较一律走 tsUTC()：SQLite 里时间是带偏移的文本，直接比会按字符串序
	// 错位（说明见 sql_time.go）。
	//
	// 「排期时间」= COALESCE(end_at, start_at, due_at)：**不看 snoozed_until**
	// （用户 2026-10-14：「稍后提醒……不改变创建、到期时间，只是延迟提醒时间」）。
	// 稍后提醒只影响投递任务的 run_at（见 rebuildJobs），列表/分组/视图都按原来的排期走 ——
	// 所以「稍后到明天」的条目仍然留在今天页，只是下一次提醒推迟了。
	effectiveDue := "COALESCE(end_at, start_at, due_at)"
	preset := "(repeat_rule <> 'none' OR start_at IS NOT NULL OR (due_at IS NOT NULL AND " + tsUTC(effectiveDue) + " >= datetime(?)))"
	switch view {
	case "today":
		// 待办页（用户 2026-10-16：这一页由「今天」改名「待办」，内容改成近期待办）：
		// 生效时间落在**今天起 7 天内**的 + **已经逾期的**。逾期靠排序（due_at 升序）
		// 自然置顶，前端再打个「逾期」标记，并按天分成 已逾期 / 今天 / 明天 / 后天 / … 的卡片。
		// 窗口左闭右开：startToday+7 天 = 第 7 天的 24 点（今天到第 7 天，共 7 天）。
		//
		// 逾期的这一支**不看稍后提醒**（用户 2026-10-13：「逾期项目点击知道了，提醒依然
		// 保留在逾期栏目，只是按后台设定时间进行下一次提示」）：点「知道了」会把它稍后提醒
		// 到设定时间，但那条任务**本来就逾期**，不能因此从待办页的「已逾期」里消失。
		// 普通（还没逾期）的条目仍然按排期时间算 —— 稍后提醒改的是提醒时间，
		// 不会把一条任务挪进/挪出这 7 天。
		_, cutoff := overduePolicy(db, userID)
		overdueExpr := overdueDeadlineExpr("COALESCE(end_at, start_at, due_at)", cutoff) + " < datetime(?)"
		q = q.Where(openOnly+"due_at IS NOT NULL AND ("+tsUTC(effectiveDue)+" < datetime(?) OR "+overdueExpr+")",
			sqlTimeArg(startToday.AddDate(0, 0, 7)), sqlTimeArg(now))
	case "planned":
		// 计划页＝「预设信息」：有循环规则的、有时间段（计划页建的就是这种）、
		// 或者排在明天及以后的任务。今天页里那些「就今天办」的普通任务不会在这里
		// 重复出现；记事没有排期（保存时就被清空），天然不属于计划页。
		if includeCompleted {
			q = q.Where("(completed_at IS NULL AND "+preset+") OR (completed_at IS NOT NULL AND "+
				tsUTC("completed_at")+" >= datetime(?) AND "+tsUTC("completed_at")+" < datetime(?))",
				sqlTimeArg(endToday), sqlTimeArg(monthStartOfNow), sqlTimeArg(monthEndOfNow))
		} else {
			q = q.Where(openOnly+preset, sqlTimeArg(endToday))
		}
	case "completed":
		q = q.Where("completed_at IS NOT NULL")
	default:
		if openOnly != "" {
			q = q.Where("completed_at IS NULL")
		}
	}
	// 时间窗口（from/to）：归月/归日口径与原来一致——有到期时间按 due_at，
	// 记事没有到期时间按它的记录时间 completed_at，最后兜底 created_at。
	if window.start != nil {
		q = q.Where(tsUTC("COALESCE(due_at, completed_at, created_at)")+" >= datetime(?)", sqlTimeArg(*window.start))
	}
	if window.end != nil {
		q = q.Where(tsUTC("COALESCE(due_at, completed_at, created_at)")+" < datetime(?)", sqlTimeArg(*window.end))
	}
	if len(listIDs) > 0 {
		q = q.Where("list_id IN ?", listIDs)
	}
	if query = strings.TrimSpace(query); query != "" {
		like := "%" + query + "%"
		q = q.Where("(title LIKE ? OR notes LIKE ?)", like, like)
	}
	// 「全部」视图里已完成的行排到最后：先看还要做的事，再回头翻已做完的。
	order := "CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, " + tsUTC("due_at") + " ASC, priority DESC, position ASC, id DESC"
	if includeCompleted && view != "completed" {
		order = "CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END, " + order
	}
	// 记事本页：记事没有 due_at（保存时被清空），默认排序会把它们甩到最后，
	// 而记事本是流水账——最新的要排在最上面。按生效时间倒序（记事取 completed_at，
	// 也就等于创建时间）。
	if sort == "created_desc" {
		order = tsUTC("COALESCE(due_at, completed_at, created_at)") + " DESC, id DESC"
	}
	if err := q.Order(order).Find(&rows).Error; err != nil {
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
	listColors := make(map[uint]string, len(lists))
	for _, list := range lists {
		listNames[list.ID] = list.Name
		listColors[list.ID] = list.Color
	}

	// 「第几次」：循环项目的完成次数（一条聚合查询覆盖本页所有行，不是逐行查）。
	// 只统计 completions 历史表：循环任务完成一次就写一条历史（非循环的只写
	// completed_at，不参与这里），所以 N+1 就是这一次的序号。
	type cycleRow struct {
		ReminderID uint
		Done       int64
	}
	var cycleRows []cycleRow
	if err := db.Model(&Completion{}).
		Select("reminder_id, COUNT(*) AS done").
		Where("user_id = ? AND deleted_at IS NULL AND reminder_id IN ?", userID, reminderIDs).
		Group("reminder_id").Scan(&cycleRows).Error; err != nil {
		return nil, err
	}
	doneByReminder := make(map[uint]int64, len(cycleRows))
	for _, row := range cycleRows {
		doneByReminder[row.ReminderID] = row.Done
	}

	result := make([]ReminderDTO, 0, len(rows))
	for _, row := range rows {
		cycle := 0
		if row.RepeatRule != "" && row.RepeatRule != "none" {
			cycle = int(doneByReminder[row.ID]) + 1
		}
		result = append(result, ReminderDTO{
			Reminder:       row,
			Channels:       channelsByReminder[row.ID],
			ChannelTargets: targetsByReminder[row.ID],
			ListName:       listNames[row.ListID],
			ListColor:      listColors[row.ListID],
			CycleIndex:     cycle,
			CanDelete:      row.UserID == userID,
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
	background := ""
	err := db.Transaction(func(tx *gorm.DB) error {
		var item Reminder
		if err := tx.Where("id = ? AND user_id = ? AND deleted_at IS NULL", reminderID, userID).First(&item).Error; err != nil {
			return err
		}
		background = item.Background
		if err := tx.Model(&DeliveryJob{}).Where("reminder_id = ? AND user_id = ? AND status IN ?", reminderID, userID, []string{"pending", "retry"}).Update("status", "cancelled").Error; err != nil {
			return err
		}
		now := time.Now()
		if err := retireDueNotifications(tx, userID, reminderID, now); err != nil {
			return err
		}
		return tx.Model(&item).Update("deleted_at", &now).Error
	})
	if err != nil {
		return err
	}
	// 卡片删了，它上传的背景图跟着删（用户 2026-10-13 明确要求）；
	// preset: 开头的内置图没有文件，cleanup 里会直接放过。
	cleanupUploadedBackground(db, background, reminderID)
	return nil
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
			next, err := nextOccurrenceAfter(*item.DueAt, item.RepeatRule, item.Calendar, item.LunarAnchor, now)
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
	// 「提醒@他」存到清单的那条任务：勾完以后卡片状态也要跟着变（用户 2026-10-13）。
	syncNudgeFromReminder(db, userID, reminderID, true)
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
	// 撤销完成时，存到清单的那条也回到「待处理」（与完成同一套同步）。
	syncNudgeFromReminder(db, userID, reminderID, false)
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

// nextOccurrenceAfter 从 t 开始按规则往后走，直到落在 now 之后。
// 循环事项可能很久没确认（例如 2011 年的生日一直拖到今天），只走一步会把 due_at
// 留在 2012 年；这里跳过已经过去的周期，确认后倒计时从当前这一轮重新开始。
func nextOccurrenceAfter(t time.Time, rule, calendar, anchor string, now time.Time) (time.Time, error) {
	for i := 0; i < 10000; i++ {
		next, err := nextOccurrenceWithCalendar(t, rule, calendar, anchor)
		if err != nil {
			return t, err
		}
		if !next.After(t) {
			return t, nil
		}
		t = next
		if t.After(now) {
			return t, nil
		}
	}
	return t, nil
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
//	lastweek  上周一 00:00 → 本周一 00:00（上一整个自然周）
//	month     本月 1 日 00:00 → 下月 1 日 00:00（整月）
//	lastmonth 上月 1 日 00:00 → 本月 1 日 00:00（整月）
//	year      1 月 1 日 00:00 → 次年 1 月 1 日 00:00（整年）
//	custom    from 00:00 → to 次日 00:00（含结束当天）
//
// 之所以统一成整段，是因为「到此刻为止」会让边界随时间漂移：同一份数据在
// 月初和月末查「本月」得到不同的终点描述，用户核对时无从判断。
func ParseCompletedRange(option, from, to string) (CompletedRange, error) {
	return parseCompletedRangeAt(option, from, to, time.Now())
}

// parseCompletedRangeAt 是 ParseCompletedRange 的「按给定时刻算」版本：
// AI 的快照传的是它自己钉住的 now，这样测试里的「本周」不会随真实日期漂。
func parseCompletedRangeAt(option, from, to string, at time.Time) (CompletedRange, error) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return CompletedRange{}, err
	}
	now := at.In(loc)
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
	case "lastweek":
		// 上周是**上一个自然周**（周一 → 周日），不是「最近 7 天」：
		// 起点 = 本周一往前 7 天，终点 = 本周一，左闭右开，刚好和「本周」首尾相接。
		offset := (int(now.Weekday()) + 6) % 7
		startOfThisWeek := startOfToday.AddDate(0, 0, -offset)
		start := startOfThisWeek.AddDate(0, 0, -7)
		return CompletedRange{Start: &start, End: &startOfThisWeek}, nil
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
	hq = excludeHiddenCardCompletions(hq, db, hiddenFeatureListIDs(db, userID))
	if rng.Start != nil {
		hq = hq.Where(tsUTC("completed_at")+" >= datetime(?)", sqlTimeArg(*rng.Start))
	}
	if rng.End != nil {
		hq = hq.Where(tsUTC("completed_at")+" < datetime(?)", sqlTimeArg(*rng.End))
	}
	if query = strings.TrimSpace(query); query != "" {
		hq = hq.Where("title_snapshot LIKE ?", "%"+query+"%")
	}
	if err := hq.Order(tsUTC("completed_at") + " DESC").Find(&history).Error; err != nil {
		return nil, err
	}

	var rows []Reminder
	rq := db.Where("user_id = ? AND deleted_at IS NULL AND completed_at IS NOT NULL", userID)
	rq = excludeHiddenCardReminders(rq, hiddenFeatureListIDs(db, userID))
	if rng.Start != nil {
		rq = rq.Where(tsUTC("completed_at")+" >= datetime(?)", sqlTimeArg(*rng.Start))
	}
	if rng.End != nil {
		rq = rq.Where(tsUTC("completed_at")+" < datetime(?)", sqlTimeArg(*rng.End))
	}
	if len(listIDs) > 0 {
		rq = rq.Where("list_id IN ?", listIDs)
	}
	if query != "" {
		like := "%" + query + "%"
		rq = rq.Where("(title LIKE ? OR notes LIKE ?)", like, like)
	}
	if err := rq.Order(tsUTC("completed_at") + " DESC").Find(&rows).Error; err != nil {
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
			// 完成时段从这条提醒的录入时间算起（用户 2026-10-22 的示例：
			// 2 号录入、5 号完成，就要能看到 2 号 → 5 号这一整段）。
			if !owner.CreatedAt.IsZero() {
				created := owner.CreatedAt
				item.CreatedAt = &created
			}
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
		created := r.CreatedAt
		result = append(result, CompletedItemDTO{
			ID: r.ID, Source: "reminder", ReminderID: r.ID,
			Title: r.Title, CompletedAt: *r.CompletedAt, Kind: r.Kind,
			CreatedAt: &created,
			ListID:    r.ListID, ListName: listNames[r.ListID],
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

// deleteList 删除一个清单：先把清单里的提醒归到默认清单，再软删清单。
// 抽成函数是为了让「接口删除」与「同步收到对端的删除」走同一条路径——
// 两处各写一遍时，同步那条路很容易漏掉「提醒归置」，留下一批挂在已删除清单上
// 的孤儿数据（列表按清单筛选时它们会凭空消失）。
func deleteList(db *gorm.DB, userID, listID uint) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var list List
		if err := tx.Where("id = ? AND user_id = ? AND deleted_at IS NULL", listID, userID).First(&list).Error; err != nil {
			return err
		}
		if list.IsDefault {
			return errors.New("默认清单不能删除")
		}
		fallback, err := ensureDefaultList(tx, userID)
		if err != nil {
			return err
		}
		if err := tx.Model(&Reminder{}).
			Where("user_id = ? AND list_id = ? AND deleted_at IS NULL", userID, listID).
			Update("list_id", fallback.ID).Error; err != nil {
			return err
		}
		now := time.Now()
		return tx.Model(&list).Update("deleted_at", &now).Error
	})
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

// listCalendarItems 返回 [from, to) 内「落在这段时间」的条目，含已完成项，按时间升序。
//
// 两类来源：
//   - 任务：到期时间（due_at）在区间内；
//   - 记事：没有到期时间（保存时会被清空），按**记录时间**（completed_at，
//     记事创建即完成）落在区间内。
//
// 排序按「生效时间」COALESCE(due_at, completed_at)：一天里任务与记事混排，
// 顺序稳定（SQLite 的 COALESCE 对 NULL 取后一个参数）。
func listCalendarItems(db *gorm.DB, userID uint, from, to time.Time, listIDs []uint) ([]CalendarItemDTO, error) {
	var rows []Reminder
	// 记事的 completed_at 一定非空（创建时写入），任务的 due_at 一定非空，
	// 两个条件互斥，合起来就是「这一天有这条数据」。
	// 任务的三种「这一天有它」：① 到期日落在窗口内；② **时间段任务与窗口相交**
	// （开始早于窗口末尾、结束不早于窗口开头）—— 时间段任务在日历上要跨天显示，
	// 所以只要区间与这一屏有交集就得带回来（用户要求：点开始框、跨框，一直到时间段最后一天）；
	// ③ 记事的记录时间落在窗口内（记事没有到期时间）。
	q := db.Where("user_id = ? AND deleted_at IS NULL AND ("+
		"(kind = ? AND due_at IS NOT NULL AND "+tsUTC("due_at")+" >= datetime(?) AND "+tsUTC("due_at")+" < datetime(?)) OR "+
		"(kind = ? AND end_at IS NOT NULL AND start_at IS NOT NULL AND "+
		tsUTC("start_at")+" < datetime(?) AND "+tsUTC("end_at")+" >= datetime(?)) OR "+
		"(kind = ? AND completed_at IS NOT NULL AND "+tsUTC("completed_at")+" >= datetime(?) AND "+tsUTC("completed_at")+" < datetime(?)))",
		userID, KindTask, sqlTimeArg(from), sqlTimeArg(to),
		KindTask, sqlTimeArg(to), sqlTimeArg(from),
		KindNote, sqlTimeArg(from), sqlTimeArg(to))
	q = excludeHiddenCardReminders(q, hiddenFeatureListIDs(db, userID))
	if len(listIDs) > 0 {
		q = q.Where("list_id IN ?", listIDs)
	}
	if err := q.Order(tsUTC("COALESCE(due_at, completed_at)") + " ASC, id ASC").Find(&rows).Error; err != nil {
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
		// 生效时间：任务看到期时间，记事看记录时间。
		at := r.DueAt
		if at == nil {
			at = r.CompletedAt
		}
		if at == nil {
			continue
		}
		item := CalendarItemDTO{
			ID: r.ID, Title: r.Title, ListID: r.ListID,
			DueAt: *at, StartAt: r.StartAt, EndAt: r.EndAt, DueDate: at.In(loc).Format("2006-01-02"),
			AllDay: r.AllDay && r.Kind == KindTask, Completed: r.CompletedAt != nil,
			Kind: r.Kind, Priority: r.Priority, RepeatRule: r.RepeatRule,
			// CardID / CardRole 都要带上：日历靠 card_role 上色，靠 card_id 才能关联回卡片
			// （之前只带了 CardRole，card_id 一直是空的——由 verify-097 的日历断言抓出来）。
			Notes: r.Notes, CompletedAt: r.CompletedAt, CardRole: r.CardRole, CardID: r.CardID,
		}
		if l, ok := listByID[r.ListID]; ok {
			item.ListName = l.Name
			item.ListColor = l.Color
			item.ListIcon = normalizeListIcon(l.Icon)
		}
		result = append(result, item)
	}
	return result, nil
}
