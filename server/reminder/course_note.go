package reminder

import (
	"strings"
	"time"

	"smallgo/server/timetable"

	"gorm.io/gorm"
)

// 课程表的「备注」永久保存在随手记事本里：标题统一为「课程备注：<课程名>」，
// 同一门课再次保存时更新同一条；课程被删掉也不删这条记事。
func init() {
	timetable.SetCourseNoteSaver(saveCourseNote)
}

func saveCourseNote(db *gorm.DB, userID, noteID uint, courseTitle, note string) (uint, error) {
	note = strings.TrimSpace(note)
	if note == "" {
		return 0, nil
	}
	title := "课程备注：" + strings.TrimSpace(courseTitle)
	var existing Reminder
	if noteID != 0 {
		if err := db.Where("id = ? AND user_id = ? AND kind = ?", noteID, userID, KindNote).First(&existing).Error; err == nil {
			if existing.Title == title && existing.Notes == note {
				return existing.ID, nil
			}
			if err := db.Model(&Reminder{}).Where("id = ?", existing.ID).
				Updates(map[string]interface{}{"title": title, "notes": note, "updated_at": time.Now()}).Error; err != nil {
				return 0, err
			}
			return existing.ID, nil
		}
	}
	bucket, err := ensureNoteBucket(db, userID)
	if err != nil {
		return 0, err
	}
	err = db.Where("user_id = ? AND list_id = ? AND kind = ? AND title = ?", userID, bucket.ID, KindNote, title).
		Order("id ASC").First(&existing).Error
	if err == nil {
		if existing.Title == title && existing.Notes == note {
			return existing.ID, nil
		}
		if err := db.Model(&Reminder{}).Where("id = ?", existing.ID).
			Updates(map[string]interface{}{"title": title, "notes": note, "updated_at": time.Now()}).Error; err != nil {
			return 0, err
		}
		return existing.ID, nil
	}
	if err != gorm.ErrRecordNotFound {
		return 0, err
	}
	now := time.Now()
	row := Reminder{
		UserID: userID, ListID: bucket.ID, Title: title, Notes: note,
		Kind: KindNote, CompletedAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&row).Error; err != nil {
		return 0, err
	}
	return row.ID, nil
}
