package config

import (
	"os"
	"path/filepath"
	"testing"
)

// 改库文件名不能让人丢数据：老库存在、新库不存在时必须自动改名过来。
func TestMigrateLegacyDBFileRenamesOldDatabase(t *testing.T) {
	dir := t.TempDir()
	dbDir := filepath.Join(dir, "db")
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(dbDir, legacyDBFileName)
	target := filepath.Join(dbDir, dbFileName)

	if err := os.WriteFile(legacy, []byte("legacy-data"), 0o600); err != nil {
		t.Fatal(err)
	}
	// 顺带验证 -wal/-shm 也会跟着搬
	if err := os.WriteFile(legacy+"-wal", []byte("wal"), 0o600); err != nil {
		t.Fatal(err)
	}

	migrateLegacyDBFile(target)

	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatal("老库文件应已被改名，不应还在")
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("新库文件不存在: %v", err)
	}
	if string(got) != "legacy-data" {
		t.Fatalf("新库内容 = %q，应原样保留", got)
	}
	if _, err := os.Stat(target + "-wal"); err != nil {
		t.Fatal("-wal 应跟着一起改名")
	}
}

// 新库已存在时不许动它（更不能拿老库去覆盖）
func TestMigrateLegacyDBFileKeepsExistingNewDatabase(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, dbFileName)
	legacy := filepath.Join(dir, legacyDBFileName)
	if err := os.WriteFile(target, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}

	migrateLegacyDBFile(target)

	if got, _ := os.ReadFile(target); string(got) != "new" {
		t.Fatalf("新库被改动了: %q", got)
	}
	if _, err := os.Stat(legacy); err != nil {
		t.Fatal("老库不该被删或改名（新库已存在时应原样不动）")
	}
}

// 全新安装：两个文件都没有，不应报错也不应造文件
func TestMigrateLegacyDBFileOnFreshInstall(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, dbFileName)
	migrateLegacyDBFile(target)
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("全新安装时不该凭空造出库文件")
	}
}

// 默认路径已经用上项目名，不再是上游的 reminder.db
func TestDefaultDBFileNameIsProjectName(t *testing.T) {
	if dbFileName != "workordernote.db" {
		t.Fatalf("默认库文件名 = %q，应为 workordernote.db", dbFileName)
	}
	if legacyDBFileName != "reminder.db" {
		t.Fatalf("老库文件名 = %q，应为 reminder.db", legacyDBFileName)
	}
}
