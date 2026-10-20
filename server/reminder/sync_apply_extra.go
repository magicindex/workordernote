package reminder

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"

	"smallgo/server/database"
	"smallgo/server/timetable"
)

// 课程表、个人偏好与站点设置的双机同步（0.39.0）。
//
// 合并规则与其它实体一致：按 updated_at 取新的，时间相同用实例标识兜底。
// 课程表与条目原先是硬删除，0.39.0 起改成软删并保留墓碑，否则「在对端删掉
// 一张表」会变成「下次同步又回来」。

// newerThan 按毫秒比较：SQLite 存时间会截掉纳秒，直接用 After 会让「刚写入的
// 同一行」每次同步都判成更新，幂等检查就过不去。
func newerThan(local, incoming time.Time) bool {
	return incoming.Truncate(time.Millisecond).After(local.Truncate(time.Millisecond))
}

func applySyncTimetables(tx *gorm.DB, snap syncSnapshot, users map[string]database.User,
	myInstance string, stats *syncApplyStats) (map[string]uint, error) {
	var locals []timetable.Timetable
	if err := tx.Unscoped().Find(&locals).Error; err != nil {
		return nil, err
	}
	byUID := make(map[string]*timetable.Timetable, len(locals))
	for i := range locals {
		byUID[locals[i].SyncUID] = &locals[i]
	}
	out := make(map[string]uint, len(snap.Timetables))
	for _, in := range snap.Timetables {
		if in.UID == "" {
			continue
		}
		owner, ok := users[in.Owner]
		if !ok {
			markUnmapped(stats, in.Owner)
			continue
		}
		periodsJSON := "[]"
		if len(in.Periods) > 0 {
			raw, err := json.Marshal(in.Periods)
			if err != nil {
				return nil, err
			}
			periodsJSON = string(raw)
		}
		local, exists := byUID[in.UID]
		if !exists {
			row := timetable.Timetable{
				UserID: owner.ID, Name: in.Name, Location: in.Location, Position: in.Position,
				LessonMinutes: in.LessonMinutes, BreakMinutes: in.BreakMinutes,
				PeriodCount: in.PeriodCount, PeriodsJSON: periodsJSON,
				SyncUID: in.UID, CreatedAt: in.CreatedAt, UpdatedAt: in.UpdatedAt,
			}
			row.DeletedAt.Valid = in.Deleted
			row.DeletedAt.Time = in.UpdatedAt
			if err := tx.Unscoped().Create(&row).Error; err != nil {
				return nil, err
			}
			out[in.UID] = row.ID
			stats.TimetablesCreated++
			if !in.Deleted {
				stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
			}
			continue
		}
		out[in.UID] = local.ID
		if in.Deleted != local.DeletedAt.Valid {
			// 删除/恢复也要按时间取新的，不能无条件跟随。
			if !newerThan(local.UpdatedAt, in.UpdatedAt) {
				continue
			}
		} else if !newerThan(local.UpdatedAt, in.UpdatedAt) {
			continue
		}
		updates := map[string]interface{}{
			"user_id": owner.ID, "name": in.Name, "location": in.Location, "position": in.Position,
			"lesson_minutes": in.LessonMinutes, "break_minutes": in.BreakMinutes,
			"period_count": in.PeriodCount, "periods": periodsJSON,
			"updated_at": in.UpdatedAt,
		}
		if in.Deleted {
			updates["deleted_at"] = in.UpdatedAt
			stats.TimetablesDeleted++
		} else {
			updates["deleted_at"] = nil
			stats.TimetablesUpdated++
		}
		if err := tx.Unscoped().Model(&timetable.Timetable{}).Where("id = ?", local.ID).
			Updates(updates).Error; err != nil {
			return nil, err
		}
		if !in.Deleted {
			stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
		}
	}
	return out, nil
}

func applySyncTimetableEntries(tx *gorm.DB, snap syncSnapshot, users map[string]database.User,
	tables map[string]uint, myInstance string, stats *syncApplyStats) error {
	var locals []timetable.TimetableEntry
	if err := tx.Unscoped().Find(&locals).Error; err != nil {
		return err
	}
	byUID := make(map[string]*timetable.TimetableEntry, len(locals))
	for i := range locals {
		byUID[locals[i].SyncUID] = &locals[i]
	}
	for _, in := range snap.TimetableEntries {
		if in.UID == "" {
			continue
		}
		owner, ok := users[in.Owner]
		if !ok {
			markUnmapped(stats, in.Owner)
			continue
		}
		tableID, ok := tables[in.TimetableUID]
		if !ok {
			// 表被跳过（账号没配上或墓碑缺失）：条目也不落，否则成孤儿。
			stats.Skipped++
			continue
		}
		local, exists := byUID[in.UID]
		if !exists {
			row := timetable.TimetableEntry{
				UserID: owner.ID, TimetableID: tableID, Title: in.Title, Kind: in.Kind,
				Weekday: in.Weekday, StartTime: in.StartTime, EndTime: in.EndTime,
				Location: in.Location, Teacher: in.Teacher, Note: in.Note, Color: in.Color,
				SyncUID: in.UID, CreatedAt: in.CreatedAt, UpdatedAt: in.UpdatedAt,
			}
			row.DeletedAt.Valid = in.Deleted
			row.DeletedAt.Time = in.UpdatedAt
			if err := tx.Unscoped().Create(&row).Error; err != nil {
				return err
			}
			stats.EntriesCreated++
			if !in.Deleted {
				stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
			}
			continue
		}
		if !newerThan(local.UpdatedAt, in.UpdatedAt) {
			continue
		}
		updates := map[string]interface{}{
			"user_id": owner.ID, "timetable_id": tableID, "title": in.Title, "kind": in.Kind,
			"weekday": in.Weekday, "start_time": in.StartTime, "end_time": in.EndTime,
			"location": in.Location, "teacher": in.Teacher, "note": in.Note, "color": in.Color,
			"updated_at": in.UpdatedAt,
		}
		if in.Deleted {
			updates["deleted_at"] = in.UpdatedAt
			stats.EntriesDeleted++
		} else {
			updates["deleted_at"] = nil
			stats.EntriesUpdated++
		}
		if err := tx.Unscoped().Model(&timetable.TimetableEntry{}).Where("id = ?", local.ID).
			Updates(updates).Error; err != nil {
			return err
		}
		if !in.Deleted {
			stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
		}
	}
	return nil
}

func applySyncUserConfigs(tx *gorm.DB, snap syncSnapshot, users map[string]database.User, stats *syncApplyStats) error {
	for _, in := range snap.UserConfigs {
		if in.Key == "" || syncConfigSecrets[in.Key] {
			continue
		}
		owner, ok := users[in.Owner]
		if !ok {
			markUnmapped(stats, in.Owner)
			continue
		}
		var local database.SystemConfig
		err := tx.Where("user_id = ? AND key = ?", owner.ID, in.Key).First(&local).Error
		if err == gorm.ErrRecordNotFound {
			row := database.SystemConfig{UserID: owner.ID, Key: in.Key, Value: in.Value,
				CreatedAt: in.UpdatedAt, UpdatedAt: in.UpdatedAt}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			stats.ConfigsUpdated++
			stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
			continue
		}
		if err != nil {
			return err
		}
		if !newerThan(local.UpdatedAt, in.UpdatedAt) {
			continue
		}
		if err := tx.Model(&database.SystemConfig{}).Where("id = ?", local.ID).
			Updates(map[string]interface{}{"value": in.Value, "updated_at": in.UpdatedAt}).Error; err != nil {
			return err
		}
		stats.ConfigsUpdated++
		stats.AffectedUsers = append(stats.AffectedUsers, owner.ID)
	}
	return nil
}

func applySyncSystemConfigs(tx *gorm.DB, snap syncSnapshot, stats *syncApplyStats) error {
	for _, in := range snap.SystemConfigs {
		if in.Key == "" || syncConfigSecrets[in.Key] {
			continue
		}
		var local database.SystemConfig
		err := tx.Where("user_id = 0 AND key = ?", in.Key).First(&local).Error
		if err == gorm.ErrRecordNotFound {
			row := database.SystemConfig{UserID: 0, Key: in.Key, Value: in.Value,
				CreatedAt: in.UpdatedAt, UpdatedAt: in.UpdatedAt}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			stats.ConfigsUpdated++
			continue
		}
		if err != nil {
			return err
		}
		if !newerThan(local.UpdatedAt, in.UpdatedAt) {
			continue
		}
		if err := tx.Model(&database.SystemConfig{}).Where("id = ?", local.ID).
			Updates(map[string]interface{}{"value": in.Value, "updated_at": in.UpdatedAt}).Error; err != nil {
			return err
		}
		stats.ConfigsUpdated++
	}
	return nil
}
