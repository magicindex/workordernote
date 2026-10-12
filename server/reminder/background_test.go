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
