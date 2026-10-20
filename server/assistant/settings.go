// Package assistant 是「呼叫小秘」的服务端：把后台填写的模型参数（服务商、
// 接口地址、API Key、模型名）落成 sysconfig 的 Internal 配置，并对外只暴露
// 两个口子——管理员填参数（/api/assistant/admin/*）、登录用户对话
// （POST /api/assistant/chat）。
//
// **通用样式**是这里的核心口径：一律按 OpenAI 兼容协议说话
// （POST {base}/chat/completions、GET {base}/models），服务商只是几个预设值的
// 快捷方式（见 providerPresets）。任何兼容服务都能用 provider=custom 接进来，
// 后台改一下地址/模型名就能换模型，不用改代码、不用重启发版。
//
// 密钥不出服务端：浏览器只看得到掩码（maskSecret），对话请求由本包转发，
// 前端永远拿不到 API Key。
package assistant

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"smallgo/server/sysconfig"

	"gorm.io/gorm"
)

// AI 配置键。全部登记为**系统级 + Internal**。
//
// Internal 的含义见 sysconfig/registry.go：不出现在任何配置接口的列表里、
// 也不能通过通用配置接口改写。API Key 绝不能走 /api/configs 那条通道——
// 那里对所有管理员回显明文，还会把密钥摆进「系统配置」页面的配置项列表里。
const (
	keyEnabled      = "ai_enabled"
	keyProvider     = "ai_provider"
	keyBaseURL      = "ai_base_url"
	keyAPIKey       = "ai_api_key"
	keyModel        = "ai_model"
	keySystemPrompt = "ai_system_prompt"
	// keyUserPrompt 是「每个人自己的系统提示词」。0.35.0 之前系统提示词只有
	// 管理员能改；现在它是个人偏好：这个人写过就用他的，没写才回退到管理员
	// 设的默认值（keySystemPrompt）。
	keyUserPrompt = "ai_user_prompt"
	// keyAssistantName 是「每个人给自己的小秘起的名字」：空串 = 用默认的「小秘」。
	// 它不是密钥，随个人偏好一起同步；对话里、面板标题与系统提示词都用它。
	keyAssistantName = "ai_assistant_name"
	keyTimeout       = "ai_timeout_seconds"
	keyThinkingMode  = "ai_thinking_mode"
)

// defaultAssistantName 是没起名时的默认称呼。
const defaultAssistantName = "小秘"

// maxAssistantNameRunes 是名字长度上限：够起一个昵称，又不至于把面板标题撑开。
const maxAssistantNameRunes = 12

// maxUserPromptRunes 是个人系统提示词的长度上限。默认提示词约 230 字，2000
// 足够写清楚人设与边界，又不至于把每一轮请求都撑成一篇长文。
const maxUserPromptRunes = 2000

// 超时（秒）：太长会把一个卡住的上游拖成「转圈半分钟没反应」，太短会误杀
// 慢模型的长回答。默认 60，允许 5–600。
const (
	defaultTimeoutSeconds = 60
	minTimeoutSeconds     = 5
	maxTimeoutSeconds     = 600
)

const defaultProviderID = "deepseek"

// defaultSystemPrompt 是开箱即用的系统提示词。面板里可改：不同的人对「小秘」
// 的期待不一样（有人要点子，有人要周报草稿）。
//
// 关于【工作数据】：用户问周报这类问题时，服务端会把真实记录附在系统消息里
// （见 digest.go 的 digestSystemPrompt）。提示词里必须交代这一点，否则模型会把
// 那段数据当成用户粘贴的文本，或者干脆忽略它去编内容。
const defaultSystemPrompt = "你是「工作序记」里的助手小秘。用简体中文回答，语气简短、直接，不要客套。" +
	"用户会用一句话交代事情，例如「明天上午十点提醒我交周报」。" +
	"你不能替用户建立或修改数据：需要落成任务或记事时，明确告诉用户去点「新建提醒」，不要声称你已经建好了。" +
	"当消息里出现【工作数据】时，那是系统从用户自己的记录里取回的真实数据：只用它的条目与数字作答，不要添加没有出现的事项；" +
	"写周报、月报、总结或清单时按它的分组与时间组织，数据不够就直说。"

// providerPreset 是「OpenAI 兼容」口径下的一个服务商预设：只提供默认地址、
// 常见模型名与密钥申请入口。控件本身是通用的（地址/密钥/模型三个输入框），
// 预设只是省去用户去翻文档。
type providerPreset struct {
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	BaseURL     string   `json:"base_url"`
	Models      []string `json:"models"`
	KeyRequired bool     `json:"key_required"`
	KeyURL      string   `json:"key_url,omitempty"`
	Note        string   `json:"note,omitempty"`
}

// providerPresets 的顺序就是面板下拉框的顺序：先国内常用的，再国际的，
// 最后本地与自定义。
//
// 模型名只是**建议**（面板给 datalist 提示），不参与校验：服务商的模型名
// 变得快，写死一份允许列表只会让用户在新模型上线后填不进去。
var providerPresets = []providerPreset{
	{
		ID: "deepseek", Label: "DeepSeek（深度求索）",
		BaseURL:     "https://api.deepseek.com/v1",
		Models:      []string{"deepseek-chat", "deepseek-reasoner"},
		KeyRequired: true, KeyURL: "https://platform.deepseek.com/api_keys",
	},
	{
		ID: "siliconflow", Label: "硅基流动 SiliconFlow",
		BaseURL: "https://api.siliconflow.cn/v1",
		Models: []string{
			"deepseek-ai/DeepSeek-V3",
			"Qwen/Qwen2.5-7B-Instruct",
			"THUDM/glm-4-9b-chat",
		},
		KeyRequired: true, KeyURL: "https://cloud.siliconflow.cn/account/ak",
		Note: "一个 Key 通吃多家开源模型，模型名要带前缀（如 deepseek-ai/DeepSeek-V3）",
	},
	{
		ID: "moonshot", Label: "月之暗面 Kimi",
		BaseURL:     "https://api.moonshot.cn/v1",
		Models:      []string{"moonshot-v1-8k", "moonshot-v1-32k", "kimi-k2-0711-preview"},
		KeyRequired: true, KeyURL: "https://platform.moonshot.cn/console/api-keys",
	},
	{
		ID: "zhipu", Label: "智谱 GLM",
		BaseURL:     "https://open.bigmodel.cn/api/paas/v4",
		Models:      []string{"glm-4-flash", "glm-4-plus", "glm-4-air"},
		KeyRequired: true, KeyURL: "https://open.bigmodel.cn/usercenter/apikeys",
	},
	{
		ID: "dashscope", Label: "阿里云百炼（通义千问）",
		BaseURL:     "https://dashscope.aliyuncs.com/compatible-mode/v1",
		Models:      []string{"qwen-plus", "qwen-turbo", "qwen-max"},
		KeyRequired: true, KeyURL: "https://bailian.console.aliyun.com/",
		Note: "要用「兼容模式」的地址（含 compatible-mode），不是 DashScope 原生地址",
	},
	{
		ID: "openai", Label: "OpenAI",
		BaseURL:     "https://api.openai.com/v1",
		Models:      []string{"gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"},
		KeyRequired: true, KeyURL: "https://platform.openai.com/api-keys",
	},
	{
		ID: "ollama", Label: "本地 Ollama",
		BaseURL: "http://127.0.0.1:11434/v1",
		Models:  []string{"qwen2.5:7b", "qwen2.5:3b", "llama3.1:8b"},
		Note:    "本机跑模型，不需要 API Key。工作序记装在容器里时 127.0.0.1 指的是容器自己——点「检测本机 Ollama」，它会自动填宿主地址和这台机器上已下载的模型。",
	},
	{
		ID: "custom", Label: "自定义（任意 OpenAI 兼容接口）",
		Models: []string{},
		Note:   "兼容 POST {地址}/chat/completions 的服务都能接；地址一般以 /v1 结尾",
	},
}

// presetByID 按 id 取预设。
func presetByID(id string) (providerPreset, bool) {
	for _, preset := range providerPresets {
		if preset.ID == id {
			return preset, true
		}
	}
	return providerPreset{}, false
}

// providerIDs 是下拉框的可选值，同时用于注册表的 select 校验。
func providerIDs() []string {
	ids := make([]string, 0, len(providerPresets))
	for _, preset := range providerPresets {
		ids = append(ids, preset.ID)
	}
	return ids
}

// Settings 是「AI 助手」的全部可配置项。
type Settings struct {
	Enabled        bool
	Provider       string
	BaseURL        string
	APIKey         string
	Model          string
	SystemPrompt   string
	TimeoutSeconds int
	// ThinkingMode 是「对话里显示思考过程」的后台偏好（off/brief/full，见
	// thinking.go）。用户可在面板上临时换，后台这份是默认值。
	ThinkingMode string
}

// configValue 读一个 AI 配置项：库里有值就用库里的，否则退回注册表默认值。
//
// 用「空串即未设」判断而不是区分「没这行」和「这行是空串」：后台清空地址的
// 语义就是「跟随所选服务商的预设地址」，与默认值（空串）一致，不需要额外标记。
func configValue(db *gorm.DB, key string) string {
	value := ""
	if def, ok := sysconfig.GetConfigDef(key); ok {
		value = def.Default
	}
	if v, err := sysconfig.GetConfig(db, key, 0); err == nil && strings.TrimSpace(v) != "" {
		value = v
	}
	return value
}

// userSystemPrompt 读这个人自己的系统提示词；没写过就是空串。
// userID 为 0（后台/测试没有当前用户）时直接返回空，绝不回退去读别人的行。
func userSystemPrompt(db *gorm.DB, userID uint) string {
	if userID == 0 {
		return ""
	}
	v, err := sysconfig.GetConfig(db, keyUserPrompt, userID)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// effectiveSystemPrompt 给出这一轮真正要用的系统提示词：本人的优先，
// 没写就用管理员设的默认值（settings.SystemPrompt，默认值是内置文案）。
// assistantName 读这个人给小秘起的名字；没设置或配置坏了就是空串（由界面回退到「小秘」）。
func assistantName(db *gorm.DB, userID uint) string {
	if userID == 0 {
		return ""
	}
	v, err := sysconfig.GetConfig(db, keyAssistantName, userID)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// personalizePrompt 把系统提示词里的默认称呼换成用户起的名字，并先声明一次身份。
// 自定义名字为空（或就是「小秘」）时原样返回，避免在默认提示词里重复声明。
func personalizePrompt(prompt, name string) string {
	name = strings.TrimSpace(name)
	if name == "" || name == defaultAssistantName {
		return prompt
	}
	prompt = strings.ReplaceAll(prompt, defaultAssistantName, name)
	return "你的名字叫「" + name + "」，请始终用这个名字称呼自己。\n\n" + prompt
}

func effectiveSystemPrompt(db *gorm.DB, userID uint, fallback string) string {
	if v := userSystemPrompt(db, userID); v != "" {
		return v
	}
	return strings.TrimSpace(fallback)
}

// loadSettings 读出当前生效的设置；缺项/脏值一律退回默认值，绝不返回错误——
// 它是对话热路径上的调用，一条被手工改坏的配置不该让整个助手不可用。
func loadSettings(db *gorm.DB) Settings {
	timeout, err := strconv.Atoi(strings.TrimSpace(configValue(db, keyTimeout)))
	if err != nil || timeout < minTimeoutSeconds || timeout > maxTimeoutSeconds {
		timeout = defaultTimeoutSeconds
	}
	settings := Settings{
		Enabled:        configValue(db, keyEnabled) == "true",
		Provider:       configValue(db, keyProvider),
		BaseURL:        configValue(db, keyBaseURL),
		APIKey:         strings.TrimSpace(configValue(db, keyAPIKey)),
		Model:          strings.TrimSpace(configValue(db, keyModel)),
		SystemPrompt:   strings.TrimSpace(configValue(db, keySystemPrompt)),
		TimeoutSeconds: timeout,
		ThinkingMode:   normalizeThinkingMode(configValue(db, keyThinkingMode)),
	}
	if _, ok := presetByID(settings.Provider); !ok {
		settings.Provider = defaultProviderID
	}
	return settings
}

// effectiveBaseURL 返回真正要请求的接口根地址：后台填了地址就用它，留空则跟随
// 所选服务商的预设地址（「通用样式」：换服务商只改一个下拉框）。
func (s Settings) effectiveBaseURL() string {
	if s.BaseURL != "" {
		return s.BaseURL
	}
	if preset, ok := presetByID(s.Provider); ok {
		return preset.BaseURL
	}
	return ""
}

// preset 返回当前服务商的预设（一定取得到：loadSettings 会把未知 id 归一化）。
func (s Settings) preset() providerPreset {
	preset, _ := presetByID(s.Provider)
	return preset
}

// ready 表示「参数齐了、可以直接对话」。与 Enabled 分开：启用是意愿，ready 是
// 条件——面板要能说清「你开了，但还差个模型名」。
func (s Settings) ready() bool {
	return s.blockedReason(false) == ""
}

// blockedReason 说明「为什么还不能用」，给面板/接口调用方直接显示。
// includeDisabled 为 true 时把「未启用」也算一条原因（面板提示用）。
func (s Settings) blockedReason(includeDisabled bool) string {
	if includeDisabled && !s.Enabled {
		return "AI 助手未启用"
	}
	if s.effectiveBaseURL() == "" {
		return "还没有填写接口地址"
	}
	if s.Model == "" {
		return "还没有填写模型名称"
	}
	if s.preset().KeyRequired && s.APIKey == "" {
		return "还没有填写 API Key"
	}
	return ""
}

// active 是前端真正关心的状态：启用且参数齐全，说话时会真的走模型。
func (s Settings) active() bool {
	return s.Enabled && s.ready()
}

// maskSecret 把密钥变成能给人看的样子：只留头 4 位与尾 4 位，中间省略。
//
// 面板要能显示「已经填过一个 Key」（否则用户无法判断该不该重填），又不能
// 把完整的密钥送进浏览器（一次 XSS、一张截图就漏了）。短密钥一律全遮。
func maskSecret(value string) string {
	runes := []rune(strings.TrimSpace(value))
	switch {
	case len(runes) == 0:
		return ""
	case len(runes) <= 8:
		return strings.Repeat("•", len(runes))
	default:
		return string(runes[:4]) + "…" + string(runes[len(runes)-4:])
	}
}

// normalizeBaseURL 把用户填的地址整理成可直接拼接的形式，并挡掉明显填错的输入。
//
// 允许直接粘完整的对话地址（.../v1/chat/completions）：用户从文档里复制的往往
// 就是这一整条，让他自己删掉尾巴很容易删错——这里统一剥掉，只留根地址。
func normalizeBaseURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	if !strings.Contains(value, "://") {
		// 常见输入：api.deepseek.com/v1（漏了协议）。补 http:// 反而更糟——公网
		// 服务必须走 https，所以这里明确要求写全，避免把密钥明文发出去。
		return "", fmt.Errorf("接口地址要以 http:// 或 https:// 开头")
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("接口地址无法解析：%v", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("接口地址只支持 http:// 或 https://")
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("接口地址缺少主机名，例如 https://api.deepseek.com/v1")
	}
	path := strings.TrimSuffix(parsed.Path, "/")
	for _, suffix := range []string{"/chat/completions", "/completions"} {
		if strings.HasSuffix(path, suffix) {
			path = strings.TrimSuffix(path, suffix)
			break
		}
	}
	parsed.Path = strings.TrimSuffix(path, "/")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

// settingsInput 是保存接口的入参（也是「测试连接」可选的草稿参数）。
type settingsInput struct {
	Enabled        bool   `json:"enabled"`
	Provider       string `json:"provider"`
	BaseURL        string `json:"base_url"`
	APIKey         string `json:"api_key"`
	ClearAPIKey    bool   `json:"clear_api_key"`
	Model          string `json:"model"`
	SystemPrompt   string `json:"system_prompt"`
	TimeoutSeconds int    `json:"timeout_seconds"`
	ThinkingMode   string `json:"thinking_mode"`
}

// apply 在既有设置上套用入参，返回一份**未落库**的新设置（校验也在这里做）。
//
// 两条容易踩的规则：
//   - api_key 留空表示「不改」（面板不回显完整密钥，用户只改模型名时不该把
//     密钥顺手清掉）；真要清空走 clear_api_key。
//   - base_url 留空表示「跟随服务商预设地址」，这是通用样式的一部分，不是漏填。
func (in settingsInput) apply(current Settings) (Settings, error) {
	provider := strings.TrimSpace(in.Provider)
	if provider == "" {
		provider = defaultProviderID
	}
	if _, ok := presetByID(provider); !ok {
		return current, fmt.Errorf("未知的服务商：%s", provider)
	}

	baseURL, err := normalizeBaseURL(in.BaseURL)
	if err != nil {
		return current, err
	}

	model := strings.TrimSpace(in.Model)
	if len([]rune(model)) > 200 {
		return current, fmt.Errorf("模型名称过长")
	}

	apiKey := strings.TrimSpace(in.APIKey)
	switch {
	case in.ClearAPIKey:
		apiKey = ""
	case apiKey == "":
		apiKey = current.APIKey
	}
	if len([]rune(apiKey)) > 500 {
		return current, fmt.Errorf("API Key 过长")
	}

	prompt := strings.TrimSpace(in.SystemPrompt)
	if len([]rune(prompt)) > 4000 {
		return current, fmt.Errorf("系统提示词最多 4000 字")
	}

	timeout := in.TimeoutSeconds
	if timeout == 0 {
		timeout = defaultTimeoutSeconds
	}
	if timeout < minTimeoutSeconds || timeout > maxTimeoutSeconds {
		return current, fmt.Errorf("超时时间要在 %d–%d 秒之间", minTimeoutSeconds, maxTimeoutSeconds)
	}

	thinking := strings.TrimSpace(in.ThinkingMode)
	if thinking == "" {
		thinking = current.ThinkingMode
	}
	if thinking == "" {
		thinking = defaultThinkingMode
	}
	if !validThinkingMode(thinking) {
		return current, fmt.Errorf("思考过程显示口径不支持：%s", thinking)
	}

	next := Settings{
		Enabled:        in.Enabled,
		Provider:       provider,
		BaseURL:        baseURL,
		APIKey:         apiKey,
		Model:          model,
		SystemPrompt:   prompt,
		TimeoutSeconds: timeout,
		ThinkingMode:   thinking,
	}
	// 开启时必须是「参数齐全」的状态：半套设置（比如开了但没模型名）会让用户
	// 点开面板就收到报错，不如保存时直接说清差什么。
	if next.Enabled {
		if reason := next.blockedReason(false); reason != "" {
			return current, fmt.Errorf("启用 AI 助手前请先补全：%s", reason)
		}
	}
	return next, nil
}

// saveSettings 校验并落库。任何一项不合法都整体拒绝，不留半套配置。
func saveSettings(db *gorm.DB, in settingsInput) (Settings, error) {
	next, err := in.apply(loadSettings(db))
	if err != nil {
		return Settings{}, err
	}
	values := map[string]string{
		keyEnabled:      strconv.FormatBool(next.Enabled),
		keyProvider:     next.Provider,
		keyBaseURL:      next.BaseURL,
		keyAPIKey:       next.APIKey,
		keyModel:        next.Model,
		keySystemPrompt: next.SystemPrompt,
		keyTimeout:      strconv.Itoa(next.TimeoutSeconds),
		keyThinkingMode: next.ThinkingMode,
	}
	for key, value := range values {
		if err := sysconfig.UpdateConfig(db, key, value, 0); err != nil {
			return Settings{}, fmt.Errorf("保存失败：%v", err)
		}
	}
	return next, nil
}
