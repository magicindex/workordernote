package timetable

import (
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
		table := Timetable{UserID: userID, Name: name, Position: maxPos.P + 1}
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
			Name     *string `json:"name"`
			Position *int    `json:"position"`
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
	return table, true
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
