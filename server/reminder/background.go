package reminder

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"smallgo/server/logger"

	"gorm.io/gorm"
)

// 仪式感卡片的**背景图**（用户 2026-10-13 要求：「可以更换图片作为背景」）。
//
// reminders.background 存三种值：
//
//	""               不设背景（卡片用配色渐变，见 CeremonyPanel 的 cardStyle）
//	"preset:<key>"   内置主题图：随前端产物一起构建、两端都有，**永远不会被删**
//	                 （用户要求「跟随模板不会被删除」）
//	"/uploads/..."   用户上传的图片：落在 <data-dir>/uploads 下（随 data 卷持久化），
//	                 卡片删除 / 换成别的背景时立即清理（见 cleanupUploadedBackground）
//
// 上传的**文件本身不参与双机同步**（同步的只是这个路径）：对端没有这个文件时，
// 前端会回落到配色渐变（CeremonyPanel 里给 <img> 挂了 @error 兜底），不会显示破图。
var backgroundPresetPattern = regexp.MustCompile(`^preset:[a-z0-9][a-z0-9-]{0,31}$`)

// 背景蒙板的两个指标范围（用户 2026-10-13）：
//
//	maxBgBlur     虚化像素上限（再高就糊成一团，卡面内容也看不清）
//	defaultBgMask 默认**透明度** 45%（= 蒙板浓度 55%）：与上一版写死在样式里的
//	              暗色蒙板观感一致，老卡片迁移后看起来不变
const (
	maxBgBlur     = 24
	defaultBgBlur = 0
	defaultBgMask = 45
	// defaultBgAlpha 卡片背景默认不透明白底（100 = 与之前一样），
	// 想做成只留文字时再往 0 拉。
	defaultBgAlpha = 100
)

// validateBackground 校验背景值：空、preset:<slug>、或本机上传出来的路径。
// 只校验形状不校验具体 preset 名单 —— 加一张内置图不该逼着后端一起改。
func validateBackground(value string) error {
	if value == "" || backgroundPresetPattern.MatchString(value) || isUploadedBackground(value) {
		return nil
	}
	return errors.New("背景图无效")
}

func isUploadedBackground(value string) bool {
	return strings.HasPrefix(value, "/uploads/") && !strings.Contains(value, "..")
}

var backgroundUploadDir string

// SetUploadDir 由 server 启动时注入：清理上传图片时要拼绝对路径。
func SetUploadDir(dir string) { backgroundUploadDir = dir }

// uploadedBackgroundPath 把 "/uploads/2026/10/13/x.jpg" 解析成上传目录下的绝对路径，
// 并保证解析结果不越出该目录（与 upload.ServeUpload 同一套防线）。
func uploadedBackgroundPath(value string) (string, bool) {
	if backgroundUploadDir == "" || !isUploadedBackground(value) {
		return "", false
	}
	root, err := filepath.Abs(backgroundUploadDir)
	if err != nil {
		return "", false
	}
	rel := filepath.Clean(strings.TrimPrefix(value, "/uploads/"))
	full := filepath.Join(root, rel)
	if full != root && !strings.HasPrefix(full, root+string(os.PathSeparator)) {
		return "", false
	}
	return full, true
}

// cleanupUploadedBackground 删除一张不再被任何**未删除**条目引用的上传图片。
//
// 只在事务**提交之后**调用（删文件撤不回来）；还被别的条目引用时保留。
// preset: 开头的内置图没有对应文件，这里直接放过。
func cleanupUploadedBackground(db *gorm.DB, value string, excludeReminderID uint) {
	path, ok := uploadedBackgroundPath(value)
	if !ok {
		return
	}
	var count int64
	q := db.Model(&Reminder{}).Where("deleted_at IS NULL AND background = ?", value)
	if excludeReminderID > 0 {
		q = q.Where("id <> ?", excludeReminderID)
	}
	if err := q.Count(&count).Error; err != nil || count > 0 {
		return
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		logger.Error("reminder: 删除卡片背景图失败 %s: %v", path, err)
	}
}

// backgroundGCGrace 是兜底回收的宽限期：刚上传、还没保存进条目的图片不能被回收。
const backgroundGCGrace = 24 * time.Hour

// gcUnreferencedBackgrounds 兜底回收上传目录里没人引用的图片。
//
// 为什么需要它：条目被删除有两种路径 —— 本机 API（走 cleanupUploadedBackground 即时清理）
// 与**双机同步落地的删除**（对端删掉卡片，本机按墓碑删行，那条路在事务里、删不了文件）。
// 这个每天跑一次的兜底把两边收干净。只删「没有任何未删除条目引用」且超过 24 小时的文件。
func gcUnreferencedBackgrounds(db *gorm.DB) {
	if db == nil || backgroundUploadDir == "" {
		return
	}
	root, err := filepath.Abs(backgroundUploadDir)
	if err != nil {
		return
	}
	var referenced []string
	if err := db.Model(&Reminder{}).
		Where("deleted_at IS NULL AND background LIKE '/uploads/%'").
		Pluck("background", &referenced).Error; err != nil {
		logger.Error("reminder: 读取背景图引用失败: %v", err)
		return
	}
	keep := map[string]bool{}
	for _, value := range referenced {
		if path, ok := uploadedBackgroundPath(value); ok {
			keep[path] = true
		}
	}
	removed := 0
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		if keep[path] {
			return nil
		}
		info, statErr := entry.Info()
		if statErr != nil || time.Since(info.ModTime()) < backgroundGCGrace {
			return nil
		}
		if rmErr := os.Remove(path); rmErr == nil {
			removed++
		}
		return nil
	})
	if removed > 0 {
		logger.Info("reminder: 回收未被引用的背景图 %d 个", removed)
	}
}
