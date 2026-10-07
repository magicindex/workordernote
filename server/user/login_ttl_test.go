package user

import (
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"smallgo/server/database"
	"smallgo/server/sysconfig"
)

func newTTLTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared&_loc=Local"), &gorm.Config{})
	if err != nil {
		t.Fatalf("打开内存库失败：%v", err)
	}
	if err := db.AutoMigrate(&database.SystemConfig{}); err != nil {
		t.Fatalf("建表失败：%v", err)
	}
	return db
}

// 记住登录按天、不记住按小时；两个都能在后台改，改完立刻生效。
func TestLoginTokenTTLUsesConfig(t *testing.T) {
	// 这两个键由 sysconfig 包在 init 里注册好了，这里直接用，别再注册一次（会 panic）
	db := newTTLTestDB(t)

	if got := loginTokenTTL(db, true); got != 7*24*time.Hour {
		t.Fatalf("记住登录默认应为 7 天，实际 %v", got)
	}
	if got := loginTokenTTL(db, false); got != 12*time.Hour {
		t.Fatalf("不记住默认应为 12 小时，实际 %v", got)
	}

	if err := sysconfig.UpdateConfig(db, "login_remember_days", "30", 0); err != nil {
		t.Fatalf("写配置失败：%v", err)
	}
	if err := sysconfig.UpdateConfig(db, "login_session_hours", "3", 0); err != nil {
		t.Fatalf("写配置失败：%v", err)
	}
	if got := loginTokenTTL(db, true); got != 30*24*time.Hour {
		t.Fatalf("改配置后记住登录应为 30 天，实际 %v", got)
	}
	if got := loginTokenTTL(db, false); got != 3*time.Hour {
		t.Fatalf("改配置后不记住应为 3 小时，实际 %v", got)
	}
}

// 配置被写坏（非数字、0、负数、超大）时退回默认值，不能让登录失败。
func TestLoginTokenTTLFallsBackOnBadValue(t *testing.T) {
	db := newTTLTestDB(t)
	for _, bad := range []string{"abc", "0", "-5", "999999"} {
		if err := sysconfig.UpdateConfig(db, "login_remember_days", bad, 0); err != nil {
			t.Fatalf("写配置失败：%v", err)
		}
		if got := loginTokenTTL(db, true); got != 7*24*time.Hour {
			t.Fatalf("配置为 %q 时应退回 7 天，实际 %v", bad, got)
		}
	}
}
