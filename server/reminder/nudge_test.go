package reminder

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"smallgo/server/database"
	"smallgo/server/sysconfig"

	"github.com/gin-gonic/gin"
)

// 「提醒@他」（用户 2026-10-13）的接口行为：
//   · 只能提醒别人（自己提醒自己一律 400）；
//   · 两列各归各的（我提醒他人 / 别人提醒我）；
//   · 对方「已收到」「已完成」都写一条回执通知给发起人（这就是消息面板里的反馈）；
//   · 站内回执只有接收人能点（发起人越权 404）；
//   · 别人提醒我、还没做完的条数要进 /summary 的统计。
func nudgeRequest(t *testing.T, handler gin.HandlerFunc, userID uint, method, body string, params gin.Params) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(method, "/api/reminder/nudges", strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Params = params
	ctx.Set("userID", userID)
	handler(ctx)
	return recorder
}

func nudgeData[T any](t *testing.T, recorder *httptest.ResponseRecorder) T {
	t.Helper()
	var out struct {
		Data T `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析响应失败：%v（%s）", err, recorder.Body.String())
	}
	return out.Data
}

func nudgeIDParam(id uint) gin.Params {
	return gin.Params{{Key: "id", Value: strconv.FormatUint(uint64(id), 10)}}
}

func seedNudgeUsers(t *testing.T, ids ...uint) {
	t.Helper()
	for _, id := range ids {
		account := database.User{ID: id, Username: "user" + strconv.FormatUint(uint64(id), 10), Password: "x", Role: "user", Status: 1}
		if err := appDB.Create(&account).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func TestNudgeRejectsSelfAndUnknownTarget(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)

	const me, mate = 901, 902
	seedNudgeUsers(t, me, mate)

	// 自己提醒自己：挡在服务端（不是靠前端不显示自己）
	rec := nudgeRequest(t, handleCreateNudge(appDB), me, http.MethodPost,
		`{"to_user_id":901,"content":"提醒我自己"}`, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("自己提醒自己应当 400，实际 %d（%s）", rec.Code, rec.Body.String())
	}

	// 不存在的对象
	rec = nudgeRequest(t, handleCreateNudge(appDB), me, http.MethodPost,
		`{"to_user_id":9999,"content":"提醒谁"}`, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("对象不存在应当 404，实际 %d", rec.Code)
	}

	// 空内容
	rec = nudgeRequest(t, handleCreateNudge(appDB), me, http.MethodPost,
		`{"to_user_id":902,"content":"   "}`, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("空内容应当 400，实际 %d", rec.Code)
	}

	// 停用的账号也不能被提醒
	if err := appDB.Model(&database.User{}).Where("id = ?", mate).Update("status", 0).Error; err != nil {
		t.Fatal(err)
	}
	rec = nudgeRequest(t, handleCreateNudge(appDB), me, http.MethodPost,
		`{"to_user_id":902,"content":"停用的人"}`, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("停用账号应当 404，实际 %d", rec.Code)
	}
}

func TestNudgeRoundTripAndFeedback(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)

	const sender, receiver = 911, 912
	seedNudgeUsers(t, sender, receiver)

	rec := nudgeRequest(t, handleCreateNudge(appDB), sender, http.MethodPost,
		`{"to_user_id":912,"content":"把周报发我","note":"今天下班前"}`, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("发送失败：%d（%s）", rec.Code, rec.Body.String())
	}
	created := nudgeData[NudgeDTO](t, rec)
	if created.FromUserID != sender || created.ToUserID != receiver {
		t.Fatalf("发件人/收件人不对：%+v", created)
	}
	if created.Direction != "sent" || !created.CanDelete {
		t.Fatalf("发起人视角应当是 sent 且可撤回：%+v", created)
	}

	// 接收人那边的未读回执：一条站内通知写给他
	var got int64
	if err := appDB.Model(&Notification{}).
		Where("user_id = ? AND type = ?", receiver, "nudge_received").Count(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got != 1 {
		t.Fatalf("接收人应当收到 1 条 nudge_received 通知，实际 %d", got)
	}

	// 两列各归各的
	rec = nudgeRequest(t, handleListNudges(appDB), sender, http.MethodGet, "", nil)
	sentBox := nudgeData[struct {
		Sent     []NudgeDTO `json:"sent"`
		Received []NudgeDTO `json:"received"`
		Counts   struct {
			ReceivedPending int64 `json:"received_pending"`
			SentPending     int64 `json:"sent_pending"`
		} `json:"counts"`
	}](t, rec)
	if len(sentBox.Sent) != 1 || len(sentBox.Received) != 0 {
		t.Fatalf("发起人应当只有 1 条「我提醒他人」：%+v", sentBox)
	}
	if sentBox.Counts.SentPending != 1 || sentBox.Counts.ReceivedPending != 0 {
		t.Fatalf("发起人的统计不对：%+v", sentBox.Counts)
	}
	if sentBox.Sent[0].ToUsername != "user912" {
		t.Fatalf("应带接收人用户名，实际 %q", sentBox.Sent[0].ToUsername)
	}

	rec = nudgeRequest(t, handleListNudges(appDB), receiver, http.MethodGet, "", nil)
	receivedBox := nudgeData[struct {
		Sent     []NudgeDTO `json:"sent"`
		Received []NudgeDTO `json:"received"`
		Counts   struct {
			ReceivedPending int64 `json:"received_pending"`
			ReceivedUnread  int64 `json:"received_unread"`
		} `json:"counts"`
	}](t, rec)
	if len(receivedBox.Received) != 1 || len(receivedBox.Sent) != 0 {
		t.Fatalf("接收人应当只有 1 条「别人提醒我」：%+v", receivedBox)
	}
	if receivedBox.Received[0].Direction != "received" {
		t.Fatalf("接收人视角应当是 received：%+v", receivedBox.Received[0])
	}
	if receivedBox.Counts.ReceivedPending != 1 || receivedBox.Counts.ReceivedUnread != 1 {
		t.Fatalf("接收人的统计不对：%+v", receivedBox.Counts)
	}

	// 发起人不能替对方点「已收到」/「已完成」（越权一律 404，不是 403）
	for _, path := range []string{"read", "done"} {
		handler := handleReadNudge(appDB)
		if path == "done" {
			handler = handleDoneNudge(appDB)
		}
		rec = nudgeRequest(t, handler, sender, http.MethodPost, "", nudgeIDParam(created.ID))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("发起人调 %s 应当 404，实际 %d", path, rec.Code)
		}
	}

	// 接收人点「已收到」→ 发起人拿到回执通知
	rec = nudgeRequest(t, handleReadNudge(appDB), receiver, http.MethodPost, "", nudgeIDParam(created.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("标记已收到失败：%d（%s）", rec.Code, rec.Body.String())
	}
	if err := appDB.Model(&Notification{}).
		Where("user_id = ? AND type = ?", sender, "nudge_read").Count(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got != 1 {
		t.Fatalf("发起人应当收到 1 条 nudge_read 回执，实际 %d", got)
	}

	// 接收人点「已完成」→ 再一条回执，且完成时补上已读时间
	rec = nudgeRequest(t, handleDoneNudge(appDB), receiver, http.MethodPost, "", nudgeIDParam(created.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("标记已完成失败：%d（%s）", rec.Code, rec.Body.String())
	}
	if err := appDB.Model(&Notification{}).
		Where("user_id = ? AND type = ?", sender, "nudge_done").Count(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got != 1 {
		t.Fatalf("发起人应当收到 1 条 nudge_done 回执，实际 %d", got)
	}
	var row Nudge
	if err := appDB.First(&row, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.DoneAt == nil || row.ReadAt == nil {
		t.Fatalf("完成后 done_at/read_at 都该有值：%+v", row)
	}

	// 做完了就不再计入接收人的待办角标
	rec = nudgeRequest(t, handleListNudges(appDB), receiver, http.MethodGet, "", nil)
	after := nudgeData[struct {
		Counts struct {
			ReceivedPending int64 `json:"received_pending"`
		} `json:"counts"`
	}](t, rec)
	if after.Counts.ReceivedPending != 0 {
		t.Fatalf("做完之后 received_pending 应当为 0，实际 %d", after.Counts.ReceivedPending)
	}
}

func TestNudgeDeletePermissions(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)

	const sender, receiver, stranger = 921, 922, 923
	seedNudgeUsers(t, sender, receiver, stranger)

	rec := nudgeRequest(t, handleCreateNudge(appDB), sender, http.MethodPost,
		`{"to_user_id":922,"content":"删删看"}`, nil)
	created := nudgeData[NudgeDTO](t, rec)

	// 不相干的第三者删不掉、也看不到
	rec = nudgeRequest(t, handleDeleteNudge(appDB), stranger, http.MethodDelete, "", nudgeIDParam(created.ID))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("第三者删除应当 404，实际 %d", rec.Code)
	}
	var alive int64
	if err := appDB.Model(&Nudge{}).Where("id = ?", created.ID).Count(&alive).Error; err != nil {
		t.Fatal(err)
	}
	if alive != 1 {
		t.Fatal("第三者不该删掉这条提醒")
	}

	// 发起人可以在对方做完之前撤回
	rec = nudgeRequest(t, handleDeleteNudge(appDB), sender, http.MethodDelete, "", nudgeIDParam(created.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("发起人撤回失败：%d（%s）", rec.Code, rec.Body.String())
	}
	if err := appDB.Model(&Nudge{}).Where("id = ?", created.ID).Count(&alive).Error; err != nil {
		t.Fatal(err)
	}
	if alive != 0 {
		t.Fatal("撤回后不该还在")
	}

	// 对方做完之后发起人不能撤回，但接收人自己可以删掉那一侧
	rec = nudgeRequest(t, handleCreateNudge(appDB), sender, http.MethodPost,
		`{"to_user_id":922,"content":"做完了再删"}`, nil)
	second := nudgeData[NudgeDTO](t, rec)
	if rec := nudgeRequest(t, handleDoneNudge(appDB), receiver, http.MethodPost, "", nudgeIDParam(second.ID)); rec.Code != http.StatusOK {
		t.Fatalf("接收人完成失败：%d", rec.Code)
	}
	rec = nudgeRequest(t, handleDeleteNudge(appDB), sender, http.MethodDelete, "", nudgeIDParam(second.ID))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("对方已完成时发起人撤回应当 400，实际 %d", rec.Code)
	}
	rec = nudgeRequest(t, handleDeleteNudge(appDB), receiver, http.MethodDelete, "", nudgeIDParam(second.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("接收人删除自己那一侧应当 200，实际 %d", rec.Code)
	}
}

// 可选提醒对象：只列状态正常的账号，而且不包含自己。
func TestNudgeUsersExcludesSelf(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)

	const me, mate, disabled = 931, 932, 933
	seedNudgeUsers(t, me, mate, disabled)
	if err := appDB.Model(&database.User{}).Where("id = ?", disabled).Update("status", 0).Error; err != nil {
		t.Fatal(err)
	}

	rec := nudgeRequest(t, handleNudgeUsers(appDB), me, http.MethodGet, "", nil)
	users := nudgeData[[]NudgeUser](t, rec)
	if len(users) != 1 || users[0].ID != mate {
		t.Fatalf("应当只列出未停用的别人（%d），实际 %+v", mate, users)
	}
}

// 「提醒@他」从系统偏好挪到个人偏好后：关掉的人既不进 @ 列表，也不能被直接发。
func TestNudgeHonoursPersonalSwitch(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)

	const me, mate, quiet = 941, 942, 943
	seedNudgeUsers(t, me, mate, quiet)
	if err := sysconfig.UpdateConfig(appDB, "nudge_enabled", "false", quiet); err != nil {
		t.Fatal(err)
	}

	rec := nudgeRequest(t, handleNudgeUsers(appDB), me, http.MethodGet, "", nil)
	users := nudgeData[[]NudgeUser](t, rec)
	if len(users) != 1 || users[0].ID != mate {
		t.Fatalf("关掉「提醒@他」的人不该出现在名单里（只剩 %d），实际 %+v", mate, users)
	}

	body := `{"to_user_id":943,"content":"关掉的人不该收到"}`
	rec = nudgeRequest(t, handleCreateNudge(appDB), me, http.MethodPost, body, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("给关掉的人发提醒应当 400，实际 %d %s", rec.Code, rec.Body.String())
	}
}

// 「提醒消息归到智能清单显示统计中」：/summary 里要有 nudge_pending，
// 而且是**只算别人提醒我、我还没做完**的那些。
func TestNudgeCountsInSummaryStats(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	gin.SetMode(gin.TestMode)

	const me, mate = 941, 942
	seedNudgeUsers(t, me, mate)

	send := func(from, to uint, content string) uint {
		rec := nudgeRequest(t, handleCreateNudge(appDB), from, http.MethodPost,
			`{"to_user_id":`+strconv.FormatUint(uint64(to), 10)+`,"content":"`+content+`"}`, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("发送失败：%d（%s）", rec.Code, rec.Body.String())
		}
		return nudgeData[NudgeDTO](t, rec).ID
	}
	// 别人提醒我两条，我提醒别人一条（后者不该进我的待办角标）
	send(mate, me, "第一条")
	doneID := send(mate, me, "第二条")
	send(me, mate, "我提醒他的")

	summary := func(userID uint) int64 {
		rec := nudgeRequest(t, handleSummary(appDB), userID, http.MethodGet, "", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("/summary 失败：%d（%s）", rec.Code, rec.Body.String())
		}
		data := nudgeData[map[string]any](t, rec)
		value, ok := data["nudge_pending"]
		if !ok {
			t.Fatalf("/summary 里应当有 nudge_pending：%+v", data)
		}
		number, _ := value.(float64)
		return int64(number)
	}

	if got := summary(me); got != 2 {
		t.Fatalf("「别人提醒我」两条未完成，nudge_pending 应为 2，实际 %d", got)
	}
	// 我提醒别人的那条不该算在我头上；对 mate 来说则是 1 条待办
	if got := summary(mate); got != 1 {
		t.Fatalf("mate 的 nudge_pending 应为 1，实际 %d", got)
	}

	if rec := nudgeRequest(t, handleDoneNudge(appDB), me, http.MethodPost, "", nudgeIDParam(doneID)); rec.Code != http.StatusOK {
		t.Fatalf("完成失败：%d", rec.Code)
	}
	if got := summary(me); got != 1 {
		t.Fatalf("完成一条后 nudge_pending 应为 1，实际 %d", got)
	}
}
