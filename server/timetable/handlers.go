package timetable

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"smallgo/server/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	maxTablesPerUser   = 12
	maxEntriesPerTable = 200
	maxTableNameRunes  = 20
	maxTitleRunes      = 40
	maxLocationRunes   = 40
	maxTeacherRunes    = 30
	maxNoteRunes       = 300

	minLessonMinutes = 15
	maxLessonMinutes = 180
	maxBreakMinutes  = 60
	maxPeriodCount   = 16
)

var clockPattern = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

// handleListTables 返回「自己的表 + 别人共享给我的表」。
// 自己的表排前面；共享表带 owner_name / permission，前端据此隐藏写操作。
func handleListTables(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		var own []Timetable
		if err := db.Where("user_id = ?", userID).
			Order("position asc, id asc").Find(&own).Error; err != nil {
			response.ErrorInternal(c, "读取课程表失败")
			return
		}

		var shares []TimetableShare
		if err := db.Where("user_id = ?", userID).Order("id asc").Find(&shares).Error; err != nil {
			response.ErrorInternal(c, "读取课程表失败")
			return
		}
		sharedIDs := make([]uint, 0, len(shares))
		for _, s := range shares {
			sharedIDs = append(sharedIDs, s.TimetableID)
		}
		var shared []Timetable
		if len(sharedIDs) > 0 {
			if err := db.Where("id IN ?", sharedIDs).Find(&shared).Error; err != nil {
				response.ErrorInternal(c, "读取课程表失败")
				return
			}
		}
		sharedByID := make(map[uint]Timetable, len(shared))
		for _, t := range shared {
			sharedByID[t.ID] = t
		}

		ids := make([]uint, 0, len(own)+len(shared))
		for _, t := range own {
			ids = append(ids, t.ID)
		}
		for _, t := range shared {
			ids = append(ids, t.ID)
		}
		counts := make(map[uint]int64, len(ids))
		if len(ids) > 0 {
			var rows []struct {
				TimetableID uint
				N           int64
			}
			if err := db.Model(&TimetableEntry{}).
				Select("timetable_id, count(*) as n").
				Where("timetable_id IN ? AND (week_start = ? OR week_start = '')", ids, CurrentWeekStart()).
				Group("timetable_id").Scan(&rows).Error; err != nil {
				response.ErrorInternal(c, "读取课程表失败")
				return
			}
			for _, r := range rows {
				counts[r.TimetableID] = r.N
			}
		}

		out := make([]gin.H, 0, len(own)+len(shares))
		for _, t := range own {
			out = append(out, gin.H{
				"id": t.ID, "name": t.Name, "position": t.Position,
				"entry_count": counts[t.ID],
				"permission":  PermissionOwner, "is_shared": false, "owner_name": "",
			})
		}
		ownerNames := make(map[uint]string)
		for _, s := range shares {
			t, ok := sharedByID[s.TimetableID]
			if !ok {
				continue
			}
			name, seen := ownerNames[t.UserID]
			if !seen {
				name = userDisplayName(db, t.UserID)
				ownerNames[t.UserID] = name
			}
			permission := s.Permission
			if permission != PermissionWrite {
				permission = PermissionRead
			}
			out = append(out, gin.H{
				"id": t.ID, "name": t.Name, "position": t.Position,
				"entry_count": counts[t.ID],
				"permission":  permission, "is_shared": true, "owner_name": name,
			})
		}
		response.Success(c, gin.H{"tables": out})
	}
}

func handleCreateTable(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		var req struct {
			Name     string `json:"name"`
			Location string `json:"location"`
			// 用户 2026-10-19：「节次按当前时间设置成默认」——新表直接沿用当前这张表的
			// 节次表与课时/课间，省得每次重填；没给或表不属于自己就用内置默认。
			CopyFrom uint `json:"copy_from"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.ErrorBadRequest(c, "请求格式不对")
			return
		}
		name, err := normalizeTableName(req.Name)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		location, err := normalizeLocation(req.Location)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		var n int64
		if err := db.Model(&Timetable{}).Where("user_id = ?", userID).Count(&n).Error; err != nil {
			response.ErrorInternal(c, "保存课程表失败")
			return
		}
		if n >= maxTablesPerUser {
			response.ErrorBadRequest(c, "最多可以建 12 张课程表")
			return
		}
		var maxPos struct{ P int }
		db.Model(&Timetable{}).Select("coalesce(max(position), -1) as p").
			Where("user_id = ?", userID).Scan(&maxPos)
		table := Timetable{
			UserID: userID, Name: name, Location: location, Position: maxPos.P + 1,
			LessonMinutes: defaultLessonMinutes, BreakMinutes: defaultBreakMinutes,
			PeriodCount: defaultPeriodCount,
		}
		table.Periods = defaultPeriods()
		if req.CopyFrom != 0 {
			if source, ok := ownedTable(db, userID, fmt.Sprint(req.CopyFrom)); ok && len(source.Periods) > 0 {
				table.Periods = source.Periods
				table.PeriodCount = len(source.Periods)
				table.LessonMinutes = source.LessonMinutes
				table.BreakMinutes = source.BreakMinutes
			}
		}
		table.PeriodsJSON = marshalPeriods(table.Periods)
		if err := db.Create(&table).Error; err != nil {
			response.ErrorInternal(c, "保存课程表失败")
			return
		}
		response.Success(c, table)
	}
}

// handleGetTable 返回表本身与全部条目；条目按星期与开始时间排好，
// 前端直接按天分组即可。
// handleGetTable 允许 owner 与共享接收者读取；共享表的条目按 timetable_id 查，
// 不再按 user_id 查（条目始终归表的所有者）。
func handleGetTable(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		table, permission, ok := accessibleTable(db, userID, c.Param("id"))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "课程表不存在")
			return
		}
		weekStart, err := NormalizeWeekParam(c.Query("week"))
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		if err := ensureWeek(db, table, weekStart); err != nil {
			response.ErrorInternal(c, "读取课程表失败")
			return
		}
		var entries []TimetableEntry
		if err := db.Where("timetable_id = ? AND week_start = ?", table.ID, weekStart).
			Order("weekday asc, start_time asc, id asc").Find(&entries).Error; err != nil {
			response.ErrorInternal(c, "读取课程表失败")
			return
		}
		response.Success(c, gin.H{
			"table": table, "entries": entries,
			"week_start": weekStart, "current_week": CurrentWeekStart(),
			"past":       isPastWeek(weekStart),
			"permission": permission,
			"owner_name": userDisplayName(db, table.UserID),
			"is_owner":   permission == PermissionOwner,
		})
	}
}

func handleUpdateTable(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		table, ok := ownedTable(db, userID, c.Param("id"))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "课程表不存在")
			return
		}
		var req struct {
			Name          *string         `json:"name"`
			Location      *string         `json:"location"`
			Position      *int            `json:"position"`
			LessonMinutes *int            `json:"lesson_minutes"`
			BreakMinutes  *int            `json:"break_minutes"`
			PeriodCount   *int            `json:"period_count"`
			Periods       *[]CoursePeriod `json:"periods"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.ErrorBadRequest(c, "请求格式不对")
			return
		}
		updates := map[string]interface{}{}
		if req.Name != nil {
			name, err := normalizeTableName(*req.Name)
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			updates["name"] = name
			table.Name = name
		}
		if req.Location != nil {
			location, err := normalizeLocation(*req.Location)
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			updates["location"] = location
			table.Location = location
		}
		if req.Position != nil {
			updates["position"] = *req.Position
			table.Position = *req.Position
		}
		// 用户 2026-10-19 要求每节次的时间段可以自己定：优先用 periods，
		// 只改课时/课间/起点时按新的节奏重排一遍整周骨架。
		if req.Periods != nil {
			periods, err := normalizePeriods(*req.Periods)
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			updates["periods"] = marshalPeriods(periods)
			updates["period_count"] = len(periods)
			table.Periods = periods
			table.PeriodsJSON = marshalPeriods(periods)
			table.PeriodCount = len(periods)
		} else if req.LessonMinutes != nil || req.BreakMinutes != nil || req.PeriodCount != nil {
			lesson, brk := table.LessonMinutes, table.BreakMinutes
			if req.LessonMinutes != nil {
				lesson = *req.LessonMinutes
			}
			if req.BreakMinutes != nil {
				brk = *req.BreakMinutes
			}
			lesson, brk, err := normalizePacing(lesson, brk)
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			periods := regeneratePeriods(lesson, brk, table.Periods)
			updates["lesson_minutes"], updates["break_minutes"] = lesson, brk
			updates["periods"] = marshalPeriods(periods)
			updates["period_count"] = len(periods)
			table.LessonMinutes, table.BreakMinutes = lesson, brk
			table.Periods, table.PeriodsJSON, table.PeriodCount = periods, marshalPeriods(periods), len(periods)
		}
		if len(updates) == 0 {
			response.Success(c, table)
			return
		}
		if err := db.Model(&Timetable{}).Where("id = ? AND user_id = ?", table.ID, userID).
			Updates(updates).Error; err != nil {
			response.ErrorInternal(c, "保存课程表失败")
			return
		}
		response.Success(c, table)
	}
}

func handleDeleteTable(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		table, ok := ownedTable(db, userID, c.Param("id"))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "课程表不存在")
			return
		}
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("timetable_id = ?", table.ID).
				Delete(&TimetableEntry{}).Error; err != nil {
				return err
			}
			if err := tx.Where("timetable_id = ?", table.ID).
				Delete(&TimetableShare{}).Error; err != nil {
				return err
			}
			if err := tx.Where("timetable_id = ?", table.ID).
				Delete(&TimetableWeek{}).Error; err != nil {
				return err
			}
			return tx.Where("id = ? AND user_id = ?", table.ID, userID).
				Delete(&Timetable{}).Error
		})
		if err != nil {
			response.ErrorInternal(c, "删除课程表失败")
			return
		}
		response.Success(c, gin.H{"deleted": table.ID})
	}
}

type entryInput struct {
	Title     string `json:"title"`
	Kind      string `json:"kind"`
	Weekday   int    `json:"weekday"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
	Location  string `json:"location"`
	Teacher   string `json:"teacher"`
	Note      string `json:"note"`
	Color     string `json:"color"`
}

func entryFromInput(in entryInput) (TimetableEntry, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return TimetableEntry{}, errText("课程名称不能为空")
	}
	if utf8.RuneCountInString(title) > maxTitleRunes {
		return TimetableEntry{}, errText("课程名称最多 40 个字符")
	}
	kind := in.Kind
	if kind == "" {
		kind = KindCourse
	}
	if kind != KindCourse && kind != KindActivity {
		return TimetableEntry{}, errText("类型只能是课程或课外活动")
	}
	if in.Weekday < 1 || in.Weekday > 7 {
		return TimetableEntry{}, errText("请选择星期")
	}
	start := strings.TrimSpace(in.StartTime)
	end := strings.TrimSpace(in.EndTime)
	if !clockPattern.MatchString(start) || !clockPattern.MatchString(end) {
		return TimetableEntry{}, errText("时间写成 08:00 这样的格式")
	}
	if start >= end {
		return TimetableEntry{}, errText("结束时间要晚于开始时间")
	}
	location := strings.TrimSpace(in.Location)
	teacher := strings.TrimSpace(in.Teacher)
	note := strings.TrimSpace(strings.ReplaceAll(in.Note, "\r\n", "\n"))
	color := strings.TrimSpace(in.Color)
	if utf8.RuneCountInString(location) > maxLocationRunes {
		return TimetableEntry{}, errText("地点最多 40 个字符")
	}
	if utf8.RuneCountInString(teacher) > maxTeacherRunes {
		return TimetableEntry{}, errText("老师最多 30 个字符")
	}
	if utf8.RuneCountInString(note) > maxNoteRunes {
		return TimetableEntry{}, errText("备注最多 300 个字符")
	}
	if utf8.RuneCountInString(color) > 24 {
		color = ""
	}
	return TimetableEntry{
		Title: title, Kind: kind, Weekday: in.Weekday,
		StartTime: start, EndTime: end,
		Location: location, Teacher: teacher, Note: note, Color: color,
	}, nil
}

func handleCreateEntry(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		table, permission, ok := accessibleTable(db, userID, c.Param("id"))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "课程表不存在")
			return
		}
		if permission == PermissionRead {
			response.ErrorForbidden(c, "这张课程表是只读共享，不能修改")
			return
		}
		var in entryInput
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "请求格式不对")
			return
		}
		entry, err := entryFromInput(in)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		weekStart, err := NormalizeWeekParam(c.Query("week"))
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		if isPastWeek(weekStart) {
			response.ErrorForbidden(c, "历史课程表只读，不能修改")
			return
		}
		if err := ensureWeek(db, table, weekStart); err != nil {
			response.ErrorInternal(c, "保存失败")
			return
		}
		var n int64
		db.Model(&TimetableEntry{}).Where("timetable_id = ? AND week_start = ?", table.ID, weekStart).Count(&n)
		if n >= maxEntriesPerTable {
			response.ErrorBadRequest(c, "一张表一周最多 200 条")
			return
		}
		entry.UserID = table.UserID
		entry.TimetableID = table.ID
		entry.WeekStart = weekStart
		if err := db.Create(&entry).Error; err != nil {
			response.ErrorInternal(c, "保存失败")
			return
		}
		saveEntryCourseNote(db, &entry)
		response.Success(c, entry)
	}
}

// handleUpdateEntry 允许只改其中几项：先把旧值读出来合并，再按同一套规则校验，
// 避免前端漏传一个字段就把它清空。
func handleUpdateEntry(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		var entry TimetableEntry
		if err := db.Where("id = ?", c.Param("id")).First(&entry).Error; err != nil {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "这条课程不存在")
			return
		}
		table, permission, ok := accessibleTable(db, userID, fmt.Sprint(entry.TimetableID))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "这条课程不存在")
			return
		}
		if permission == PermissionRead {
			response.ErrorForbidden(c, "这张课程表是只读共享，不能修改")
			return
		}
		if entry.WeekStart == "" {
			entry.WeekStart = CurrentWeekStart()
			if err := db.Model(&TimetableEntry{}).Where("id = ?", entry.ID).Update("week_start", entry.WeekStart).Error; err != nil {
				response.ErrorInternal(c, "保存失败")
				return
			}
		}
		if isPastWeek(entry.WeekStart) {
			response.ErrorForbidden(c, "历史课程表只读，不能修改")
			return
		}
		var req struct {
			Title     *string `json:"title"`
			Kind      *string `json:"kind"`
			Weekday   *int    `json:"weekday"`
			StartTime *string `json:"start_time"`
			EndTime   *string `json:"end_time"`
			Location  *string `json:"location"`
			Teacher   *string `json:"teacher"`
			Note      *string `json:"note"`
			Color     *string `json:"color"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.ErrorBadRequest(c, "请求格式不对")
			return
		}
		in := entryInput{
			Title: entry.Title, Kind: entry.Kind, Weekday: entry.Weekday,
			StartTime: entry.StartTime, EndTime: entry.EndTime,
			Location: entry.Location, Teacher: entry.Teacher,
			Note: entry.Note, Color: entry.Color,
		}
		if req.Title != nil {
			in.Title = *req.Title
		}
		if req.Kind != nil {
			in.Kind = *req.Kind
		}
		if req.Weekday != nil {
			in.Weekday = *req.Weekday
		}
		if req.StartTime != nil {
			in.StartTime = *req.StartTime
		}
		if req.EndTime != nil {
			in.EndTime = *req.EndTime
		}
		if req.Location != nil {
			in.Location = *req.Location
		}
		if req.Teacher != nil {
			in.Teacher = *req.Teacher
		}
		if req.Note != nil {
			in.Note = *req.Note
		}
		if req.Color != nil {
			in.Color = *req.Color
		}
		next, err := entryFromInput(in)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		next.ID = entry.ID
		next.UserID = table.UserID
		next.TimetableID = entry.TimetableID
		next.WeekStart = entry.WeekStart
		next.CourseNoteID = entry.CourseNoteID
		next.SyncUID = entry.SyncUID
		next.CreatedAt = entry.CreatedAt
		if err := db.Save(&next).Error; err != nil {
			response.ErrorInternal(c, "保存失败")
			return
		}
		saveEntryCourseNote(db, &next)
		response.Success(c, next)
	}
}

func handleDeleteEntry(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		var entry TimetableEntry
		if err := db.Where("id = ?", c.Param("id")).First(&entry).Error; err != nil {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "这条课程不存在")
			return
		}
		_, permission, ok := accessibleTable(db, userID, fmt.Sprint(entry.TimetableID))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "这条课程不存在")
			return
		}
		if permission == PermissionRead {
			response.ErrorForbidden(c, "这张课程表是只读共享，不能修改")
			return
		}
		if entry.WeekStart == "" {
			entry.WeekStart = CurrentWeekStart()
		}
		if isPastWeek(entry.WeekStart) {
			response.ErrorForbidden(c, "历史课程表只读，不能修改")
			return
		}
		if err := db.Delete(&TimetableEntry{}, entry.ID).Error; err != nil {
			response.ErrorInternal(c, "删除失败")
			return
		}
		response.Success(c, gin.H{"deleted": true})
	}
}

func ownedTable(db *gorm.DB, userID uint, rawID string) (Timetable, bool) {
	table, permission, ok := accessibleTable(db, userID, rawID)
	return table, ok && permission == PermissionOwner
}

const (
	defaultLessonMinutes = 45
	defaultBreakMinutes  = 10
	defaultPeriodCount   = 8
)

var periodSections = map[string]bool{"early": true, "morning": true, "afternoon": true, "evening": true}

// 节次表以 JSON 存在 `timetables.periods` 里；坏数据按空处理，前端会退回默认骨架。
func marshalPeriods(list []CoursePeriod) string {
	raw, err := json.Marshal(list)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

func parsePeriods(raw string) []CoursePeriod {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var out []CoursePeriod
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}

// addMinutes 把 "HH:MM" 往后推 delta 分钟（跨天就夹到 23:59，课程表不跨夜）。
func addMinutes(base string, delta int) string {
	var h, m int
	fmt.Sscanf(base, "%d:%d", &h, &m)
	total := h*60 + m + delta
	if total < 0 {
		total = 0
	}
	if total > 23*60+59 {
		total = 23*60 + 59
	}
	return fmt.Sprintf("%02d:%02d", total/60, total%60)
}

// defaultPeriods 建表时铺一份骨架：四段各自从自己的第 1 节开始，段内 45+10。
func defaultPeriods() []CoursePeriod {
	plan := []struct {
		section string
		starts  []string
	}{
		{"early", []string{"07:30", "08:25"}},
		{"morning", []string{"09:20", "10:15", "11:10"}},
		{"afternoon", []string{"14:00", "14:55"}},
		{"evening", []string{"19:00"}},
	}
	out := make([]CoursePeriod, 0, defaultPeriodCount)
	for _, item := range plan {
		for _, start := range item.starts {
			out = append(out, CoursePeriod{Section: item.section, Start: start, End: addMinutes(start, defaultLessonMinutes)})
		}
	}
	return out
}

// regeneratePeriods 只按课时/课间重排：每段从自己的第 1 节开始，互不影响
// （用户 2026-10-19：「每个区域都从第1节课开始排，时间按第一节课开始时间计算」）。
func regeneratePeriods(lesson, brk int, current []CoursePeriod) []CoursePeriod {
	if len(current) == 0 {
		return defaultPeriods()
	}
	out := make([]CoursePeriod, 0, len(current))
	cursor := ""
	prev := ""
	for _, period := range current {
		if period.Section != prev {
			cursor = period.Start
			prev = period.Section
		}
		end := addMinutes(cursor, lesson)
		out = append(out, CoursePeriod{Section: period.Section, Start: cursor, End: end})
		cursor = addMinutes(end, brk)
	}
	return out
}

// normalizePeriods 校验用户手工排的节次表：段合法、时间是 HH:MM、先后有序且不重叠。
func normalizePeriods(in []CoursePeriod) ([]CoursePeriod, error) {
	if len(in) == 0 {
		return nil, errors.New("至少要有一节课")
	}
	if len(in) > maxPeriodCount {
		return nil, errors.New("每天最多 16 节")
	}
	out := make([]CoursePeriod, 0, len(in))
	prevEnd := ""
	for _, p := range in {
		section := strings.TrimSpace(p.Section)
		if !periodSections[section] {
			return nil, errors.New("节次所属的段只能是早课/上午/下午/晚课")
		}
		start, end := strings.TrimSpace(p.Start), strings.TrimSpace(p.End)
		if !clockPattern.MatchString(start) || !clockPattern.MatchString(end) {
			return nil, errors.New("每节课的时间要写成 HH:MM")
		}
		if end <= start {
			return nil, errors.New("每节课的结束时间要晚于开始时间")
		}
		if prevEnd != "" && start < prevEnd {
			return nil, errors.New("节次时间要按先后顺序排，别叠在一起")
		}
		prevEnd = end
		out = append(out, CoursePeriod{Section: section, Start: start, End: end})
	}
	return out, nil
}

// normalizePacing 校验课时与课间，返回规整后的值。
func normalizePacing(lesson, brk int) (int, int, error) {
	if lesson < minLessonMinutes || lesson > maxLessonMinutes {
		return 0, 0, errors.New("一节课的分钟数要在 15–180 之间")
	}
	if brk < 0 || brk > maxBreakMinutes {
		return 0, 0, errors.New("课间分钟数要在 0–60 之间")
	}
	return lesson, brk, nil
}

// 表级「班级 / 地点」：可选，留空表示不设置（卡片就只显示条目自己的地点）。
func normalizeLocation(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if utf8.RuneCountInString(raw) > 40 {
		return "", errText("班级 / 地点最多 40 个字符")
	}
	return raw, nil
}

func normalizeTableName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", errText("表名不能为空")
	}
	if utf8.RuneCountInString(name) > maxTableNameRunes {
		return "", errText("表名最多 20 个字符")
	}
	return name, nil
}

type errText string

func (e errText) Error() string { return string(e) }
