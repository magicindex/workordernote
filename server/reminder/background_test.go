package reminder

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// 背景图取值的白名单/黑名单：只认空、preset:<slug>、本机上传出来的 /uploads/ 路径。
func TestValidateBackground(t *testing.T) {
	good := []string{
		"",
		"preset:birthday",
		"preset:mid-autumn",
		"/uploads/2026/10/13/6f1c0f2e-1.jpg",
	}
	for _, value := range good {
		if err := validateBackground(value); err != nil {
			t.Fatalf("%q 应该被接受：%v", value, err)
		}
	}
	bad := []string{
		"preset:",
		"preset:Birthday",             // 大写
		"preset:生日",                  // 非 ASCII
		"preset:with space",           // 空格
		"preset:" + string(make([]byte, 40)),
		"/uploads/../../etc/passwd",   // 越界
		"/etc/passwd",
		"uploads/2026/10/13/x.jpg",    // 少了前导斜杠
		"javascript:alert(1)",
		"http://example.com/x.jpg",
	}
	for _, value := range bad {
		if err := validateBackground(value); err == nil {
			t.Fatalf("%q 不该被接受", value)
		}
	}
}

// 上传的图片：卡片删了要跟着删；还被别的卡片引用时不能删；越界路径一律不碰。
func TestCleanupUploadedBackground(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	dir := t.TempDir()
	SetUploadDir(dir)
	defer SetUploadDir("")

	rel := "/uploads/2026/10/13/pic.jpg"
	full := filepath.Join(dir, "2026", "10", "13", "pic.jpg")
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("fake-image"), 0o644); err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	const userID = 331
	first := Reminder{UserID: userID, ListID: 1, Title: "带图卡片", Background: rel}
	if err := appDB.Create(&first).Error; err != nil {
		t.Fatal(err)
	}

	// 还有一张未删除的卡片引用着它 → 不能删
	cleanupUploadedBackground(appDB, rel, 0)
	if _, err := os.Stat(full); err != nil {
		t.Fatalf("仍被引用的图片不该被删：%v", err)
	}

	// 第二张卡片也引用它：删掉第一张后文件仍要在
	second := Reminder{UserID: userID, ListID: 1, Title: "也带这张图", Background: rel}
	if err := appDB.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	if err := appDB.Model(&Reminder{}).Where("id = ?", first.ID).Update("deleted_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	cleanupUploadedBackground(appDB, rel, first.ID)
	if _, err := os.Stat(full); err != nil {
		t.Fatalf("还有另一张卡片引用时不该删：%v", err)
	}

	// 两张都删掉 → 文件回收
	if err := appDB.Model(&Reminder{}).Where("id = ?", second.ID).Update("deleted_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	cleanupUploadedBackground(appDB, rel, second.ID)
	if _, err := os.Stat(full); !os.IsNotExist(err) {
		t.Fatalf("没人引用后应删掉，实际 err=%v", err)
	}

	// 内置主题图没有文件，清理函数直接放过（不会报错、也不会去碰别的文件）
	cleanupUploadedBackground(appDB, "preset:birthday", 0)

	// 越界路径（手改数据库塞进来的）绝不落到上传目录之外
	outside := filepath.Join(dir, "..", "keep-me.txt")
	if err := os.WriteFile(outside, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	cleanupUploadedBackground(appDB, "/uploads/../keep-me.txt", 0)
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("越界路径不该被删：%v", err)
	}
}

// 卡片删除接口真的会顺带清掉上传的背景图（端到端走一遍 deleteReminder）。
func TestDeleteReminderCleansBackgroundFile(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	dir := t.TempDir()
	SetUploadDir(dir)
	defer SetUploadDir("")

	rel := "/uploads/2026/10/13/card.jpg"
	full := filepath.Join(dir, "2026", "10", "13", "card.jpg")
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("fake-image"), 0o644); err != nil {
		t.Fatal(err)
	}

	const userID = 332
	row := Reminder{UserID: userID, ListID: 1, Title: "仪式感卡片", Background: rel}
	if err := appDB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := deleteReminder(appDB, userID, row.ID); err != nil {
		t.Fatalf("删除失败：%v", err)
	}
	if _, err := os.Stat(full); !os.IsNotExist(err) {
		t.Fatalf("卡片删除后背景图应被清理，实际 err=%v", err)
	}
}

// 背景蒙板两个指标的默认值与范围（用户 2026-10-13 要求「可调整虚化、透明度」）：
// 不传 → 虚化 0 / 透明度 45；超范围一律拒绝；更新时缺省表示「不改」。
func TestBackgroundMaskDefaultsAndRanges(t *testing.T) {
	cleanup := testDB(t)
	defer cleanup()

	const userID = 341
	bg := "preset:birthday"
	due := time.Now().Add(time.Hour)
	created, err := createReminder(appDB, userID, SaveReminderInput{
		Title: "蒙板默认值", Kind: KindTask, DueAt: &due, RepeatRule: "none", Background: &bg,
	})
	if err != nil {
		t.Fatalf("建卡片失败：%v", err)
	}
	if created.BgBlur != 0 || created.BgMask != defaultBgMask {
		t.Fatalf("没传蒙板时应是 blur=0 / mask=%d，实际 %d / %d", defaultBgMask, created.BgBlur, created.BgMask)
	}

	// 显式传值
	blur, mask := 8, 20
	updated, err := updateReminder(appDB, userID, created.ID, SaveReminderInput{
		Title: created.Title, Kind: KindTask, ListID: created.ListID,
		DueAt: created.DueAt, RepeatRule: "none", Version: created.Version,
		BgBlur: &blur, BgMask: &mask,
	})
	if err != nil {
		t.Fatalf("更新失败：%v", err)
	}
	if updated.BgBlur != 8 || updated.BgMask != 20 {
		t.Fatalf("虚化/透明度没落库：%d / %d", updated.BgBlur, updated.BgMask)
	}

	// 缺省 = 不改
	kept, err := updateReminder(appDB, userID, created.ID, SaveReminderInput{
		Title: created.Title, Kind: KindTask, ListID: created.ListID,
		DueAt: created.DueAt, RepeatRule: "none", Version: updated.Version,
	})
	if err != nil {
		t.Fatalf("更新失败：%v", err)
	}
	if kept.BgBlur != 8 || kept.BgMask != 20 {
		t.Fatalf("没传蒙板时应保持原值，实际 %d / %d", kept.BgBlur, kept.BgMask)
	}

	// 超范围拒绝
	blurTooBig, maskTooBig, negative := maxBgBlur+1, 101, -1
	cases := []struct {
		name string
		in   SaveReminderInput
	}{
		{"虚化过大", SaveReminderInput{Title: "x", Kind: KindTask, DueAt: &due, RepeatRule: "none", BgBlur: &blurTooBig}},
		{"虚化为负", SaveReminderInput{Title: "x", Kind: KindTask, DueAt: &due, RepeatRule: "none", BgBlur: &negative}},
		{"透明度过大", SaveReminderInput{Title: "x", Kind: KindTask, DueAt: &due, RepeatRule: "none", BgMask: &maskTooBig}},
		{"透明度为负", SaveReminderInput{Title: "x", Kind: KindTask, DueAt: &due, RepeatRule: "none", BgMask: &negative}},
	}
	for _, c := range cases {
		if _, err := createReminder(appDB, userID, c.in); err == nil {
			t.Fatalf("%s 应该被拒绝", c.name)
		}
	}
}
