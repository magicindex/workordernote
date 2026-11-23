package assistant

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// 这个文件是「回答必须基于真实数据」的**后置校验**。
//
// 提示词只能劝模型别编，拦不住它偶尔编。所以在把回答交给用户之前，这里再用
// 结构化数据核对一遍：
//   - 引用编号必须真实存在（[99] 这种直接判违规）；
//   - 完成/未完成/逾期/记事/清单/课程这些统计数字必须与数据一致；
//   - 数据为空时，回答必须明确说「没有记录」，不能编出事项；
//   - 有数据时，只要回答在陈述数据，就必须带出处编号。
//
// 校验不通过不会直接丢掉回答：先带着违规原因让模型重答一次（只多一次请求，
// 正常回答不受影响），仍然不通过就退回按真实数据拼的草稿——宁可少说，也不
// 把编造的内容当成事实交给用户。

// WorkSource 是一条可被回答引用的数据出处。ID 与系统提示词里每条数据前的
// [编号] 一一对应，回给面板后用户可逐条核对。
type WorkSource struct {
	ID       int    `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Day      string `json:"day,omitempty"`
	Clock    string `json:"clock,omitempty"`
	ListName string `json:"list_name,omitempty"`
	Detail   string `json:"detail,omitempty"`
	// Ref 是内部记录标识（reminder:12 / completion:34 / list:5 / timetable_entry:6），
	// 便于排查「这条来源到底是哪条记录」，不用于展示。
	Ref string `json:"ref,omitempty"`
}

// GroundingReport 是这一轮回答的数据校验结果，随对话一起回给面板。
type GroundingReport struct {
	Checked bool `json:"checked"`
	OK      bool `json:"ok"`
	// Violations 是没通过的原因（中文，直接可读）。
	Violations []string `json:"violations,omitempty"`
	// Citations 是回答里实际出现的、合法的出处编号。
	Citations []int `json:"citations,omitempty"`
	// Repaired 表示第一次回答不合格，已经让模型按数据重答过一次。
	Repaired bool `json:"repaired,omitempty"`
	// Fallback 表示重答仍不合格，最终展示的是按真实数据直接拼的草稿。
	Fallback bool `json:"fallback,omitempty"`
}

// digestEmpty 判断这一轮是不是「一条记录都没有」。
func digestEmpty(d WorkDigestResult) bool {
	return d.Completed == 0 && d.Open == 0 && d.Notes == 0 && d.Courses == 0
}

// 中文数字 + 计数单位：模型常写「完成了三项」「两条逾期」，不转成阿拉伯数字
// 就会和数据的 3 / 2 擦肩而过，校验形同虚设。
var chineseCountPattern = regexp.MustCompile(`([一二两三四五六七八九十]+)\s*(条|项|个|节|篇|份)`)

// normalizeCountNumerals 只转换「数字 + 计数单位」里的中文数字，不动正文其它内容。
func normalizeCountNumerals(text string) string {
	return chineseCountPattern.ReplaceAllStringFunc(text, func(match string) string {
		parts := chineseCountPattern.FindStringSubmatch(match)
		if len(parts) != 3 {
			return match
		}
		if n, ok := parseChineseCount(parts[1]); ok {
			return strconv.Itoa(n) + parts[2]
		}
		return match
	})
}

// parseChineseCount 认 1–99 的中文数字（一 / 十 / 十一 / 二十 / 二十三）。
// 只服务计数校验：更大的数字在周报里极少出现，认不出就原样放过，不误报。
func parseChineseCount(raw string) (int, bool) {
	digits := map[rune]int{'一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
	runes := []rune(raw)
	switch len(runes) {
	case 1:
		if runes[0] == '十' {
			return 10, true
		}
		if n, ok := digits[runes[0]]; ok {
			return n, true
		}
	case 2:
		if runes[0] == '十' {
			if n, ok := digits[runes[1]]; ok {
				return 10 + n, true
			}
		}
		if runes[1] == '十' {
			if n, ok := digits[runes[0]]; ok {
				return n * 10, true
			}
		}
	case 3:
		if runes[1] == '十' {
			a, okA := digits[runes[0]]
			b, okB := digits[runes[2]]
			if okA && okB {
				return a*10 + b, true
			}
		}
	}
	return 0, false
}

// 引用编号：兼容半角 [2] 与全角 【2】。只认 1–3 位数字，避免把 [2026]
// 这类年份误当成出处。
var citationPattern = regexp.MustCompile(`\[(\d{1,3})\]|【(\d{1,3})】`)

// 统计数字的常见说法。模型可以换措辞，但「完成 5 条」这类主谓结构很稳定；
// 每种口径同时收「完成 5 条」与「5 条完成」两种语序，减少漏检。
var (
	reCompletedCount = regexp.MustCompile(`完成(?:了|的)?\s*(?:事项|任务)?\s*[:：]?\s*(\d+)\s*(?:条|项|个)`)
	reCompletedAfter = regexp.MustCompile(`(\d+)\s*(?:条|项|个)\s*(?:已完成|完成)`)
	reOpenCount      = regexp.MustCompile(`(?:未完成|还没做完|尚未完成|待办|未收尾)\s*(?:事项|任务)?\s*[:：]?\s*(?:有|共|还有|剩下)?\s*(\d+)\s*(?:条|项|个)`)
	reOpenAfter      = regexp.MustCompile(`(\d+)\s*(?:条|项|个)\s*(?:未完成|没做完|尚未完成|待办|未收尾)`)
	reOverdueCount   = regexp.MustCompile(`逾期\s*(?:事项|任务)?\s*[:：]?\s*(?:有|共|还有)?\s*(\d+)\s*(?:条|项|个)`)
	reOverdueAfter   = regexp.MustCompile(`(\d+)\s*(?:条|项|个)\s*逾期`)
	reNotesCount     = regexp.MustCompile(`记事\s*(?:新增)?\s*[:：]?\s*(?:有|共|还有)?\s*(\d+)\s*(?:条|篇|个)`)
	reNotesAfter     = regexp.MustCompile(`(\d+)\s*(?:条|篇)\s*(?:新)?记事`)
	reListsCount     = regexp.MustCompile(`清单\s*[:：]?\s*(?:有|共|还有)?\s*(\d+)\s*个`)
	reListsAfter     = regexp.MustCompile(`(\d+)\s*个清单`)
	reCoursesCount   = regexp.MustCompile(`课程\s*[:：]?\s*(?:有|共|还有)?\s*(\d+)\s*(?:节|门)`)
	reCoursesAfter   = regexp.MustCompile(`(\d+)\s*(?:节|门)\s*课程`)
)

// 有数据时，出现这些词基本就是在陈述工作数据，必须有出处编号。
var workClaimWords = []string{"完成", "未完成", "逾期", "记事", "清单", "课程", "事项", "任务", "待办"}

// 数据为空时，这些说法表示「我已经承认没有数据」。
var noDataPhrases = []string{
	"没有记录", "没有相关", "没有任何", "没有数据", "没有找到", "未找到", "暂无", "无记录",
	"数据中没有", "没有可以", "没有可", "没有这条", "为空", "没有完成", "没有未完成",
}

// validateGrounding 用这一轮的数据核对模型回答；不依赖模型自述，全部可复算。
func validateGrounding(reply string, digest WorkDigestResult) GroundingReport {
	report := GroundingReport{Checked: true}
	// 中文数字也要能核对：「完成了三项」与「完成了 3 项」是同一句话。
	reply = normalizeCountNumerals(strings.TrimSpace(reply))
	if reply == "" {
		report.Violations = append(report.Violations, "回答为空")
		return report
	}

	report.Citations, report.Violations = citationsOf(reply, len(digest.Sources), report.Violations)
	report.Violations = statViolations(reply, digest, report.Violations)

	claimsData := mentionsWorkClaim(reply)
	switch {
	case digestEmpty(digest):
		// 空数据：可以寒暄，但只要开始说「完成了…」就必须先承认没有记录。
		if claimsData && !containsAny(reply, noDataPhrases) {
			report.Violations = append(report.Violations,
				"这一时段没有任何记录，回答却在描述工作内容；应明确说明「已提供的数据中没有相关记录」")
		}
	case claimsData && len(report.Citations) == 0 && !containsAny(reply, noDataPhrases):
		// 有数据：只要在陈述数据，就必须带出处编号。已经明确说「没有…」的
		// 否定句放行——那是诚实回答，不该因为没编号被打回。
		report.Violations = append(report.Violations,
			"回答引用了工作数据，但没有标注任何出处编号；每条数据后应标注对应的 [编号]（汇总数字用 [1]）")
	}

	report.OK = len(report.Violations) == 0
	return report
}

// citationsOf 取回答里的出处编号，并挑出不存在的编号。
func citationsOf(reply string, sourceCount int, violations []string) ([]int, []string) {
	seen := map[int]bool{}
	valid := make([]int, 0, 4)
	bad := map[int]bool{}
	for _, match := range citationPattern.FindAllStringSubmatch(reply, -1) {
		raw := match[1]
		if raw == "" {
			raw = match[2]
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			continue
		}
		if n > sourceCount {
			bad[n] = true
			continue
		}
		if !seen[n] {
			seen[n] = true
			valid = append(valid, n)
		}
	}
	sort.Ints(valid)
	if len(bad) > 0 {
		ids := make([]int, 0, len(bad))
		for id := range bad {
			ids = append(ids, id)
		}
		sort.Ints(ids)
		if sourceCount == 0 {
			violations = append(violations, fmt.Sprintf("回答标注了出处 %s，但这一轮没有可引用的数据来源", joinIDs(ids)))
		} else {
			violations = append(violations, fmt.Sprintf(
				"引用了不存在的出处 %s；本轮只有 1–%d 号来源", joinIDs(ids), sourceCount))
		}
	}
	return valid, violations
}

// statViolations 核对回答里的统计数字。只查「条/项/个/节/篇」这类计数，
// 「逾期 3 天」是单条记录的逾期天数，不在这里判断。
func statViolations(reply string, digest WorkDigestResult, violations []string) []string {
	// 「未完成 3 条」里也含有「完成」两个字，直接拿完成的正则去扫会把它当成
	// 「完成 3 条」——先把否定说法换掉，避免自己跟自己冲突。
	completedText := strings.NewReplacer("尚未完成", "尚未办结", "未完成", "未办结").Replace(reply)
	checks := []struct {
		label  string
		want   int
		text   string
		before *regexp.Regexp
		after  *regexp.Regexp
	}{
		{"完成条数", digest.Completed, completedText, reCompletedCount, reCompletedAfter},
		{"未完成条数", digest.Open, reply, reOpenCount, reOpenAfter},
		{"逾期条数", digest.Overdue, reply, reOverdueCount, reOverdueAfter},
		{"记事条数", digest.Notes, reply, reNotesCount, reNotesAfter},
		{"清单个数", digest.Lists, reply, reListsCount, reListsAfter},
		{"课程节数", digest.Courses, reply, reCoursesCount, reCoursesAfter},
	}
	for _, check := range checks {
		got, mismatch := countMismatch(check.text, check.want, check.before, check.after)
		if !mismatch {
			continue
		}
		violations = append(violations, fmt.Sprintf(
			"%s与数据不一致：回答写 %d，数据是 %d", check.label, got, check.want))
	}
	return violations
}

// countMismatch 扫描所有命中的计数，只要有一个与数据不一致就报出来。
// 不能只看第一处：模型可能先写对总数，后面又编一个分项数字。
func countMismatch(reply string, want int, patterns ...*regexp.Regexp) (int, bool) {
	for _, pattern := range patterns {
		for _, match := range pattern.FindAllStringSubmatch(reply, -1) {
			n, err := strconv.Atoi(match[1])
			if err != nil {
				continue
			}
			if n != want {
				return n, true
			}
		}
	}
	return 0, false
}

func mentionsWorkClaim(reply string) bool {
	return containsAny(reply, workClaimWords)
}

func containsAny(text string, words []string) bool {
	for _, word := range words {
		if strings.Contains(text, word) {
			return true
		}
	}
	return false
}

func joinIDs(ids []int) string {
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, fmt.Sprintf("[%d]", id))
	}
	return strings.Join(parts, "、")
}

// 没附数据时，这些问法明显是在问用户自己的记录。服务端没认出时间段（或数据
// 模块异常）时，模型也不能靠记忆编一份出来，只能说明「看不到」。
var workDataQuestionWords = []string{
	"周报", "月报", "年报", "总结", "汇报", "清单", "待办", "完成", "逾期", "记事",
	"做了什么", "干了什么", "忙了什么", "工作情况", "工作记录", "工作",
}

// 无数据时，这些说法表示模型已经承认「看不到」。
var noDataAnswerPhrases = []string{
	"看不到", "没有数据", "没有相关", "暂无", "没有记录", "先选", "选择时间", "选个时间",
	"选择范围", "选一个时间", "无法查看", "不能查看", "没有可用",
}

// 无数据时出现了「完成 3 条」「[2]」这类具体断言，基本就是编的。
var ungroundedClaimPattern = regexp.MustCompile(
	`(?:完成|未完成|逾期|记事|清单|课程)\D{0,8}\d+\s*(?:条|项|个|节|篇)|\d+\s*(?:条|项|个|节|篇)\s*(?:已完成|未完成|完成|任务|记录)`)

// looksLikeWorkDataQuestion 判断这句话是不是在问用户自己的记录。
func looksLikeWorkDataQuestion(text string) bool {
	return containsAny(strings.TrimSpace(text), workDataQuestionWords)
}

// validateNoDataAnswer 校验「没有附数据」时的回答：可以寒暄、可以说明怎么选
// 时间范围，但不能报出任何具体条数或出处。
func validateNoDataAnswer(reply string) GroundingReport {
	report := GroundingReport{Checked: true}
	reply = normalizeCountNumerals(strings.TrimSpace(reply))
	if reply == "" {
		report.Violations = append(report.Violations, "回答为空")
		return report
	}
	// 已经明确说看不到，就不追究它有没有提到「3 条」这种假设性的例子。
	if containsAny(reply, noDataAnswerPhrases) {
		report.OK = true
		return report
	}
	if ungroundedClaimPattern.MatchString(reply) || citationPattern.MatchString(reply) {
		report.Violations = append(report.Violations,
			"本轮没有附上工作数据，回答却给出了具体条数或出处；应先说明看不到记录，并请用户先选时间范围")
	}
	report.OK = len(report.Violations) == 0
	return report
}

// noDataRepairPrompt 是「没数据却编了数字」时的改口指令。
func noDataRepairPrompt() string {
	return "当前消息里没有【工作数据】，你看不到用户的任何记录。请重新回答：不要编造记录、数字、日期或出处；" +
		"明确说明现在看不到这些记录，并请用户先在面板上选择时间范围（本周/本月/今年/自定义）或关键词后再问。"
}

// noDataFallbackReply 是改口仍不合格时的安全文案：宁可让用户补一步，也不猜。
func noDataFallbackReply() string {
	return "我现在看不到你的工作记录，没法按数据回答。请先在面板上选择时间范围（本周 / 本月 / 今年 / 自定义）" +
		"或关键词，再问我一次；没有数据时我不会替你猜。"
}

// groundingRepairPrompt 是校验失败后追加给模型的重答指令。刻意把违规原因
// 原样带上：模型通常能据此只改数字/补引用，而不是整段重写。
func groundingRepairPrompt(violations []string) string {
	return "你上一条回答没有通过数据校验：" + strings.Join(violations, "；") + "。\n" +
		"请只依据系统消息里的【工作数据】重新回答，不要使用记忆或常识补齐；" +
		"每一条数据后标注对应 [编号]（汇总数字用 [1]）；" +
		"数据中没有的内容直接写「已提供的数据中没有相关记录」；" +
		"不要新增任何数字、事项、日期或人名。"
}

// groundingFallback 在重答仍不合格时使用：按真实数据直接拼一份草稿。
// 这是「宁可少说也不编」的最后一道闸——用户看到的每个数字都能在来源里找到。
func groundingFallback(digest WorkDigestResult) string {
	body := strings.TrimSpace(digest.Draft)
	if body == "" {
		var b strings.Builder
		fmt.Fprintf(&b, "【%s】\n", digest.Label)
		fmt.Fprintf(&b, "已提供的数据：完成 %d 条 / 还没做完 %d 条（其中逾期 %d 条）/ 记事 %d 条 / 清单 %d 个 / 课程 %d 节。",
			digest.Completed, digest.Open, digest.Overdue, digest.Notes, digest.Lists, digest.Courses)
		body = b.String()
	}
	return body + "\n\n（模型回答未通过数据校验，已改为按真实记录直接列出；点开「数据来源」可逐条核对。）"
}
