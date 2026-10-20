package reminder

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/skip2/go-qrcode"
	"gorm.io/gorm"

	"smallgo/server/config"
	"smallgo/server/response"
	"smallgo/server/sysconfig"
)

// 安卓客户端（WebView 壳子）的发布信息。
//
// 信息都放在系统配置里，管理员在「系统配置 → 安卓客户端」里改；APK 文件本身由
// 上传接口写进 <数据目录>/downloads/，文件名/大小/sha256/上传时间写回只读配置项。
//
// 下载地址分「内网 / 外网」两条：
//   - 两条都可以手填（比如外网走反代域名、内网走 NAS 地址）；
//   - 内网那条留空时，自动用「当前访问这个页面的地址」——局域网里打开设置页就能
//     直接生成可扫的二维码，不用先填一遍自己的地址。
const (
	cfgAndroidVersion = "android_version"
	cfgAndroidNotes   = "android_notes"
	cfgAndroidLanURL  = "android_lan_url"
	cfgAndroidWanURL  = "android_wan_url"

	// 下面四个由上传接口写入，界面上是只读（sysconfig 的 Internal）
	cfgAndroidAPKName = "android_apk_name"
	cfgAndroidAPKSize = "android_apk_size"
	cfgAndroidAPKSHA  = "android_apk_sha256"
	cfgAndroidAPKTime = "android_apk_time"

	androidAPKPath = "/api/reminder/android/apk"
	// 单个 APK 上限，够放一个正常的壳子包了
	androidMaxAPKSize = 300 << 20
)

func init() {
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: cfgAndroidVersion, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Default: "0.1.0", Group: "android", Label: "客户端版本号",
		Description: "安卓客户端的版本号，显示在「版本信息 → 安卓客户端」卡片上",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: cfgAndroidNotes, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Default: "", Group: "android", Label: "更新说明",
		Description: "这一版安卓客户端改了什么，显示在卡片里；可写多行",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: cfgAndroidLanURL, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Default: "", Group: "android", Label: "内网下载地址",
		Description: "局域网里用的下载链接；留空则自动用当前访问地址（推荐留空）",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: cfgAndroidWanURL, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Default: "", Group: "android", Label: "外网下载地址",
		Description: "在外面用的下载链接（反代域名等）；留空表示没有外网地址",
	})
	// 上传接口写入的元信息：Internal = 只读，避免有人在设置里手改出不一致
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: cfgAndroidAPKName, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Internal: true, Group: "android", Label: "APK 文件名",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: cfgAndroidAPKSize, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Internal: true, Group: "android", Label: "APK 大小",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: cfgAndroidAPKSHA, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Internal: true, Group: "android", Label: "APK SHA256",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: cfgAndroidAPKTime, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Internal: true, Group: "android", Label: "APK 上传时间",
	})
}

// AndroidClientDTO 是给前端卡片/接口用的客户端信息。
type AndroidClientDTO struct {
	Version    string `json:"version"`
	Notes      string `json:"notes"`
	FileName   string `json:"file_name"`
	FileSize   int64  `json:"file_size"`
	SHA256     string `json:"sha256"`
	UploadedAt string `json:"uploaded_at"`
	HasAPK     bool   `json:"has_apk"`
	LANURL     string `json:"lan_url"`
	WANURL     string `json:"wan_url"`
	MinSDK     int    `json:"min_sdk"`
}

func androidDownloadDir() string {
	return filepath.Join(config.C.DataDir, "downloads")
}

func androidCfg(db *gorm.DB, key, def string) string {
	if v, err := sysconfig.GetConfig(db, key, 0); err == nil {
		if strings.TrimSpace(v) != "" || def == "" {
			return v
		}
	}
	return def
}

func androidCfgInt(db *gorm.DB, key string) int64 {
	var n int64
	fmt.Sscanf(androidCfg(db, key, "0"), "%d", &n)
	return n
}

func buildAndroidClientDTO(db *gorm.DB, c *gin.Context) AndroidClientDTO {
	name := androidCfg(db, cfgAndroidAPKName, "")
	dto := AndroidClientDTO{
		Version:    androidCfg(db, cfgAndroidVersion, "0.1.0"),
		Notes:      androidCfg(db, cfgAndroidNotes, ""),
		FileName:   name,
		FileSize:   androidCfgInt(db, cfgAndroidAPKSize),
		SHA256:     androidCfg(db, cfgAndroidAPKSHA, ""),
		UploadedAt: androidCfg(db, cfgAndroidAPKTime, ""),
		LANURL:     androidCfg(db, cfgAndroidLanURL, ""),
		WANURL:     androidCfg(db, cfgAndroidWanURL, ""),
		MinSDK:     24,
	}
	if name != "" {
		if _, err := os.Stat(filepath.Join(androidDownloadDir(), filepath.Base(name))); err == nil {
			dto.HasAPK = true
		}
	}
	// 内网地址留空：用当前这次请求的地址拼一条，局域网里打开设置页就能直接扫码下载
	if dto.LANURL == "" && dto.HasAPK && c != nil {
		scheme := "http"
		if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
			scheme = "https"
		}
		dto.LANURL = scheme + "://" + c.Request.Host + androidAPKPath
	}
	return dto
}

// GET /api/reminder/android —— 公开：安卓客户端信息（卡片、二维码都要用）
func handleAndroidClient(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		response.Success(c, buildAndroidClientDTO(db, c))
	}
}

// GET /api/reminder/android/apk —— 公开：下载 APK
func handleAndroidDownloadAPK(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		name := strings.TrimSpace(androidCfg(db, cfgAndroidAPKName, ""))
		if name == "" {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "还没有上传安卓客户端")
			return
		}
		path := filepath.Join(androidDownloadDir(), filepath.Base(name))
		if _, err := os.Stat(path); err != nil {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "安装包不存在，请重新上传")
			return
		}
		c.Header("Content-Type", "application/vnd.android.package-archive")
		c.Header("Content-Disposition", `attachment; filename="`+filepath.Base(name)+`"`)
		c.File(path)
	}
}

// POST /api/reminder/admin/android/apk —— 管理员上传/替换 APK
func handleAndroidUploadAPK(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, androidMaxAPKSize+(1<<20))
		file, err := c.FormFile("file")
		if err != nil {
			response.ErrorBadRequest(c, "请选择要上传的 APK 文件")
			return
		}
		if file.Size <= 0 {
			response.ErrorBadRequest(c, "文件不能为空")
			return
		}
		if file.Size > androidMaxAPKSize {
			response.ErrorBadRequest(c, fmt.Sprintf("文件过大（最大 %d MB）", androidMaxAPKSize>>20))
			return
		}
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".apk") {
			response.ErrorBadRequest(c, "只支持 .apk 文件")
			return
		}

		version := strings.TrimSpace(c.PostForm("version"))
		if version == "" {
			version = strings.TrimSpace(androidCfg(db, cfgAndroidVersion, "0.1.0"))
		}
		// 文件名按版本号生成，覆盖同版本旧包；名字里只留安全字符
		safeVersion := strings.Map(func(r rune) rune {
			switch {
			case r >= '0' && r <= '9', r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '.', r == '-', r == '_':
				return r
			default:
				return '-'
			}
		}, version)
		name := fmt.Sprintf("workordernote-android-%s.apk", safeVersion)
		dir := androidDownloadDir()
		if err := os.MkdirAll(dir, 0o755); err != nil {
			response.ErrorInternal(c, "创建下载目录失败")
			return
		}

		src, err := file.Open()
		if err != nil {
			response.ErrorBadRequest(c, "读取上传文件失败")
			return
		}
		defer src.Close()

		tmp := filepath.Join(dir, name+".tmp")
		dst, err := os.Create(tmp)
		if err != nil {
			response.ErrorInternal(c, "保存文件失败")
			return
		}
		hasher := sha256.New()
		written, copyErr := io.Copy(io.MultiWriter(dst, hasher), src)
		closeErr := dst.Close()
		if copyErr != nil || closeErr != nil {
			_ = os.Remove(tmp)
			response.ErrorInternal(c, "写入文件失败")
			return
		}
		final := filepath.Join(dir, name)
		if err := os.Rename(tmp, final); err != nil {
			_ = os.Remove(tmp)
			response.ErrorInternal(c, "保存文件失败")
			return
		}

		sha := hex.EncodeToString(hasher.Sum(nil))
		now := time.Now().Format(time.RFC3339)
		// 写回配置（Internal 项只能从代码里写，接口层是只读的）
		_ = sysconfig.UpdateConfig(db, cfgAndroidVersion, version, 0)
		_ = sysconfig.UpdateConfig(db, cfgAndroidAPKName, name, 0)
		_ = sysconfig.UpdateConfig(db, cfgAndroidAPKSize, fmt.Sprintf("%d", written), 0)
		_ = sysconfig.UpdateConfig(db, cfgAndroidAPKSHA, sha, 0)
		_ = sysconfig.UpdateConfig(db, cfgAndroidAPKTime, now, 0)

		dto := buildAndroidClientDTO(db, c)
		response.Success(c, dto)
	}
}

// DELETE /api/reminder/admin/android/apk —— 管理员下架 APK
func handleAndroidDeleteAPK(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		name := strings.TrimSpace(androidCfg(db, cfgAndroidAPKName, ""))
		if name != "" {
			_ = os.Remove(filepath.Join(androidDownloadDir(), filepath.Base(name)))
		}
		for _, key := range []string{cfgAndroidAPKName, cfgAndroidAPKSize, cfgAndroidAPKSHA, cfgAndroidAPKTime} {
			_ = sysconfig.UpdateConfig(db, key, "", 0)
		}
		response.Success(c, buildAndroidClientDTO(db, c))
	}
}

// GET /api/reminder/android/qrcode?addr=lan|wan&size=320 —— 公开：下载地址的二维码
//
// 服务端自己出图，而不是让前端拼一个通用二维码接口：
// 上游那个 qrcode 应用（/api/qrcode）并没有被 main 引入，页面里请求它只会拿到 SPA 的
// index.html；而且让服务端决定地址，客户端不用自己拼 URL，内外网切换也不会走样。
func handleAndroidQRCode(db *gorm.DB) gin.HandlerFunc {
	const (
		defaultSize = 320
		maxSize     = 1024
	)
	return func(c *gin.Context) {
		dto := buildAndroidClientDTO(db, c)
		url := dto.LANURL
		if strings.EqualFold(c.Query("addr"), "wan") && dto.WANURL != "" {
			url = dto.WANURL
		}
		if url == "" || !dto.HasAPK {
			response.Error(c, http.StatusNotFound, response.CodeNotFound, "还没有可下载的安装包")
			return
		}
		size := defaultSize
		if s, err := strconv.Atoi(c.Query("size")); err == nil && s > 0 {
			if s > maxSize {
				size = maxSize
			} else {
				size = s
			}
		}
		png, err := qrcode.Encode(url, qrcode.Medium, size)
		if err != nil {
			response.ErrorInternal(c, "生成二维码失败")
			return
		}
		c.Header("Cache-Control", "no-store")
		c.Data(http.StatusOK, "image/png", png)
	}
}
