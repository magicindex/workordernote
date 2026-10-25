package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mattn/go-sqlite3"
	"gorm.io/gorm"

	"smallgo/server/database"
	"smallgo/server/logger"
)

const (
	maxRestoreBytes   = int64(32 << 30) // 解包上限 32 GiB
	maxRestoreEntries = 200000
	maxManifestBytes  = 1 << 20
	maxUploadBytes    = int64(16 << 30)
)

var (
	// opMu 让备份与恢复互斥：恢复期间不能再做快照，否则可能把半截数据写进备份。
	opMu sync.Mutex

	errRestoreBusy = errors.New("正在执行备份或恢复，请稍后再试")
)

// BackupFile 是本机备份目录里的一份可恢复备份。
type BackupFile struct {
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modified_at"`
}

// RestoreResult 是恢复完成后的摘要，页面用来提示恢复了哪一份、恢复前的安全备份在哪。
type RestoreResult struct {
	File       string `json:"file"`
	SafetyFile string `json:"safety_file,omitempty"`
	Version    string `json:"version,omitempty"`
	CreatedAt  string `json:"created_at,omitempty"`
	Users      int    `json:"users"`
	Uploads    int    `json:"uploads"`
}

type archiveManifest struct {
	App       string `json:"app"`
	Version   string `json:"version"`
	CreatedAt string `json:"created_at"`
	Database  string `json:"database"`
}

// ListLocal 返回本机备份目录里的备份文件，按文件名倒序（最新的在前）。
func ListLocal(db *gorm.DB) ([]BackupFile, error) {
	dir := localDir(db)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []BackupFile{}, nil
		}
		return nil, err
	}
	files := make([]BackupFile, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if !entry.Type().IsRegular() || !validBackupName(name) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, BackupFile{
			Name:       name,
			Size:       info.Size(),
			ModifiedAt: info.ModTime().Format(time.RFC3339),
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name > files[j].Name })
	return files, nil
}

// RestoreLocal 恢复本机目录里的指定备份。
func RestoreLocal(db *gorm.DB, name string, now time.Time) (RestoreResult, error) {
	if !validBackupName(name) {
		return RestoreResult{}, fmt.Errorf("无效的备份文件名")
	}
	archive := filepath.Join(localDir(db), name)
	if err := ensureRegularFile(archive); err != nil {
		return RestoreResult{}, err
	}
	return restoreArchive(db, archive, name, now)
}

// RestoreUpload 把页面上传的备份文件写到临时目录后恢复。上传文件不会留在本机备份目录。
func RestoreUpload(db *gorm.DB, r io.Reader, displayName string, now time.Time) (RestoreResult, error) {
	// 临时文件放在数据目录同级：容器里的 /tmp 往往很小，而备份可能有几个 GB。
	tmpDir := filepath.Dir(appCfg.UploadDir)
	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		return RestoreResult{}, fmt.Errorf("创建临时目录失败: %w", err)
	}
	tmp, err := os.CreateTemp(tmpDir, ".workordernote-restore-upload-*.tar.gz")
	if err != nil {
		return RestoreResult{}, fmt.Errorf("创建临时文件失败: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmp, io.LimitReader(r, maxUploadBytes+1)); err != nil {
		tmp.Close()
		return RestoreResult{}, fmt.Errorf("保存上传文件失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return RestoreResult{}, fmt.Errorf("保存上传文件失败: %w", err)
	}
	if info, err := os.Stat(tmpPath); err != nil || info.Size() > maxUploadBytes {
		return RestoreResult{}, fmt.Errorf("备份文件过大")
	}
	if displayName == "" {
		displayName = "上传的备份"
	}
	return restoreArchive(db, tmpPath, displayName, now)
}

func restoreArchive(db *gorm.DB, archive, displayName string, now time.Time) (RestoreResult, error) {
	if !opMu.TryLock() {
		return RestoreResult{}, errRestoreBusy
	}
	defer opMu.Unlock()

	// 暂存目录放在上传目录的同级：最后把 uploads 换进去时可以用 rename，
	// 不用跨文件系统复制整棵图片目录。
	uploadParent := filepath.Dir(appCfg.UploadDir)
	if err := os.MkdirAll(uploadParent, 0o755); err != nil {
		return RestoreResult{}, fmt.Errorf("创建恢复暂存目录失败: %w", err)
	}
	staging, err := os.MkdirTemp(uploadParent, ".workordernote-restore-*")
	if err != nil {
		return RestoreResult{}, fmt.Errorf("创建恢复暂存目录失败: %w", err)
	}
	defer os.RemoveAll(staging)

	dataDir := filepath.Join(staging, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return RestoreResult{}, fmt.Errorf("创建恢复暂存目录失败: %w", err)
	}
	manifest, uploads, err := extractArchive(archive, dataDir)
	if err != nil {
		return RestoreResult{}, err
	}

	restoredDB := filepath.Join(dataDir, filepath.FromSlash(manifest.Database))
	if err := inspectSnapshot(restoredDB); err != nil {
		return RestoreResult{}, err
	}

	// 恢复前先留一份当前数据的快照。失败就不恢复，避免「想回到昨天，结果今天也没了」。
	dir := localDir(db)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return RestoreResult{}, fmt.Errorf("创建备份目录失败: %w", err)
	}
	safetyName := filePrefix + now.Format("20060102-150405") + "-before-restore.tar.gz"
	safetyPath := filepath.Join(dir, safetyName)
	// 同一秒内连续恢复时不要覆盖上一份安全备份。
	for i := 2; ; i++ {
		_, statErr := os.Lstat(safetyPath)
		if os.IsNotExist(statErr) {
			break
		}
		if statErr != nil {
			return RestoreResult{}, fmt.Errorf("检查安全备份路径失败: %w", statErr)
		}
		if i > 100 {
			return RestoreResult{}, fmt.Errorf("同名的安全备份过多，请稍后再试")
		}
		safetyName = fmt.Sprintf("%s%s-before-restore-%d.tar.gz", filePrefix, now.Format("20060102-150405"), i)
		safetyPath = filepath.Join(dir, safetyName)
	}
	if _, err := createArchive(db, safetyPath, now); err != nil {
		os.Remove(safetyPath)
		return RestoreResult{}, fmt.Errorf("恢复前的安全备份失败: %w", err)
	}

	stagedUploads := filepath.Join(dataDir, "uploads")
	if err := os.MkdirAll(stagedUploads, 0o755); err != nil {
		return RestoreResult{}, fmt.Errorf("准备上传目录失败: %w", err)
	}

	oldUploads, err := swapUploads(stagedUploads)
	if err != nil {
		return RestoreResult{}, err
	}

	if err := restoreDatabase(db, restoredDB); err != nil {
		rollbackUploads(oldUploads)
		return RestoreResult{}, fmt.Errorf("恢复数据库失败: %w", err)
	}

	// 备份可能来自旧版本：补上后来新增的表/列。失败也算恢复未完成，
	// 但此时数据库已经换成本份快照，保留旧上传目录以便人工回退。
	if err := database.AutoMigrate(db); err != nil {
		return RestoreResult{}, fmt.Errorf("数据库已恢复，但升级表结构失败: %w", err)
	}
	if err := db.Exec("PRAGMA journal_mode=WAL").Error; err != nil {
		logger.Warn("backup: restore set WAL failed: %v", err)
	}
	if oldUploads != "" {
		_ = os.RemoveAll(oldUploads)
	}

	users := 0
	db.Raw("SELECT count(*) FROM users").Scan(&users)

	res := RestoreResult{
		File:       displayName,
		SafetyFile: safetyName,
		Version:    manifest.Version,
		CreatedAt:  manifest.CreatedAt,
		Users:      users,
		Uploads:    uploads,
	}
	logger.Info("backup: restored %s (users=%d uploads=%d) safety=%s", displayName, users, uploads, safetyName)
	return res, nil
}

// swapUploads 把暂存的 uploads 换到正式位置，返回被替换下来的旧目录（可能为空）。
func swapUploads(staged string) (string, error) {
	target := appCfg.UploadDir
	parent := filepath.Dir(target)
	old := filepath.Join(parent, fmt.Sprintf(".%s.restore-old-%d", filepath.Base(target), time.Now().UnixNano()))

	if _, err := os.Stat(target); err == nil {
		if err := os.Rename(target, old); err != nil {
			return "", fmt.Errorf("暂存旧上传目录失败: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("检查上传目录失败: %w", err)
	} else {
		old = ""
	}

	if err := os.Rename(staged, target); err != nil {
		if old != "" {
			_ = os.Rename(old, target)
		}
		return "", fmt.Errorf("替换上传目录失败: %w", err)
	}
	return old, nil
}

func rollbackUploads(old string) {
	_ = os.RemoveAll(appCfg.UploadDir)
	if old != "" {
		_ = os.Rename(old, appCfg.UploadDir)
	}
}

// restoreDatabase 用 SQLite 在线备份 API 把快照库整库复制进已打开的运行库。
// 不直接替换 db 文件：进程还持有 WAL 连接，换文件会让连接指向旧 inode。
func restoreDatabase(db *gorm.DB, snapshot string) error {
	dsn := (&url.URL{Scheme: "file", Path: snapshot, RawQuery: "mode=ro&immutable=1"}).String()
	srcSQL, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return err
	}
	defer srcSQL.Close()
	srcSQL.SetMaxOpenConns(1)
	srcSQL.SetMaxIdleConns(1)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	dstSQL, err := db.DB()
	if err != nil {
		return err
	}
	dstConn, err := dstSQL.Conn(ctx)
	if err != nil {
		return err
	}
	defer dstConn.Close()
	srcConn, err := srcSQL.Conn(ctx)
	if err != nil {
		return err
	}
	defer srcConn.Close()

	return dstConn.Raw(func(dest any) error {
		destConn, ok := dest.(*sqlite3.SQLiteConn)
		if !ok {
			return fmt.Errorf("当前数据库驱动不支持在线恢复")
		}
		return srcConn.Raw(func(source any) error {
			srcConn, ok := source.(*sqlite3.SQLiteConn)
			if !ok {
				return fmt.Errorf("备份数据库驱动不支持在线恢复")
			}
			bk, err := destConn.Backup("main", srcConn, "main")
			if err != nil {
				return err
			}
			for {
				done, err := bk.Step(-1)
				if err != nil {
					_ = bk.Finish()
					return err
				}
				if done {
					return bk.Finish()
				}
			}
		})
	})
}

// inspectSnapshot 确认解包出来的确实是一个可用的工作序记数据库：
// SQLite 完整性检查通过、核心表存在、至少有一个账号。
func inspectSnapshot(dbPath string) error {
	if err := ensureRegularFile(dbPath); err != nil {
		return fmt.Errorf("备份里没有数据库文件")
	}
	dsn := (&url.URL{Scheme: "file", Path: dbPath, RawQuery: "mode=ro&immutable=1"}).String()
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return fmt.Errorf("数据库文件无法打开: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	var integrity string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil {
		return fmt.Errorf("数据库完整性检查失败: %w", err)
	}
	if integrity != "ok" {
		return fmt.Errorf("数据库完整性检查未通过: %s", integrity)
	}
	var tables int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('users','system_configs')").Scan(&tables); err != nil {
		return fmt.Errorf("读取数据库结构失败: %w", err)
	}
	if tables < 2 {
		return fmt.Errorf("这不是工作序记的备份：缺少核心数据表")
	}
	var users int
	if err := db.QueryRow("SELECT count(*) FROM users").Scan(&users); err != nil {
		return fmt.Errorf("读取账号数据失败: %w", err)
	}
	if users == 0 {
		return fmt.Errorf("备份里没有账号，恢复后将无法登录")
	}
	return nil
}

// extractArchive 安全解包：拒绝绝对路径、..、软链接与设备文件，并限制总大小/条目数。
func extractArchive(archive, dest string) (archiveManifest, int, error) {
	var manifest archiveManifest
	f, err := os.Open(archive)
	if err != nil {
		return manifest, 0, fmt.Errorf("打开备份文件失败: %w", err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return manifest, 0, fmt.Errorf("备份文件不是有效的 tar.gz: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)

	var total int64
	uploads := 0
	entries := 0
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return manifest, 0, fmt.Errorf("读取备份文件失败: %w", err)
		}
		entries++
		if entries > maxRestoreEntries {
			return manifest, 0, fmt.Errorf("备份文件条目过多")
		}

		name := path.Clean(strings.TrimPrefix(header.Name, "./"))
		if name == "." {
			continue
		}
		if path.IsAbs(name) || name == ".." || strings.HasPrefix(name, "../") || strings.Contains(name, "\x00") {
			return manifest, 0, fmt.Errorf("备份文件包含非法路径: %s", header.Name)
		}
		target := filepath.Join(dest, filepath.FromSlash(name))
		if !strings.HasPrefix(target, dest+string(os.PathSeparator)) {
			return manifest, 0, fmt.Errorf("备份文件包含非法路径: %s", header.Name)
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return manifest, 0, fmt.Errorf("解包失败: %w", err)
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return manifest, 0, fmt.Errorf("解包失败: %w", err)
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
			if err != nil {
				return manifest, 0, fmt.Errorf("解包失败: %w", err)
			}
			n, copyErr := io.Copy(out, io.LimitReader(tr, maxRestoreBytes-total+1))
			closeErr := out.Close()
			if copyErr != nil {
				return manifest, 0, fmt.Errorf("解包失败: %w", copyErr)
			}
			if closeErr != nil {
				return manifest, 0, fmt.Errorf("解包失败: %w", closeErr)
			}
			total += n
			if total > maxRestoreBytes {
				return manifest, 0, fmt.Errorf("备份解包后超过 %d GiB 上限", maxRestoreBytes>>30)
			}
			if name == "manifest.json" {
				if n > maxManifestBytes {
					return manifest, 0, fmt.Errorf("manifest.json 过大")
				}
				if err := json.Unmarshal(readSmallFile(target), &manifest); err != nil {
					return manifest, 0, fmt.Errorf("manifest.json 无法解析: %w", err)
				}
			}
			if strings.HasPrefix(name, "uploads/") {
				uploads++
			}
		default:
			return manifest, 0, fmt.Errorf("备份文件包含不支持的类型: %s", header.Name)
		}
	}

	if manifest.Database == "" {
		return manifest, 0, fmt.Errorf("备份文件缺少 manifest.json 或 database 字段")
	}
	dbPath := path.Clean(manifest.Database)
	if path.IsAbs(dbPath) || dbPath == ".." || strings.HasPrefix(dbPath, "../") {
		return manifest, 0, fmt.Errorf("manifest.json 的数据库路径非法")
	}
	if !strings.HasPrefix(dbPath, "db/") {
		return manifest, 0, fmt.Errorf("manifest.json 的数据库路径不在 db/ 目录下")
	}
	manifest.Database = dbPath
	return manifest, uploads, nil
}

func readSmallFile(path string) []byte {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	raw, _ := io.ReadAll(io.LimitReader(f, maxManifestBytes+1))
	return raw
}

func validBackupName(name string) bool {
	return name != "" &&
		len(name) < 200 &&
		name == filepath.Base(name) &&
		!strings.ContainsAny(name, `/\`) &&
		strings.HasPrefix(name, filePrefix) &&
		strings.HasSuffix(name, ".tar.gz")
}

func ensureRegularFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("不是普通文件")
	}
	return nil
}
