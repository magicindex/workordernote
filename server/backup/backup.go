package backup

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"smallgo/server/config"
	"smallgo/server/logger"
	"smallgo/server/sysconfig"
	"smallgo/server/version"
)

const filePrefix = "workordernote-backup-"

// Result 是一次备份的落点与大小，手动接口会原样返回给页面。
type Result struct {
	File       string `json:"file"`
	Size       int64  `json:"size"`
	LocalPath  string `json:"local_path,omitempty"`
	WebDAVPath string `json:"webdav_path,omitempty"`
	Detail     string `json:"detail"`
}

var (
	appDB  *gorm.DB
	appCfg config.Config
)

// Configure 由 server.Start 在数据库就绪、配置初始化之后调用一次：
// 记住运行参数，并把每日检查任务交给 scheduler。
func Configure(db *gorm.DB, cfg config.Config) {
	appDB = db
	appCfg = cfg
	registerSchedule()
}

// localDir 返回本机备份目录；配置为空时落在数据目录下的 backups。
func localDir(db *gorm.DB) string {
	dir, _ := sysconfig.GetConfig(db, "backup_local_dir", 0)
	dir = strings.TrimSpace(dir)
	if dir == "" {
		dir = filepath.Join(appCfg.DataDir, "backups")
	}
	return dir
}

// createArchive 把数据库与上传文件写进 dest（一个 .tar.gz）。
//
// 数据库用 `VACUUM INTO` 做一致性快照：直接 cp 一个正在写的 SQLite 库（还有 -wal
// 未合并）会得到半截数据；VACUUM INTO 由 SQLite 自己保证一致。
func createArchive(db *gorm.DB, dest string, now time.Time) (int64, error) {
	tmp, err := os.MkdirTemp("", "workordernote-backup-*")
	if err != nil {
		return 0, err
	}
	defer os.RemoveAll(tmp)

	dbName := filepath.Base(appCfg.DBPath)
	dbCopy := filepath.Join(tmp, "db", dbName)
	if err := os.MkdirAll(filepath.Dir(dbCopy), 0o755); err != nil {
		return 0, err
	}
	if err := vacuumInto(db, dbCopy); err != nil {
		return 0, fmt.Errorf("快照数据库失败: %w", err)
	}

	manifest := map[string]any{
		"app":        version.AppName,
		"version":    version.Version,
		"created_at": now.Format(time.RFC3339),
		"database":   filepath.ToSlash(filepath.Join("db", dbName)),
		"includes":   []string{"database", "uploads"},
	}
	manifestPath := filepath.Join(tmp, "manifest.json")
	raw, _ := json.MarshalIndent(manifest, "", "  ")
	if err := os.WriteFile(manifestPath, raw, 0o644); err != nil {
		return 0, err
	}

	out, err := os.Create(dest)
	if err != nil {
		return 0, err
	}
	gz := gzip.NewWriter(out)
	tw := tar.NewWriter(gz)

	addFile := func(path, name string) error {
		info, err := os.Stat(path)
		if err != nil {
			return err
		}
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = name
		if info.IsDir() {
			header.Name += "/"
		}
		if err := tw.WriteHeader(header); err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(tw, f)
		return err
	}

	if err := addFile(manifestPath, "manifest.json"); err != nil {
		return 0, err
	}
	if err := addFile(dbCopy, manifest["database"].(string)); err != nil {
		return 0, err
	}
	// 上传目录可能不存在（刚装好还没传过图）；不存在就跳过，不算失败。
	if _, err := os.Stat(appCfg.UploadDir); err == nil {
		err := filepath.Walk(appCfg.UploadDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(appCfg.UploadDir, path)
			if err != nil {
				return err
			}
			if rel == "." {
				return nil
			}
			return addFile(path, filepath.ToSlash(filepath.Join("uploads", rel)))
		})
		if err != nil {
			return 0, err
		}
	}

	if err := tw.Close(); err != nil {
		return 0, err
	}
	if err := gz.Close(); err != nil {
		return 0, err
	}
	if err := out.Close(); err != nil {
		return 0, err
	}
	st, err := os.Stat(dest)
	if err != nil {
		return 0, err
	}
	return st.Size(), nil
}

// vacuumInto 优先用参数绑定；个别 SQLite 构建对 VACUUM INTO 的参数支持不稳，
// 失败时退回转义后的字面量（路径来自管理员配置，转义单引号即可）。
func vacuumInto(db *gorm.DB, path string) error {
	if err := db.Exec("VACUUM INTO ?", path).Error; err == nil {
		return nil
	}
	escaped := strings.ReplaceAll(path, "'", "''")
	return db.Exec(fmt.Sprintf("VACUUM INTO '%s'", escaped)).Error
}

// Run 立即执行一次备份：本机与 WebDAV 按配置各落一份。
func Run(db *gorm.DB, now time.Time) (Result, error) {
	var res Result
	dir := localDir(db)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return res, fmt.Errorf("创建备份目录失败: %w", err)
	}
	name := filePrefix + now.Format("20060102-150405") + ".tar.gz"
	dest := filepath.Join(dir, name)
	size, err := createArchive(db, dest, now)
	if err != nil {
		os.Remove(dest)
		return res, err
	}
	res.File = name
	res.Size = size

	localOn, _ := sysconfig.GetConfig(db, "backup_local_enabled", 0)
	if localOn != "true" {
		os.Remove(dest) // 只推 WebDAV 时不在本机留副本
	} else {
		res.LocalPath = dest
		res.Detail = "本机：" + dest
	}

	webdavOn, _ := sysconfig.GetConfig(db, "backup_webdav_enabled", 0)
	if webdavOn == "true" {
		remote, err := uploadWebDAV(db, dest, name)
		if err != nil {
			setStatus(db, now, "failed", res.Detail+"；WebDAV 失败："+err.Error())
			return res, fmt.Errorf("WebDAV 上传失败: %w", err)
		}
		res.WebDAVPath = remote
		if res.Detail != "" {
			res.Detail += "；"
		}
		res.Detail += "WebDAV：" + remote
	}
	if res.LocalPath == "" && res.WebDAVPath == "" {
		return res, fmt.Errorf("两个备份位置都没开启")
	}

	keep := keepCount(db)
	if res.LocalPath != "" {
		pruneLocal(dir, keep)
	}
	if res.WebDAVPath != "" {
		pruneWebDAV(db, keep)
	}
	setStatus(db, now, "ok", res.Detail)
	logger.Info("backup: %s (%d bytes) %s", name, size, res.Detail)
	return res, nil
}

func keepCount(db *gorm.DB) int {
	raw, _ := sysconfig.GetConfig(db, "backup_keep", 0)
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return 7
	}
	return n
}

func setStatus(db *gorm.DB, now time.Time, status, detail string) {
	_ = sysconfig.UpdateConfig(db, "backup_last_at", now.Format(time.RFC3339), 0)
	_ = sysconfig.UpdateConfig(db, "backup_last_status", status, 0)
	_ = sysconfig.UpdateConfig(db, "backup_last_detail", detail, 0)
}

// pruneLocal 只删本功能自己生成的文件（带固定前缀与时间戳），按文件名倒序保留最新的 n 份。
func pruneLocal(dir string, keep int) {
	if keep <= 0 {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, filePrefix) && strings.HasSuffix(name, ".tar.gz") {
			names = append(names, name)
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	for i, name := range names {
		if i < keep {
			continue
		}
		_ = os.Remove(filepath.Join(dir, name))
	}
}
