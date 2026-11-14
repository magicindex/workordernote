package backup

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// LocalDir 是本机目录选择器里的一项。
type LocalDir struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// LocalBrowseResult 是当前路径与下一层目录。
type LocalBrowseResult struct {
	Path   string     `json:"path"`
	Parent string     `json:"parent"`
	Dirs   []LocalDir `json:"dirs"`
}

// BrowseLocalBackup 列出本机目录（空路径从数据目录开始），供选择备份保存目录。
func BrowseLocalBackup(overridePath *string) (LocalBrowseResult, error) {
	raw := ""
	if overridePath != nil {
		raw = strings.TrimSpace(*overridePath)
	}
	if raw == "" {
		raw = appCfg.DataDir
	}
	abs, err := filepath.Abs(raw)
	if err != nil {
		return LocalBrowseResult{}, fmt.Errorf("路径不合法：%w", err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return LocalBrowseResult{}, fmt.Errorf("目录不存在或不可访问")
	}
	if !info.IsDir() {
		return LocalBrowseResult{}, fmt.Errorf("不是目录")
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return LocalBrowseResult{}, fmt.Errorf("读取目录失败：%w", err)
	}
	dirs := make([]LocalDir, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirs = append(dirs, LocalDir{Name: entry.Name(), Path: filepath.Join(abs, entry.Name())})
	}
	sort.Slice(dirs, func(i, j int) bool { return dirs[i].Name < dirs[j].Name })
	parent := ""
	if abs != string(filepath.Separator) {
		p := filepath.Dir(abs)
		if p != abs {
			parent = p
		}
	}
	return LocalBrowseResult{Path: abs, Parent: parent, Dirs: dirs}, nil
}
