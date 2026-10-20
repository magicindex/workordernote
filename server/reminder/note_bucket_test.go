package reminder

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"smallgo/server/database"
	"smallgo/server/sysconfig"
)

// listListsAPI 直接调 handleListLists，返回这一用户的清单列表（绕开鉴权中间件）。
func listListsAPI(t *testing.T, userID uint) []ListDTO {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/reminder/lists", nil)
	ctx.Set("userID", userID)
	handleListLists(appDB)(ctx)
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET lists 应 200，实际 %d：%s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Data []ListDTO `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析响应失败：%v（%s）", err, recorder.Body.String())
	}
	return body.Data
}

// 老数据里的记事本行（默认清单图标 book）在打开侧栏时就要被纠正成笔记本图标：
// 否则用户升级后看到的还是原来的图标，会以为「改了没生效」（0.15.4 上线前踩到过）。
func TestStaleNoteBucketIconHealedOnListLists(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshNoteFeature(t)

	const userID = 98
	stale := List{
		UserID: userID, Name: "旧记事本", Color: noteBucketListColor,
		Icon: "book", Template: listTemplateNote, Position: 9,
	}
	if err := appDB.Create(&stale).Error; err != nil {
		t.Fatal(err)
	}
	other := List{UserID: userID, Name: "自己的清单", Icon: "star", Position: 1}
	if err := appDB.Create(&other).Error; err != nil {
		t.Fatal(err)
	}

	rows := listListsAPI(t, userID)
	var note *ListDTO
	for i := range rows {
		if rows[i].Template == listTemplateNote {
			note = &rows[i]
		}
		if rows[i].Name == "自己的清单" && rows[i].Icon != "star" {
			t.Fatalf("普通清单的图标被改动了：%q", rows[i].Icon)
		}
	}
	if note == nil {
		t.Fatal("侧栏里应能看到记事本栏目")
	}
	if note.Icon != noteBucketIcon {
		t.Fatalf("记事本图标应纠正为 %q，实际 %q", noteBucketIcon, note.Icon)
	}
	if note.Name != noteBucketListName {
		t.Fatalf("记事本名字应纠正为 %q，实际 %q", noteBucketListName, note.Name)
	}
	if note.ID != stale.ID {
		t.Fatalf("应复用原来那一行（%d），实际返回 %d", stale.ID, note.ID)
	}

	// 落库了，下次请求才是稳定态（不重复写）。
	var after List
	if err := appDB.Where("id = ?", stale.ID).First(&after).Error; err != nil {
		t.Fatal(err)
	}
	if after.Icon != noteBucketIcon || after.Name != noteBucketListName {
		t.Fatalf("纠正结果没有落库：%+v", after)
	}
	var count int64
	if err := appDB.Model(&List{}).Where("user_id = ? AND template = ? AND deleted_at IS NULL", userID, listTemplateNote).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("记事本栏目应仍只有 1 条，实际 %d", count)
	}
	// 第二次请求：值已经对了，再取一次也必须一致。
	for _, r := range listListsAPI(t, userID) {
		if r.Template == listTemplateNote && (r.Icon != noteBucketIcon || r.Name != noteBucketListName) {
			t.Fatalf("第二次请求的记事本栏目不对：%+v", r)
		}
	}
}

// 把 notebook feature 缓存关掉：测试里会反复改这个开关，不能让 2 秒缓存影响断言。
func withFreshNoteFeature(t *testing.T) {
	t.Helper()
	old := noteFeatureCache
	noteFeatureCache = 0
	resetNoteFeatureCache()
	t.Cleanup(func() {
		noteFeatureCache = old
		resetNoteFeatureCache()
	})
}

// setNoteFeature 改**某个用户自己的**偏好（记事本栏目是个人开关，注册表默认开）。
func setNoteFeature(t *testing.T, userID uint, on bool) {
	t.Helper()
	value := "true"
	if !on {
		value = "false"
	}
	if err := sysconfig.UpdateConfig(appDB, "notebook_enabled", value, userID); err != nil {
		t.Fatal(err)
	}
	resetNoteFeatureCache()
}

// 「记事本」是一个固定栏目：自动建一次、重复调用不会建第二条，删掉也能找回来。
func TestNoteBucketCreatedOnce(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshNoteFeature(t)

	first, err := ensureNoteBucket(appDB, 51)
	if err != nil {
		t.Fatal(err)
	}
	if first.Name != noteBucketListName || first.Template != listTemplateNote {
		t.Fatalf("记事本清单不对：%+v", first)
	}
	second, err := ensureNoteBucket(appDB, 51)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("重复调用不应新建第二条：%d vs %d", first.ID, second.ID)
	}
	var count int64
	if err := appDB.Model(&List{}).Where("user_id = ? AND template = ?", 51, listTemplateNote).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("记事本清单应只有一条，实际 %d", count)
	}

	// 用户自己把它删掉后，再调应该找回同一条，而不是又建一条同名的。
	now := time.Now()
	if err := appDB.Model(&List{}).Where("id = ?", first.ID).Update("deleted_at", now).Error; err != nil {
		t.Fatal(err)
	}
	again, err := ensureNoteBucket(appDB, 51)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != first.ID {
		t.Fatalf("应找回被删掉的记事本清单：%d vs %d", again.ID, first.ID)
	}
}

// 记事一律落到记事本栏目；任务仍然落到默认清单。记事本按创建时间倒序。
func TestNoteLandsInNotebookBucketAndSortsByCreatedDesc(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshNoteFeature(t)

	const userID = 52
	task, err := createReminder(appDB, userID, SaveReminderInput{Title: "普通任务"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := ensureNoteBucket(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	if task.ListID == bucket.ID {
		t.Fatal("任务不该落到记事本栏目")
	}

	older, err := createReminder(appDB, userID, SaveReminderInput{Title: "早的一条记事", Kind: KindNote})
	if err != nil {
		t.Fatal(err)
	}
	newer, err := createReminder(appDB, userID, SaveReminderInput{Title: "晚的一条记事", Kind: KindNote})
	if err != nil {
		t.Fatal(err)
	}
	for _, note := range []ReminderDTO{older, newer} {
		if note.ListID != bucket.ID {
			t.Fatalf("记事应落到记事本栏目 %d，实际 %d", bucket.ID, note.ListID)
		}
	}

	// 把两条记事的记录时间拉开，断言记事本按时间倒序（最新的在最上面）。
	if err := appDB.Model(&Reminder{}).Where("id = ?", older.ID).
		UpdateColumn("completed_at", time.Now().Add(-2*time.Hour)).Error; err != nil {
		t.Fatal(err)
	}

	rows, err := listReminders(appDB, userID, "all", "", []uint{bucket.ID}, true, "", "", "created_desc")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("记事本应有 2 条记事，实际 %d", len(rows))
	}
	if rows[0].ID != newer.ID || rows[1].ID != older.ID {
		t.Fatalf("记事本应按创建时间倒序，实际 %d, %d", rows[0].ID, rows[1].ID)
	}

	// 「全部 / 已完成」智能清单照常显示这些记事（记事创建即完成）。
	all, err := listReminders(appDB, userID, "all", "", nil, true, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[uint]bool{}
	for _, r := range all {
		seen[r.ID] = true
	}
	if !seen[older.ID] || !seen[newer.ID] {
		t.Fatalf("「全部」应仍能看到记事：%v", all)
	}
}

// 记事本栏目是个人偏好：默认开；显式关掉后读取为关。
func TestNotebookFeatureDefaultsOnAndUserOverrideWins(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()
	withFreshNoteFeature(t)

	const userID = 53
	// 没写过这一行 → 用注册表默认值 true。
	if !notebookFeatureEnabled(appDB, userID) {
		t.Fatal("notebook_enabled 注册表默认应为开")
	}
	// 用户显式关掉 → 他自己的 false 必须生效（改注册表默认值不影响显式行）。
	setNoteFeature(t, userID, false)
	if notebookFeatureEnabled(appDB, userID) {
		t.Fatal("用户显式关掉后不应再认为是开的")
	}
	// 显式打开 → 生效。
	setNoteFeature(t, userID, true)
	if !notebookFeatureEnabled(appDB, userID) {
		t.Fatal("用户显式打开后应为开")
	}
}

// from/to（含起不含止）是 month 泛化后的窗口：只有窗口内的条目会被列出。
func TestListRemindersFromToWindow(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 54
	base := time.Date(2026, 3, 10, 10, 0, 0, 0, shanghai())
	inside := base.AddDate(0, 0, 2)
	outside := base.AddDate(0, 1, 0)
	for _, tc := range []struct {
		title string
		due   time.Time
	}{{"窗口内", inside}, {"窗口外", outside}} {
		due := tc.due
		if _, err := createReminder(appDB, userID, SaveReminderInput{
			Title: tc.title, DueAt: &due, RepeatRule: "none",
		}); err != nil {
			t.Fatal(err)
		}
	}

	rows, err := listReminders(appDB, userID, "all", "", nil, false, "2026-03-10", "2026-04-01", "")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, r := range rows {
		got[r.Title] = true
	}
	if !got["窗口内"] || got["窗口外"] {
		t.Fatalf("from/to 窗口筛选不对：%v", got)
	}

	// month 兼容换算出的窗口应与手写 from/to 等价。
	from, to := monthWindow("2026-03")
	if from != "2026-03-01" || to != "2026-04-01" {
		t.Fatalf("monthWindow(2026-03) = %q,%q", from, to)
	}
}

// 记事本栏目经同步到对端后必须仍然是「记事本栏目」模板，否则对端按模板查不到它、
// 会各自再建一个，两边都出现重复的记事本（0.15.0 上线后实际踩到过）。
func TestNotebookTemplateSurvivesSync(t *testing.T) {
	withShanghaiLocal(t)
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	seedUser(t, dbB, "王耀辉", "admin")

	bucket, err := ensureNoteBucket(dbA, userA.ID)
	if err != nil {
		t.Fatal(err)
	}
	if bucket.Template != listTemplateNote {
		t.Fatalf("本机记事本栏目模板应为 %q，实际 %q", listTemplateNote, bucket.Template)
	}
	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, snap); err != nil {
		t.Fatal(err)
	}
	// 对端拿到的那条必须仍是 notebook 模板，且对端 ensureNoteBucket 复用它（不新建）
	var inB List
	if err := dbB.Where("name = ?", noteBucketListName).First(&inB).Error; err != nil {
		t.Fatal(err)
	}
	if inB.Template != listTemplateNote {
		t.Fatalf("同步到对端后模板退化成 %q（应为 %q）", inB.Template, listTemplateNote)
	}
	var userB database.User
	if err := dbB.Where("username = ?", "王耀辉").First(&userB).Error; err != nil {
		t.Fatal(err)
	}
	again, err := ensureNoteBucket(dbB, userB.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != inB.ID {
		t.Fatalf("对端又建了一个记事本（%d vs %d）", again.ID, inB.ID)
	}
	var count int64
	if err := dbB.Model(&List{}).Where("name = ? AND deleted_at IS NULL", noteBucketListName).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("对端应只有 1 个记事本栏目，实际 %d 个", count)
	}
}

// 同步过来的记事也落到**本机**的记事本栏目，并且不改变时间与内容。
func TestSyncedNoteLandsInLocalNotebook(t *testing.T) {
	withShanghaiLocal(t)
	dbA, dbB := newSyncDB(t), newSyncDB(t)
	userA := seedUser(t, dbA, "王耀辉", "admin")
	seedUser(t, dbB, "王耀辉", "admin")

	// A 上先有一条普通清单，记事被创建时就归到了记事本栏目；这里强行把它挪回普通清单，
	// 模拟「历史上记在别的清单里的记事」，再同步给 B。
	plain, err := ensureDefaultList(dbA, userA.ID)
	if err != nil {
		t.Fatal(err)
	}
	created, err := createReminder(dbA, userA.ID, SaveReminderInput{Title: "旧记事", Kind: KindNote, RepeatRule: "none"})
	if err != nil {
		t.Fatal(err)
	}
	if err := dbA.Model(&Reminder{}).Where("id = ?", created.ID).Update("list_id", plain.ID).Error; err != nil {
		t.Fatal(err)
	}
	var before Reminder
	if err := dbA.Where("id = ?", created.ID).First(&before).Error; err != nil {
		t.Fatal(err)
	}

	snap, err := buildSyncSnapshot(dbA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applySyncSnapshot(dbB, snap); err != nil {
		t.Fatal(err)
	}
	var inB Reminder
	if err := dbB.Where("title = ?", "旧记事").First(&inB).Error; err != nil {
		t.Fatal(err)
	}
	var bucketB List
	if err := dbB.Where("template = ? AND deleted_at IS NULL", listTemplateNote).First(&bucketB).Error; err != nil {
		t.Fatal(err)
	}
	if inB.ListID != bucketB.ID {
		t.Fatalf("同步到对端的记事应落在对端记事本栏目（%d），实际 %d", bucketB.ID, inB.ListID)
	}
	if !inB.CompletedAt.Equal(*before.CompletedAt) || inB.Title != before.Title {
		t.Fatalf("记事的时间/内容被改了：%+v vs %+v", inB.CompletedAt, before.CompletedAt)
	}
}

// 迁移：历史记事（散落在普通清单里）全部归入记事本栏目，时间与内容不变。
func TestMoveNotesIntoNotebookMigration(t *testing.T) {
	withShanghaiLocal(t)
	cleanup := testDB(t)
	defer cleanup()

	const userID = 97
	plain, err := ensureDefaultList(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	note, err := createReminder(appDB, userID, SaveReminderInput{Title: "历史记事", Kind: KindNote, RepeatRule: "none"})
	if err != nil {
		t.Fatal(err)
	}
	// 手动挪回普通清单，模拟迁移前的状态
	oldCompleted := note.CompletedAt
	if err := appDB.Model(&Reminder{}).Where("id = ?", note.ID).Update("list_id", plain.ID).Error; err != nil {
		t.Fatal(err)
	}
	// 跑一次与注册表里同名同逻辑的迁移
	var ids []uint
	if err := appDB.Model(&Reminder{}).Where("kind = ? AND deleted_at IS NULL", KindNote).Distinct().Pluck("user_id", &ids).Error; err != nil {
		t.Fatal(err)
	}
	for _, uid := range ids {
		bucket, err := ensureNoteBucket(appDB, uid)
		if err != nil {
			t.Fatal(err)
		}
		if err := appDB.Model(&Reminder{}).
			Where("user_id = ? AND kind = ? AND deleted_at IS NULL AND list_id <> ?", uid, KindNote, bucket.ID).
			Update("list_id", bucket.ID).Error; err != nil {
			t.Fatal(err)
		}
	}
	var after Reminder
	if err := appDB.Where("id = ?", note.ID).First(&after).Error; err != nil {
		t.Fatal(err)
	}
	bucket, err := ensureNoteBucket(appDB, userID)
	if err != nil {
		t.Fatal(err)
	}
	if after.ListID != bucket.ID {
		t.Fatalf("历史记事应归入记事本栏目 %d，实际 %d", bucket.ID, after.ListID)
	}
	if after.Title != "历史记事" || !after.CompletedAt.Equal(*oldCompleted) {
		t.Fatalf("迁移不该改动内容与时间：%q / %v", after.Title, after.CompletedAt)
	}
}
