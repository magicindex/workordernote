package timetable

import "gorm.io/gorm"

// courseNoteSaver 由 reminder 包注册：课程备注要写进「随手记事本」，
// 但 reminder 已经依赖 timetable（双机同步），这里用回调避免包循环。
var courseNoteSaver func(db *gorm.DB, userID, noteID uint, courseTitle, note string) (uint, error)

// SetCourseNoteSaver 在 reminder 包初始化时注入实现。
func SetCourseNoteSaver(fn func(db *gorm.DB, userID, noteID uint, courseTitle, note string) (uint, error)) {
	courseNoteSaver = fn
}

func saveEntryCourseNote(db *gorm.DB, entry *TimetableEntry) {
	if entry.Note == "" || courseNoteSaver == nil {
		return
	}
	id, err := courseNoteSaver(db, entry.UserID, entry.CourseNoteID, entry.Title, entry.Note)
	if err != nil || id == 0 || id == entry.CourseNoteID {
		return
	}
	if err := db.Model(&TimetableEntry{}).Where("id = ?", entry.ID).Update("course_note_id", id).Error; err == nil {
		entry.CourseNoteID = id
	}
}
