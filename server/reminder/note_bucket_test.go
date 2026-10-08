package reminder

import (
	"testing"
	"time"

	"smallgo/server/sysconfig"
)

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
