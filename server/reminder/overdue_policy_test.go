package reminder

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"smallgo/server/sysconfig"
)

// resetOverduePolicyCache 让下一次读取重新查库（配置改完必须调用，
// 否则 2 秒的进程内缓存会把旧值带进来）。
func resetOverduePolicyCache() {
	overdueGraceMu.Lock()
	overdueGraceAt = time.Time{}
	overdueGraceMu.Unlock()
}

// setPublicConfig 写一条系统级公开配置（测试用）。
//
// 必须先 InitDefaultConfigs：UpdateConfig 在「行不存在」时新建的行 **public=false**，
// 而 overduePolicy 读的是 GetPublicConfigs（WHERE public = true）——不先播种的话
// 写进去的值根本读不到（这里的第一次实现就踩了：断言里拿到的一直是默认值）。
func setPublicConfig(t *testing.T, key, value string) {
	t.Helper()
	if err := sysconfig.InitDefaultConfigs(appDB); err != nil {
		t.Fatalf("初始化默认配置失败：%v", err)
	}
	if err := sysconfig.UpdateConfig(appDB, key, value, 0); err != nil {
		t.Fatalf("写配置 %s 失败：%v", key, err)
	}
	resetOverduePolicyCache()
}

// summaryOverdue 跑一次 /summary，返回 overdue 角标。
func summaryOverdue(t *testing.T, userID uint) int64 {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/reminder/summary", nil)
	context.Set("userID", userID)
	handleSummary(appDB)(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Data map[string]int64 `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Data["overdue"]
}

// 规则本身（不依赖跑测试的钟点）：用 SQLite 把「逾期截止时刻」算出来，
// 按固定日期的行核对 —— 当天到期 → 当天 23:59；过期时间设 00:00 → 就是到期时刻本身。
func TestOverdueDeadlineExpression(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 312
	loc, _ := time.LoadLocation("Asia/Shanghai")
	due := time.Date(2026, 10, 10, 9, 0, 0, 0, loc) // 固定：2026-10-10 09:00 +08:00
	row := Reminder{UserID: userID, ListID: 1, Title: "固定日期", DueAt: &due, RepeatRule: "none"}
	if err := appDB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	deadlineOf := func(expire string) string {
		var got string
		q := "SELECT " + overdueDeadlineExpr("due_at", expire) + " FROM reminders WHERE id = ?"
		if err := appDB.Raw(q, row.ID).Scan(&got).Error; err != nil {
			t.Fatalf("算 deadline 失败：%v", err)
		}
		return got
	}
	// 23:59（默认）：2026-10-10 23:59 +08:00 = 2026-10-10 15:59 UTC
	if got := deadlineOf("23:59"); got != "2026-10-10 15:59:00" {
		t.Fatalf("默认 23:59 的 deadline 应是 2026-10-10 15:59:00(UTC)，实际 %q", got)
	}
	// 00:00：截止时刻等于到期时刻本身 = 2026-10-10 01:00 UTC
	if got := deadlineOf("00:00"); got != "2026-10-10 01:00:00" {
		t.Fatalf("过期时间 00:00 的 deadline 应等于到期时刻 2026-10-10 01:00:00(UTC)，实际 %q", got)
	}
	// 到期时刻晚于当天过期时间时取晚的那个：09:00 + 过期时间 08:00 → 仍是 09:00
	if got := deadlineOf("08:00"); got != "2026-10-10 01:00:00" {
		t.Fatalf("到期时刻晚于过期时间时应取到期时刻，实际 %q", got)
	}
}

// 端到端：/summary 的 overdue 角标跟着「过期时间」走。
// 用「昨天 23:00」与「今天 00:10」两条，断言随时钟自适应（不写死期望值）。
func TestExpireTimeDefersOverdueUntilDayEnd(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 311
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().In(loc)
	todayEarly := time.Date(now.Year(), now.Month(), now.Day(), 0, 10, 0, 0, loc)
	yesterdayLate := time.Date(now.Year(), now.Month(), now.Day(), 23, 0, 0, 0, loc).AddDate(0, 0, -1)
	y := yesterdayLate
	e := todayEarly
	rows := []Reminder{
		{UserID: userID, ListID: 1, Title: "昨天 23:00 到期", DueAt: &y, RepeatRule: "none"},
		{UserID: userID, ListID: 1, Title: "今天 00:10 到期", DueAt: &e, RepeatRule: "none"},
	}
	if err := appDB.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	setPublicConfig(t, "task_overdue_after_minutes", "30")
	// 默认 23:59：今天 00:10 那条要等到今天 23:59（+30 分钟），所以只有昨天那条逾期
	setPublicConfig(t, "task_expire_time", "23:59")
	if got := summaryOverdue(t, userID); got != 1 {
		t.Fatalf("默认 23:59 时应只有昨天那条逾期，实际 %d", got)
	}

	// 过期时间 00:00 = 按到期时刻算：今天 00:10 那条的 deadline 就是 00:10，
	// 过了 00:40 就该算逾期（跑测试的钟点不同，期望值随之调整）
	setPublicConfig(t, "task_expire_time", "00:00")
	want := int64(1)
	if now.After(todayEarly.Add(30 * time.Minute)) {
		want = 2
	}
	if got := summaryOverdue(t, userID); got != want {
		t.Fatalf("过期时间 00:00 时应有 %d 条逾期，实际 %d（now=%s）", want, got, now.Format(time.RFC3339))
	}

	// 非法值不生效，退回默认 23:59
	setPublicConfig(t, "task_expire_time", "25:99")
	if _, expire := overduePolicy(appDB); expire != "23:59" {
		t.Fatalf("非法过期时间应退回 23:59，实际 %q", expire)
	}
}

// validClock 的白名单/黑名单（防手改数据库塞进非法值把 SQL 拼坏）。
func TestValidClock(t *testing.T) {
	if !validClock("23:59") || !validClock("00:00") || !validClock("09:05") {
		t.Fatal("合法时间被拒了")
	}
	for _, bad := range []string{"", "23", "23:5", "24:00", "aa:bb", "23:60", "23:59:00"} {
		if validClock(bad) {
			t.Fatalf("%q 不该算合法时间", bad)
		}
	}
}
