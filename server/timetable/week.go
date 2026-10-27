package timetable

import (
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
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

// ensureWeek 保证某张表的某一周有一条快照记录。
//   - 本周第一次访问：把旧数据（week_start 为空）认领到本周；没有旧数据时从上一周复制。
//   - 未来周：从最近一个有内容的历史周复制，方便接着排。
//   - 过去周：没有快照就保持空白（不伪造历史），由前端按只读展示。
func ensureWeek(db *gorm.DB, table Timetable, weekStart string) error {
	if weekStart == "" {
		weekStart = CurrentWeekStart()
	}
	var row TimetableWeek
	err := db.Where("timetable_id = ? AND week_start = ?", table.ID, weekStart).First(&row).Error
	if err == nil {
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}

	current := CurrentWeekStart()
	if weekStart == current {
		if err := db.Model(&TimetableEntry{}).
			Where("timetable_id = ? AND (week_start = '' OR week_start IS NULL)", table.ID).
			Update("week_start", current).Error; err != nil {
			return err
		}
	}

	// 先占位，避免并发重复复制；唯一索引兜底。
	row = TimetableWeek{TimetableID: table.ID, WeekStart: weekStart}
	if err := db.Create(&row).Error; err != nil {
		if existsErr := db.Where("timetable_id = ? AND week_start = ?", table.ID, weekStart).First(&row).Error; existsErr == nil {
			return nil
		}
		return err
	}

	if weekStart < current {
		return nil
	}

	// 本周没有旧数据时，从上一周接续；未来周从最近一个有内容的周接续。
	var n int64
	if err := db.Model(&TimetableEntry{}).Where("timetable_id = ? AND week_start = ?", table.ID, weekStart).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	var source struct{ WeekStart string }
	if err := db.Model(&TimetableEntry{}).
		Select("week_start").
		Where("timetable_id = ? AND week_start <> '' AND week_start < ?", table.ID, weekStart).
		Group("week_start").
		Order("week_start DESC").Limit(1).Scan(&source).Error; err != nil {
		return err
	}
	if source.WeekStart == "" {
		return nil
	}
	var srcEntries []TimetableEntry
	if err := db.Where("timetable_id = ? AND week_start = ?", table.ID, source.WeekStart).
		Order("weekday asc, start_time asc, id asc").Find(&srcEntries).Error; err != nil {
		return err
	}
	for _, e := range srcEntries {
		copy := TimetableEntry{
			UserID: table.UserID, TimetableID: table.ID, WeekStart: weekStart,
			Title: e.Title, Kind: e.Kind, Weekday: e.Weekday,
			StartTime: e.StartTime, EndTime: e.EndTime,
			Location: e.Location, Teacher: e.Teacher, Note: e.Note, Color: e.Color,
			CourseNoteID: e.CourseNoteID,
		}
		if err := db.Create(&copy).Error; err != nil {
			return err
		}
	}
	return nil
}

func isPastWeek(weekStart string) bool { return weekStart < CurrentWeekStart() }
