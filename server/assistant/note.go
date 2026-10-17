package assistant

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"smallgo/server/response"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 「保存到记事本」（用户 2026-10-17：「ai聊天输出内容增加 保存到记事本功能，
// 自动生成标签」）。
//
// 面板上每条小秘回答下面有个「保存到记事本」按钮，一键把这段回答存成一条记事。
// 用户要的是**自动生成**——标题、标签、备注都由服务端按内容算好，他不用手打：
//
//	标题：#AI小秘 #周报 本周完成 3 项、还有 4 项没做完
//	备注：标签：#AI小秘 #周报
//	      来自 AI 小秘对话 · 2026-10-17 07:41
//
//	      （整段回答原文）
//
// 标签走关键词表（周报/月报/年报/总结/待办/账单…），扫的是「用户问的那句话 +
// 小秘的回答」；再固定带上「AI小秘」，日后在记事本里一眼能把小秘存下的挑出来。
// 全程不调用模型：没接模型的机器上（出草稿的那条路）一样能存。
const (
	noteSourceTag = "AI小秘"
	// noteTitleRunes 是标题里「摘要」部分的字数上限。
	noteTitleRunes = 40
	// noteTitleLimit 是标题总长上限：数据列是 size:200，留够余量，列表里也不至于占两行。
	noteTitleLimit = 120
	// noteMaxTags 是自动标签个数上限（含固定的「AI小秘」）。
	noteMaxTags = 3
	// maxNoteRunes 是允许存进记事的正文字数上限：与单条对话消息同量级。
	maxNoteRunes = 8000
)

// noteTagRules 是自动打标签的规则表：按顺序扫，命中一条就带上这个标签。
// 词表只收中文关键词——用户问的和回答里写的都是中文，不做英文/大小写处理。
var noteTagRules = []struct {
	tag      string
	keywords []string
}{
	{"周报", []string{"周报", "本周", "这周", "上周"}},
	{"月报", []string{"月报", "本月", "这个月", "上月"}},
	{"年报", []string{"年报", "今年", "年度", "年终"}},
	{"总结", []string{"总结", "汇报"}},
	{"待办", []string{"待办", "要做", "还没做", "未完成", "逾期"}},
	{"计划", []string{"计划", "安排"}},
	{"提醒", []string{"提醒", "闹钟"}},
	{"账单", []string{"账单", "信用卡", "还款", "记账"}},
	{"清单", []string{"清单"}},
}

// digestOptionTags 是数据口径 → 标签：面板点了「本周周报」这类查询时，即使
// 回答里没出现「周报」两个字，也能按这一轮的口径把标签打上。
var digestOptionTags = map[string]string{
	"week":   "周报",
	"month":  "月报",
	"year":   "年报",
	"open":   "未完成",
	"custom": "自定义查询",
}

// saveNoteRequest 是面板发来的：text 必填，另两个是给打标签用的上下文。
type saveNoteRequest struct {
	// Text 是这一条回答的原文（含 Markdown），存进备注。
	Text string `json:"text"`
	// Question 是用户问的那句话——标题与标签都从「问 + 答」里认。
	Question string `json:"question"`
	// Hint 是这一轮的数据口径（week/month/year/open/custom），可空。
	Hint string `json:"hint"`
}

// SavedNote 是存好之后回给面板的那条记事的摘要。
type SavedNote struct {
	ID       uint
	Title    string
	ListID   uint
	ListName string
}

// NoteSaver 由业务包实现（server/reminder 的 CreateNote，走与手动新建同一条路），
// 在 server/main.go 启动时注入——assistant 不直接 import reminder：
// reminder 的测试会 import 根包，而根包 import assistant，直接依赖会绕成环。
type NoteSaver func(db *gorm.DB, userID uint, title, notes, originClientID string) (SavedNote, error)

var noteSaver NoteSaver

// RegisterNoteSaver 注入实现，只在启动时调用一次。
func RegisterNoteSaver(fn NoteSaver) { noteSaver = fn }

// handleSaveNote 把一条回答存进记事本，返回新记事与自动生成的标题、标签。
func handleSaveNote(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body saveNoteRequest
		if err := c.ShouldBindJSON(&body); err != nil {
			response.ErrorBadRequest(c, `请求格式不对：需要 { text: "要保存的回答" }`)
			return
		}
		text := strings.TrimSpace(body.Text)
		if text == "" {
			response.ErrorBadRequest(c, "没有可保存的内容")
			return
		}
		if runes := []rune(text); len(runes) > maxNoteRunes {
			response.ErrorBadRequest(c,
				fmt.Sprintf("这段内容太长（%d 字，上限 %d 字），存进记事本前请先精简一下", len(runes), maxNoteRunes))
			return
		}
		if noteSaver == nil {
			response.ErrorInternal(c, "记事本模块还没就绪，稍后再试")
			return
		}
		title, notes, tags := buildSavedNote(text, body.Question, body.Hint, time.Now())
		item, err := noteSaver(db, c.GetUint("userID"), title, notes, strings.TrimSpace(c.GetHeader("X-Client-Id")))
		if err != nil {
			response.ErrorBadRequest(c, err.Error())
			return
		}
		response.Success(c, gin.H{
			"id":        item.ID,
			"title":     item.Title,
			"tags":      tags,
			"list_id":   item.ListID,
			"list_name": item.ListName,
		})
	}
}

// buildSavedNote 算出这条记事的标题、备注与标签。text 是回答原文，question 是
// 用户那句问话，hint 是这一轮的数据口径，at 是保存时刻（测试里固定住才好断言）。
func buildSavedNote(text, question, hint string, at time.Time) (title, notes string, tags []string) {
	tags = noteTags(question, text, hint)
	summary := noteSummary(text)
	if summary == "" {
		summary = "小秘的回答"
	}
	tokens := tagTokens(tags)
	title = truncateRunes(strings.Join(append(tokens, summary), " "), noteTitleLimit)
	notes = strings.Join([]string{
		"标签：" + strings.Join(tokens, " "),
		"来自 AI 小秘对话 · " + at.In(noteLocation()).Format("2006-01-02 15:04"),
		"",
		strings.TrimSpace(text),
	}, "\n")
	return title, notes, tags
}

// noteTags 生成标签，取「为什么存这条」而不是「内容里出现了什么字」：
//  1. 先扫用户问的那句话与这一轮的数据口径（口径最准）；
//  2. 问话里什么都认不出来时，再拿回答兜底（比如用户只问「今天该先做什么」，
//     回答里提到账单，就带个「账单」）；
//  3. 第一个永远是「AI小秘」，最多 noteMaxTags 个。
func noteTags(question, answer, hint string) []string {
	tags := []string{noteSourceTag}
	if tag, ok := digestOptionTags[strings.TrimSpace(hint)]; ok {
		tags = appendTag(tags, tag)
	}
	tags = appendTagsFromRules(tags, question)
	if len(tags) == 1 {
		tags = appendTagsFromRules(tags, answer)
	}
	return tags
}

// appendTagsFromRules 把 text 里认得到的标签一个个接上（认不出来就原样返回）。
func appendTagsFromRules(tags []string, text string) []string {
	for _, rule := range noteTagRules {
		if len(tags) >= noteMaxTags {
			break
		}
		for _, keyword := range rule.keywords {
			if strings.Contains(text, keyword) {
				tags = appendTag(tags, rule.tag)
				break
			}
		}
	}
	return tags
}

// appendTag 加一个标签：满了不加，已经有了也不加。
func appendTag(tags []string, tag string) []string {
	if tag == "" || len(tags) >= noteMaxTags {
		return tags
	}
	for _, existing := range tags {
		if existing == tag {
			return tags
		}
	}
	return append(tags, tag)
}

// noteSummary 把一整段回答揉成一行摘要：去掉 Markdown 记号（#、*、`、序号），
// 取第一个有内容的行，超长按字符截断（truncateRunes 会补省略号）。
func noteSummary(text string) string {
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		line = strings.TrimLeft(line, "#>*-•·　 \t")
		line = trimOrderMarker(line)
		line = strings.NewReplacer("**", "", "__", "", "`", "").Replace(line)
		line = strings.Join(strings.Fields(line), " ")
		if line != "" {
			return truncateRunes(line, noteTitleRunes)
		}
	}
	return ""
}

// trimOrderMarker 去掉行首的「1.」「1、」「1)」这类编号，让摘要直接是内容本身。
func trimOrderMarker(line string) string {
	line = strings.TrimSpace(line)
	digits := 0
	for digits < len(line) && line[digits] >= '0' && line[digits] <= '9' {
		digits++
	}
	if digits > 0 && digits < len(line) {
		marker, size := utf8.DecodeRuneInString(line[digits:])
		switch marker {
		case '.', '、', ')', '）':
			return strings.TrimSpace(line[digits+size:])
		}
	}
	return line
}

// tagTokens 把标签渲染成标题/备注里写的样子：#AI小秘 #周报。
func tagTokens(tags []string) []string {
	tokens := make([]string, 0, len(tags))
	for _, tag := range tags {
		tokens = append(tokens, "#"+tag)
	}
	return tokens
}

// noteLocation 是记事里那行时间的时区：与全站一致（Asia/Shanghai），取不到退回本地时区。
func noteLocation() *time.Location {
	if loc, err := time.LoadLocation("Asia/Shanghai"); err == nil {
		return loc
	}
	return time.Local
}
