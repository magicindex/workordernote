package timetable

import "time"

// 课程表（用户 2026-10-18）：
//
//   - 一个账号可以有多张表（「哥哥」「妹妹」「我」），页面顶部按标签切换；
//   - 每张表里是课程与课外活动两类条目，按周几 + 起止时间摆放；
//   - 栏目本身由个人偏好 timetable_enabled 控制显隐（默认关），关掉只是隐藏，
//     数据保留——与记事本 / 信用卡 / 仪式感是同一套做法。
//
// 这里刻意不把课程塞进 reminders：课程表是「每周重复的版式」，不是一条条
// 待办；混进清单会污染待办视图、完成统计与提醒派发。
const (
	KindCourse   = "course"   // 课程
	KindActivity = "activity" // 课外活动（社团、托管、训练…）
)

type Timetable struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index;not null" json:"-"`
	Name      string    `gorm:"size:40;not null" json:"name"`
	Position  int       `gorm:"not null;default:0" json:"position"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type TimetableEntry struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	UserID      uint      `gorm:"index;not null" json:"-"`
	TimetableID uint      `gorm:"index;not null" json:"timetable_id"`
	Title       string    `gorm:"size:60;not null" json:"title"`
	Kind        string    `gorm:"size:16;not null;default:'course'" json:"kind"`
	Weekday     int       `gorm:"not null;default:1" json:"weekday"` // 1=周一 … 7=周日
	StartTime   string    `gorm:"size:5;not null;default:''" json:"start_time"`
	EndTime     string    `gorm:"size:5;not null;default:''" json:"end_time"`
	Location    string    `gorm:"size:60;not null;default:''" json:"location"`
	Teacher     string    `gorm:"size:40;not null;default:''" json:"teacher"`
	Note        string    `gorm:"size:300;not null;default:''" json:"note"`
	Color       string    `gorm:"size:24;not null;default:''" json:"color"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
