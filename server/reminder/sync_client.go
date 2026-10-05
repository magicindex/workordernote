package reminder

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// 双机同步里「本机 → 对端」的那一半：一个很小的 HTTP 客户端。
//
// 两台机器是对等关系，没有主从，所以每一台都同时实现客户端与服务端
// （见 sync_handlers.go）。同步只在管理员的动作或定时任务里发起，
// 不做变更即同步：提醒应用的量级不值得为「实时」付出发送风暴与半途失败的代价。
const (
	syncTokenHeader    = "X-Sync-Token"
	syncInstanceHeader = "X-Sync-Instance"
	// syncRequestBodyLimit 是解压后的报文上限。gzip 能把报文压到约 1/10，
	// 但解压炸弹不能不管：宁可明确报错，也不把内存吃满。
	syncRequestBodyLimit = 64 << 20
)

type syncPeerClient struct {
	baseURL string
	token   string
	http    *http.Client
}

func newSyncPeerClient(settings syncSettings) (*syncPeerClient, error) {
	base := strings.TrimSuffix(settings.PeerURL, "/")
	if base == "" {
		return nil, fmt.Errorf("未填写对端地址")
	}
	return &syncPeerClient{
		baseURL: base,
		token:   settings.Token,
		http: &http.Client{
			// 全量报文在弱网/大库下可能慢，但必须有上限：定时任务卡在一个
			// 不响应的对端上会让后续同步全部堆住。
			Timeout: 60 * time.Second,
		},
	}, nil
}

// peerResponse 是应用统一的响应信封（见 response.Response）。
type peerResponse struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func (c *syncPeerClient) do(ctx context.Context, method, path string, body io.Reader, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set(syncTokenHeader, c.token)
	req.Header.Set("Accept", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		// 网络层错误最常见的原因是地址填错、对端没启动或不在同一网段，
		// 报错里带上地址，用户一眼能看出该改哪里。
		return nil, fmt.Errorf("连接对端 %s 失败：%v", c.baseURL, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, fmt.Errorf("读取对端响应失败：%v", err)
	}
	var envelope peerResponse
	if err := json.Unmarshal(raw, &envelope); err != nil {
		if resp.StatusCode == http.StatusUnauthorized {
			return nil, fmt.Errorf("对端拒绝了同步请求（401）：两端的同步令牌不一致")
		}
		return nil, fmt.Errorf("对端返回了无法解析的响应（HTTP %d）：%s", resp.StatusCode, truncateForMessage(raw))
	}
	if envelope.Code != 0 {
		return nil, fmt.Errorf("对端返回错误：%s", envelope.Message)
	}
	return envelope.Data, nil
}

// fetchInfo 只取对端的元信息，用于「测试连接」。
func (c *syncPeerClient) fetchInfo(ctx context.Context) (syncPeerInfo, error) {
	var info syncPeerInfo
	data, err := c.do(ctx, http.MethodGet, "/api/reminder/sync/info", nil, nil)
	if err != nil {
		return info, err
	}
	if err := json.Unmarshal(data, &info); err != nil {
		return info, fmt.Errorf("解析对端信息失败：%v", err)
	}
	return info, nil
}

// fetchSnapshot 拉取对端的全量数据。
func (c *syncPeerClient) fetchSnapshot(ctx context.Context) (syncSnapshot, error) {
	var snap syncSnapshot
	data, err := c.do(ctx, http.MethodGet, "/api/reminder/sync/snapshot", nil, nil)
	if err != nil {
		return snap, err
	}
	if err := json.Unmarshal(data, &snap); err != nil {
		return snap, fmt.Errorf("解析对端数据失败：%v", err)
	}
	return snap, nil
}

// syncPushReceipt 是推送后对端的回执：改了多少条，以及它自己的元信息
// （顺便让本机知道对端是谁、版本多少、时钟差多少）。
type syncPushReceipt struct {
	InstanceID  string         `json:"instance_id"`
	AppName     string         `json:"app_name"`
	AppVersion  string         `json:"app_version"`
	SiteTitle   string         `json:"site_title"`
	GeneratedAt time.Time      `json:"generated_at"`
	Users       int            `json:"users"`
	Stats       syncApplyStats `json:"stats"`
}

// pushSnapshot 把本机数据推给对端。报文体是 gzip 过的 JSON，并显式声明
// Content-Encoding —— 应用的服务端对请求体有 1MB 的统一上限，压缩后
// 几万条数据也远在限内（见 middleware.LimitJSONBody）。
func (c *syncPeerClient) pushSnapshot(ctx context.Context, snap syncSnapshot, instanceID string) (syncPushReceipt, error) {
	var receipt syncPushReceipt
	raw, err := json.Marshal(snap)
	if err != nil {
		return receipt, err
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(raw); err != nil {
		return receipt, err
	}
	if err := zw.Close(); err != nil {
		return receipt, err
	}
	data, err := c.do(ctx, http.MethodPost, "/api/reminder/sync/apply", &buf, map[string]string{
		"Content-Type":     "application/json",
		"Content-Encoding": "gzip",
		syncInstanceHeader: instanceID,
	})
	if err != nil {
		return receipt, err
	}
	if err := json.Unmarshal(data, &receipt); err != nil {
		return receipt, fmt.Errorf("解析对端回执失败：%v", err)
	}
	return receipt, nil
}

func truncateForMessage(raw []byte) string {
	text := strings.TrimSpace(string(raw))
	if len(text) > 200 {
		return text[:200] + "…"
	}
	if text == "" {
		return "空响应"
	}
	return text
}
