package reminder

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// 免打扰（用户 2026-10-16）：手动开关 + 后台时间段，两者任一成立都不发任何提醒。
// 这里覆盖三样东西：
//   - 时间段本身（跨天、起止相同＝不用、整点样式归一化）；
//   - 状态组装（手动开关 / 时间段 / 此刻是否生效 / 原因说明）；
//   - 「优先在所有通知以上」真的生效（逾期提醒被拦、别的用户不受影响、
//     提醒@他照旧写通知中心）。
func TestInDNDWindow(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	at := func(h, m int) time.Time {
		return time.Date(2026, 10, 16, h, m, 0, 0, loc)
	}

	cases := []struct {
		name       string
		start, end string
		h, m       int
		want       bool
	}{
		{"同日窗口内", "09:00", "12:00", 10, 30, true},
		{"同日窗口前", "09:00", "12:00", 8, 59, false},
		{"同日窗口起点算在内", "09:00", "12:00", 9, 0, true},
		{"同日窗口终点不算在内", "09:00", "12:00", 12, 0, false},
		{"跨天窗口的晚上", "22:00", "07:00", 23, 30, true},
		{"跨天窗口的凌晨", "22:00", "07:00", 3, 0, true},
		{"跨天窗口的白天不算", "22:00", "07:00", 15, 0, false},
		{"跨天窗口起点算在内", "22:00", "07:00", 22, 0, true},
		{"跨天窗口终点不算在内", "22:00", "07:00", 7, 0, false},
		{"起止相同＝不用这个时间段", "07:00", "07:00", 7, 0, false},
		{"00:00–00:00＝不生效", "00:00", "00:00", 3, 0, false},
		{"不补零也认", "6:00", "9:00", 7, 30, true},
		{"乱七八糟的值不生效", "abc", "07:00", 3, 0, false},
	}
	for _, c := range cases {
		if got := inDNDWindow(at(c.h, c.m), c.start, c.end); got != c.want {
			t.Fatalf("%s（%s–%s 的 %02d:%02d）应为 %v，实际 %v", c.name, c.start, c.end, c.h, c.m, c.want, got)
		}
	}
}

func TestDNDStateFromConfigAndManual(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 324
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	// 默认（没设过）：时间段 22:00–07:00 **但总开关是关的**，所以下午当然不生效，手动也关着。
	noon := time.Date(2026, 10, 16, 12, 0, 0, 0, loc)
	state := loadDNDState(appDB, userID, noon)
	if state.Manual || state.InWindow || state.Active {
		t.Fatalf("默认状态下不该免打扰，实际 %+v", state)
	}
	if state.WindowStart != "22:00" || state.WindowEnd != "07:00" {
		t.Fatalf("默认时间段应为备着的 22:00–07:00，实际 %s–%s", state.WindowStart, state.WindowEnd)
	}
	if state.WindowEnabled {
		t.Fatalf("时间段总开关默认应为关（打开会改掉夜里到清晨的提醒行为），实际 %+v", state)
	}
	if state.Reason != "" {
		t.Fatalf("没生效时不该有原因说明，实际 %q", state.Reason)
	}

	// 本人的偏好里打开时间段总开关，才轮到 22:00–07:00 说话
	setUserConfig(t, keyDNDEnabled, "true", userID)

	// 手动开关：开了就一直开着（不挑时间），原因说明写「手动免打扰」。
	setUserConfig(t, keyDNDManual, "true", userID)
	state = loadDNDState(appDB, userID, noon)
	if !state.Manual || !state.Active || state.Reason != "手动免打扰" {
		t.Fatalf("手动开关打开后应立刻生效，实际 %+v", state)
	}

	// 手动 + 时间段同时成立：原因说明两个都写。
	night := time.Date(2026, 10, 16, 23, 30, 0, 0, loc)
	state = loadDNDState(appDB, userID, night)
	if !state.InWindow || !state.Active {
		t.Fatalf("23:30 应落在 22:00–07:00 里，实际 %+v", state)
	}
	if state.Reason != "手动免打扰 + 免打扰时间段 22:00–07:00" {
		t.Fatalf("两个来源都该写进原因说明，实际 %q", state.Reason)
	}

	// 只关手动：时间段还在，夜里依旧安静（这是「后台时间段」的意义）。
	setUserConfig(t, keyDNDManual, "false", userID)
	state = loadDNDState(appDB, userID, night)
	if state.Manual || !state.Active || state.Reason != "免打扰时间段 22:00–07:00" {
		t.Fatalf("关掉手动后夜里仍应免打扰，实际 %+v", state)
	}

	// 改自己的时间段：起止归一化（"6:00" → "06:00"），凌晨 3 点不再安静。
	setUserConfig(t, keyDNDStart, "6:00", userID)
	setUserConfig(t, keyDNDEnd, "7:00", userID)
	state = loadDNDState(appDB, userID, time.Date(2026, 10, 16, 3, 0, 0, 0, loc))
	if state.WindowStart != "06:00" || state.WindowEnd != "07:00" {
		t.Fatalf("时间段应归一化成 06:00–07:00，实际 %s–%s", state.WindowStart, state.WindowEnd)
	}
	if state.Active {
		t.Fatalf("改成 06:00–07:00 后凌晨 3 点不该免打扰，实际 %+v", state)
	}

	// 关掉自己的时间段：手动也关着 → 一天里任何时刻都不安静。
	setUserConfig(t, keyDNDEnabled, "false", userID)
	state = loadDNDState(appDB, userID, time.Date(2026, 10, 16, 6, 30, 0, 0, loc))
	if state.WindowEnabled || state.InWindow || state.Active {
		t.Fatalf("后台关掉时间段后 06:30 不该免打扰，实际 %+v", state)
	}
}

// 免打扰要「优先在所有通知以上」：逾期提醒整轮跳过（不写通知），到点后照常补发。
func TestDNDBlocksOverdueNotifications(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 325
	setUserConfig(t, "task_overdue_time", "00:00", userID) // 按到期时刻算逾期（同现有用例的口径）
	setUserConfig(t, keyDNDEnabled, "true", userID)
	setUserConfig(t, keyDNDStart, "22:00", userID)
	setUserConfig(t, keyDNDEnd, "07:00", userID)

	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	// 一条 3 小时前就该逾期的任务
	night := time.Date(2026, 10, 16, 3, 0, 0, 0, loc)
	due := night.Add(-3 * time.Hour)
	row := Reminder{UserID: userID, ListID: 1, Title: "自检免打扰逾期", DueAt: &due, RepeatRule: "none"}
	if err := appDB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	count := func() int64 {
		var n int64
		appDB.Model(&Notification{}).
			Where("user_id = ? AND reminder_id = ? AND type = ?", userID, row.ID, "reminder_overdue").
			Count(&n)
		return n
	}

	// 凌晨 3 点落在 22:00–07:00 里：一条都不发
	notifyOverdueAt(appDB, night)
	if got := count(); got != 0 {
		t.Fatalf("免打扰时间段里不该发逾期提醒，实际 %d 条", got)
	}

	// 手动开关同样拦得住（白天也一样）
	morning := time.Date(2026, 10, 16, 9, 0, 0, 0, loc)
	setUserConfig(t, keyDNDManual, "true", userID)
	notifyOverdueAt(appDB, morning)
	if got := count(); got != 0 {
		t.Fatalf("手动免打扰期间不该发逾期提醒，实际 %d 条", got)
	}

	// 关掉手动免打扰、也不在时间段里：照常补发（免打扰只是推迟，不是丢掉）
	setUserConfig(t, keyDNDManual, "false", userID)
	notifyOverdueAt(appDB, morning.Add(time.Minute))
	if got := count(); got != 1 {
		t.Fatalf("免打扰结束后应补发 1 条逾期提醒，实际 %d 条", got)
	}
}

// 免打扰只挡自己：同一个 now 下，别的用户该收到还是要收到。
func TestDNDOnlyBlocksTheUserWhoEnabledIt(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const quietUser, normalUser = 326, 327
	setUserConfig(t, "task_overdue_time", "00:00", quietUser)
	setUserConfig(t, "task_overdue_time", "00:00", normalUser)
	setUserConfig(t, keyDNDManual, "true", quietUser)

	loc, _ := time.LoadLocation("Asia/Shanghai")
	now := time.Date(2026, 10, 16, 15, 0, 0, 0, loc)
	due := now.Add(-2 * time.Hour)

	quietRow := Reminder{UserID: quietUser, ListID: 1, Title: "自检免打扰用户", DueAt: &due, RepeatRule: "none"}
	normalRow := Reminder{UserID: normalUser, ListID: 1, Title: "自检普通用户", DueAt: &due, RepeatRule: "none"}
	if err := appDB.Create(&quietRow).Error; err != nil {
		t.Fatal(err)
	}
	if err := appDB.Create(&normalRow).Error; err != nil {
		t.Fatal(err)
	}

	notifyOverdueAt(appDB, now)

	var quietCount, normalCount int64
	appDB.Model(&Notification{}).Where("user_id = ? AND reminder_id = ?", quietUser, quietRow.ID).Count(&quietCount)
	appDB.Model(&Notification{}).Where("user_id = ? AND reminder_id = ?", normalUser, normalRow.ID).Count(&normalCount)
	if quietCount != 0 {
		t.Fatalf("免打扰用户不该收到逾期提醒，实际 %d 条", quietCount)
	}
	if normalCount != 1 {
		t.Fatalf("别的用户应照常收到逾期提醒，实际 %d 条", normalCount)
	}
}

// 提醒@他：免打扰期间照样写通知中心（未读角标照常），只是不实时推。
// 通知在不在，就是这条契约里能验证、也最要紧的那一半。
func TestNotifyNudgeDuringDNDStillRecordsNotification(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 328
	setUserConfig(t, keyDNDManual, "true", userID)
	notifyNudge(appDB, userID, "nudge_received", "自检免打扰提醒@他", "体")

	var n int64
	appDB.Model(&Notification{}).Where("user_id = ? AND title = ?", userID, "自检免打扰提醒@他").Count(&n)
	if n != 1 {
		t.Fatalf("免打扰期间提醒@他也要记进通知中心，实际 %d 条", n)
	}
}

// 接口层：GET 读状态、PUT 切手动开关（并落库）、身体不对就 400。
func TestDNDHandlers(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	gin.SetMode(gin.TestMode)
	const userID = 329

	call := func(method, body string, handler gin.HandlerFunc) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(method, "/api/reminder/dnd", bytes.NewBufferString(body))
		context.Request.Header.Set("Content-Type", "application/json")
		context.Set("userID", userID)
		handler(context)
		var payload map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("%s %s 返回的不是 JSON：%s", method, body, recorder.Body.String())
		}
		return recorder, payload
	}

	recorder, payload := call(http.MethodGet, "", handleDNDState(appDB))
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET /dnd 返回 %d：%s", recorder.Code, recorder.Body.String())
	}
	data, _ := payload["data"].(map[string]any)
	if data == nil || data["active"] != false || data["manual"] != false {
		t.Fatalf("初始状态应为未免打扰，实际 %v", payload)
	}

	recorder, payload = call(http.MethodPut, `{"manual":true}`, handleSetDND(appDB))
	if recorder.Code != http.StatusOK {
		t.Fatalf("PUT /dnd 返回 %d：%s", recorder.Code, recorder.Body.String())
	}
	data, _ = payload["data"].(map[string]any)
	if data == nil || data["active"] != true || data["manual"] != true {
		t.Fatalf("打开手动免打扰后应 active，实际 %v", payload)
	}
	if !dndManual(appDB, userID) {
		t.Fatal("手动免打扰应落到个人配置里")
	}

	recorder, payload = call(http.MethodPut, `{"manual":false}`, handleSetDND(appDB))
	data, _ = payload["data"].(map[string]any)
	if recorder.Code != http.StatusOK || data["active"] != false {
		t.Fatalf("关掉手动免打扰后不该 active，实际 %d %v", recorder.Code, payload)
	}
	if dndManual(appDB, userID) {
		t.Fatal("关掉后个人配置里应为 false")
	}

	if recorder, _ := call(http.MethodPut, `{}`, handleSetDND(appDB)); recorder.Code != http.StatusBadRequest {
		t.Fatalf("空 body 应回 400，实际 %d", recorder.Code)
	}
	if recorder, _ := call(http.MethodPut, `{"manual":"嗯"}`, handleSetDND(appDB)); recorder.Code != http.StatusBadRequest {
		t.Fatalf("非法 body 应回 400，实际 %d", recorder.Code)
	}
}

// 免打扰时间段是个人偏好（2026-10-19 从系统配置迁移）：A 开了，B 不受影响。
func TestDNDWindowIsPerUser(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const a, b = 326, 327
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	night := time.Date(2026, 10, 16, 23, 30, 0, 0, loc)

	setUserConfig(t, keyDNDEnabled, "true", a)
	setUserConfig(t, keyDNDStart, "22:00", a)
	setUserConfig(t, keyDNDEnd, "07:00", a)

	stateA := loadDNDState(appDB, a, night)
	if !stateA.Active || !stateA.WindowEnabled {
		t.Fatalf("A 开了时间段，23:30 应当免打扰，实际 %+v", stateA)
	}
	stateB := loadDNDState(appDB, b, night)
	if stateB.Active || stateB.WindowEnabled {
		t.Fatalf("B 没开，A 的设置不该影响 B，实际 %+v", stateB)
	}
	if dndBlocked(appDB, a, night) != true || dndBlocked(appDB, b, night) != false {
		t.Fatalf("投递链路上的判断也应各按各的：A=true B=false")
	}

	// 反过来 B 设一个自己的窗口，A 的窗口不受影响。
	setUserConfig(t, keyDNDStart, "09:00", b)
	stateA = loadDNDState(appDB, a, night)
	if stateA.WindowStart != "22:00" {
		t.Fatalf("B 改开始时间不该改到 A 的，实际 A=%s", stateA.WindowStart)
	}
}
