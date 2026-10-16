package assistant

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"smallgo/server/logger"
	"smallgo/server/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 一次对话的规模上限：这是「一句话交代事情」的助手，不是长文档摘要工具。
// 挡住超大请求既是保护上游账单，也是保护本机内存（请求体本身另有 1MB 的
// 全局限制，见 middleware.LimitJSONBody）。
const (
	maxMessages      = 40
	maxMessageRunes  = 8000
	maxTotalRunes    = 48000
	maxConcurrentAsk = 4
)

// chatSem 限制同时进行中的对话数：每轮对话都要花上游配额、占一条长连接。
// 满了直接让用户重试，比排一长队把每个人拖到超时更好。
var chatSem = make(chan struct{}, maxConcurrentAsk)

// handleStatus 给面板用的状态：**不含**接口地址与密钥，任何登录用户都能看。
// 面板据此决定是显示「模型已接入 · deepseek-chat」还是走占位回复。
func handleStatus(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		settings := loadSettings(db)
		response.Success(c, gin.H{
			"enabled":        settings.Enabled,
			"ready":          settings.ready(),
			"active":         settings.active(),
			"provider":       settings.Provider,
			"provider_label": settings.preset().Label,
			"model":          settings.Model,
			"reason":         settings.blockedReason(true),
			// 面板要按这个值放宽自己的请求超时：本地小模型（Ollama）首答要等模型
			// 加载，前端那 30 秒的默认超时会把还在跑的请求掐成「网络错误」。
			"timeout_seconds": settings.TimeoutSeconds,
		})
	}
}

// handleChat 是「呼叫小秘」唯一的对话入口：前端把整段对话发过来，这里加上
// 后台配置的系统提示词，转发给模型，再把这一轮的回复返回。
//
// 密钥只在服务端：前端从头到尾拿不到 API Key，也就不存在「浏览器直连模型、
// 把密钥写进前端」的漏洞面。
func handleChat(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Messages []Message `json:"messages"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			response.ErrorBadRequest(c, "请求格式不对：需要 { messages: [{ role, content }] }")
			return
		}
		settings := loadSettings(db)
		if !settings.Enabled {
			response.ErrorBadRequest(c, "AI 助手未启用：请在「系统配置 → AI 助手」里开启并填好模型参数")
			return
		}
		if reason := settings.blockedReason(false); reason != "" {
			response.ErrorBadRequest(c, "AI 助手配置还没填完："+reason+"（系统配置 → AI 助手）")
			return
		}
		messages, err := normalizeMessages(body.Messages)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		select {
		case chatSem <- struct{}{}:
			defer func() { <-chatSem }()
		default:
			response.Error(c, http.StatusTooManyRequests, 429, "同时在聊的人有点多，请稍等一下再发")
			return
		}

		payload := messages
		if settings.SystemPrompt != "" {
			payload = append([]Message{{Role: "system", Content: settings.SystemPrompt}}, messages...)
		}
		started := time.Now()
		result, err := newClient(settings).Chat(c.Request.Context(), payload)
		if err != nil {
			// 日志里**不写密钥**：apiError 的文案里本来就没有密钥，上游原文可能
			// 带请求 id，留着便于对账。
			logger.Warn("assistant: 对话失败（provider=%s model=%s）：%v", settings.Provider, settings.Model, err)
			response.Error(c, http.StatusBadGateway, 502, err.Error())
			return
		}
		logger.Info("assistant: 对话完成（model=%s，耗时 %dms，提示 %d / 回复 %d tokens）",
			result.Model, time.Since(started).Milliseconds(), result.PromptTokens, result.CompletionTokens)
		response.Success(c, gin.H{
			"reply": result.Reply,
			"model": result.Model,
			"usage": gin.H{
				"prompt_tokens":     result.PromptTokens,
				"completion_tokens": result.CompletionTokens,
			},
			"duration_ms": time.Since(started).Milliseconds(),
		})
	}
}

// normalizeMessages 清洗前端发来的对话：角色白名单、单条与总量长度、空消息。
//
// 不信任前端：这段对话会按 token 计费，也是提示词注入的入口（用户可以把
// 「忽略之前的指令」写进消息里，所以系统提示词由服务端**在保存时固定下来**，
// 前端无权覆盖——见 handleChat 里 system 角色只来自配置）。
func normalizeMessages(raw []Message) ([]Message, error) {
	out := make([]Message, 0, len(raw))
	total := 0
	for _, item := range raw {
		role := strings.TrimSpace(item.Role)
		content := strings.TrimSpace(item.Content)
		if content == "" {
			continue
		}
		switch role {
		case "user", "assistant":
			// system 不放行：系统提示词只由服务端在 handleChat 里前置拼接
			// （见上面的注释），前端若能自己塞一条 role=system 就能顶掉它。
		default:
			return nil, fmt.Errorf("消息角色不支持：%s", role)
		}
		size := len([]rune(content))
		if size > maxMessageRunes {
			return nil, fmt.Errorf("单条消息最多 %d 字", maxMessageRunes)
		}
		total += size
		out = append(out, Message{Role: role, Content: content})
	}
	if len(out) == 0 {
		return nil, errors.New("消息内容为空")
	}
	if len(out) > maxMessages {
		return nil, fmt.Errorf("一次最多 %d 条消息", maxMessages)
	}
	if total > maxTotalRunes {
		return nil, fmt.Errorf("本次对话内容过长，最多 %d 字", maxTotalRunes)
	}
	// 面板会把整段历史都发过来，首条可能是上次的回复（assistant）。多数上游
	// 要求首条是 user，这里把开头的 assistant 去掉（丢掉的是界面上的旧回复，
	// 不是用户刚说的话）。
	for len(out) > 1 && out[0].Role == "assistant" {
		out = out[1:]
	}
	return out, nil
}

// settingsView 是「系统配置 → AI 助手」面板的完整视图。密钥只回掩码。
type settingsView struct {
	Enabled          bool             `json:"enabled"`
	Provider         string           `json:"provider"`
	BaseURL          string           `json:"base_url"`
	APIKey           string           `json:"api_key"`
	APIKeySet        bool             `json:"api_key_set"`
	Model            string           `json:"model"`
	SystemPrompt     string           `json:"system_prompt"`
	TimeoutSeconds   int              `json:"timeout_seconds"`
	EffectiveBaseURL string           `json:"effective_base_url"`
	Ready            bool             `json:"ready"`
	Active           bool             `json:"active"`
	Reason           string           `json:"reason"`
	DefaultPrompt    string           `json:"default_system_prompt"`
	Providers        []providerPreset `json:"providers"`
}

func buildSettingsView(s Settings) settingsView {
	return settingsView{
		Enabled:          s.Enabled,
		Provider:         s.Provider,
		BaseURL:          s.BaseURL,
		APIKey:           maskSecret(s.APIKey),
		APIKeySet:        s.APIKey != "",
		Model:            s.Model,
		SystemPrompt:     s.SystemPrompt,
		TimeoutSeconds:   s.TimeoutSeconds,
		EffectiveBaseURL: s.effectiveBaseURL(),
		Ready:            s.ready(),
		Active:           s.active(),
		Reason:           s.blockedReason(true),
		DefaultPrompt:    defaultSystemPrompt,
		Providers:        providerPresets,
	}
}

func handleGetSettings(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		response.Success(c, buildSettingsView(loadSettings(db)))
	}
}

func handleSaveSettings(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var in settingsInput
		if err := c.ShouldBindJSON(&in); err != nil {
			response.ErrorBadRequest(c, "请求格式不对")
			return
		}
		next, err := saveSettings(db, in)
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		// 写日志但**不写密钥**：改了哪个服务商/模型是运维要看的信息。
		logger.Info("assistant: 设置已更新（enabled=%t provider=%s model=%s timeout=%ds key=%s）",
			next.Enabled, next.Provider, next.Model, next.TimeoutSeconds, maskSecret(next.APIKey))
		// 直接回新视图：面板保存后不用再拉一次，也顺手拿到重新计算的 ready/reason。
		response.Success(c, buildSettingsView(next))
	}
}

// handleTest 是面板上的「测试连接」：先按 OpenAI 兼容协议拉一次模型列表；
// 有些服务没实现 /models（404/403），那就退一步用一次最小对话来验
// 「地址 + 密钥 + 模型名」这条链路。
//
// 允许带草稿参数（面板上改了还没保存就先试）：草稿里留空的字段沿用已保存的值，
// 密钥同理——前端不回显完整密钥，不回传也不该被当成「清空」。
func handleTest(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		current := loadSettings(db)
		var in settingsInput
		if c.Request.ContentLength > 0 {
			if err := c.ShouldBindJSON(&in); err != nil {
				response.ErrorBadRequest(c, "请求格式不对")
				return
			}
		}
		draft := current
		// 空请求体或 `{}`（这回没给草稿）＝ 就测已保存的那套设置。
		// 不能一律走 apply：apply 会把没填的字段当成「清空」（model 会被清成空），
		// 于是「测一下当前配置」反而报「还没有填写模型名称」。
		if in != (settingsInput{}) {
			next, err := in.apply(current)
			if err != nil {
				response.ErrorBadRequest(c, err.Error())
				return
			}
			draft = next
		}
		if reason := draft.blockedReason(false); reason != "" {
			// 不算失败：只是还没填完，面板上照原样显示这句话。
			response.Success(c, gin.H{"ok": false, "detail": "还差一步：" + reason})
			return
		}

		api := newClient(draft)
		ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(draft.TimeoutSeconds)*time.Second)
		defer cancel()

		started := time.Now()
		models, listErr := api.ListModels(ctx)
		if listErr == nil {
			if len(models) == 0 {
				models = []string{draft.Model}
			}
			response.Success(c, gin.H{
				"ok":         true,
				"detail":     fmt.Sprintf("连接正常，可用模型 %d 个", len(models)),
				"models":     models,
				"endpoint":   api.modelsEndpoint(),
				"latency_ms": time.Since(started).Milliseconds(),
				"via":        "models",
			})
			return
		}

		replyStart := time.Now()
		result, chatErr := api.Chat(ctx, []Message{{Role: "user", Content: "请只回两个字：收到"}})
		if chatErr == nil {
			response.Success(c, gin.H{
				"ok":         true,
				"detail":     "连接正常（该服务没有可用的模型列表接口，已用一次真实对话验证）：模型回了「" + truncateRunes(result.Reply, 40) + "」",
				"models":     []string{draft.Model},
				"endpoint":   api.chatEndpoint(),
				"latency_ms": time.Since(replyStart).Milliseconds(),
				"via":        "chat",
			})
			return
		}

		// 两条路都不通：优先报对话那条——它验证的东西更多（模型名也要对）。
		// 只有对话那条说不出人话（非 apiError）时，才退回模型列表的错误。
		detail := chatErr.Error()
		if _, ok := asAPIError(chatErr); !ok {
			if _, listOk := asAPIError(listErr); listOk {
				detail = listErr.Error()
			}
		}
		logger.Warn("assistant: 测试连接失败（provider=%s model=%s）：%v", draft.Provider, draft.Model, detail)
		response.Success(c, gin.H{
			"ok":         false,
			"detail":     detail,
			"endpoint":   api.modelsEndpoint(),
			"latency_ms": time.Since(started).Milliseconds(),
		})
	}
}
