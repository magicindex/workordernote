package timetable

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const weekDateLayout = "2006-01-02"

// CurrentWeekStart 返回今天所在自然周的周一（本地时区）。
func CurrentWeekStart() string { return weekStartOf(time.Now()) }

func weekStartOf(t time.Time) string {
	wd := int(t.Weekday())
	if wd == 0 {
		wd = 7
	}
	monday := t.AddDate(0, 0, 1-wd)
	return monday.Format(weekDateLayout)
}

// NormalizeWeekParam 把前端给的任意日期归一到周一；空值取本周。
func NormalizeWeekParam(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return CurrentWeekStart(), nil
	}
	t, err := time.ParseInLocation(weekDateLayout, raw, time.Local)
	if err != nil {
		return "", fmt.Errorf("周日期格式应为 YYYY-MM-DD")
	}
	return weekStartOf(t), nil
}

// ensureWeek 保证目标周（正常调用只会是本周）有一条周记录并铺好课程。
//
// 2026-10-27 用户要求恢复「下周沿用本周」：当新的一周第一次被访问时，
// 复制最近一个有周记录的更早周；如果那一周被清空，就复制空表（不再往更早找）。
// 性能/并发安全靠 (timetable_id, week_start) 唯一索引：只有抢到周记录的事务负责复制。
func ensureWeek(db *gorm.DB, table Timetable, weekStart string) error {
	current := CurrentWeekStart()
	if weekStart < current {
		return nil
	}
	if weekStart == current {
		// 旧版「未来周快照」留下的空周记录会让本周无法触发自动沿用；
		// 清掉没有条目的未来周记录（有条目的保留，避免丢课）。
		if err := db.Exec(`DELETE FROM timetable_weeks
			WHERE timetable_id = ? AND week_start > ? AND NOT EXISTS (
				SELECT 1 FROM timetable_entries e
				WHERE e.timetable_id = timetable_weeks.timetable_id
				  AND e.week_start = timetable_weeks.week_start
				  AND e.deleted_at IS NULL
			)`, table.ID, current).Error; err != nil {
			return err
		}
	}
	var existing TimetableWeek
	err := db.Where("timetable_id = ? AND week_start = ?", table.ID, weekStart).First(&existing).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	return db.Transaction(func(tx *gorm.DB) error {
		claim := TimetableWeek{TimetableID: table.ID, WeekStart: weekStart}
		res := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&claim)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// 另一个请求已经初始化了这一周。
			return nil
		}

		// 旧数据（week_start 为空）认领到本周；它们本身就代表本周，不能再复制上一周。
		if weekStart == CurrentWeekStart() {
			claimLegacy := tx.Model(&TimetableEntry{}).
				Where("timetable_id = ? AND (week_start = '' OR week_start IS NULL)", table.ID).
				Update("week_start", weekStart)
			if claimLegacy.Error != nil {
				return claimLegacy.Error
			}
			if claimLegacy.RowsAffected > 0 {
				return nil
			}
		}

		var prev TimetableWeek
		err := tx.Where("timetable_id = ? AND week_start < ?", table.ID, weekStart).
			Order("week_start DESC").First(&prev).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}

		var source []TimetableEntry
		if err := tx.Where("timetable_id = ? AND week_start = ?", table.ID, prev.WeekStart).
			Find(&source).Error; err != nil {
			return err
		}
		for _, e := range source {
			baseUID := e.SyncUID
			if baseUID == "" {
				baseUID = strconv.FormatUint(uint64(e.ID), 10)
			}
			next := TimetableEntry{
				SyncUID: carriedEntryUID(baseUID, weekStart),
				UserID:  e.UserID, TimetableID: e.TimetableID,
				Title: e.Title, Kind: e.Kind, Weekday: e.Weekday,
				StartTime: e.StartTime, EndTime: e.EndTime,
				Location: e.Location, Teacher: e.Teacher, Note: e.Note,
				Color: e.Color, WeekStart: weekStart, CourseNoteID: e.CourseNoteID,
			}
			if err := tx.Create(&next).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// carriedEntryUID 让两台设备在跨周复制时生成同一个 sync_uid：
// 否则各自复制一份、同步时 UID 不同，就会把同一节课合并成两条。
func carriedEntryUID(sourceUID, weekStart string) string {
	sum := sha1.Sum([]byte(sourceUID + "|" + weekStart))
	return hex.EncodeToString(sum[:])
}

func isPastWeek(weekStart string) bool { return weekStart < CurrentWeekStart() }
