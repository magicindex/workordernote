package backup

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"smallgo/server/sysconfig"
)

var hrefPattern = regexp.MustCompile(`<[^>]*href[^>]*>([^<]+)</[^>]*href>`)

// webdavTarget 拼出最终 URL：地址 + 子目录 + 文件名。
func webdavTarget(db *gorm.DB, name string) (string, error) {
	base, _ := sysconfig.GetConfig(db, "backup_webdav_url", 0)
	base = strings.TrimSpace(base)
	if base == "" {
		return "", fmt.Errorf("没有填写 WebDAV 地址")
	}
	u, err := url.Parse(base)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("WebDAV 地址不合法")
	}
	sub, _ := sysconfig.GetConfig(db, "backup_webdav_dir", 0)
	sub = strings.Trim(strings.TrimSpace(sub), "/")
	u.Path = strings.TrimRight(u.Path, "/")
	if sub != "" {
		u.Path += "/" + sub
	}
	if name != "" {
		u.Path += "/" + name
	}
	return u.String(), nil
}

func davRequest(db *gorm.DB, method, target string, body io.Reader, header map[string]string) (*http.Response, error) {
	req, err := http.NewRequest(method, target, body)
	if err != nil {
		return nil, err
	}
	user, _ := sysconfig.GetConfig(db, "backup_webdav_username", 0)
	pass, _ := sysconfig.GetConfig(db, "backup_webdav_password", 0)
	if user != "" || pass != "" {
		req.SetBasicAuth(user, pass)
	}
	for key, value := range header {
		req.Header.Set(key, value)
	}
	client := davClient(db)
	resp, err := client.Do(req)
	if err != nil {
		return nil, explainDAVError(err)
	}
	return resp, nil
}

// davClient 每次请求新建。自建 NAS 常用自签名证书，或用 IP 访问而证书里只有域名 SAN，
// Go 的默认校验会直接报 x509；只有管理员显式开启「跳过 HTTPS 证书校验」才放行。
func davClient(db *gorm.DB) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if insecure, _ := sysconfig.GetConfig(db, "backup_webdav_insecure", 0); insecure == "true" {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return &http.Client{Timeout: 90 * time.Second, Transport: transport}
}

// explainDAVError 给证书类失败补一句能照着做的建议；原始错误仍包在 %w 里，
// 页面上的「上次备份结果」与日志都能看到完整原因。
func explainDAVError(err error) error {
	var (
		certErr *tls.CertificateVerificationError
		hostErr x509.HostnameError
		caErr   x509.UnknownAuthorityError
	)
	if errors.As(err, &certErr) || errors.As(err, &hostErr) || errors.As(err, &caErr) {
		return fmt.Errorf("%w（HTTPS 证书不受信任或与访问地址不匹配：可改用证书里的主机名，或在「数据备份」里开启「跳过 HTTPS 证书校验」）", err)
	}
	return err
}

// uploadWebDAV 先补建目录（忽略「已存在」的 405），再 PUT 整个文件。
func uploadWebDAV(db *gorm.DB, file, name string) (string, error) {
	target, err := webdavTarget(db, name)
	if err != nil {
		return "", err
	}
	// MKCOL 子目录：父目录必须存在，这里只建配置里那一层。
	if dirURL, err := webdavTarget(db, ""); err == nil && dirURL != strings.TrimRight(target, "/") {
		resp, err := davRequest(db, "MKCOL", dirURL, nil, nil)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusMethodNotAllowed &&
				resp.StatusCode != http.StatusConflict && resp.StatusCode != http.StatusOK {
				return "", fmt.Errorf("创建目录失败（HTTP %d）", resp.StatusCode)
			}
		}
	}

	f, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer f.Close()
	resp, err := davRequest(db, http.MethodPut, target, f, map[string]string{"Content-Type": "application/gzip"})
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return target, nil
}

// pruneWebDAV 用 PROPFIND 列出目录里的备份文件，按名字倒序保留最新 keep 份。
func pruneWebDAV(db *gorm.DB, keep int) {
	if keep <= 0 {
		return
	}
	dirURL, err := webdavTarget(db, "")
	if err != nil {
		return
	}
	body := strings.NewReader(`<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/></d:prop></d:propfind>`)
	resp, err := davRequest(db, "PROPFIND", dirURL, body, map[string]string{"Depth": "1", "Content-Type": "application/xml"})
	if err != nil {
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	type entry struct{ name, href string }
	var files []entry
	for _, match := range hrefPattern.FindAllStringSubmatch(string(raw), -1) {
		href := strings.TrimSpace(match[1])
		name := path.Base(href)
		if strings.HasPrefix(name, filePrefix) && strings.HasSuffix(name, ".tar.gz") {
			files = append(files, entry{name: name, href: href})
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].name > files[j].name })
	for i, f := range files {
		if i < keep {
			continue
		}
		deleteURL := f.href
		if !strings.HasPrefix(deleteURL, "http://") && !strings.HasPrefix(deleteURL, "https://") {
			base, err := url.Parse(dirURL)
			if err != nil {
				return
			}
			rel, err := url.Parse(f.href)
			if err != nil {
				return
			}
			deleteURL = base.ResolveReference(rel).String()
		}
		resp, err := davRequest(db, http.MethodDelete, deleteURL, nil, nil)
		if err == nil {
			resp.Body.Close()
		}
	}
}
