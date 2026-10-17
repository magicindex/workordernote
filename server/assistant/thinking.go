package assistant

import "strings"

// 对话里「思考过程」的显示口径。
//
// 思考模型（qwen3、deepseek-r1 这类）会把思维链单独返回，正式回答另放一段。
// 三种模式只决定「服务端怎么对待这段思维链、面板给不给看」：
//
//   - off   只有对话：思维链直接丢掉，面板只看得到正式回答；
//   - brief 简洁思考（默认）：只留开头一小段，当一行小字附在回答下面；
//   - full  详细思考过程：整段思维链都给面板，折叠在「思考过程」里。
//
// **不向上游发任何旗标**：各家的「少想一点」开关（Ollama 的 think、
// OpenAI 的 reasoning_effort）行为不一，实测同一句话的思维链长度在开关之间
// 随机波动（4B 模型 1000–2100 字），既省不了时间也会让回答质量忽好忽坏。
// 所以这里只谈展示，界面文案也照实说「模型仍然会先想」。
const (
	ThinkingOff   = "off"
	ThinkingBrief = "brief"
	ThinkingFull  = "full"

	defaultThinkingMode = ThinkingBrief

	// brief 模式最多留多少字：一行小字够用就行，太长会把正式回答挤下去。
	briefThinkingRunes = 120
)

// thinkingModeOptions 是后台下拉与面板按钮的取值，顺序即展示顺序。
var thinkingModeOptions = []string{ThinkingOff, ThinkingBrief, ThinkingFull}

// normalizeThinkingMode 把任意输入归一化：认不出的一律退回默认（简洁思考）。
// 值来自配置或前端，两处都可能写脏，不在这里报错——顶多退回默认。
func normalizeThinkingMode(value string) string {
	v := strings.TrimSpace(value)
	for _, opt := range thinkingModeOptions {
		if v == opt {
			return opt
		}
	}
	return defaultThinkingMode
}

// validThinkingMode 判断取值是否是三个支持的档位（保存时用：值不合法要报错，
// 不像 loadSettings 那样静默退回默认）。
func validThinkingMode(value string) bool {
	for _, opt := range thinkingModeOptions {
		if value == opt {
			return true
		}
	}
	return false
}

// thinkingPayload 按模式裁出这一轮回给面板的思维链。truncated 表示「这段是
// 掐头去尾的」，面板据此在行尾加个省略号，不假装完整。
func thinkingPayload(mode, reasoning string) (text string, truncated bool) {
	reasoning = strings.TrimSpace(reasoning)
	switch normalizeThinkingMode(mode) {
	case ThinkingOff:
		return "", false
	case ThinkingFull:
		return reasoning, false
	default:
		flat := strings.Join(strings.Fields(reasoning), " ")
		runes := []rune(flat)
		if len(runes) <= briefThinkingRunes {
			return flat, false
		}
		return string(runes[:briefThinkingRunes]), true
	}
}
