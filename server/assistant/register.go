package assistant

import (
	"smallgo/server/sysconfig"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 系统级 + Internal 的注册方式是本包的关键取舍：
//
//   - **系统级**：模型参数是全站一份（谁登录都用同一个模型），不是每个用户
//     各填一份——否则一个家庭/NAS 上人人都要自备 Key。
//   - **Internal**：不出现在任何配置接口的列表里、也不能通过通用配置接口改写。
//     API Key 更不能走 /api/configs ——那条通道对所有管理员回显明文，还会把
//     密钥摆进「系统配置」页面的配置项列表里。这里的读接口只回掩码，写接口
//     只认 /api/assistant/admin/*（管理员 + 审计）。
func init() {
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keyEnabled, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeBool,
		Default: "false", Internal: true, Group: "assistant", Label: "启用 AI 助手",
		Description: "开启后「呼叫小秘」才会真的调用模型；关闭时面板走本地占位回复",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keyProvider, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeSelect,
		Default: defaultProviderID, Internal: true, Options: providerIDs(),
		Group: "assistant", Label: "模型服务商",
		Description: "预设只是帮你填好地址与常见模型名；任何 OpenAI 兼容服务都选「自定义」",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keyBaseURL, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Default: "", Internal: true, Group: "assistant", Label: "接口地址",
		Description: "OpenAI 兼容根地址（一般以 /v1 结尾）；留空表示跟随所选服务商的默认地址",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keyAPIKey, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Default: "", Internal: true, Group: "assistant", Label: "API Key",
		Description: "只保存在服务端，接口只回掩码；本地 Ollama 之类可以留空",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keyModel, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Default: "", Internal: true, Group: "assistant", Label: "模型名称",
		Description: "例如 deepseek-chat；服务商上线新模型时直接填名字即可，不用改代码",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keySystemPrompt, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeString,
		Default: defaultSystemPrompt, Internal: true, Group: "assistant", Label: "系统提示词",
		Description: "每轮对话都由服务端加在最前面，决定小秘的人设与边界",
	})
	// 个人系统提示词：每个人一份，放在偏好设置里改；Internal 让它不出现在
	// 通用配置接口的列表里（读写走 /api/assistant/prompts）。
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keyUserPrompt, Scope: sysconfig.ScopeUser, Type: sysconfig.TypeString,
		Default: "", Internal: true, Group: "assistant", Label: "我的系统提示词",
		Description: "只影响你自己和小秘的对话；留空则使用管理员设的默认提示词",
	})
	// 小秘名称：每个人自己起（个人偏好，随账号同步）。留空就是默认的「小秘」。
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keyAssistantName, Scope: sysconfig.ScopeUser, Type: sysconfig.TypeString,
		Default: "", Internal: true, Group: "assistant", Label: "小秘名称",
		Description: "你给小秘起的名字，会用在对话面板、问候语和系统提示词里；留空就是「小秘」",
	})
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keyTimeout, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeInt,
		Default: "60", Internal: true, Group: "assistant", Label: "请求超时（秒）",
		Description: "等模型回答的最长时间，5–600 秒",
	})
	// 思考过程显示口径：默认「简洁思考」。做成后台偏好是因为它关乎每个人的
	// 阅读习惯与回答质量——有人只要结论，有人要把模型的推理看全。
	sysconfig.RegisterConfig(sysconfig.ConfigDef{
		Key: keyThinkingMode, Scope: sysconfig.ScopeSystem, Type: sysconfig.TypeSelect,
		Default: defaultThinkingMode, Internal: true, Options: thinkingModeOptions,
		Group: "assistant", Label: "对话里显示思考过程",
		Description: "只影响面板显不显示模型先想的那一段：只有对话 / 简洁思考（默认）/ 详细思考过程；模型本身仍然会思考",
	})
}

// RegisterRoutes 挂上 AI 助手的路由。
//
// 对话与状态给**登录用户**（面板在侧栏，人人可见）；参数读写只给**管理员**
// （adminGroup 已带 RequireAdmin + 审计日志）。
func RegisterRoutes(auth *gin.RouterGroup, admin *gin.RouterGroup, db *gorm.DB) {
	auth.GET("/assistant/status", handleStatus(db))
	auth.POST("/assistant/chat", handleChat(db))
	// 把小秘的一段回答存进记事本（标题与标签由服务端自动生成）：
	// 与对话一样是每个用户自己的数据，所以挂登录用户组。
	auth.POST("/assistant/notes", handleSaveNote(db))
	// 个人提示词：登录用户读写自己的（系统提示词）。各栏目的提示词存在清单上，
	// 走 /api/reminder/lists/:id 的 ai_prompt 字段。
	auth.GET("/assistant/prompts", handleGetPromptPrefs(db))
	auth.PUT("/assistant/prompts", handleSavePromptPrefs(db))

	admin.GET("/assistant/admin/settings", handleGetSettings(db))
	admin.PUT("/assistant/admin/settings", handleSaveSettings(db))
	admin.POST("/assistant/admin/test", handleTest(db))
	admin.POST("/assistant/admin/detect-ollama", handleDetectOllama(db))
}
