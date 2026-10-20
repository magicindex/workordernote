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
	overduePolicyMu.Lock()
	overduePolicyCache = map[uint]overduePolicyEntry{}
	overduePolicyMu.Unlock()
	quietMu.Lock()
	quietCache = map[uint]quietEntry{}
	quietMu.Unlock()
	advanceMu.Lock()
	advanceCache = map[uint]advanceEntry{}
	advanceMu.Unlock()
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

// setUserConfig 写一条个人偏好（测试用）：「逾期提醒时间」「开始提醒时间」都是个人偏好。
func setUserConfig(t *testing.T, key, value string, userID uint) {
	t.Helper()
	if err := sysconfig.InitDefaultConfigs(appDB); err != nil {
		t.Fatalf("初始化默认配置失败：%v", err)
	}
	if err := sysconfig.UpdateConfig(appDB, key, value, userID); err != nil {
		t.Fatalf("写个人偏好 %s 失败：%v", key, err)
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

// 规则本身（不依赖跑测试的钟点）：用 SQLite 把「逾期判定时刻」算出来，按固定日期的行核对。
//
// 规则（用户 2026-10-12 明确）：到期日当天的「逾期提醒时间」就是判定时刻 —— 与任务写的
// 几点无关（新建提醒默认 23:59，若按「取两者较晚」算，用户设 20:30 就永远看不到效果）。
// 只有 00:00 例外：表示按到期时刻本身算、不按天顺延。
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
	deadlineOf := func(cutoff string) string {
		var got string
		q := "SELECT " + overdueDeadlineExpr("due_at", cutoff) + " FROM reminders WHERE id = ?"
		if err := appDB.Raw(q, row.ID).Scan(&got).Error; err != nil {
			t.Fatalf("算 deadline 失败：%v", err)
		}
		return got
	}
	// 23:59（默认）：2026-10-10 23:59 +08:00 = 2026-10-10 15:59 UTC
	if got := deadlineOf("23:59"); got != "2026-10-10 15:59:00" {
		t.Fatalf("默认 23:59 的 deadline 应是 2026-10-10 15:59:00(UTC)，实际 %q", got)
	}
	// 20:30（用户举的例子）：就是当天 20:30 —— 09:00 到期的任务也等到 20:30 才算逾期
	if got := deadlineOf("20:30"); got != "2026-10-10 12:30:00" {
		t.Fatalf("逾期时间 20:30 的 deadline 应是当天 20:30 = 2026-10-10 12:30:00(UTC)，实际 %q", got)
	}
	// 08:00：比到期时刻（09:00）还早 —— 新口径按**日期**算，所以就是当天 08:00
	if got := deadlineOf("08:00"); got != "2026-10-10 00:00:00" {
		t.Fatalf("逾期时间 08:00 的 deadline 应是当天 08:00 = 2026-10-10 00:00:00(UTC)，实际 %q", got)
	}
	// 00:00：例外 —— 按到期时刻本身算 = 2026-10-10 01:00 UTC
	if got := deadlineOf("00:00"); got != "2026-10-10 01:00:00" {
		t.Fatalf("逾期时间 00:00 的 deadline 应等于到期时刻 2026-10-10 01:00:00(UTC)，实际 %q", got)
	}
}

// 端到端：/summary 的 overdue 角标跟着**个人偏好**「逾期提醒时间」走。
// 用「昨天 23:00」与「今天 00:10」两条，断言随时钟自适应（不写死期望值）。
func TestOverdueTimeDefersOverdueUntilCutoff(t *testing.T) {
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
	// 期望值全部按「判定时刻 + 30 分钟宽限」随时钟算：跑测试的钟点不同（尤其刚过零点、
	// 刚过 20:30 这些边界）期望值本来就该变，写死数字只会在那几个分钟里假红。
	const grace = 30 * time.Minute
	overdueNow := func(instant time.Time, cutoff string) int64 {
		deadline := instant
		if cutoff != "00:00" { // 00:00 = 按到期时刻本身算
			h, m, _ := clockParts(cutoff)
			l := instant.In(loc)
			deadline = time.Date(l.Year(), l.Month(), l.Day(), h, m, 0, 0, loc)
		}
		if now.After(deadline.Add(grace)) {
			return 1
		}
		return 0
	}
	wantWith := func(cutoff string) int64 {
		return overdueNow(yesterdayLate, cutoff) + overdueNow(todayEarly, cutoff)
	}

	// 默认 23:59：今天 00:10 那条要等到今天 23:59（+30 分钟），所以正常只有昨天那条逾期
	setUserConfig(t, "task_overdue_time", "23:59", userID)
	if got, want := summaryOverdue(t, userID), wantWith("23:59"); got != want {
		t.Fatalf("默认 23:59 时应有 %d 条逾期，实际 %d（now=%s）", want, got, now.Format(time.RFC3339))
	}

	// 逾期时间 00:00 = 按到期时刻算：今天 00:10 那条的 deadline 就是 00:10（+30 分钟宽限）
	setUserConfig(t, "task_overdue_time", "00:00", userID)
	if got, want := summaryOverdue(t, userID), wantWith("00:00"); got != want {
		t.Fatalf("逾期时间 00:00 时应有 %d 条逾期，实际 %d（now=%s）", want, got, now.Format(time.RFC3339))
	}

	// 用户举的例子：逾期时间设 20:30 —— 今天 00:10 到期的任务过了今天 20:30（+宽限）
	// 就算逾期。注意它比「新建默认的 23:59」更早，这正是这次改动要的效果：
	// 旧口径取 MAX(到期时刻, 当天时间)，设 20:30 对 23:59 的任务永远没有效果。
	setUserConfig(t, "task_overdue_time", "20:30", userID)
	if got, want := summaryOverdue(t, userID), wantWith("20:30"); got != want {
		t.Fatalf("逾期时间 20:30 时应有 %d 条逾期，实际 %d（now=%s）", want, got, now.Format(time.RFC3339))
	}

	// 非法值不生效，退回默认 23:59
	setUserConfig(t, "task_overdue_time", "25:99", userID)
	if _, cutoff := overduePolicy(appDB, userID); cutoff != "23:59" {
		t.Fatalf("非法逾期时间应退回 23:59，实际 %q", cutoff)
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
