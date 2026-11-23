package assistant

import (
	"strings"
	"testing"
)

// groundedDigest 是一个「部分数据」快照：有完成记录，但未完成/记事为空。
// 三类回归场景（无数据 / 部分数据 / 数据冲突）都围绕它和它的空版本展开。
func groundedDigest() WorkDigestResult {
	return WorkDigestResult{
		Found:     true,
		Option:    "week",
		Label:     "本周",
		Completed: 2,
		Open:      0,
		Overdue:   0,
		Notes:     0,
		Lists:     1,
		Courses:   0,
		Markdown:  "【工作数据】时间段：本周\n[1] 统计：完成 2 条 / 还没做完 0 条（其中逾期 0 条）\n[2] 2026-11-18 10:00 写周报（工作）\n[3] 2026-11-19 16:00 修水管（生活）",
		Draft:     "【本周 工作草稿】\n合计：完成 2 条 · 还没做完 0 条（逾期 0 条）",
		Sources: []WorkSource{
			{ID: 1, Kind: "summary", Title: "统计汇总", Detail: "完成 2 条 / 还没做完 0 条（其中逾期 0 条）"},
			{ID: 2, Kind: "completed", Title: "写周报", Day: "2026-11-18", Clock: "10:00", ListName: "工作"},
			{ID: 3, Kind: "completed", Title: "修水管", Day: "2026-11-19", Clock: "16:00", ListName: "生活"},
			{ID: 4, Kind: "list", Title: "工作", Detail: "清单分布：完成 1 / 未完成 0"},
		},
	}
}

func emptyDigest() WorkDigestResult {
	return WorkDigestResult{
		Found:    true,
		Option:   "week",
		Label:    "本周",
		Markdown: "【工作数据】时间段：本周\n[1] 统计：完成 0 条 / 还没做完 0 条（其中逾期 0 条）\n一、这段时间完成的：没有记录",
		Draft:    "【本周 工作草稿】\n这段时间没有对应的记录。",
		Sources:  []WorkSource{{ID: 1, Kind: "summary", Title: "统计汇总", Detail: "完成 0 条 / 还没做完 0 条"}},
	}
}

// fullDigest 是各项都非零的快照，用来测「数据冲突」（回答与数据对不上）。
func fullDigest() WorkDigestResult {
	return WorkDigestResult{
		Found:     true,
		Option:    "week",
		Label:     "本周",
		Completed: 5,
		Open:      3,
		Overdue:   1,
		Notes:     2,
		Lists:     2,
		Courses:   1,
		Draft:     "【本周 工作草稿】\n合计：完成 5 条 · 还没做完 3 条（逾期 1 条）",
		Sources: []WorkSource{
			{ID: 1, Kind: "summary", Title: "统计汇总"},
			{ID: 2, Kind: "completed", Title: "A"},
			{ID: 3, Kind: "completed", Title: "B"},
			{ID: 4, Kind: "completed", Title: "C"},
			{ID: 5, Kind: "completed", Title: "D"},
			{ID: 6, Kind: "completed", Title: "E"},
			{ID: 7, Kind: "open", Title: "F"},
			{ID: 8, Kind: "open", Title: "G"},
			{ID: 9, Kind: "open", Title: "H"},
			{ID: 10, Kind: "list", Title: "工作"},
			{ID: 11, Kind: "list", Title: "生活"},
			{ID: 12, Kind: "note", Title: "I"},
			{ID: 13, Kind: "note", Title: "J"},
			{ID: 14, Kind: "course", Title: "数学"},
		},
	}
}

func hasViolation(report GroundingReport, substr string) bool {
	for _, v := range report.Violations {
		if strings.Contains(v, substr) {
			return true
		}
	}
	return false
}

// 场景一：无数据。模型不能编出任何事项或数字；诚实说「没有记录」则放行。
func TestValidateGroundingEmptyDataRefusesFabrication(t *testing.T) {
	digest := emptyDigest()

	fabricated := validateGrounding("本周完成了 3 项任务，还整理了客户资料。", digest)
	if !fabricated.Checked || fabricated.OK {
		t.Fatalf("空数据时编造内容应当判违规：%+v", fabricated)
	}
	if !hasViolation(fabricated, "没有") && !hasViolation(fabricated, "不一致") {
		t.Fatalf("违规说明要指出「没有数据/数字不一致」：%+v", fabricated.Violations)
	}

	honest := validateGrounding("已提供的数据中没有相关记录。", digest)
	if !honest.OK {
		t.Fatalf("明确说明没有数据时应当通过：%+v", honest)
	}
	honest = validateGrounding("这段时间没有完成任何事项。", digest)
	if !honest.OK {
		t.Fatalf("「没有完成任何事项」也是诚实回答，应当通过：%+v", honest)
	}
}

// 场景二：部分数据。缺的那部分必须承认缺失，已有的数字必须对得上。
func TestValidateGroundingPartialData(t *testing.T) {
	digest := groundedDigest()

	good := validateGrounding("完成 2 条 [2][3]；还没有未完成事项。", digest)
	if !good.OK {
		t.Fatalf("与数据一致的回答应当通过：%+v", good.Violations)
	}
	if len(good.Citations) != 2 || good.Citations[0] != 2 || good.Citations[1] != 3 {
		t.Fatalf("应当提取到 [2][3] 两个出处：%+v", good.Citations)
	}

	// 数据里没有未完成，回答却说逾期 1 条 —— 部分数据场景下最常见的编造。
	conflict := validateGrounding("完成 2 条 [2][3]；另有 1 条逾期 [1]。", digest)
	if conflict.OK || !hasViolation(conflict, "逾期") {
		t.Fatalf("把不存在的逾期数说出来应当判违规：%+v", conflict)
	}

	// 只说了数据里有的事，但没标出处 → 必须打回重答。
	noCitation := validateGrounding("本周完成了写周报和修水管。", digest)
	if noCitation.OK || !hasViolation(noCitation, "出处编号") {
		t.Fatalf("陈述数据却没有出处编号应当判违规：%+v", noCitation)
	}
}

// 场景三：数据冲突。回答里的统计数字与快照不一致，必须被逐项抓出来。
func TestValidateGroundingConflictingNumbers(t *testing.T) {
	digest := fullDigest()

	report := validateGrounding("本周完成 7 条 [1]，未完成 3 条 [1]，逾期 1 条 [1]，记事 2 条 [1]，清单 2 个 [1]，课程 1 节 [1]。", digest)
	if report.OK {
		t.Fatal("完成 7 条与数据 5 条冲突，应当判违规")
	}
	if !hasViolation(report, "完成条数") || !hasViolation(report, "7") || !hasViolation(report, "5") {
		t.Fatalf("违规说明要写清「回答 7 / 数据 5」：%+v", report.Violations)
	}

	// 同一句里前面对、后面错，也要能抓到（不能只看第一处数字）。
	report = validateGrounding("完成 5 条 [1]，未完成 3 条 [1]；另外逾期 4 条 [1]。", digest)
	if report.OK || !hasViolation(report, "逾期条数") {
		t.Fatalf("后面的错误逾期数也必须抓到：%+v", report)
	}

	valid := validateGrounding("完成 5 条 [1]，未完成 3 条（逾期 1 条）[1]，记事 2 条 [1]，清单 2 个 [1]，课程 1 节 [1]。", digest)
	if !valid.OK {
		t.Fatalf("完全一致的回答应当通过：%+v", valid.Violations)
	}
}

// 引用不存在的出处必须判违规：不能让模型拿 [99] 假装有来源。
func TestValidateGroundingRejectsUnknownCitation(t *testing.T) {
	report := validateGrounding("完成 2 条 [99]。", groundedDigest())
	if report.OK || !hasViolation(report, "不存在的出处") {
		t.Fatalf("不存在的出处应当判违规：%+v", report)
	}
}

// 中文数字也要参与核对：「完成了三项」与「完成了 3 项」不能一个拦、一个放。
func TestValidateGroundingChineseNumerals(t *testing.T) {
	good := validateGrounding("本周完成两项 [2][3]，没有未完成事项。", groundedDigest())
	if !good.OK {
		t.Fatalf("「两项」与数据 2 条一致，应当通过：%+v", good.Violations)
	}
	bad := validateGrounding("本周完成了三项 [2][3]。", groundedDigest())
	if bad.OK || !hasViolation(bad, "完成条数") {
		t.Fatalf("「三项」与数据 2 条冲突，应当判违规：%+v", bad)
	}
	if got := normalizeCountNumerals("二十三项、十一篇、十节"); !strings.Contains(got, "23项") || !strings.Contains(got, "11篇") || !strings.Contains(got, "10节") {
		t.Fatalf("中文数字转换不对：%q", got)
	}
}

func TestGroundingRepairPromptCarriesReasons(t *testing.T) {
	prompt := groundingRepairPrompt([]string{"完成条数不一致", "缺少出处编号"})
	for _, want := range []string{"完成条数不一致", "缺少出处编号", "【工作数据】", "已提供的数据中没有相关记录"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("重答指令缺少 %q：%s", want, prompt)
		}
	}
}

// 没有附数据、但问句明显在要记录时，也不许报出具体条数或出处。
func TestValidateNoDataAnswer(t *testing.T) {
	if !looksLikeWorkDataQuestion("我上周做了些什么工作") {
		t.Fatal("「做了些什么工作」应当被认成工作数据问题")
	}
	if looksLikeWorkDataQuestion("你好呀") {
		t.Fatal("普通寒暄不该被认成工作数据问题")
	}

	honest := validateNoDataAnswer("我现在看不到你的工作记录，请先在面板上选择时间范围再问。")
	if !honest.Checked || !honest.OK {
		t.Fatalf("承认看不到记录时应当通过：%+v", honest)
	}
	fabricated := validateNoDataAnswer("你上周完成了 3 项任务，还写了周报。")
	if fabricated.OK || !hasViolation(fabricated, "没有附上工作数据") {
		t.Fatalf("没有数据却报出具体条数应当判违规：%+v", fabricated)
	}
	cited := validateNoDataAnswer("上周完成不少事 [2]。")
	if cited.OK || !hasViolation(cited, "出处") {
		t.Fatalf("没有数据却给出出处编号应当判违规：%+v", cited)
	}
	if !strings.Contains(noDataFallbackReply(), "选择时间范围") {
		t.Fatal("安全文案要告诉用户下一步怎么补数据")
	}
}

func TestGroundingFallbackUsesDraft(t *testing.T) {
	digest := groundedDigest()
	fallback := groundingFallback(digest)
	if !strings.Contains(fallback, digest.Draft) {
		t.Fatalf("兜底应当使用按真实数据拼的草稿：%s", fallback)
	}
	if !strings.Contains(fallback, "未通过数据校验") {
		t.Fatalf("兜底要说明为什么不是模型原文：%s", fallback)
	}
	// 草稿都没有时也要给出统计数字，不能返回空串。
	bare := groundingFallback(WorkDigestResult{Label: "本周", Completed: 2})
	if !strings.Contains(bare, "完成 2 条") {
		t.Fatalf("没有草稿时也要按数据给出摘要：%s", bare)
	}
}

// 系统提示词必须把数据规则与编号说明一起下发：模型看得到才会照着做。
func TestDigestSystemPromptCarriesGroundingRules(t *testing.T) {
	prompt := digestSystemPrompt("你是小秘", groundedDigest())
	for _, want := range []string{"你是小秘", "【工作数据】", "[1]", "【数据回答规则", "已提供的数据中没有相关记录", "不得"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("系统提示词缺少 %q：\n%s", want, prompt)
		}
	}
}
