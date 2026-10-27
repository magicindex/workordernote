package timetable

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"gorm.io/gorm"
)

// 课程表（用户 2026-10-18）：
//
//   - 一个账号可以有多张表（「哥哥」「妹妹」「我」），页面顶部按标签切换；
//   - 每张表里是课程与课外活动两类条目，按周几 + 起止时间摆放；
//   - 栏目本身由个人偏好 timetable_enabled 控制显隐（默认开），关掉只是隐藏，
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
	// 班级 / 地点（用户 2026-10-19：「名字后边增加 班级\地点（可选），设置好班级后课程表自动引用」）：
	// 表级默认值，课程条目自己不填地点时卡片就显示它；条目填了则以条目为准。
	Location string `gorm:"size:60;not null;default:''" json:"location"`

	// 排课节奏：一节课多长、课间多长，以及「按课时重排」的起点与节数。
	// 用户 2026-10-18 提出「45 分钟下课 10 分钟、课间操怎么体现」，所以把它做成
	// 每张表自己的设置：填了开始时间就自动带出结束时间。
	LessonMinutes int `gorm:"not null;default:45" json:"lesson_minutes"`
	BreakMinutes  int `gorm:"not null;default:10" json:"break_minutes"`
	PeriodCount   int `gorm:"not null;default:8" json:"period_count"`

	// 每节次的具体时间段（用户 2026-10-19：「允许设置每节次时间段」）：
	// 段（早课/上午/下午/晚课）+ 起止，顺序即节次顺序。存 JSON，跟着表走。
	PeriodsJSON string         `gorm:"column:periods;type:text" json:"-"`
	Periods     []CoursePeriod `gorm:"-" json:"periods"`

	// SyncUID / DeletedAt 供「双机同步」认行与传墓碑，与清单、提醒同一套做法。
	SyncUID   string         `gorm:"size:40;index" json:"-"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// TimetableShare 把一张课程表共享给另一个账号。
// 权限只有 read（只看）与 write（可增删改课程，不能改表设置/删表/再共享）；
// 同一个人对同一张表只有一条记录，重复共享时更新权限。
type TimetableShare struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	TimetableID uint      `gorm:"not null;uniqueIndex:idx_timetable_share" json:"timetable_id"`
	UserID      uint      `gorm:"not null;uniqueIndex:idx_timetable_share;index" json:"user_id"`
	Permission  string    `gorm:"size:8;not null;default:'read'" json:"permission"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TimetableWeek 标记某张表的某一周已经初始化，避免空周被反复从上一周复制。
type TimetableWeek struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	TimetableID uint      `gorm:"not null;uniqueIndex:idx_timetable_week" json:"timetable_id"`
	WeekStart   string    `gorm:"size:10;not null;uniqueIndex:idx_timetable_week" json:"week_start"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CoursePeriod 是一节课的骨架（不是某个学生某天的课）。
// Section 取 early/morning/afternoon/evening，前端按它把卡片分到四段。
type CoursePeriod struct {
	Section string `json:"section"`
	Start   string `json:"start"`
	End     string `json:"end"`
}

type TimetableEntry struct {
	ID          uint `gorm:"primaryKey" json:"id"`
	UserID      uint `gorm:"index;not null" json:"-"`
	TimetableID uint `gorm:"index;not null" json:"timetable_id"`
	// WeekStart 是这一条课程所属自然周的周一（YYYY-MM-DD）。课程表按周留快照：
	// 切到上周/下周看到的是那一周实际排的课，过去的周只读，编辑本周不影响历史。
	WeekStart string `gorm:"size:10;not null;default:'';index" json:"week_start"`
	Title     string `gorm:"size:60;not null" json:"title"`
	Kind      string `gorm:"size:16;not null;default:'course'" json:"kind"`
	Weekday   int    `gorm:"not null;default:1" json:"weekday"` // 1=周一 … 7=周日
	StartTime string `gorm:"size:5;not null;default:''" json:"start_time"`
	EndTime   string `gorm:"size:5;not null;default:''" json:"end_time"`
	Location  string `gorm:"size:60;not null;default:''" json:"location"`
	Teacher   string `gorm:"size:40;not null;default:''" json:"teacher"`
	Note      string `gorm:"size:300;not null;default:''" json:"note"`
	Color     string `gorm:"size:24;not null;default:''" json:"color"`
	// CourseNoteID 指向随手记事本里「课程备注：<课程名>」那条记事；删课不删备注。
	CourseNoteID uint           `gorm:"not null;default:0;index" json:"-"`
	SyncUID      string         `gorm:"size:40;index" json:"-"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

// BeforeCreate 给同步功能上线后新建的课程表/条目分配跨实例标识；同步写入的行
// 自带对端标识，不会被覆盖。
func (t *Timetable) BeforeCreate(*gorm.DB) error      { return ensureSyncUID(&t.SyncUID) }
func (e *TimetableEntry) BeforeCreate(*gorm.DB) error { return ensureSyncUID(&e.SyncUID) }

func ensureSyncUID(uid *string) error {
	if uid == nil || *uid != "" {
		return nil
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return err
	}
	*uid = hex.EncodeToString(buf)
	return nil
}
