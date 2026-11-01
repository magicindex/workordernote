package reminder

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"smallgo/server/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 手机日历 → 应用：导入 .ics 文件。
//
// 浏览器的 PWA 没有办法读手机本地日历（没有原生权限），所以这里不做「实时双向」；
// 用户从手机/电脑日历导出 .ics 后上传，事件会变成普通提醒。重复导入同一个文件时，
// 用事件 UID 的 SHA-1 当 SyncUID 去重，不会越导越多。

const (
	maxICalImportBytes = 2 << 20
	maxICalEvents      = 500
)

type icalEvent struct {
	UID         string
	Summary     string
	Description string
	Start       time.Time
	End         time.Time
	AllDay      bool
	RepeatRule  string
}

type icalProperty struct {
	Name   string
	Params map[string]string
	Value  string
}

func handleImportCalendar(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxICalImportBytes+64<<10)
		file, err := c.FormFile("file")
		if err != nil {
			response.ErrorBadRequest(c, "请选择 .ics 日历文件")
			return
		}
		if file.Size > maxICalImportBytes {
			response.ErrorBadRequest(c, "日历文件不能超过 2MB")
			return
		}
		f, err := file.Open()
		if err != nil {
			response.ErrorBadRequest(c, "读取日历文件失败")
			return
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, maxICalImportBytes+1))
		if err != nil || len(data) > maxICalImportBytes {
			response.ErrorBadRequest(c, "读取日历文件失败")
			return
		}

		userID := currentUserID(c)
		listID, _ := strconv.ParseUint(strings.TrimSpace(c.PostForm("list_id")), 10, 64)
		if listID > 0 {
			var list List
			if err := db.Where("user_id = ? AND id = ? AND deleted_at IS NULL", userID, uint(listID)).First(&list).Error; err != nil {
				response.ErrorBadRequest(c, "目标清单不存在")
				return
			}
			if list.Template == listTemplateCard {
				response.ErrorBadRequest(c, "不能导入到信用卡账单清单")
				return
			}
		}

		events, err := parseICalEvents(data)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		if len(events) == 0 {
			response.ErrorBadRequest(c, "没有找到可导入的日程")
			return
		}
		if len(events) > maxICalEvents {
			response.ErrorBadRequest(c, "一次最多导入 500 条日程")
			return
		}

		created, skipped := 0, 0
		for _, ev := range events {
			syncUID := icalSyncUID(ev)
			var existing int64
			if err := db.Model(&Reminder{}).
				Where("user_id = ? AND sync_uid = ? AND deleted_at IS NULL", userID, syncUID).
				Count(&existing).Error; err != nil {
				response.ErrorInternal(c, "检查重复日程失败")
				return
			}
			if existing > 0 {
				skipped++
				continue
			}
			in := SaveReminderInput{
				Title:      ev.Summary,
				Notes:      ev.Description,
				Kind:       KindTask,
				ListID:     uint(listID),
				DueAt:      &ev.Start,
				AllDay:     ev.AllDay,
				RepeatRule: ev.RepeatRule,
				Calendar:   "solar",
			}
			if !ev.AllDay && ev.End.After(ev.Start) {
				start := ev.Start
				end := ev.End
				in.StartAt = &start
				in.EndAt = &end
			}
			item, err := createReminder(db, userID, in)
			if err != nil {
				response.ErrorBadRequest(c, "导入「"+ev.Summary+"」失败："+err.Error())
				return
			}
			// 用来源 UID 的哈希当同步键：同一个文件再导入时就能认出是同一件事。
			if err := db.Model(&Reminder{}).Where("id = ?", item.ID).
				Update("sync_uid", syncUID).Error; err != nil {
				response.ErrorInternal(c, "保存导入日程失败")
				return
			}
			publishDataChanged(userID, "reminder", "created", item.ID, originClientID(c))
			created++
		}
		response.Success(c, gin.H{"created": created, "skipped": skipped, "total": len(events)})
	}
}

func icalSyncUID(ev icalEvent) string {
	key := strings.TrimSpace(ev.UID)
	if key == "" {
		key = ev.Summary + "|" + ev.Start.Format(time.RFC3339) + "|" + ev.End.Format(time.RFC3339)
	}
	sum := sha1.Sum([]byte(key))
	return hex.EncodeToString(sum[:])
}

// parseICalEvents 是一个够用的 iCalendar 读取器：只关心 VEVENT 的时间、标题、备注、
// 简单重复规则与 UID。它支持 CRLF/LF、折行、常见 TZID、UTC 与全天日期。
func parseICalEvents(data []byte) ([]icalEvent, error) {
	text := strings.TrimPrefix(string(data), "\ufeff")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	rawLines := strings.Split(text, "\n")
	lines := make([]string, 0, len(rawLines))
	for _, line := range rawLines {
		// RFC 5545 折行：续行以空格或 tab 开头，接回上一行。
		if len(line) > 0 && (line[0] == ' ' || line[0] == '\t') && len(lines) > 0 {
			lines[len(lines)-1] += line[1:]
			continue
		}
		lines = append(lines, line)
	}

	var events []icalEvent
	var current map[string]icalProperty
	sawCalendar := false
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		prop, ok := parseICalProperty(line)
		if !ok {
			continue
		}
		switch prop.Name {
		case "BEGIN":
			if strings.EqualFold(prop.Value, "VCALENDAR") {
				sawCalendar = true
			}
			if strings.EqualFold(prop.Value, "VEVENT") {
				current = map[string]icalProperty{}
			}
		case "END":
			if strings.EqualFold(prop.Value, "VEVENT") && current != nil {
				if ev, ok := icalEventFromProps(current); ok {
					events = append(events, ev)
				}
				current = nil
			}
		default:
			if current != nil {
				// DTSTART/DTEND 等只取第一次出现的值，避免奇怪的重复属性覆盖。
				if _, exists := current[prop.Name]; !exists {
					current[prop.Name] = prop
				}
			}
		}
	}
	if !sawCalendar {
		return nil, errors.New("这不是有效的 .ics 日历文件")
	}
	return events, nil
}

func icalEventFromProps(props map[string]icalProperty) (icalEvent, bool) {
	startProp, ok := props["DTSTART"]
	if !ok {
		return icalEvent{}, false
	}
	start, allDay, ok := parseICalTime(startProp)
	if !ok {
		return icalEvent{}, false
	}
	if strings.EqualFold(strings.TrimSpace(props["STATUS"].Value), "CANCELLED") {
		return icalEvent{}, false
	}
	sum := strings.TrimSpace(unescapeICalText(props["SUMMARY"].Value))
	if sum == "" {
		sum = "未命名日程"
	}
	ev := icalEvent{
		UID:         strings.TrimSpace(props["UID"].Value),
		Summary:     sum,
		Description: strings.TrimSpace(unescapeICalText(props["DESCRIPTION"].Value)),
		Start:       start,
		AllDay:      allDay,
		RepeatRule:  simpleICalRepeatRule(props["RRULE"].Value),
	}
	if endProp, ok := props["DTEND"]; ok {
		if end, _, ok := parseICalTime(endProp); ok && end.After(start) {
			ev.End = end
		}
	}
	return ev, true
}

func parseICalProperty(line string) (icalProperty, bool) {
	inQuote := false
	colon := -1
	for i := 0; i < len(line); i++ {
		switch line[i] {
		case '"':
			inQuote = !inQuote
		case ':':
			if !inQuote {
				colon = i
			}
		}
		if colon >= 0 {
			break
		}
	}
	if colon < 0 {
		return icalProperty{}, false
	}
	left, value := line[:colon], line[colon+1:]
	parts := strings.Split(left, ";")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return icalProperty{}, false
	}
	prop := icalProperty{
		Name:   strings.ToUpper(strings.TrimSpace(parts[0])),
		Params: map[string]string{},
		Value:  value,
	}
	for _, part := range parts[1:] {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		prop.Params[strings.ToUpper(strings.TrimSpace(kv[0]))] = strings.Trim(strings.TrimSpace(kv[1]), `"`)
	}
	return prop, true
}

func parseICalTime(prop icalProperty) (time.Time, bool, bool) {
	value := strings.TrimSpace(prop.Value)
	if value == "" {
		return time.Time{}, false, false
	}
	loc := shanghai()
	if tz := strings.TrimSpace(prop.Params["TZID"]); tz != "" {
		if loaded, err := time.LoadLocation(tz); err == nil {
			loc = loaded
		}
	}
	allDay := strings.EqualFold(prop.Params["VALUE"], "DATE") || (len(value) == 8 && !strings.Contains(value, "T"))
	if allDay {
		if len(value) < 8 {
			return time.Time{}, false, false
		}
		t, err := time.ParseInLocation("20060102", value[:8], loc)
		return t, true, err == nil
	}
	if strings.HasSuffix(value, "Z") {
		for _, layout := range []string{"20060102T150405Z", "20060102T1504Z"} {
			if t, err := time.ParseInLocation(layout, value, time.UTC); err == nil {
				return t.In(loc), false, true
			}
		}
		return time.Time{}, false, false
	}
	for _, layout := range []string{"20060102T150405", "20060102T1504"} {
		if t, err := time.ParseInLocation(layout, value, loc); err == nil {
			return t, false, true
		}
	}
	if t, err := time.ParseInLocation("20060102", value, loc); err == nil {
		return t, true, true
	}
	return time.Time{}, false, false
}

// simpleICalRepeatRule 只接受 FREQ + 可选的 INTERVAL=1。
// BYDAY/BYMONTHDAY/COUNT/UNTIL 这些复杂规则不猜，宁可按单次日程导入，
// 也不要给用户造出一条错误的循环。
func simpleICalRepeatRule(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value == "" || strings.Contains(value, "BY") || strings.Contains(value, "COUNT") || strings.Contains(value, "UNTIL") {
		return "none"
	}
	for _, part := range strings.Split(value, ";") {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		if kv[0] == "INTERVAL" && strings.TrimSpace(kv[1]) != "1" {
			return "none"
		}
	}
	switch {
	case strings.Contains(value, "FREQ=DAILY"):
		return "daily"
	case strings.Contains(value, "FREQ=WEEKLY"):
		return "weekly"
	case strings.Contains(value, "FREQ=MONTHLY"):
		return "monthly"
	case strings.Contains(value, "FREQ=YEARLY"):
		return "yearly"
	}
	return "none"
}

func unescapeICalText(value string) string {
	var b strings.Builder
	for i := 0; i < len(value); i++ {
		if value[i] != '\\' || i+1 >= len(value) {
			b.WriteByte(value[i])
			continue
		}
		i++
		switch value[i] {
		case 'n', 'N':
			b.WriteByte('\n')
		case 't', 'T':
			b.WriteByte('\t')
		default:
			b.WriteByte(value[i])
		}
	}
	return b.String()
}
