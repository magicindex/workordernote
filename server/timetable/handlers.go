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

// listTables 只回当前账号自己的表，顺带给出每张表的条目数（标签上要显示）。
func handleListTables(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		var tables []Timetable
		if err := db.Where("user_id = ?", userID).
			Order("position asc, id asc").Find(&tables).Error; err != nil {
			response.ErrorInternal(c, "读取课程表失败")
			return
		}
		counts := make(map[uint]int64, len(tables))
		if len(tables) > 0 {
			ids := make([]uint, 0, len(tables))
			for _, t := range tables {
				ids = append(ids, t.ID)
			}
			var rows []struct {
				TimetableID uint
				N           int64
			}
			if err := db.Model(&TimetableEntry{}).
				Select("timetable_id, count(*) as n").
				Where("user_id = ? AND timetable_id IN ?", userID, ids).
				Group("timetable_id").Scan(&rows).Error; err != nil {
				response.ErrorInternal(c, "读取课程表失败")
				return
			}
			for _, r := range rows {
				counts[r.TimetableID] = r.N
			}
		}
		out := make([]gin.H, 0, len(tables))
		for _, t := range tables {
			out = append(out, gin.H{
				"id": t.ID, "name": t.Name, "position": t.Position,
				"entry_count": counts[t.ID],
			})
		}
		response.Success(c, gin.H{"tables": out})
	}
}

func handleCreateTable(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		var req struct {
			Name string `json:"name"`
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
			UserID: userID, Name: name, Position: maxPos.P + 1,
			LessonMinutes: defaultLessonMinutes, BreakMinutes: defaultBreakMinutes,
			PeriodCount: defaultPeriodCount, FirstPeriod: defaultFirstPeriod,
			EarlyBreakMinutes: defaultEarlyBreak, NoonBreakMinutes: defaultNoonBreak, EveningBreakMinutes: defaultEveningBreak,
		}
		table.Periods = defaultPeriods(defaultFirstPeriod, defaultLessonMinutes, defaultBreakMinutes,
			defaultEarlyBreak, defaultNoonBreak, defaultEveningBreak, defaultPeriodCount)
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
func handleGetTable(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		table, ok := ownedTable(db, userID, c.Param("id"))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "课程表不存在")
			return
		}
		var entries []TimetableEntry
		if err := db.Where("user_id = ? AND timetable_id = ?", userID, table.ID).
			Order("weekday asc, start_time asc, id asc").Find(&entries).Error; err != nil {
			response.ErrorInternal(c, "读取课程表失败")
			return
		}
		response.Success(c, gin.H{"table": table, "entries": entries})
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
			Position      *int            `json:"position"`
			LessonMinutes *int            `json:"lesson_minutes"`
			BreakMinutes  *int            `json:"break_minutes"`
			PeriodCount   *int            `json:"period_count"`
			FirstPeriod   *string         `json:"first_period"`
			EarlyBreak    *int            `json:"early_break_minutes"`
			NoonBreak     *int            `json:"noon_break_minutes"`
			EveningBreak  *int            `json:"evening_break_minutes"`
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
		} else if req.LessonMinutes != nil || req.BreakMinutes != nil || req.FirstPeriod != nil ||
			req.EarlyBreak != nil || req.NoonBreak != nil || req.EveningBreak != nil {
			lesson, brk, first := table.LessonMinutes, table.BreakMinutes, table.FirstPeriod
			if req.LessonMinutes != nil {
				lesson = *req.LessonMinutes
			}
			if req.BreakMinutes != nil {
				brk = *req.BreakMinutes
			}
			if req.FirstPeriod != nil {
				first = strings.TrimSpace(*req.FirstPeriod)
			}
			lesson, brk, first, err := normalizePacing(lesson, brk, first)
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			earlyBreak, noonBreak, eveningBreak := table.EarlyBreakMinutes, table.NoonBreakMinutes, table.EveningBreakMinutes
			if req.EarlyBreak != nil {
				earlyBreak = *req.EarlyBreak
			}
			if req.NoonBreak != nil {
				noonBreak = *req.NoonBreak
			}
			if req.EveningBreak != nil {
				eveningBreak = *req.EveningBreak
			}
			if err := validateBreaks(earlyBreak, noonBreak, eveningBreak); err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			periods := regeneratePeriods(first, lesson, brk, earlyBreak, noonBreak, eveningBreak, table.Periods)
			updates["lesson_minutes"], updates["break_minutes"] = lesson, brk
			updates["first_period"] = first
			updates["early_break_minutes"] = earlyBreak
			updates["noon_break_minutes"] = noonBreak
			updates["evening_break_minutes"] = eveningBreak
			updates["periods"] = marshalPeriods(periods)
			updates["period_count"] = len(periods)
			table.LessonMinutes, table.BreakMinutes, table.FirstPeriod = lesson, brk, first
			table.EarlyBreakMinutes, table.NoonBreakMinutes, table.EveningBreakMinutes = earlyBreak, noonBreak, eveningBreak
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
			if err := tx.Where("timetable_id = ? AND user_id = ?", table.ID, userID).
				Delete(&TimetableEntry{}).Error; err != nil {
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
		table, ok := ownedTable(db, userID, c.Param("id"))
		if !ok {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "课程表不存在")
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
		var n int64
		db.Model(&TimetableEntry{}).Where("timetable_id = ?", table.ID).Count(&n)
		if n >= maxEntriesPerTable {
			response.ErrorBadRequest(c, "一张表最多 200 条")
			return
		}
		entry.UserID = userID
		entry.TimetableID = table.ID
		if err := db.Create(&entry).Error; err != nil {
			response.ErrorInternal(c, "保存失败")
			return
		}
		response.Success(c, entry)
	}
}

// handleUpdateEntry 允许只改其中几项：先把旧值读出来合并，再按同一套规则校验，
// 避免前端漏传一个字段就把它清空。
func handleUpdateEntry(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		var entry TimetableEntry
		if err := db.Where("id = ? AND user_id = ?", c.Param("id"), userID).
			First(&entry).Error; err != nil {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "这条课程不存在")
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
		next.UserID = userID
		next.TimetableID = entry.TimetableID
		next.CreatedAt = entry.CreatedAt
		if err := db.Save(&next).Error; err != nil {
			response.ErrorInternal(c, "保存失败")
			return
		}
		response.Success(c, next)
	}
}

func handleDeleteEntry(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetUint("userID")
		res := db.Where("id = ? AND user_id = ?", c.Param("id"), userID).
			Delete(&TimetableEntry{})
		if res.Error != nil {
			response.ErrorInternal(c, "删除失败")
			return
		}
		if res.RowsAffected == 0 {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "这条课程不存在")
			return
		}
		response.Success(c, gin.H{"deleted": true})
	}
}

func ownedTable(db *gorm.DB, userID uint, rawID string) (Timetable, bool) {
	var table Timetable
	if err := db.Where("id = ? AND user_id = ?", rawID, userID).First(&table).Error; err != nil {
		return Timetable{}, false
	}
	// periods 是 JSON 文本列：老表没写过就按课时/课间/起点补一份骨架。
	table.Periods = parsePeriods(table.PeriodsJSON)
	if len(table.Periods) == 0 {
		table.Periods = defaultPeriods(table.FirstPeriod, table.LessonMinutes, table.BreakMinutes,
			table.EarlyBreakMinutes, table.NoonBreakMinutes, table.EveningBreakMinutes, table.PeriodCount)
	}
	return table, true
}

const (
	defaultLessonMinutes = 45
	defaultBreakMinutes  = 10
	defaultPeriodCount   = 8
	defaultFirstPeriod   = "08:00"
	defaultEarlyBreak    = 20
	defaultNoonBreak     = 60
	defaultEveningBreak  = 60
)

var periodSections = map[string]bool{"early": true, "morning": true, "afternoon": true, "evening": true}

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

// sectionOf 只在「没有现成节次表」时用来给默认骨架分段落。
func sectionOf(at string) string {
	switch {
	case at < "09:00":
		return "early"
	case at < "12:00":
		return "morning"
	case at < "18:00":
		return "afternoon"
	default:
		return "evening"
	}
}

// gapAfter 返回某一段结束后的长休：早课→早休、上午→午休、下午→晚修。
func gapAfter(section string, earlyBreak, noonBreak, eveningBreak int) int {
	switch section {
	case "early":
		return earlyBreak
	case "morning":
		return noonBreak
	case "afternoon":
		return eveningBreak
	}
	return 0
}

// defaultPeriods 建表时铺一份骨架：默认早 2 / 上午 3 / 下午 2 / 晚 1，
// 段内 45+10，跨段加早休/午休/晚修；节数更多时补在晚课。
func defaultPeriods(first string, lesson, brk, earlyBreak, noonBreak, eveningBreak, count int) []CoursePeriod {
	if count < 1 {
		count = 1
	}
	if count > maxPeriodCount {
		count = maxPeriodCount
	}
	plan := []struct {
		section string
		n       int
	}{{"early", 2}, {"morning", 3}, {"afternoon", 2}, {"evening", 1}}
	out := make([]CoursePeriod, 0, count)
	cursor := first
	prevSection := ""
	used := map[string]int{}
	planAt := 0
	for i := 0; i < count; i += 1 {
		for planAt < len(plan) && used[plan[planAt].section] >= plan[planAt].n {
			planAt += 1
		}
		section := plan[len(plan)-1].section
		if planAt < len(plan) {
			section = plan[planAt].section
		}
		if i > 0 && section != prevSection {
			cursor = addMinutes(cursor, gapAfter(prevSection, earlyBreak, noonBreak, eveningBreak))
		}
		end := addMinutes(cursor, lesson)
		out = append(out, CoursePeriod{Section: section, Start: cursor, End: end})
		cursor = addMinutes(end, brk)
		prevSection = section
		used[section] += 1
	}
	return out
}

// regeneratePeriods 按「段内课时+课间、跨段长休」重排：
// 第一段从 first 起步（不是早课就用它自己原来的起点），之后每段接上一段 + 长休。
func regeneratePeriods(first string, lesson, brk, earlyBreak, noonBreak, eveningBreak int, current []CoursePeriod) []CoursePeriod {
	if len(current) == 0 {
		return defaultPeriods(first, lesson, brk, earlyBreak, noonBreak, eveningBreak, defaultPeriodCount)
	}
	out := make([]CoursePeriod, 0, len(current))
	cursor := first
	prevSection := ""
	for i, period := range current {
		if i == 0 {
			if period.Section != "early" {
				cursor = period.Start
			}
		} else if period.Section != prevSection {
			cursor = addMinutes(cursor, gapAfter(prevSection, earlyBreak, noonBreak, eveningBreak))
		}
		end := addMinutes(cursor, lesson)
		out = append(out, CoursePeriod{Section: period.Section, Start: cursor, End: end})
		cursor = addMinutes(end, brk)
		prevSection = period.Section
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

// marshalPeriods / parsePeriods 负责节次表和 JSON 文本列互转。
func marshalPeriods(periods []CoursePeriod) string {
	raw, err := json.Marshal(periods)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

func parsePeriods(raw string) []CoursePeriod {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var periods []CoursePeriod
	if err := json.Unmarshal([]byte(raw), &periods); err != nil {
		return nil
	}
	return periods
}

// validateBreaks 三段长休都按分钟存，0 表示不休息。
func validateBreaks(earlyBreak, noonBreak, eveningBreak int) error {
	for name, value := range map[string]int{"早休": earlyBreak, "午休": noonBreak, "晚修": eveningBreak} {
		if value < 0 || value > maxBreakMinutes {
			return errors.New(name + "分钟数要在 0–60 之间")
		}
	}
	return nil
}

// normalizePacing 校验课时、课间与第一节起点，返回规整后的值。
func normalizePacing(lesson, brk int, first string) (int, int, string, error) {
	if lesson < minLessonMinutes || lesson > maxLessonMinutes {
		return 0, 0, "", errors.New("一节课的分钟数要在 15–180 之间")
	}
	if brk < 0 || brk > maxBreakMinutes {
		return 0, 0, "", errors.New("课间分钟数要在 0–60 之间")
	}
	first = strings.TrimSpace(first)
	if !clockPattern.MatchString(first) {
		return 0, 0, "", errors.New("第一节课开始时间要写成 HH:MM")
	}
	return lesson, brk, first, nil
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
