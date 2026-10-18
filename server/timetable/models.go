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
	ID       uint   `gorm:"primaryKey" json:"id"`
	UserID   uint   `gorm:"index;not null" json:"-"`
	Name     string `gorm:"size:40;not null" json:"name"`
	Position int    `gorm:"not null;default:0" json:"position"`

	// 排课节奏：一节课多长、课间多长，以及「按课时重排」的起点与节数。
	// 用户 2026-10-18 提出「45 分钟下课 10 分钟、课间操怎么体现」，所以把它做成
	// 每张表自己的设置：填了开始时间就自动带出结束时间。
	LessonMinutes int    `gorm:"not null;default:45" json:"lesson_minutes"`
	BreakMinutes  int    `gorm:"not null;default:10" json:"break_minutes"`
	PeriodCount int `gorm:"not null;default:8" json:"period_count"`

	// 每节次的具体时间段（用户 2026-10-19：「允许设置每节次时间段」）：
	// 段（早课/上午/下午/晚课）+ 起止，顺序即节次顺序。存 JSON，跟着表走。
	PeriodsJSON string         `gorm:"column:periods;type:text" json:"-"`
	Periods     []CoursePeriod `gorm:"-" json:"periods"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// CoursePeriod 是一节课的骨架（不是某个学生某天的课）。
// Section 取 early/morning/afternoon/evening，前端按它把卡片分到四段。
type CoursePeriod struct {
	Section string `json:"section"`
	Start   string `json:"start"`
	End     string `json:"end"`
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
