package reminder

import (
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"smallgo/server/database"
	"smallgo/server/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 手机日历同步（用户 2026-10-29）：应用里没有原生日历权限，手机也读不到应用库，
// 所以走最成熟、无需装客户端的一条路——**带令牌的只读 ICS 订阅**。
//
// 手机日历订阅这个地址后，系统会按自己的节奏来拉；用户在应用里改任务，
// 下一次拉取就能看到（iOS 通常十几分钟，Android/Google 可能几小时，由系统决定）。
// 反向（手机日历 → 应用）用 ICS 文件导入，见 calendar_import.go。
//
// 令牌放在 URL 里：手机日历客户端不会带 Authorization 头。
// 它只能读当前用户的日历，泄露后可在偏好设置里一键重置（rotate）。

const calendarFeedPathPrefix = "/api/calendar/feed/"

func newCalendarToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// ensureCalendarToken 返回用户当前的订阅令牌，没有就生成一个。
func ensureCalendarToken(db *gorm.DB, user *database.User) (string, error) {
	if strings.TrimSpace(user.CalendarToken) != "" {
		return user.CalendarToken, nil
	}
	token, err := newCalendarToken()
	if err != nil {
		return "", err
	}
	if err := db.Model(&database.User{}).Where("id = ?", user.ID).
		Update("calendar_token", token).Error; err != nil {
		return "", err
	}
	user.CalendarToken = token
	return token, nil
}

func calendarSubscriptionPayload(c *gin.Context, token string) gin.H {
	path := calendarFeedPathPrefix + token + ".ics"
	base := requestBaseURL(c)
	return gin.H{
		"token": token,
		"path":  path,
		"url":   base + path,
	}
}

// requestBaseURL 尽量还原用户浏览器看到的协议与域名（反代通常只带 X-Forwarded-*）。
func requestBaseURL(c *gin.Context) string {
	scheme := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto"))
	if scheme == "" {
		if c.Request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	scheme = strings.ToLower(strings.TrimSpace(strings.Split(scheme, ",")[0]))
	if scheme != "https" && scheme != "http" {
		scheme = "http"
	}
	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = c.Request.Host
	}
	if i := strings.Index(host, ","); i >= 0 {
		host = strings.TrimSpace(host[:i])
	}
	return scheme + "://" + host
}

func handleGetCalendarSubscription(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var user database.User
		if err := db.First(&user, currentUserID(c)).Error; err != nil {
			response.ErrorInternal(c, "读取账号失败")
			return
		}
		token, err := ensureCalendarToken(db, &user)
		if err != nil {
			response.ErrorInternal(c, "生成日历订阅地址失败")
			return
		}
		response.Success(c, calendarSubscriptionPayload(c, token))
	}
}

func handleRotateCalendarSubscription(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := newCalendarToken()
		if err != nil {
			response.ErrorInternal(c, "生成日历订阅地址失败")
			return
		}
		var user database.User
		if err := db.First(&user, currentUserID(c)).Error; err != nil {
			response.ErrorInternal(c, "读取账号失败")
			return
		}
		if err := db.Model(&database.User{}).Where("id = ?", user.ID).
			Update("calendar_token", token).Error; err != nil {
			response.ErrorInternal(c, "保存日历订阅地址失败")
			return
		}
		response.Success(c, calendarSubscriptionPayload(c, token))
	}
}

// handleCalendarFeed 是公开的只读订阅端点：没有会话，只靠 URL 里的随机令牌认人。
func handleCalendarFeed(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := strings.TrimSuffix(c.Param("token"), ".ics")
		if len(token) < 20 {
			c.Status(http.StatusNotFound)
			return
		}
		var user database.User
		if err := db.Where("calendar_token = ? AND status = 1", token).First(&user).Error; err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		body, err := buildCalendarFeed(db, user)
		if err != nil {
			response.ErrorInternal(c, "生成日历时失败")
			return
		}
		sum := sha1.Sum(body)
		etag := `"` + hex.EncodeToString(sum[:]) + `"`
		c.Header("Content-Type", "text/calendar; charset=utf-8")
		c.Header("Content-Disposition", `inline; filename="workordernote.ics"`)
		c.Header("Cache-Control", "private, max-age=300")
		c.Header("ETag", etag)
		c.Header("X-Robots-Tag", "noindex, nofollow")
		if c.GetHeader("If-None-Match") == etag {
			c.Status(http.StatusNotModified)
			return
		}
		c.String(http.StatusOK, string(body))
	}
}

// buildCalendarFeed 把用户未完成的定时任务拼成一份 iCalendar。
// 已完成的靠 completed_at 过滤掉；记事没有到期时间，本来就不在日历里。
func buildCalendarFeed(db *gorm.DB, user database.User) ([]byte, error) {
	var items []Reminder
	if err := db.Where(
		"user_id = ? AND deleted_at IS NULL AND completed_at IS NULL AND kind = ? AND due_at IS NOT NULL",
		user.ID, KindTask,
	).Order("due_at asc").Find(&items).Error; err != nil {
		return nil, err
	}
	listNames := map[uint]string{}
	if len(items) > 0 {
		ids := make([]uint, 0, len(items))
		seen := map[uint]bool{}
		for _, item := range items {
			if !seen[item.ListID] {
				seen[item.ListID] = true
				ids = append(ids, item.ListID)
			}
		}
		var lists []List
		if err := db.Where("id IN ?", ids).Find(&lists).Error; err != nil {
			return nil, err
		}
		for _, list := range lists {
			listNames[list.ID] = list.Name
		}
	}

	loc := shanghai()
	now := time.Now().UTC()
	var b strings.Builder
	writeLine := func(format string, args ...any) {
		b.WriteString(foldICalLine(fmt.Sprintf(format, args...)))
		b.WriteString("\r\n")
	}
	writeLine("BEGIN:VCALENDAR")
	writeLine("VERSION:2.0")
	writeLine("PRODID:-//WorkOrderNote//Calendar//CN")
	writeLine("CALSCALE:GREGORIAN")
	writeLine("METHOD:PUBLISH")
	writeLine("X-WR-CALNAME:%s", icalEscape("工作序记 - "+user.Username))
	writeLine("X-WR-TIMEZONE:Asia/Shanghai")
	writeLine("REFRESH-INTERVAL;VALUE=DURATION:PT15M")
	writeLine("X-PUBLISHED-TTL:PT15M")

	for i := range items {
		item := items[i]
		if item.DueAt == nil {
			continue
		}
		start := item.DueAt.In(loc)
		if item.StartAt != nil {
			start = item.StartAt.In(loc)
		}
		end := start.Add(30 * time.Minute)
		allDay := item.AllDay
		if allDay {
			start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, loc)
		}
		if item.EndAt != nil && item.EndAt.After(start) {
			end = item.EndAt.In(loc)
			if allDay {
				end = time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, loc)
				if !end.After(start) {
					end = start.AddDate(0, 0, 1)
				}
			}
		} else if allDay {
			end = start.AddDate(0, 0, 1)
		}

		writeLine("BEGIN:VEVENT")
		writeLine("UID:workordernote-%d@local", item.ID)
		writeLine("DTSTAMP:%s", now.Format("20060102T150405Z"))
		writeLine("LAST-MODIFIED:%s", item.UpdatedAt.UTC().Format("20060102T150405Z"))
		if allDay {
			writeLine("DTSTART;VALUE=DATE:%s", start.Format("20060102"))
			writeLine("DTEND;VALUE=DATE:%s", end.Format("20060102"))
		} else {
			writeLine("DTSTART:%s", start.UTC().Format("20060102T150405Z"))
			writeLine("DTEND:%s", end.UTC().Format("20060102T150405Z"))
		}
		writeLine("SUMMARY:%s", icalEscape(item.Title))
		desc := strings.TrimSpace(item.Notes)
		if name := listNames[item.ListID]; name != "" {
			if desc != "" {
				desc += "\n"
			}
			desc += "清单：" + name
		}
		if desc != "" {
			writeLine("DESCRIPTION:%s", icalEscape(desc))
		}
		if name := listNames[item.ListID]; name != "" {
			writeLine("CATEGORIES:%s", icalEscape(name))
		}
		if rule := icalRRule(item); rule != "" {
			writeLine("RRULE:%s", rule)
		}
		writeLine("STATUS:CONFIRMED")
		writeLine("TRANSP:TRANSPARENT")
		writeLine("END:VEVENT")
	}
	writeLine("END:VCALENDAR")
	return []byte(b.String()), nil
}

// icalRRule 只映射公历的简单循环。农历每月/每年在公历里没有固定规则，
// 导出成单次日程（用户可以在手机日历里继续看到这一次），不做错误的 RRULE。
func icalRRule(item Reminder) string {
	if item.Calendar == "lunar" {
		return ""
	}
	switch item.RepeatRule {
	case "daily":
		return "FREQ=DAILY"
	case "weekly":
		return "FREQ=WEEKLY"
	case "monthly":
		return "FREQ=MONTHLY"
	case "yearly":
		return "FREQ=YEARLY"
	default:
		return ""
	}
}

func icalEscape(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case ';':
			b.WriteString(`\;`)
		case ',':
			b.WriteString(`\,`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			// 归一成 \n，避免 \r\n 变成两个空行
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// foldICalLine 按 RFC 5545 把长行折到 75 字节以内（含 CRLF），续行以一个空格开头。
// 中文一个字 3 字节，不能从 UTF-8 字节中间切断。
func foldICalLine(line string) string {
	const max = 73
	if len(line) <= max {
		return line
	}
	var b strings.Builder
	for len(line) > max {
		cut := max
		for cut > 0 && (line[cut]&0xC0) == 0x80 {
			cut--
		}
		if cut == 0 {
			cut = max
		}
		b.WriteString(line[:cut])
		b.WriteString("\r\n ")
		line = line[cut:]
	}
	b.WriteString(line)
	return b.String()
}
