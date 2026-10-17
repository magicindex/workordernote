package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"
)

// 上游响应体的读取上限：模型回答正常在几百 KB 以内，1MB 足够，也避免一个
// 异常的上游把内存吃掉。
const maxResponseBytes = 1 << 20

// Message 与 OpenAI 兼容接口一致（role: system/user/assistant）。
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatResult 是一次问答的结果（只取前端与排查要用到的字段）。
type ChatResult struct {
	Reply            string
	Model            string
	PromptTokens     int
	CompletionTokens int
	// Reasoning 是「思考模型」这一轮的思维链（qwen3、deepseek-r1 这类）。
	// 不接模型的模式（off/brief/full）由调用方决定拿它做什么：off 直接丢掉，
	// brief 取开头一小段，full 原样给面板。空串表示上游没给（普通模型）。
	Reasoning string
}

// apiError 是「要展示给用户」的调用失败：一句中文说明 + 上游状态码（没有就 0）。
//
// 上游自己报的 message 会拼在后面——「余额不足」「模型不存在」这类信息只有
// 上游知道，用自己的话盖掉反而让人查不下去。
type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string { return e.Message }

// asAPIError 把错误还原成 apiError，用来按「上游状态码 / 是连接问题还是文案问题」
// 分流（测试连接时两条路都失败，要挑一条更能说明问题的报给用户）。
func asAPIError(err error) (*apiError, bool) {
	var target *apiError
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}

// client 是 OpenAI 兼容协议的最小客户端：一次对话、一次模型列表。
type client struct {
	baseURL  string
	apiKey   string
	model    string
	provider string
	http     *http.Client
}

func newClient(s Settings) *client {
	timeout := time.Duration(s.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = defaultTimeoutSeconds * time.Second
	}
	return &client{
		baseURL:  s.effectiveBaseURL(),
		apiKey:   strings.TrimSpace(s.APIKey),
		model:    s.Model,
		provider: s.Provider,
		http:     &http.Client{Timeout: timeout},
	}
}

func (c *client) chatEndpoint() string   { return c.baseURL + "/chat/completions" }
func (c *client) modelsEndpoint() string { return c.baseURL + "/models" }

// 本机 Ollama 的模型保活时间。默认 5 分钟就被卸载，而这台机器上重新把 7B 读回
// 内存要几分钟——问一句等五分钟没人受得了。只在 provider=ollama 时带这个字段：
// 别的服务多半不认识它。
const ollamaKeepAlive = "30m"

// chatRequest 按 OpenAI 兼容协议构造请求体。显式带 stream:false：个别服务
// （如某些自建网关）缺省就是流式，返回一串 SSE 会让解析直接失败。
type chatRequest struct {
	Model     string    `json:"model"`
	Messages  []Message `json:"messages"`
	Stream    bool      `json:"stream"`
	KeepAlive string    `json:"keep_alive,omitempty"`
}

type chatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Content string `json:"content"`
			// 「思考模型」（qwen3、deepseek-r1 这类）把思维链单独放在一个字段里，
			// 正式回答才放 content。字段名各家长得不一样：Ollama 与 DeepSeek 原生
			// 用 reasoning、OpenAI 兼容网关那边常见 reasoning_content，两个都收
			// （见 reasoningOf）。
			Reasoning        string `json:"reasoning"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

// Chat 发一轮对话，取回这一轮的回复。
func (c *client) Chat(ctx context.Context, messages []Message) (ChatResult, error) {
	if c.baseURL == "" {
		return ChatResult{}, &apiError{Message: "还没有配置接口地址"}
	}
	if c.model == "" {
		return ChatResult{}, &apiError{Message: "还没有配置模型名称"}
	}
	payload := chatRequest{Model: c.model, Messages: messages, Stream: false}
	if c.provider == "ollama" {
		payload.KeepAlive = ollamaKeepAlive
	}
	var parsed chatResponse
	if err := c.do(ctx, http.MethodPost, c.chatEndpoint(), payload, &parsed); err != nil {
		return ChatResult{}, err
	}
	reply := ""
	reasoning := ""
	if len(parsed.Choices) > 0 {
		reply = strings.TrimSpace(parsed.Choices[0].Message.Content)
		reasoning = reasoningOf(parsed.Choices[0].Message)
	}
	if reply == "" {
		// 200 也可能什么都没返回。分开说：本地「思考模型」是这个场景里最常见的
		// 一个坑（思维链占满了输出），把「换哪个模型」直接写进提示里。
		if reasoning != "" {
			return ChatResult{}, &apiError{
				Message: "这个模型只输出了思考过程（qwen3、deepseek-r1 这类「思考模型」），没有给出正式回答；换一个非思考模型（如 qwen2.5）更好，本地小机器上它答得也快",
			}
		}
		return ChatResult{}, &apiError{
			Message: "模型没有返回内容（可能是模型名不对，或该模型只返回推理过程、被安全策略拦截）",
		}
	}
	model := strings.TrimSpace(parsed.Model)
	if model == "" {
		model = c.model
	}
	return ChatResult{
		Reply:            reply,
		Model:            model,
		PromptTokens:     parsed.Usage.PromptTokens,
		CompletionTokens: parsed.Usage.CompletionTokens,
		Reasoning:        reasoning,
	}, nil
}

// reasoningOf 取一条回复里的思维链：Ollama/DeepSeek 用 reasoning，
// OpenAI 兼容网关常用 reasoning_content，哪个有内容用哪个。
func reasoningOf(msg struct {
	Content          string `json:"content"`
	Reasoning        string `json:"reasoning"`
	ReasoningContent string `json:"reasoning_content"`
}) string {
	if v := strings.TrimSpace(msg.Reasoning); v != "" {
		return v
	}
	return strings.TrimSpace(msg.ReasoningContent)
}

type modelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

// ListModels 拉一份可用模型名，给面板的模型输入框做候选。
//
// 不是所有兼容服务都实现 /models（有的返回 404、有的要额外权限），所以调用方
// 必须把它当成「锦上添花」：失败不能让保存/对话跟着失败。
func (c *client) ListModels(ctx context.Context) ([]string, error) {
	if c.baseURL == "" {
		return nil, &apiError{Message: "还没有配置接口地址"}
	}
	var parsed modelsResponse
	if err := c.do(ctx, http.MethodGet, c.modelsEndpoint(), nil, &parsed); err != nil {
		return nil, err
	}
	seen := make(map[string]bool, len(parsed.Data))
	models := make([]string, 0, len(parsed.Data))
	for _, item := range parsed.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		models = append(models, id)
	}
	sort.Strings(models)
	if len(models) > 300 {
		models = models[:300]
	}
	return models, nil
}

// do 是唯一的出口：拼头、发请求、判状态码、解 JSON，错误统一成 apiError。
func (c *client) do(ctx context.Context, method, endpoint string, payload interface{}, out interface{}) error {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return &apiError{Message: "请求体构造失败：" + err.Error()}
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return &apiError{Message: "接口地址无效：" + err.Error()}
	}
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	// 本地/自建服务（Ollama 之类）不需要密钥：留空就不带 Authorization 头——
	// 某些实现见到空的 "Bearer " 反而直接 401。
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return &apiError{Message: connectionErrorText(c.baseURL, err)}
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return &apiError{Status: resp.StatusCode, Message: "读取上游响应失败：" + err.Error()}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &apiError{Status: resp.StatusCode, Message: upstreamErrorText(resp.StatusCode, raw, endpoint)}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return &apiError{
			Status:  resp.StatusCode,
			Message: "上游返回的不是合法 JSON（地址可能填成了网页）：" + truncateRunes(string(raw), 120),
		}
	}
	return nil
}

// statusHint 把常见状态码翻译成「下一步该查什么」。
func statusHint(status int) string {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return "API Key 无效或被拒绝"
	case http.StatusNotFound:
		return "接口地址不对（OpenAI 兼容地址通常以 /v1 结尾）"
	case http.StatusTooManyRequests:
		return "请求过于频繁或额度不足"
	case http.StatusBadRequest:
		return "上游认为请求不合法（常见原因：模型名不存在）"
	case http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return "上游服务暂时不可用"
	default:
		return "上游返回错误"
	}
}

// upstreamErrorText 拼出「人话 + 上游原文」的错误说明。
func upstreamErrorText(status int, raw []byte, endpoint string) string {
	detail := ""
	var envelope struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil {
		switch {
		case envelope.Error != nil && strings.TrimSpace(envelope.Error.Message) != "":
			detail = strings.TrimSpace(envelope.Error.Message)
		case strings.TrimSpace(envelope.Message) != "":
			detail = strings.TrimSpace(envelope.Message)
		}
	}
	if detail == "" {
		detail = truncateRunes(strings.TrimSpace(string(raw)), 160)
	}
	text := fmt.Sprintf("%s（HTTP %d）", statusHint(status), status)
	if detail != "" {
		text += "：" + detail
	}
	if endpoint != "" {
		text += "（请求地址 " + endpoint + "）"
	}
	return text
}

// connectionErrorText 区分「超时」与「连不上」：两者的排查方向完全不同。
func connectionErrorText(baseURL string, err error) string {
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return fmt.Sprintf("等待 %s 响应超时：模型可能太慢，或该地址从本机不通", baseURL)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Sprintf("等待 %s 响应超时", baseURL)
	}
	return fmt.Sprintf("无法连接 %s：%v", baseURL, err)
}

// truncateRunes 按字符（不是字节）截断，避免把中文切成乱码。
func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
