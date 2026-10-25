package backup

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"smallgo/server/config"
	"smallgo/server/database"
	"smallgo/server/sysconfig"
)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	dir := t.TempDir()
	db, err := database.InitDB(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("init db: %v", err)
	}
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := sysconfig.InitDefaultConfigs(db); err != nil {
		t.Fatalf("init configs: %v", err)
	}
	t.Cleanup(func() { database.CloseDB(db) })
	return db
}

func TestCreateArchiveIncludesDatabaseAndUploads(t *testing.T) {
	db := testDB(t)
	if err := db.Exec("CREATE TABLE demo (id INTEGER PRIMARY KEY, name TEXT)").Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	if err := db.Exec("INSERT INTO demo (name) VALUES ('备份测试')").Error; err != nil {
		t.Fatalf("insert: %v", err)
	}

	dir := t.TempDir()
	appCfg = config.Config{DataDir: dir, DBPath: filepath.Join(dir, "db", "workordernote.db"), UploadDir: filepath.Join(dir, "uploads")}
	os.MkdirAll(filepath.Join(appCfg.UploadDir, "ceremony"), 0o755)
	os.WriteFile(filepath.Join(appCfg.UploadDir, "ceremony", "a.png"), []byte("PNG-DATA"), 0o644)

	dest := filepath.Join(dir, "backup.tar.gz")
	size, err := createArchive(db, dest, time.Date(2026, 10, 20, 3, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatalf("createArchive: %v", err)
	}
	if size <= 0 {
		t.Fatalf("size = %d", size)
	}

	f, err := os.Open(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(gz)
	got := map[string]string{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(tr)
		got[h.Name] = string(body)
	}
	for _, want := range []string{"manifest.json", "db/workordernote.db", "uploads/ceremony/a.png"} {
		if _, ok := got[want]; !ok {
			t.Fatalf("archive missing %q, got %v", want, keys(got))
		}
	}
	if got["uploads/ceremony/a.png"] != "PNG-DATA" {
		t.Fatalf("upload content = %q", got["uploads/ceremony/a.png"])
	}
	if !strings.Contains(got["manifest.json"], `"database": "db/workordernote.db"`) {
		t.Fatalf("manifest = %s", got["manifest.json"])
	}
}

func TestPruneLocalKeepsNewestOnly(t *testing.T) {
	dir := t.TempDir()
	names := []string{
		filePrefix + "20261018-030000.tar.gz",
		filePrefix + "20261019-030000.tar.gz",
		filePrefix + "20261020-030000.tar.gz",
		"unrelated.txt",
	}
	for _, name := range names {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	pruneLocal(dir, 2)
	left, _ := os.ReadDir(dir)
	if len(left) != 3 { // 最新的两份 + unrelated.txt
		t.Fatalf("left %d files", len(left))
	}
	for _, entry := range left {
		if entry.Name() == names[0] {
			t.Fatalf("oldest backup should be removed")
		}
	}
}

func TestWebDAVUploadAndPrune(t *testing.T) {
	db := testDB(t)
	var putPath, putAuth, putBody string
	var deleted []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "MKCOL":
			w.WriteHeader(http.StatusCreated)
		case http.MethodPut:
			body, _ := io.ReadAll(r.Body)
			putPath, putAuth, putBody = r.URL.Path, r.Header.Get("Authorization"), string(body)
			w.WriteHeader(http.StatusCreated)
		case "PROPFIND":
			w.WriteHeader(207)
			var b strings.Builder
			b.WriteString(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">`)
			for _, n := range []string{
				filePrefix + "20261015-030000.tar.gz",
				filePrefix + "20261016-030000.tar.gz",
				filePrefix + "20261017-030000.tar.gz",
			} {
				fmt.Fprintf(&b, `<d:response><d:href>/dav/wb/%s</d:href></d:response>`, n)
			}
			b.WriteString(`</d:multistatus>`)
			io.WriteString(w, b.String())
		case http.MethodDelete:
			deleted = append(deleted, r.URL.Path)
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer srv.Close()

	sysconfig.UpdateConfig(db, "backup_webdav_url", srv.URL+"/dav", 0)
	sysconfig.UpdateConfig(db, "backup_webdav_dir", "wb", 0)
	sysconfig.UpdateConfig(db, "backup_webdav_username", "u", 0)
	sysconfig.UpdateConfig(db, "backup_webdav_password", "p", 0)

	dir := t.TempDir()
	file := filepath.Join(dir, "x.tar.gz")
	os.WriteFile(file, []byte("ARCHIVE"), 0o644)
	remote, err := uploadWebDAV(db, file, "workordernote-backup-20261020-030000.tar.gz")
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if putPath != "/dav/wb/workordernote-backup-20261020-030000.tar.gz" {
		t.Fatalf("put path = %q", putPath)
	}
	if !strings.HasPrefix(putAuth, "Basic ") {
		t.Fatalf("missing basic auth: %q", putAuth)
	}
	if putBody != "ARCHIVE" || !strings.Contains(remote, putPath) {
		t.Fatalf("body/remote = %q / %q", putBody, remote)
	}

	pruneWebDAV(db, 1)
	if len(deleted) != 2 {
		t.Fatalf("deleted = %v", deleted)
	}
	for _, d := range deleted {
		if strings.HasSuffix(d, "20261017-030000.tar.gz") {
			t.Fatalf("newest should be kept: %v", deleted)
		}
	}
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestRestoreReplacesDatabaseAndUploads(t *testing.T) {
	db := testDB(t)
	dir := t.TempDir()
	appCfg = config.Config{
		DataDir:   dir,
		DBPath:    filepath.Join(dir, "db", "workordernote.db"),
		UploadDir: filepath.Join(dir, "uploads"),
	}
	if err := db.Create(&database.User{Username: "admin", Password: "x", Role: "admin", Status: 1}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := db.Exec("CREATE TABLE demo (id INTEGER PRIMARY KEY, name TEXT)").Error; err != nil {
		t.Fatal(err)
	}
	db.Exec("INSERT INTO demo (name) VALUES ('恢复前数据')")
	os.MkdirAll(filepath.Join(appCfg.UploadDir, "ceremony"), 0o755)
	os.WriteFile(filepath.Join(appCfg.UploadDir, "ceremony", "keep.png"), []byte("KEEP"), 0o644)

	if err := os.MkdirAll(localDir(db), 0o755); err != nil {
		t.Fatal(err)
	}
	name := filePrefix + "20261020-030000.tar.gz"
	archive := filepath.Join(localDir(db), name)
	if _, err := createArchive(db, archive, time.Date(2026, 10, 20, 3, 0, 0, 0, time.Local)); err != nil {
		t.Fatalf("createArchive: %v", err)
	}

	// 弄乱当前数据：表没了、图片也换掉，恢复后应回到备份里的状态。
	if err := db.Exec("DROP TABLE demo").Error; err != nil {
		t.Fatal(err)
	}
	os.RemoveAll(appCfg.UploadDir)
	os.MkdirAll(appCfg.UploadDir, 0o755)
	os.WriteFile(filepath.Join(appCfg.UploadDir, "old.txt"), []byte("OLD"), 0o644)

	res, err := RestoreLocal(db, name, time.Date(2026, 10, 21, 4, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatalf("RestoreLocal: %v", err)
	}
	if res.Users != 1 || res.Uploads != 1 {
		t.Fatalf("result users/uploads = %d/%d", res.Users, res.Uploads)
	}
	if !strings.Contains(res.SafetyFile, "before-restore") {
		t.Fatalf("safety = %q", res.SafetyFile)
	}

	var got string
	if err := db.Raw("SELECT name FROM demo WHERE id = 1").Scan(&got).Error; err != nil {
		t.Fatalf("restored demo row: %v", err)
	}
	if got != "恢复前数据" {
		t.Fatalf("demo name = %q", got)
	}
	raw, err := os.ReadFile(filepath.Join(appCfg.UploadDir, "ceremony", "keep.png"))
	if err != nil || string(raw) != "KEEP" {
		t.Fatalf("restored upload = %q, %v", raw, err)
	}
	if _, err := os.Stat(filepath.Join(appCfg.UploadDir, "old.txt")); !os.IsNotExist(err) {
		t.Fatalf("old upload should be gone, err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(localDir(db), res.SafetyFile)); err != nil {
		t.Fatalf("safety backup missing: %v", err)
	}
}

func TestRestoreRejectsPathTraversal(t *testing.T) {
	db := testDB(t)
	dir := t.TempDir()
	appCfg = config.Config{DataDir: dir, DBPath: filepath.Join(dir, "db", "workordernote.db"), UploadDir: filepath.Join(dir, "uploads")}

	archive := filepath.Join(dir, "evil.tar.gz")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	body := []byte("EVIL")
	tw.WriteHeader(&tar.Header{Name: "../evil.txt", Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg})
	tw.Write(body)
	tw.Close()
	gz.Close()
	f.Close()

	if _, err := restoreArchive(db, archive, "evil.tar.gz", time.Now()); err == nil {
		t.Fatal("path traversal archive should be rejected")
	}
	if _, err := os.Stat(filepath.Join(dir, "evil.txt")); !os.IsNotExist(err) {
		t.Fatalf("evil file escaped staging: %v", err)
	}
}

func TestRestoreRejectsDatabaseWithoutUsers(t *testing.T) {
	db := testDB(t)
	dir := t.TempDir()
	appCfg = config.Config{DataDir: dir, DBPath: filepath.Join(dir, "db", "workordernote.db"), UploadDir: filepath.Join(dir, "uploads")}
	snapshot := filepath.Join(dir, "snapshot.db")
	if err := vacuumInto(db, snapshot); err != nil {
		t.Fatal(err)
	}
	if err := inspectSnapshot(snapshot); err == nil {
		t.Fatal("empty user table should be rejected")
	}
}

func TestListLocalFiltersAndSorts(t *testing.T) {
	db := testDB(t)
	dir := t.TempDir()
	appCfg = config.Config{DataDir: dir}
	os.MkdirAll(localDir(db), 0o755)
	for _, name := range []string{
		filePrefix + "20261018-030000.tar.gz",
		filePrefix + "20261020-030000.tar.gz",
		"notes.txt",
		"other.tar.gz",
	} {
		os.WriteFile(filepath.Join(localDir(db), name), []byte("x"), 0o644)
	}
	files, err := ListLocal(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 || files[0].Name != filePrefix+"20261020-030000.tar.gz" {
		t.Fatalf("files = %+v", files)
	}
}

func TestRestoreSurvivesReopen(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "db", "app.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		t.Fatal(err)
	}
	db, err := database.InitDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(db); err != nil {
		t.Fatal(err)
	}
	appCfg = config.Config{DataDir: dir, DBPath: dbPath, UploadDir: filepath.Join(dir, "uploads")}
	if err := db.Create(&database.User{Username: "admin", Password: "x", Role: "admin", Status: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE demo (id INTEGER PRIMARY KEY, name TEXT)").Error; err != nil {
		t.Fatal(err)
	}
	db.Exec("INSERT INTO demo (name) VALUES ('落盘测试')")
	os.MkdirAll(localDir(db), 0o755)
	name := filePrefix + "20261020-040000.tar.gz"
	if _, err := createArchive(db, filepath.Join(localDir(db), name), time.Now()); err != nil {
		t.Fatal(err)
	}
	db.Exec("DELETE FROM demo")

	if _, err := RestoreLocal(db, name, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := database.CloseDB(db); err != nil {
		t.Fatal(err)
	}

	reopened, err := database.InitDB(dbPath)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer database.CloseDB(reopened)
	var got string
	if err := reopened.Raw("SELECT name FROM demo WHERE id = 1").Scan(&got).Error; err != nil {
		t.Fatalf("query after reopen: %v", err)
	}
	if got != "落盘测试" {
		t.Fatalf("after reopen name = %q", got)
	}
	var integrity string
	if err := reopened.Raw("PRAGMA integrity_check").Scan(&integrity).Error; err != nil || integrity != "ok" {
		t.Fatalf("integrity after reopen = %q, %v", integrity, err)
	}
}
