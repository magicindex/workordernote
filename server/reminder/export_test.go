package reminder

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestRepeatRuleLabel(t *testing.T) {
	cases := []struct {
		rule     string
		calendar string
		want     string
	}{
		{"none", "solar", "不重复"},
		{"daily", "solar", "每天"},
		{"weekly", "solar", "每周"},
		{"monthly", "solar", "每月"},
		{"yearly", "solar", "每年"},
		// 农历只在每月/每年重复上有意义，别的组合不该带上后缀。
		{"yearly", "lunar", "每年（农历）"},
		{"monthly", "lunar", "每月（农历）"},
		{"daily", "lunar", "每天"},
	}
	for _, tc := range cases {
		if got := repeatRuleLabel(tc.rule, tc.calendar); got != tc.want {
			t.Fatalf("repeatRuleLabel(%q, %q) = %q，期望 %q", tc.rule, tc.calendar, got, tc.want)
		}
	}
}

// 导出表格里的状态与时间必须和界面一致：过期、未完成、已完成三分，
// 全天事项只写日期（否则 Excel 里会出现没有意义的 00:00）。
func TestActiveExportRowsStatusAndTime(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, loc)
	past := now.Add(-2 * time.Hour)
	future := now.Add(2 * time.Hour)
	done := now.Add(-time.Hour)

	items := []ReminderDTO{
		{Reminder: Reminder{Title: "过期任务", Kind: KindTask, DueAt: &past}, ListName: "工作"},
		{Reminder: Reminder{Title: "未来任务", Kind: KindTask, DueAt: &future, RepeatRule: "weekly"}, ListName: "工作"},
		{Reminder: Reminder{Title: "已完成任务", Kind: KindTask, DueAt: &past, CompletedAt: &done}, ListName: "工作"},
		{Reminder: Reminder{Title: "全天记事", Kind: KindNote, DueAt: &future, AllDay: true, CompletedAt: &done, Notes: "第一行\r\n第二行"}, ListName: "生活"},
	}

	rows := activeExportRows(items, loc, now)
	if len(rows) != len(items) {
		t.Fatalf("导出行数 %d，期望 %d", len(rows), len(items))
	}
	// 每行必须和表头一样宽，否则 CSV 列会错位。
	header := exportHeader()
	for i, row := range rows {
		if len(row) != len(header) {
			t.Fatalf("第 %d 行列数 %d，期望 %d", i, len(row), len(header))
		}
	}

	if got := rows[0][3]; got != "已过期" {
		t.Fatalf("过期任务状态 = %q", got)
	}
	if got := rows[0][4]; got != "2026-10-05 10:00" {
		t.Fatalf("过期任务到期时间 = %q", got)
	}
	if got := rows[1][3]; got != "未完成" {
		t.Fatalf("未来任务状态 = %q", got)
	}
	if got := rows[1][6]; got != "每周" {
		t.Fatalf("未来任务重复 = %q", got)
	}
	if got := rows[2][3]; got != "已完成" {
		t.Fatalf("已完成任务状态 = %q", got)
	}
	if got := rows[2][5]; got != "2026-10-05 11:00" {
		t.Fatalf("已完成任务完成时间 = %q", got)
	}
	if got := rows[3][4]; got != "2026-10-05" {
		t.Fatalf("全天事项到期时间 = %q，应为纯日期", got)
	}
	if got := rows[3][1]; got != "记事" {
		t.Fatalf("记事类型 = %q", got)
	}
	// 备注里的 CRLF 归一成 LF，避免 Excel 里出现多余空行。
	if got := rows[3][7]; got != "第一行\n第二行" {
		t.Fatalf("备注 = %q", got)
	}
}

// exportRows 直接打 /api/reminder/export 并把 CSV 解出来。
func exportRows(t *testing.T, query string, userID uint) ([][]string, *httptest.ResponseRecorder) {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/reminder/export?"+query, nil)
	context.Set("userID", userID)
	handleExportReminders(appDB)(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("导出返回 %d: %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	if !strings.HasPrefix(body, "\xEF\xBB\xBF") {
		t.Fatal("导出内容缺少 UTF-8 BOM，Excel 打开中文会乱码")
	}
	records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(body, "\xEF\xBB\xBF"))).ReadAll()
	if err != nil {
		t.Fatalf("CSV 解析失败: %v", err)
	}
	return records, recorder
}

// withShanghaiLocal 把进程本地时区固定成上海，和生产容器一致。
//
// 时间戳在 SQLite 里是文本，范围筛选按字符串比较，所以「写进去的时刻」和
// 「ParseCompletedRange 算出来的边界」必须带同一个 UTC 偏移量。CI/开发容器默认
// 是 UTC，会让今天的记录看起来落在边界之外——那是环境差异，不是筛选逻辑的问题。
func withShanghaiLocal(t *testing.T) {
	t.Helper()
	previous := time.Local
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	time.Local = loc
	t.Cleanup(func() { time.Local = previous })
}

func TestExportRemindersHandler(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)
	withShanghaiLocal(t)

	const userID = 21
	due := time.Now().Add(-time.Hour).Truncate(time.Second)
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "要导出的任务", DueAt: &due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(24 * time.Hour).Truncate(time.Second)
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "还没到期", DueAt: &future, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	// 记事创建即完成，只会出现在「已完成」导出里。
	if _, err := createReminder(appDB, userID, SaveReminderInput{Title: "一条记事", Kind: KindNote}); err != nil {
		t.Fatal(err)
	}

	// 未完成口径：默认 view=all，只导出未完成的提醒，不含记事。
	records, recorder := exportRows(t, "scope=active", userID)
	if len(records) != 3 {
		t.Fatalf("未完成导出行数 %d，期望 3（表头+2）", len(records))
	}
	if got := strings.Join(records[0], ","); got != "标题,类型,清单,状态,到期时间,完成时间,重复,备注" {
		t.Fatalf("表头 = %q", got)
	}
	titles := []string{records[1][0], records[2][0]}
	for _, want := range []string{"要导出的任务", "还没到期"} {
		if !strings.Contains(strings.Join(titles, "|"), want) {
			t.Fatalf("未完成导出缺少 %q：%v", want, titles)
		}
	}
	if disposition := recorder.Header().Get("Content-Disposition"); !strings.Contains(disposition, "task-list.csv") {
		t.Fatalf("Content-Disposition = %q", disposition)
	}

	// 已完成口径：今天完成的记 1 条（记事）。
	records, recorder = exportRows(t, "scope=completed&range=today", userID)
	if len(records) != 2 {
		t.Fatalf("已完成导出行数 %d，期望 2（表头+1）", len(records))
	}
	if records[1][0] != "一条记事" || records[1][3] != "已完成" {
		t.Fatalf("已完成导出行 = %v", records[1])
	}
	if disposition := recorder.Header().Get("Content-Disposition"); !strings.Contains(disposition, "completed-list.csv") {
		t.Fatalf("Content-Disposition = %q", disposition)
	}

	// 时间范围之外的记录不导出。
	records, _ = exportRows(t, "scope=completed&range=custom&from=2020-01-01&to=2020-01-31", userID)
	if len(records) != 1 {
		t.Fatalf("空区间应只有表头，实际 %d 行", len(records))
	}

	// 「全部」口径：连已完成的也导出（记事同样在列），这是列表页开关对应的导出。
	records, _ = exportRows(t, "scope=active&view=all&status=all", userID)
	if len(records) != 4 {
		t.Fatalf("「全部」导出行数 %d，期望 4（表头+3，含记事）", len(records))
	}
	if records[3][0] != "一条记事" || records[3][1] != "记事" || records[3][3] != "已完成" {
		t.Fatalf("「全部」应含记事且状态为已完成，实际 %v", records[3])
	}

	// 日历口径：按月份导出，任务看到期时间、记事看记录时间，文件名带月份。
	month := time.Now().In(shanghai()).Format("2006-01")
	records, recorder = exportRows(t, "scope=calendar&month="+month, userID)
	if len(records) != 4 {
		t.Fatalf("日历导出行数 %d，期望 4（表头 + 2 个任务 + 记事；记事按记录时间落在本月）", len(records))
	}
	var noteRow []string
	for _, row := range records[1:] {
		if row[1] == "记事" {
			noteRow = row
		}
	}
	if noteRow == nil {
		t.Fatalf("日历导出应包含记事，实际 %v", records)
	}
	if noteRow[3] != "记事" || noteRow[4] != "" {
		t.Fatalf("记事的「状态」应为记事、「到期时间」应为空，实际 %v", noteRow)
	}
	if noteRow[5] == "" {
		t.Fatalf("记事的记录时间应写进「完成时间」列，实际 %v", noteRow)
	}
	if disposition := recorder.Header().Get("Content-Disposition"); !strings.Contains(disposition, "calendar-"+month+".csv") {
		t.Fatalf("Content-Disposition = %q", disposition)
	}
	// 月份参数写错要报 400，而不是导出一份空表。
	badRecorder := httptest.NewRecorder()
	badCtx, _ := gin.CreateTestContext(badRecorder)
	badCtx.Request = httptest.NewRequest(http.MethodGet, "/api/reminder/export?scope=calendar&month=2026-13", nil)
	badCtx.Set("userID", userID)
	handleExportReminders(appDB)(badCtx)
	if badRecorder.Code != http.StatusBadRequest {
		t.Fatalf("非法月份返回 %d，期望 400", badRecorder.Code)
	}

	// 非法参数要明确报错，而不是导出一份空表。
	recorder = httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/reminder/export?scope=bogus", nil)
	context.Set("userID", userID)
	handleExportReminders(appDB)(context)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("非法 scope 返回 %d，期望 400", recorder.Code)
	}
}

// 导出对话框的两个新参数：lists= 只导这些清单、columns= 只导这些列；
// 都不传时必须与旧行为逐字节一致（缺省＝全部清单 + 全部列）。
func TestExportSelectedListsAndColumns(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)
	withShanghaiLocal(t)

	const userID = 22
	listA := List{UserID: userID, Name: "工作", IsDefault: true}
	listB := List{UserID: userID, Name: "生活"}
	if err := appDB.Create(&listA).Error; err != nil {
		t.Fatal(err)
	}
	if err := appDB.Create(&listB).Error; err != nil {
		t.Fatal(err)
	}
	due := time.Now().Add(-time.Hour).Truncate(time.Second)
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "工作里的任务", ListID: listA.ID, DueAt: &due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "生活里的任务", ListID: listB.ID, DueAt: &due, RepeatRule: "none",
	}); err != nil {
		t.Fatal(err)
	}
	// 记事创建即完成，一律落到「记事本」栏目。
	if _, err := createReminder(appDB, userID, SaveReminderInput{Title: "一条记事", Kind: KindNote}); err != nil {
		t.Fatal(err)
	}
	bucket, err := findNoteBucket(appDB, userID, false)
	if err != nil || bucket == nil {
		t.Fatalf("记事本栏目应存在：%v %v", bucket, err)
	}

	// 只选两列：表头与每行列宽都必须与所选一致。
	records, _ := exportRows(t, "scope=active&view=all&status=all&columns=title,due", userID)
	if got := strings.Join(records[0], ","); got != "标题,到期时间" {
		t.Fatalf("按列导出表头 = %q", got)
	}
	for i, row := range records[1:] {
		if len(row) != 2 {
			t.Fatalf("第 %d 行有 %d 列，期望 2：%v", i, len(row), row)
		}
	}

	// columns 全非法 / 缺省 → 回落到全部列（旧客户端行为不变）。
	records, _ = exportRows(t, "scope=active&view=all&status=all&columns=bogus", userID)
	if got := strings.Join(records[0], ","); got != "标题,类型,清单,状态,到期时间,完成时间,重复,备注" {
		t.Fatalf("非法 columns 应回落全部列，实际表头 = %q", got)
	}

	// lists= 只导出一个清单：另一个清单与记事本都不出现。
	only := func(query string) map[string]bool {
		rows, _ := exportRows(t, query, userID)
		out := map[string]bool{}
		for _, row := range rows[1:] {
			out[row[0]] = true
		}
		return out
	}
	got := only(fmt.Sprintf("scope=active&view=all&status=all&lists=%d", listA.ID))
	if !got["工作里的任务"] || got["生活里的任务"] || got["一条记事"] {
		t.Fatalf("按清单 lists=%d 导出不对：%v", listA.ID, got)
	}
	// lists= 记事本栏目 id：只剩记事。
	got = only(fmt.Sprintf("scope=active&view=all&status=all&lists=%d", bucket.ID))
	if !got["一条记事"] || got["工作里的任务"] || got["生活里的任务"] {
		t.Fatalf("按记事本 lists=%d 导出不对：%v", bucket.ID, got)
	}
	// 旧参数 list_ids 仍然有效（兼容）。
	got = only(fmt.Sprintf("scope=active&view=all&status=all&list_ids=%d", listB.ID))
	if !got["生活里的任务"] || got["工作里的任务"] {
		t.Fatalf("旧的 list_ids 导出不对：%v", got)
	}
}
