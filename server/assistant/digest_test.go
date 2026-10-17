package assistant

import (
	"strings"
	"testing"
)

// 栏目提示词只进系统提示词，且分栏列出、单条超长要截断。
func TestDigestSystemPromptIncludesListPrompts(t *testing.T) {
	digest := WorkDigestResult{
		Markdown: "【工作数据】本周完成 2 项",
		ListPrompts: []ListPrompt{
			{Name: "工作安排", Prompt: "按基站分组，多说进度"},
			{Name: "  ", Prompt: "没有名字的忽略"},
			{Name: "信用卡账单", Prompt: strings.Repeat("长", listPromptPromptMaxRunes+50)},
		},
	}
	got := digestSystemPrompt("你是助手", digest)
	if !strings.Contains(got, "【各栏目的分析要求】") {
		t.Fatalf("要有分栏要求那一段：%s", got)
	}
	if !strings.Contains(got, "- 工作安排：按基站分组，多说进度") {
		t.Fatalf("栏目名与要求要对上：%s", got)
	}
	if strings.Contains(got, "没有名字的忽略") {
		t.Fatalf("没名字的条目要跳过：%s", got)
	}
	// 长提示词被截到上限（按 rune 数），不能整段 600 字原样塞进去。
	if strings.Contains(got, strings.Repeat("长", listPromptPromptMaxRunes+1)) {
		t.Fatal("单条提示词超过上限要截断")
	}
	if !strings.Contains(got, strings.Repeat("长", listPromptPromptMaxRunes)) {
		t.Fatal("截断要保留上限以内的内容")
	}

	// 没有提示词时不留空段落。
	plain := digestSystemPrompt("你是助手", WorkDigestResult{Markdown: "【工作数据】"})
	if strings.Contains(plain, "【各栏目的分析要求】") {
		t.Fatal("没有栏目提示词时不该出现那一段")
	}
}
