package stats

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

func TestEndpointEnvOverride(t *testing.T) {
	t.Setenv("STATS_ENDPOINT", "http://127.0.0.1:1/fake")
	if got := Endpoint(); got != "http://127.0.0.1:1/fake" {
		t.Fatalf("Endpoint() = %q, want env override", got)
	}
	os.Unsetenv("STATS_ENDPOINT")
	if got := Endpoint(); got != "https://techfunway.wycto.cn/api/apps.online/refresh" {
		t.Fatalf("Endpoint() default = %q", got)
	}
}

func TestDeviceIDIsHashedAndStable(t *testing.T) {
	dir := t.TempDir()
	a := DeviceID("testapp", dir)
	b := DeviceID("testapp", dir)
	if a != b {
		t.Fatalf("DeviceID not stable: %q vs %q", a, b)
	}
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(a) {
		t.Fatalf("DeviceID = %q, want 32-hex md5", a)
	}
	if DeviceID("otherapp", dir) == a {
		t.Fatalf("different app names must not share device id")
	}
}

func TestPersistentDeviceIDReused(t *testing.T) {
	dir := t.TempDir()
	first := persistentDeviceID(dir)
	if first == "" {
		t.Fatal("persistentDeviceID returned empty")
	}
	if _, err := os.Stat(filepath.Join(dir, "device.id")); err != nil {
		t.Fatalf("device.id not persisted: %v", err)
	}
	if second := persistentDeviceID(dir); second != first {
		t.Fatalf("persistent id changed: %q vs %q", first, second)
	}
}

