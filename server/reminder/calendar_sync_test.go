package reminder

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"smallgo/server/database"
)

func TestCalendarFeedContainsSubscription(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	user := database.User{Username: "feed-user", Password: "x", Role: "user", Status: 1}
	if err := appDB.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	list, err := ensureDefaultList(appDB, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	listName := "工作日历"
	if err := appDB.Model(&List{}).Where("id = ?", list.ID).Update("name", listName).Error; err != nil {
		t.Fatal(err)
	}

	loc := shanghai()
	due := time.Date(2026, 10, 30, 9, 0, 0, 0, loc)
	if _, err := createReminder(appDB, user.ID, SaveReminderInput{
		Title: "客户会议, 重要", Notes: "第一行\n第二行", ListID: list.ID,
		DueAt: &due, RepeatRule: "monthly",
	}); err != nil {
		t.Fatal(err)
	}
	allDay := time.Date(2026, 10, 31, 0, 0, 0, 0, loc)
	if _, err := createReminder(appDB, user.ID, SaveReminderInput{
		Title: "全天团建", ListID: list.ID, DueAt: &allDay, AllDay: true,
	}); err != nil {
		t.Fatal(err)
	}
	lunarDue := time.Date(2026, 9, 25, 9, 0, 0, 0, loc)
	if _, err := createReminder(appDB, user.ID, SaveReminderInput{
		Title: "农历生日", ListID: list.ID, DueAt: &lunarDue,
		RepeatRule: "yearly", Calendar: "lunar",
	}); err != nil {
		t.Fatal(err)
	}
	doneDue := time.Date(2026, 10, 29, 9, 0, 0, 0, loc)
	done, err := createReminder(appDB, user.ID, SaveReminderInput{
		Title: "已完成的不要出现", ListID: list.ID, DueAt: &doneDue,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := completeReminder(appDB, user.ID, done.ID); err != nil {
		t.Fatal(err)
	}

	body, err := buildCalendarFeed(appDB, user)
	if err != nil {
		t.Fatal(err)
	}
	feed := string(body)
	for _, want := range []string{
		"BEGIN:VCALENDAR",
		"UID:workordernote-", "@local",
		"SUMMARY:客户会议\\, 重要",
		"DESCRIPTION:第一行\\n第二行",
		"RRULE:FREQ=MONTHLY",
		"DTSTART:20261030T010000Z",
		"DTSTART;VALUE=DATE:20261031",
		"X-WR-TIMEZONE:Asia/Shanghai",
	} {
		if !strings.Contains(feed, want) {
			t.Fatalf("订阅内容缺少 %q:\n%s", want, feed)
		}
	}
	if strings.Contains(feed, "已完成的不要出现") {
		t.Fatal("已完成的提醒不应出现在订阅里")
	}
	for _, block := range strings.Split(feed, "BEGIN:VEVENT")[1:] {
		if strings.Contains(block, "农历生日") && strings.Contains(block, "RRULE:") {
			t.Fatal("农历循环不能输出公历 RRULE")
		}
	}
	if !strings.HasSuffix(feed, "END:VCALENDAR\r\n") {
		t.Fatal("订阅必须以 CRLF 结束")
	}
}

func TestCalendarFeedTokenValidation(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	user := database.User{Username: "token-user", Password: "x", Role: "user", Status: 1}
	if err := appDB.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	token, err := ensureCalendarToken(appDB, &user)
	if err != nil {
		t.Fatal(err)
	}
	if len(token) < 40 || strings.ContainsAny(token, "+/=") {
		t.Fatalf("token 应为 URL-safe 随机串，实际 %q", token)
	}
	again, err := ensureCalendarToken(appDB, &user)
	if err != nil {
		t.Fatal(err)
	}
	if again != token {
		t.Fatalf("已有 token 不应被改写：%q != %q", again, token)
	}
}

func TestParseICalEvents(t *testing.T) {
	data := "\xef\xbb\xbfBEGIN:VCALENDAR\r\nVERSION:2.0\r\n" +
		"BEGIN:VEVENT\r\nUID:evt-1\r\nDTSTART;TZID=Asia/Shanghai:20261102T090000\r\n" +
		"DTEND;TZID=Asia/Shanghai:20261102T100000\r\nSUMMARY:项目\r\n 评审\r\n" +
		"DESCRIPTION:地点：会议室\\, 三楼\\n带上电脑\r\nRRULE:FREQ=WEEKLY;INTERVAL=1\r\nEND:VEVENT\r\n" +
		"BEGIN:VEVENT\r\nUID:evt-2\r\nDTSTART;VALUE=DATE:20261103\r\nSUMMARY:全天事项\r\nEND:VEVENT\r\n" +
		"BEGIN:VEVENT\r\nUID:evt-3\r\nDTSTART:20261104T010000Z\r\nSUMMARY:UTC 事项\r\n" +
		"RRULE:FREQ=MONTHLY;BYDAY=1MO\r\nEND:VEVENT\r\n" +
		"BEGIN:VEVENT\r\nUID:evt-4\r\nDTSTART:20261105T010000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:取消\r\nEND:VEVENT\r\n" +
		"END:VCALENDAR\r\n"

	events, err := parseICalEvents([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 {
		t.Fatalf("应解析出 3 条，实际 %d 条: %+v", len(events), events)
	}
	if events[0].Summary != "项目评审" {
		t.Fatalf("折行没有拼回去：%q", events[0].Summary)
	}
	if events[0].RepeatRule != "weekly" {
		t.Fatalf("周期规则应为 weekly，实际 %q", events[0].RepeatRule)
	}
	if !strings.Contains(events[0].Description, "会议室, 三楼") || !strings.Contains(events[0].Description, "\n") {
		t.Fatalf("转义文本恢复失败：%q", events[0].Description)
	}
	if !events[1].AllDay {
		t.Fatal("VALUE=DATE 应识别为全天")
	}
	wantUTC := time.Date(2026, 11, 4, 9, 0, 0, 0, shanghai())
	if !events[2].Start.Equal(wantUTC) {
		t.Fatalf("UTC 时间应换算到本地时刻：%v != %v", events[2].Start, wantUTC)
	}
	if events[2].RepeatRule != "none" {
		t.Fatalf("带 BYDAY 的复杂规则应按单次处理，实际 %q", events[2].RepeatRule)
	}
}

func TestParseICalRejectsGarbage(t *testing.T) {
	if _, err := parseICalEvents([]byte("not a calendar")); err == nil {
		t.Fatal("非 ICS 内容应报错")
	}
}

func TestICalSyncUIDStable(t *testing.T) {
	a := icalEvent{UID: "abc", Summary: "标题", Start: time.Unix(100, 0).UTC(), End: time.Unix(200, 0).UTC()}
	b := a
	if icalSyncUID(a) != icalSyncUID(b) {
		t.Fatal("同一事件两次计算应得到相同 sync_uid")
	}
	c := a
	c.UID = "def"
	if icalSyncUID(a) == icalSyncUID(c) {
		t.Fatal("不同 UID 不应得到相同 sync_uid")
	}
}

func TestImportCalendarHandlerCreatesAndSkips(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	user := database.User{Username: "import-user", Password: "x", Role: "user", Status: 1}
	if err := appDB.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	list, err := ensureDefaultList(appDB, user.ID)
	if err != nil {
		t.Fatal(err)
	}

	ics := strings.Join([]string{
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"BEGIN:VEVENT",
		"UID:handler-evt-1",
		"DTSTART;TZID=Asia/Shanghai:20261202T090000",
		"DTEND;TZID=Asia/Shanghai:20261202T100000",
		"SUMMARY:接口导入会议",
		"END:VEVENT",
		"END:VCALENDAR",
		"",
	}, "\r\n")

	call := func(body []byte, listID uint) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		part, err := mw.CreateFormFile("file", "test.ics")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(body); err != nil {
			t.Fatal(err)
		}
		if listID > 0 {
			if err := mw.WriteField("list_id", fmt.Sprint(listID)); err != nil {
				t.Fatal(err)
			}
		}
		if err := mw.Close(); err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/import", &buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		w := httptest.NewRecorder()
		gin.SetMode(gin.TestMode)
		c, _ := gin.CreateTestContext(w)
		c.Request = req
		c.Set("userID", user.ID)
		handleImportCalendar(appDB)(c)
		return w
	}

	first := call([]byte(ics), list.ID)
	if first.Code != http.StatusOK || !strings.Contains(first.Body.String(), `"created":1`) {
		t.Fatalf("首次导入失败：%d %s", first.Code, first.Body.String())
	}
	var imported Reminder
	if err := appDB.Where("user_id = ? AND title = ?", user.ID, "接口导入会议").First(&imported).Error; err != nil {
		t.Fatal(err)
	}
	if imported.SyncUID == "" || imported.DueAt == nil || imported.DueAt.Hour() != 9 {
		t.Fatalf("导入结果不正确：%+v", imported)
	}

	second := call([]byte(ics), list.ID)
	if second.Code != http.StatusOK || !strings.Contains(second.Body.String(), `"skipped":1`) {
		t.Fatalf("重复导入应跳过：%d %s", second.Code, second.Body.String())
	}

	cardList := List{UserID: user.ID, Name: "信用卡", Template: listTemplateCard, Color: "slate"}
	if err := appDB.Create(&cardList).Error; err != nil {
		t.Fatal(err)
	}
	rejected := call([]byte(ics), cardList.ID)
	if rejected.Code != http.StatusBadRequest {
		t.Fatalf("信用卡清单应拒绝导入：%d %s", rejected.Code, rejected.Body.String())
	}

	var many strings.Builder
	many.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")
	for i := 0; i < maxICalEvents+1; i++ {
		fmt.Fprintf(&many, "BEGIN:VEVENT\r\nUID:bulk-%d\r\nDTSTART:20261205T010000Z\r\nSUMMARY:批量 %d\r\nEND:VEVENT\r\n", i, i)
	}
	many.WriteString("END:VCALENDAR\r\n")
	tooMany := call([]byte(many.String()), list.ID)
	if tooMany.Code != http.StatusBadRequest {
		t.Fatalf("超过 500 条应拒绝：%d %s", tooMany.Code, tooMany.Body.String())
	}
	var count int64
	if err := appDB.Model(&Reminder{}).Where("user_id = ? AND title LIKE ?", user.ID, "批量 %").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("超限文件不应导入任何条目，实际 %d", count)
	}
}
