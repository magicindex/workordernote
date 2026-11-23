package reminder

import (
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// WorkDigest 的「给模型看的 Markdown」与「回给面板的来源列表」必须是同一份
// 编号。这个测试是两边不漂的保险：以后加新的数据段落，如果只改了一边，这里
// 会直接失败。
func TestWorkDigestSourcesAlignWithMarkdown(t *testing.T) {
	digest := WorkDigest{
		Option: "week",
		Label:  "本周（2026-10-12 ~ 2026-10-18）",
		Start:  "2026-10-12",
		End:    "2026-10-19",
		Stats: WorkDigestStats{
			Completed: 2, Open: 1, Overdue: 1, Notes: 1, Lists: 2, Courses: 1,
		},
		Completed: []WorkDigestItem{
			{ID: 11, ReminderID: 21, Title: "写周报", Day: "2026-10-12", Clock: "09:00", ListName: "工作", ListID: 1},
			{ID: 12, ReminderID: 22, Title: "修水管", Day: "2026-10-13", Clock: "10:30", ListName: "生活", ListID: 2},
		},
		Open: []WorkDigestItem{
			{ID: 31, Title: "交报告", Day: "2026-10-11", Clock: "18:00", ListName: "工作", ListID: 1, Overdue: true, OverdueDays: 1},
		},
		Lists: []WorkDigestList{
			{ID: 1, Name: "工作", Completed: 1, Open: 1},
			{ID: 2, Name: "生活", Completed: 1, Open: 0},
		},
		Notes: []WorkDigestItem{
			{ID: 41, Title: "客户偏好：先发邮件", Day: "2026-10-14", Clock: "14:00", ListName: "工作", ListID: 1},
		},
		Courses: []WorkDigestCourse{
			{ID: 51, Table: "小学课表", Day: "2026-10-14", Weekday: 3, Title: "数学", Kind: "course", Start: "08:00", End: "08:45", Teacher: "小明"},
		},
	}

	sources := digest.Sources()
	wantCount := 1 + len(digest.Completed) + len(digest.Open) + len(digest.Lists) + len(digest.Notes) + len(digest.Courses)
	if len(sources) != wantCount {
		t.Fatalf("来源数应当是 %d，实际 %d", wantCount, len(sources))
	}
	for i, src := range sources {
		if src.ID != i+1 {
			t.Fatalf("来源编号应从 1 连续，实际第 %d 条是 %d", i+1, src.ID)
		}
	}
	if sources[0].Kind != "summary" || !strings.Contains(sources[0].Detail, "完成 2 条") {
		t.Fatalf("第一条应当是汇总统计：%+v", sources[0])
	}
	if sources[1].Ref != "reminder:21" || sources[1].Kind != "completed" {
		t.Fatalf("完成记录应能回查到 reminders 行：%+v", sources[1])
	}
	if sources[3].Ref != "reminder:31" || sources[3].Kind != "open" {
		t.Fatalf("未完成项应能回查到 reminders 行：%+v", sources[3])
	}
	if sources[4].Ref != "list:1" || sources[4].Kind != "list" {
		t.Fatalf("清单分布应能回查到 list：%+v", sources[4])
	}
	if sources[6].Ref != "reminder:41" || sources[6].Kind != "note" {
		t.Fatalf("记事应能回查到 reminders 行：%+v", sources[6])
	}
	if sources[7].Ref != "timetable_entry:51" || sources[7].Kind != "course" {
		t.Fatalf("课程应能回查到 timetable_entries 行：%+v", sources[7])
	}

	md := digest.Markdown()
	// 只统计「行首的 [编号]」：提示语里的示例编号不算数据行。
	lineIDs := regexp.MustCompile(`(?m)^\[(\d+)\] `).FindAllStringSubmatch(md, -1)
	if len(lineIDs) != len(sources) {
		t.Fatalf("Markdown 应当有 %d 条带编号的数据行，实际 %d：\n%s", len(sources), len(lineIDs), md)
	}
	for i, match := range lineIDs {
		id, _ := strconv.Atoi(match[1])
		if id != i+1 {
			t.Fatalf("Markdown 第 %d 条编号应当是 %d，实际 %d：\n%s", i+1, i+1, id, md)
		}
	}
	for _, want := range []string{"统计：完成 2 条", "已逾期 1 天", "清单分布", "课程表（1 节）", "08:00-08:45 数学", "小明"} {
		if !strings.Contains(md, want) {
			t.Fatalf("Markdown 缺少 %q：\n%s", want, md)
		}
	}
}

// 空快照也要有 [1] 汇总与「没有记录」的明确说法，不能给模型一张白纸。
func TestWorkDigestEmptyMarkdownStillNumbered(t *testing.T) {
	digest := WorkDigest{Option: "week", Label: "本周"}
	md := digest.Markdown()
	if !strings.Contains(md, "[1] 统计：完成 0 条") {
		t.Fatalf("空快照也要有汇总编号：\n%s", md)
	}
	if !strings.Contains(md, "没有记录") {
		t.Fatalf("空快照要明说没有记录：\n%s", md)
	}
	if got := len(digest.Sources()); got != 1 {
		t.Fatalf("空快照只有汇总一条来源，实际 %d", got)
	}
}
