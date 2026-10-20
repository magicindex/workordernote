package timetable

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"time"

	"gorm.io/gorm"
)

// BackfillSyncUIDs 给同步功能上线之前已有的课程表与条目补 sync_uid。
//
// 用内容摘要而不是随机值：把一台机器的数据目录整份拷到另一台时，两边算出的
// 标识相同，首次同步不会把同一批课程复制成两份。与 reminder.BackfillSyncUIDs
// 同一套思路；表必须先补完，条目的摘要里引用了表标识。
func BackfillSyncUIDs(db *gorm.DB) error {
	usernames, err := usernameByID(db)
	if err != nil {
		return err
	}
	var tables []Timetable
	if err := db.Where("sync_uid IS NULL OR sync_uid = ''").Find(&tables).Error; err != nil {
		return err
	}
	for i := range tables {
		uid := digest("timetable", usernames[tables[i].UserID], tables[i].Name,
			tables[i].CreatedAt.UTC().Format(time.RFC3339Nano))
		if err := db.Model(&Timetable{}).Where("id = ?", tables[i].ID).
			UpdateColumn("sync_uid", uid).Error; err != nil {
			return err
		}
		tables[i].SyncUID = uid
	}
	byID := make(map[uint]string, len(tables))
	var all []struct {
		ID      uint
		SyncUID string
	}
	if err := db.Model(&Timetable{}).Select("id, sync_uid").Scan(&all).Error; err != nil {
		return err
	}
	for _, row := range all {
		byID[row.ID] = row.SyncUID
	}

	var entries []TimetableEntry
	if err := db.Where("sync_uid IS NULL OR sync_uid = ''").Find(&entries).Error; err != nil {
		return err
	}
	for i := range entries {
		e := entries[i]
		uid := digest("timetable_entry", usernames[e.UserID], byID[e.TimetableID],
			strconv.Itoa(e.Weekday), e.StartTime, e.Title,
			e.CreatedAt.UTC().Format(time.RFC3339Nano))
		if err := db.Model(&TimetableEntry{}).Where("id = ?", e.ID).
			UpdateColumn("sync_uid", uid).Error; err != nil {
			return err
		}
	}
	return nil
}

func digest(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0x1f})
	}
	return hex.EncodeToString(h.Sum(nil))[:32]
}

func usernameByID(db *gorm.DB) (map[uint]string, error) {
	var rows []struct {
		ID       uint
		Username string
	}
	if err := db.Table("users").Select("id, username").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[uint]string, len(rows))
	for _, r := range rows {
		out[r.ID] = r.Username
	}
	return out, nil
}
