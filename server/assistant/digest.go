package assistant

import (
	"errors"
	"strings"

	"gorm.io/gorm"
)

// 这个文件把小秘与「工作数据」接起来：用户在面板上选的时间段（或话里的
// 「上周」「本月」这类时间词）会变成一份真实数据快照，随对话一起交给模型。
//
// 装配数据需要读提醒/清单/完成记录，那是 server/reminder 的地盘；但 assistant
// **不能** import reminder —— reminder 的测试 import 了 server，而 server 又
// import assistant，反向依赖会让 `go test ./reminder/` 直接 import cycle 失败。
// 所以这里只定义「要什么、给什么」的接口，实现在启动时注入（server/main.go，
// 与 reminder.SetUploadDir 同一套做法）。

// WorkDigestRequest 描述这一次要附的工作数据口径。Option 与 Keyword 都为空时，
// 数据层会看一眼 Text（用户刚说的那句话）里有没有「上周」「近 7 天」这类时间词。
type WorkDigestRequest struct {
	Option  string
	From    string
	To      string
	Keyword string
	Text    string
}

// WorkDigestResult 是数据层回给助手的东西：
//   - Markdown：给模型看的紧凑数据（随系统消息下发）；
//   - Draft：没有模型时直接给用户看的草稿；
//   - 其余字段：面板上那行「已附上 …」的摘要。
//
// Found=false 表示这句话里既没有时间段也没有口径 —— 这一轮不附数据，按普通聊天走。
type WorkDigestResult struct {
	Found     bool
	Option    string
	Label     string
	Start     string
	End       string
	Keyword   string
	ListID    uint
	ListName  string
	Completed int
	Open      int
	Overdue   int
	Notes     int
	Lists     int
	Courses   int
	Truncated bool
	Markdown  string
	Draft     string
	// ListPrompts：这次数据范围里出现过的栏目各自写的 AI 提示词
	// （用户在清单上填的「这一栏该怎么分析」）。只进系统提示词，不进面板摘要。
	ListPrompts []ListPrompt
}

// ListPrompt 是某个栏目的分析要求（来自该清单的 ai_prompt）。
type ListPrompt struct {
	Name   string
	Prompt string
}

// WorkDigestProvider 由业务包实现（server/reminder 的 WorkDigest 装配），
// 在 server/main.go 启动时注入。
type WorkDigestProvider func(db *gorm.DB, userID uint, req WorkDigestRequest) (WorkDigestResult, error)

var workDigestProvider WorkDigestProvider

// RegisterWorkDigestProvider 注入实现，只在启动时调用一次。
func RegisterWorkDigestProvider(fn WorkDigestProvider) { workDigestProvider = fn }

// digestInput 是前端选定的工作数据口径。Option 与「已完成」页的筛选同名
// （today/yesterday/week/lastweek/month/lastmonth/year/custom），另有 open
// 表示「当前还没做完」。
type digestInput struct {
	Option  string `json:"option"`
	From    string `json:"from"`
	To      string `json:"to"`
	Keyword string `json:"keyword"`
}

// digestView 是回给面板的「这一轮附了什么数据」摘要（条目正文在 reply 里）。
type digestView struct {
	Option    string `json:"option"`
	Label     string `json:"label"`
	Start     string `json:"start,omitempty"`
	End       string `json:"end,omitempty"`
	Keyword   string `json:"keyword,omitempty"`
	ListName  string `json:"list_name,omitempty"`
	Completed int    `json:"completed"`
	Open      int    `json:"open"`
	Overdue   int    `json:"overdue"`
	Notes     int    `json:"notes"`
	Lists     int    `json:"lists"`
	Courses   int    `json:"courses"`
	Truncated bool   `json:"truncated"`
}

// resolveDigest 取出这一轮要附的工作数据；found=false 表示不需要附。
func resolveDigest(db *gorm.DB, userID uint, in *digestInput, messages []Message) (WorkDigestResult, bool, error) {
	wanted := in != nil
	if workDigestProvider == nil {
		if wanted {
			// 面板明确要了数据却没装配（只有测试或异常启动会这样）：说清楚，
			// 别让用户以为「选了时间段」却拿到普通聊天。
			return WorkDigestResult{}, false, errors.New("工作数据模块还没就绪，请稍后再试")
		}
		return WorkDigestResult{}, false, nil
	}
	req := WorkDigestRequest{Text: lastUserText(messages)}
	if in != nil {
		req.Option, req.From, req.To, req.Keyword = in.Option, in.From, in.To, in.Keyword
	}
	result, err := workDigestProvider(db, userID, req)
	if err != nil {
		return WorkDigestResult{}, false, err
	}
	return result, result.Found, nil
}

// lastUserText 取最后一条用户消息（时间词识别只看用户刚说的这句）。
func lastUserText(messages []Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return messages[i].Content
		}
	}
	return ""
}

// digestSystemPrompt 把系统提示词与工作数据拼成一条 system 消息。
//
// 数据放在系统消息里而不是用户消息里：它是服务端取的、用户改不了的事实，
// 跟「角色与边界」同级；写进用户消息则会被当成用户的话，容易被后续
// 「忽略上面的内容」这类提示词顶掉。
func digestSystemPrompt(base string, digest WorkDigestResult) string {
	if strings.TrimSpace(base) == "" {
		base = defaultSystemPrompt
	}
	prompt := base + "\n\n" + digest.Markdown
	if block := listPromptBlock(digest.ListPrompts); block != "" {
		prompt += "\n\n" + block
	}
	return prompt + "\n\n" +
		"（上面的【工作数据】是系统从用户自己的记录里取回的真实数据，用户看不到它。" +
		"回答只用这些条目与数字，不要添加没有出现的事项；数据不够就直说。" +
		"写周报/月报/年报时，给成一份可以直接交上去的中文总结：先用一句话总览，" +
		"再按清单分组列完成情况，最后点出逾期与未完成项、以及建议的下一步；" +
		"不要客套话，也不要重复罗列原始条目。）"
}

// listPromptPromptMaxRunes 单条栏目提示词下发给模型的长度上限。
// 用户在清单上最多能写 600 字，但那是「管理界面允许的上限」；真塞给模型时
// 每条压缩到 400 字以内，四条也才 1600 字，不会把工作数据挤走。
const listPromptPromptMaxRunes = 400

// listPromptBlock 把各栏目的 AI 提示词拼成一段。
//
// 刻意写清「这是用户为某一栏写的分析要求」：模型很容易把这些话当成
// 全局指令；分栏列出、点名只作用于对应栏目的数据，才能让「工作安排要多说
// 进度」「信用卡只报应还」这类要求各管各的。
func listPromptBlock(prompts []ListPrompt) string {
	if len(prompts) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("【各栏目的分析要求】（用户为清单写的，只作用于该栏目的数据，不影响整体口径）")
	for _, item := range prompts {
		name := strings.TrimSpace(item.Name)
		text := strings.TrimSpace(item.Prompt)
		if name == "" || text == "" {
			continue
		}
		text = truncateRunes(text, listPromptPromptMaxRunes)
		b.WriteString("\n- ")
		b.WriteString(name)
		b.WriteString("：")
		b.WriteString(text)
	}
	if b.Len() == 0 {
		return ""
	}
	return b.String()
}

// viewOfDigest 把结果压成面板要显示的那几行。
func viewOfDigest(digest WorkDigestResult) *digestView {
	return &digestView{
		Option:    digest.Option,
		Label:     digest.Label,
		Start:     digest.Start,
		End:       digest.End,
		Keyword:   digest.Keyword,
		ListName:  digest.ListName,
		Completed: digest.Completed,
		Open:      digest.Open,
		Overdue:   digest.Overdue,
		Notes:     digest.Notes,
		Lists:     digest.Lists,
		Courses:   digest.Courses,
		Truncated: digest.Truncated,
	}
}
