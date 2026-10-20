package reminder

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// 这个文件是「AI 助手看得到工作数据」的那一层：把一段时间里的完成记录、
// 还没做完的任务、记事与清单分布，取成一份紧凑的数据快照（WorkDigest），
// 再渲染成两段文本：
//
//   - Markdown()    —— 随对话一起发给模型，让模型据此作答（不再凭空编）；
//   - DraftReport() —— 没有模型时的兜底：直接按真实数据拼一份草稿，
//     用户在任何时候点「周报」都能看到内容，而不只是「请先配置模型」。
//
// 时间段口径与「已完成」页完全一致（ParseCompletedRange，整段自然日历区间、
// 左闭右开、上海时区），这样小秘说的「上周」和页面上筛的「上周」是同一批数据。
//
// 放在 reminder 包里是为了复用同一套时间与查询口径（tsUTC / sqlTimeArg /
// hiddenCardListIDs / listCompletedHistory）：复制一份到 assistant 包迟早会漂。

// WorkDigestOptions 描述一次工作数据汇总请求。Option 空值等同于 "all"。
type WorkDigestOptions struct {
	Option   string // all / today / yesterday / week / lastweek / month / lastmonth / year / custom / open
	From     string // custom 时的起始日期（含当天，YYYY-MM-DD）
	To       string // custom 时的结束日期（含当天，YYYY-MM-DD）
	Keyword  string // 关键词过滤（标题/备注），空表示不过滤
	ListID   uint   // 「@清单名」指定的数据源；0 表示所有清单
	ListName string // 上面那个清单的名字，只用于文案（为空时按 ListID 回查一次）
}

// WorkOptionOpen 是「当前还没做完」这个口径：不限时间窗口，只看手上还挂着的。
// 「已完成」页没有这个选项，是小秘这边独有的（用户要的「工作清单」）。
const WorkOptionOpen = "open"

// 数据条数上限：小秘是给模型看的，不是全量导出。超过就截断并在文案里说明，
// 免得把上游的上下文塞爆（也免得用户误以为这就是全部）。
const (
	workDigestMaxCompleted = 60
	workDigestMaxOpen      = 30
	workDigestMaxNotes     = 10
)

// WorkDigestItem 是快照里的一条：完成记录或还没做完的任务。
type WorkDigestItem struct {
	Title       string `json:"title"`
	Day         string `json:"day,omitempty"` // YYYY-MM-DD（完成时刻 / 截止时刻）
	Clock       string `json:"clock,omitempty"`
	ListName    string `json:"list_name,omitempty"`
	Overdue     bool   `json:"overdue,omitempty"`
	OverdueDays int    `json:"overdue_days,omitempty"`
	NoDue       bool   `json:"no_due,omitempty"` // 没设截止时间
	// 归属清单 id：只用来挑「这条数据所在栏目的 AI 提示词」，不序列化给前端。
	ListID uint `json:"-"`
}

// WorkDigestPrompt 是这次数据范围里某个栏目的 AI 提示词（用户为清单写的分析要求）。
// 只进模型的系统提示词，不进面板摘要。
type WorkDigestPrompt struct {
	ListID uint
	Name   string
	Prompt string
}

// WorkDigestList 是清单维度的分布，让模型能说出「哪块最忙」。
type WorkDigestList struct {
	Name      string `json:"name"`
	Completed int    `json:"completed"`
	Open      int    `json:"open"`
}

// WorkDigestCourse 是本周课表里的一节。课程按周几固定，所以给的是本周那天的日期，
// 让模型能说「周三下午有机器人社团」而不是只看到「weekday=3」。
type WorkDigestCourse struct {
	Table    string `json:"table"`
	Day      string `json:"day"` // YYYY-MM-DD（本周那一天）
	Weekday  int    `json:"weekday"`
	Title    string `json:"title"`
	Kind     string `json:"kind"` // course / activity
	Section  string `json:"section,omitempty"` // 早课 / 上午 / 下午 / 晚课
	Start    string `json:"start"`
	End      string `json:"end"`
	Location string `json:"location,omitempty"`
	Teacher  string `json:"teacher,omitempty"`
	Note     string `json:"note,omitempty"`
}

// WorkDigestStats 是汇总数字，草稿与模型提示词都用它。
type WorkDigestStats struct {
	Completed int `json:"completed"`
	Open      int `json:"open"`
	Overdue   int `json:"overdue"`
	Notes     int `json:"notes"`
	Lists     int `json:"lists"`
	Courses   int `json:"courses"`
}

// WorkDigest 是一段时间的工作数据快照。
type WorkDigest struct {
	Option    string           `json:"option"`
	Label     string           `json:"label"` // 「上周（2026-10-05 ~ 2026-10-11）」
	Start     string           `json:"start,omitempty"`
	End       string           `json:"end,omitempty"`
	Keyword   string           `json:"keyword,omitempty"`
	ListID    uint             `json:"list_id,omitempty"`
	ListName  string           `json:"list_name,omitempty"` // 「@清单名」点名的那一栏
	All       bool             `json:"all,omitempty"`       // 不限时间
	Completed []WorkDigestItem `json:"completed"`
	Open      []WorkDigestItem `json:"open"`
	Notes     []WorkDigestItem `json:"notes"`
	Lists     []WorkDigestList `json:"lists"`
	Courses   []WorkDigestCourse `json:"courses,omitempty"`
	Stats     WorkDigestStats  `json:"stats"`
	Truncated bool             `json:"truncated"`
	// 这次数据范围涉及的栏目的 AI 提示词（用户为清单写的分析要求）。
	// 不序列化：面板摘要不需要它，只有系统提示词的装配要。
	Prompts []WorkDigestPrompt `json:"-"`
}

// BuildWorkDigest 取一段工作数据。now 由调用方传入（测试里要钉死时刻）。
func BuildWorkDigest(db *gorm.DB, userID uint, opts WorkDigestOptions, now time.Time) (WorkDigest, error) {
	loc := shanghai()
	now = now.In(loc)
	option := strings.TrimSpace(opts.Option)
	keyword := strings.TrimSpace(opts.Keyword)

	digest := WorkDigest{Option: option, Keyword: keyword}

	// 「@清单名」：这一轮只看被点名的那一栏（面板上的 @ 选择器负责把名字填进
	// 输入框，认名字的是 FindMentionedList + 这里）。
	var listFilter []uint
	if opts.ListID > 0 {
		digest.ListID = opts.ListID
		digest.ListName = strings.TrimSpace(opts.ListName)
		if digest.ListName == "" {
			digest.ListName = listNameOf(db, userID, opts.ListID)
		}
		listFilter = []uint{opts.ListID}
	}

	var rng CompletedRange
	var err error
	if option == WorkOptionOpen {
		// 不看历史、也不限时间：只看手上还挂着的。
		digest.Label = "当前未完成"
		digest.All = true
	} else {
		rng, err = parseCompletedRangeAt(option, opts.From, opts.To, now)
		if err != nil {
			return WorkDigest{}, err
		}
		span := DescribeCompletedRange(rng, loc)
		digest.Label = workRangeLabel(option, span)
		digest.Start = span.Start
		digest.End = span.End
		digest.All = rng.Start == nil && rng.End == nil
	}
	if digest.ListName != "" {
		digest.Label = digest.ListName + " · " + digest.Label
	}

	completed, err := listCompletedHistory(db, userID, rng, keyword, listFilter)
	if err != nil {
		return WorkDigest{}, err
	}
	if digest.ListID > 0 {
		// 完成历史（Completion）本身不带清单归属，listCompletedHistory 里那次
		// 过滤只作用在提醒上，历史行是回查提醒补的清单 —— 这里按补齐后的清单
		// 再筛一遍；归属不明的（提醒已被删干净）跟着一起丢掉，免得混进别人的数。
		kept := make([]CompletedItemDTO, 0, len(completed))
		for _, row := range completed {
			if row.ListID == digest.ListID {
				kept = append(kept, row)
			}
		}
		completed = kept
	}
	if option == WorkOptionOpen {
		completed = nil
	}
	if len(completed) > workDigestMaxCompleted {
		digest.Truncated = true
		completed = completed[:workDigestMaxCompleted]
	}
	for _, row := range completed {
		// 记事（kind=note）也有 completed_at，会从同一条历史里被捞出来；它们在
		// 报告里单独成节（下面 listWorkNotes），这里跳过，免得同一件事在「完成」
		// 与「记事」里各出现一次、计数也翻倍。
		if row.Kind == KindNote {
			continue
		}
		item := WorkDigestItem{
			Title:    row.Title,
			ListName: row.ListName,
			ListID:   row.ListID,
		}
		at := row.CompletedAt.In(loc)
		item.Day = at.Format("2006-01-02")
		item.Clock = at.Format("15:04")
		digest.Completed = append(digest.Completed, item)
	}

	open, overdueCount, err := listOpenWork(db, userID, rng, keyword, digest.ListID, now, loc)
	if err != nil {
		return WorkDigest{}, err
	}
	if len(open) > workDigestMaxOpen {
		digest.Truncated = true
		open = open[:workDigestMaxOpen]
	}
	digest.Open = open

	notes, notesTotal, err := listWorkNotes(db, userID, rng, keyword, digest.ListID, loc)
	if err != nil {
		return WorkDigest{}, err
	}
	digest.Notes = notes

	// 课表不是清单数据：用 @清单名 点名某一栏时就不掺进来（用户问的是那一栏）。
	if digest.ListID == 0 {
		courses, truncated := collectCourses(db, userID, keyword, rng, now)
		digest.Courses = courses
		digest.Truncated = digest.Truncated || truncated
	}

	digest.Lists = mergeWorkLists(digest.Completed, digest.Open, digest.Notes)
	digest.Prompts = collectListPrompts(db, userID, digest)
	digest.Stats = WorkDigestStats{
		Completed: len(digest.Completed),
		Open:      len(digest.Open),
		Overdue:   overdueCount,
		Notes:     notesTotal,
		Lists:     len(digest.Lists),
		Courses:   len(digest.Courses),
	}
	return digest, nil
}

// LooksLikeScheduleQuery 判断这句话是不是在问课表（不带时间词时也要把课表附上，
// 否则用户问「周三下午有什么课」会得到一份没有课表的快照）。
func LooksLikeScheduleQuery(text string) bool {
	t := strings.TrimSpace(text)
	if t == "" {
		return false
	}
	for _, word := range []string{"课程表", "课表", "课程", "上课", "有课", "早课", "上午课", "下午课", "晚课", "第几节", "几节课", "什么课", "哪节课"} {
		if strings.Contains(t, word) {
			return true
		}
	}
	return false
}

// workDigestMaxListPrompts 一次最多带几条栏目提示词。
// 提示词是给模型看的要求，条数太多会挤掉真正的工作数据；四条已经够覆盖
// 「工作安排 / 信用卡 / 随手记事本 / 自建清单」这类常见组合。
const workDigestMaxListPrompts = 4

// collectListPrompts 取这次数据范围里出现过的栏目的 AI 提示词。
//
// 只挑**真有数据**的栏目：用户给「人生要有仪式感」写了提示词、但这段时间一条
// 数据都没有，就别把那段话塞给模型（否则模型会对着空数据讲要求）。用 @清单名
// 点名时只看那一栏。顺序按清单在侧栏的先后，最多 workDigestMaxListPrompts 条。
func collectListPrompts(db *gorm.DB, userID uint, digest WorkDigest) []WorkDigestPrompt {
	wanted := map[uint]bool{}
	add := func(items []WorkDigestItem) {
		for _, item := range items {
			if item.ListID > 0 {
				wanted[item.ListID] = true
			}
		}
	}
	add(digest.Completed)
	add(digest.Open)
	add(digest.Notes)
	if digest.ListID > 0 {
		wanted = map[uint]bool{digest.ListID: true}
	}
	if len(wanted) == 0 {
		return nil
	}
	var rows []List
	if err := db.Where("user_id = ? AND deleted_at IS NULL AND ai_prompt <> ''", userID).
		Order("position ASC, id ASC").Find(&rows).Error; err != nil {
		return nil
	}
	out := make([]WorkDigestPrompt, 0, len(rows))
	for _, list := range rows {
		if !wanted[list.ID] {
			continue
		}
		prompt := strings.TrimSpace(list.AIPrompt)
		if prompt == "" {
			continue
		}
		out = append(out, WorkDigestPrompt{ListID: list.ID, Name: strings.TrimSpace(list.Name), Prompt: prompt})
		if len(out) >= workDigestMaxListPrompts {
			break
		}
	}
	return out
}

// workRangeLabel 给区间一个口语名字，草稿的标题与提示词都用它。
func workRangeLabel(option string, span CompletedRangeSpan) string {
	if option == "" || option == "all" {
		return "全部时间"
	}
	named := map[string]string{
		"today":     "今天",
		"yesterday": "昨天",
		"week":      "本周",
		"lastweek":  "上周",
		"month":     "本月",
		"lastmonth": "上月",
		"year":      "今年",
	}
	if name, ok := named[option]; ok {
		if span.Label == "" {
			return name
		}
		return name + "（" + span.Label + "）"
	}
	if span.Label == "" {
		return "自定义时间段"
	}
	return span.Label
}

// listOpenWork 取「还没做完」的任务。
//
// 口径：任务（kind=task）、未完成、未删除，且**在区间结束前就该做完**
// （截止时间落在区间里，或者已经逾期到此刻）。已经逾期但不在区间内的也留着 ——
// 写周报时「手上还挂着的旧账」正是要看的东西；截止时间晚于区间结束的将来任务
// 不算进来（那是下周的事）。
func listOpenWork(db *gorm.DB, userID uint, rng CompletedRange, keyword string, listID uint, now time.Time, loc *time.Location) ([]WorkDigestItem, int, error) {
	q := db.Where("user_id = ? AND deleted_at IS NULL AND completed_at IS NULL AND kind = ?", userID, KindTask)
	q = excludeHiddenCardReminders(q, hiddenCardListIDs(db, userID))
	if listID > 0 {
		q = q.Where("list_id = ?", listID)
	}
	if rng.End != nil {
		// due_at <= 区间结束（含未逾期但落在区间内的）。due_at 为空的任务在
		// 「当前未完成」口径里要保留，所以这里用 OR 把空值一起放进来。
		q = q.Where("due_at IS NULL OR "+tsUTC("due_at")+" < datetime(?)", sqlTimeArg(*rng.End))
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		q = q.Where("(title LIKE ? OR notes LIKE ?)", like, like)
	}
	var rows []Reminder
	if err := q.Order(tsUTC("due_at") + " ASC").Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	// 逾期优先，其次按截止时间早的在前；没设截止时间的排最后。
	items := make([]WorkDigestItem, 0, len(rows))
	listNames := listNamesOf(db, userID, rows)
	overdue := 0
	for _, row := range rows {
		item := WorkDigestItem{Title: row.Title, ListName: listNames[row.ListID], ListID: row.ListID}
		if row.DueAt == nil {
			item.NoDue = true
			items = append(items, item)
			continue
		}
		due := row.DueAt.In(loc)
		item.Day = due.Format("2006-01-02")
		item.Clock = due.Format("15:04")
		if due.Before(now) {
			item.Overdue = true
			item.OverdueDays = overdueDays(due, now)
			overdue++
		}
		items = append(items, item)
	}
	sortWorkItemsByUrgency(items)
	return items, overdue, nil
}

// sortWorkItemsByUrgency 把逾期最久、随后临近截止的排在前面，没日期的垫底。
func sortWorkItemsByUrgency(items []WorkDigestItem) {
	rank := func(item WorkDigestItem) (int, string) {
		switch {
		case item.Overdue:
			return 0, item.Day
		case item.Day != "":
			return 1, item.Day
		default:
			return 2, item.Title
		}
	}
	for i := 1; i < len(items); i++ {
		for j := i; j > 0; j-- {
			ri, ki := rank(items[j-1])
			rj, kj := rank(items[j])
			if ri < rj || (ri == rj && ki <= kj) {
				break
			}
			items[j-1], items[j] = items[j], items[j-1]
		}
	}
}

// overdueDays 是「逾期几天」，按自然日算（今天上午到期、晚上看＝逾期 0 天）。
func overdueDays(due, now time.Time) int {
	dueDay := time.Date(due.Year(), due.Month(), due.Day(), 0, 0, 0, 0, due.Location())
	nowDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	days := int(nowDay.Sub(dueDay).Hours() / 24)
	if days < 0 {
		return 0
	}
	return days
}

// listWorkNotes 取区间内新记的记事。记事的「记录时间」就是它的 completed_at
// （记事没有到期时间，保存时会被清空），这与日历里记事的落位口径一致。
func listWorkNotes(db *gorm.DB, userID uint, rng CompletedRange, keyword string, listID uint, loc *time.Location) ([]WorkDigestItem, int, error) {
	q := db.Where("user_id = ? AND deleted_at IS NULL AND kind = ? AND completed_at IS NOT NULL", userID, KindNote)
	q = excludeHiddenCardReminders(q, hiddenCardListIDs(db, userID))
	if listID > 0 {
		q = q.Where("list_id = ?", listID)
	}
	if rng.Start != nil {
		q = q.Where(tsUTC("completed_at")+" >= datetime(?)", sqlTimeArg(*rng.Start))
	}
	if rng.End != nil {
		q = q.Where(tsUTC("completed_at")+" < datetime(?)", sqlTimeArg(*rng.End))
	}
	if keyword != "" {
		q = q.Where("title LIKE ?", "%"+keyword+"%")
	}
	var rows []Reminder
	if err := q.Order(tsUTC("completed_at") + " DESC").Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	total := len(rows)
	if len(rows) > workDigestMaxNotes {
		rows = rows[:workDigestMaxNotes]
	}
	listNames := listNamesOf(db, userID, rows)
	items := make([]WorkDigestItem, 0, len(rows))
	for _, row := range rows {
		at := row.CompletedAt.In(loc)
		items = append(items, WorkDigestItem{
			Title:    row.Title,
			Day:      at.Format("2006-01-02"),
			Clock:    at.Format("15:04"),
			ListName: listNames[row.ListID],
			ListID:   row.ListID,
		})
	}
	return items, total, nil
}

// listNamesOf 一次取回涉及到的清单名，避免逐行查询。
func listNamesOf(db *gorm.DB, userID uint, rows []Reminder) map[uint]string {
	wanted := map[uint]struct{}{}
	for _, row := range rows {
		if row.ListID > 0 {
			wanted[row.ListID] = struct{}{}
		}
	}
	if len(wanted) == 0 {
		return map[uint]string{}
	}
	ids := make([]uint, 0, len(wanted))
	for id := range wanted {
		ids = append(ids, id)
	}
	var lists []List
	if err := db.Where("user_id = ? AND id IN ?", userID, ids).Find(&lists).Error; err != nil {
		return map[uint]string{}
	}
	names := make(map[uint]string, len(lists))
	for _, l := range lists {
		names[l.ID] = l.Name
	}
	return names
}

// mergeWorkLists 按清单汇总「完成 N / 未完成 M」，完成多的排前面。记事也算
// 这个清单里的产出（记事的清单就是它写下的地方），不然只有记事的清单会整条消失。
// listNameOf 按 id 查一个清单的名字（查不到就返回空串）。
func listNameOf(db *gorm.DB, userID, listID uint) string {
	var list List
	if err := db.Where("user_id = ? AND id = ? AND deleted_at IS NULL", userID, listID).First(&list).Error; err != nil {
		return ""
	}
	return strings.TrimSpace(list.Name)
}

// FindMentionedList 在用户说的那句话里找「@清单名」——就是他点名要看哪一栏。
//
// 面板上打 @ 弹出的选择器只是把名字补进输入框，最终认的还是这句话：用户自己
// 手打「@信用卡账单」也一样管用。（@全部 这类虚拟栏目不在清单表里，不参与。）
// 清单按名字长的先试，免得短名字（例如「信用卡」）抢先匹配掉长名字。
func FindMentionedList(db *gorm.DB, userID uint, text string) (uint, string, bool) {
	text = strings.TrimSpace(text)
	if text == "" || !strings.Contains(text, "@") {
		return 0, "", false
	}
	var lists []List
	if err := db.Where("user_id = ? AND deleted_at IS NULL", userID).Order("length(name) DESC").Find(&lists).Error; err != nil {
		return 0, "", false
	}
	for _, list := range lists {
		name := strings.TrimSpace(list.Name)
		if name == "" {
			continue
		}
		if strings.Contains(text, "@"+name) {
			return list.ID, name, true
		}
	}
	return 0, "", false
}

func mergeWorkLists(completed, open, notes []WorkDigestItem) []WorkDigestList {
	index := map[string]*WorkDigestList{}
	order := []string{}
	ensure := func(name string) *WorkDigestList {
		if name == "" {
			name = "未归入清单"
		}
		if row, ok := index[name]; ok {
			return row
		}
		row := &WorkDigestList{Name: name}
		index[name] = row
		order = append(order, name)
		return row
	}
	for _, item := range completed {
		ensure(item.ListName).Completed++
	}
	for _, item := range open {
		ensure(item.ListName).Open++
	}
	for _, item := range notes {
		ensure(item.ListName).Completed++
	}
	out := make([]WorkDigestList, 0, len(order))
	for _, name := range order {
		out = append(out, *index[name])
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0; j-- {
			if out[j-1].Completed >= out[j].Completed {
				break
			}
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}

// Markdown 把快照渲染成给模型看的文本。刻意用「数据而非命令」的口吻：
// 提示词里会再说一遍「据此作答、不要编造」，这里只负责把事实摆清楚。
// collectCourses 取本周（周一 ~ 周日）的课表，含课外活动与备注。
// 课表按周几重复，所以这里只需要「本周一」和用户现在所在时区。
const workDigestMaxCourses = 80

// sectionResolver 把开始时间映射到四段之一。节次表是表级 JSON，字段名固定，
// 这里只依赖 section/start/end 三个键，所以在 reminder 包里解码即可，不用 import timetable。
func sectionResolver(raw string) func(string) string {
	type period struct {
		Section string `json:"section"`
		Start   string `json:"start"`
		End     string `json:"end"`
	}
	var periods []period
	if strings.TrimSpace(raw) == "" || json.Unmarshal([]byte(raw), &periods) != nil {
		return nil
	}
	labels := map[string]string{"early": "早课", "morning": "上午", "afternoon": "下午", "evening": "晚课"}
	return func(start string) string {
		for _, p := range periods {
			if p.Start == start {
				return labels[p.Section]
			}
		}
		// 手工填的怪时间：落进哪一节的区间就算哪一段。
		for _, p := range periods {
			if start >= p.Start && start < p.End {
				return labels[p.Section]
			}
		}
		return ""
	}
}

func collectCourses(db *gorm.DB, userID uint, keyword string, rng CompletedRange, now time.Time) ([]WorkDigestCourse, bool) {
	type courseRow struct {
		TableID   uint
		TableName string
		Weekday   int
		Title     string
		Kind      string
		StartTime string
		EndTime   string
		Location  string
		Teacher   string
		Note      string
	}
	q := db.Table("timetable_entries AS e").
		Select("t.id AS table_id, t.name AS table_name, e.weekday, e.title, e.kind, e.start_time, e.end_time, e.location, e.teacher, e.note").
		Joins("JOIN timetables AS t ON t.id = e.timetable_id").
		Where("t.user_id = ? AND e.user_id = ?", userID, userID)
	if keyword != "" {
		like := "%" + keyword + "%"
		q = q.Where("(e.title LIKE ? OR e.note LIKE ? OR e.location LIKE ?)", like, like, like)
	}
	var rows []courseRow
	if err := q.Order("t.position ASC, t.id ASC, e.weekday ASC, e.start_time ASC").Scan(&rows).Error; err != nil {
		return nil, false
	}
	// 每张表的节次表：用来把课归到早课/上午/下午/晚课，模型答「周三下午」时才不会串。
	sectionOf := map[uint]func(start string) string{}
	type periodRow struct {
		ID      uint
		Periods string
	}
	var periodRows []periodRow
	if err := db.Table("timetables").Select("id, periods").Where("user_id = ?", userID).Scan(&periodRows).Error; err == nil {
		for _, pr := range periodRows {
			sectionOf[pr.ID] = sectionResolver(pr.Periods)
		}
	}

	truncated := len(rows) > workDigestMaxCourses
	if truncated {
		rows = rows[:workDigestMaxCourses]
	}
	loc := shanghai()
	weekday := int(now.In(loc).Weekday())
	if weekday == 0 {
		weekday = 7
	}
	monday := now.In(loc).AddDate(0, 0, 1-weekday)
	out := make([]WorkDigestCourse, 0, len(rows))
	for _, row := range rows {
		day := monday.AddDate(0, 0, row.Weekday-1)
		// 选了「今天 / 上周」这种窄口径时，只留落在区间里的那一天；
		// 「全部 / 当前未完成」则整周都给，模型自己按日期挑。
		if rng.Start != nil && (day.Before(*rng.Start) || !day.Before(*rng.End)) {
			continue
		}
		section := ""
		if resolve := sectionOf[row.TableID]; resolve != nil {
			section = resolve(row.StartTime)
		}
		out = append(out, WorkDigestCourse{
			Table: row.TableName, Section: section, Day: day.Format("2006-01-02"), Weekday: row.Weekday,
			Title: row.Title, Kind: row.Kind, Start: row.StartTime, End: row.EndTime,
			Location: row.Location, Teacher: row.Teacher, Note: row.Note,
		})
	}
	return out, truncated
}

// writeCourseItems 按表 → 天分组，一天一行，便于模型直接复述。
func writeCourseItems(b *strings.Builder, courses []WorkDigestCourse) {
	weekdays := []string{"", "周一", "周二", "周三", "周四", "周五", "周六", "周日"}
	lastTable, lastDay := "", ""
	for _, course := range courses {
		if course.Table != lastTable {
			fmt.Fprintf(b, "- %s：\n", course.Table)
			lastTable = course.Table
			lastDay = ""
		}
		label := weekdays[course.Weekday] + " " + course.Day[5:]
		if course.Section != "" {
			label += " " + course.Section
		}
		if label != lastDay {
			fmt.Fprintf(b, "  %s：", label)
			lastDay = label
		} else {
			b.WriteString("；")
		}
		kind := ""
		if course.Kind == "activity" {
			kind = "（活动）"
		}
		fmt.Fprintf(b, "%s-%s %s%s", course.Start, course.End, course.Title, kind)
		meta := []string{}
		if course.Location != "" {
			meta = append(meta, course.Location)
		}
		if course.Teacher != "" {
			meta = append(meta, course.Teacher)
		}
		if course.Note != "" {
			meta = append(meta, "备注："+course.Note)
		}
		if len(meta) > 0 {
			fmt.Fprintf(b, "（%s）", strings.Join(meta, "·"))
		}
		if lastDay != "" {
			b.WriteString("")
		}
	}
	b.WriteString("\n")
}

func (d WorkDigest) Markdown() string {
	var b strings.Builder
	fmt.Fprintf(&b, "【工作数据】时间段：%s", d.Label)
	if d.Keyword != "" {
		fmt.Fprintf(&b, "；关键词：%s", d.Keyword)
	}
	if d.ListName != "" {
		fmt.Fprintf(&b, "；只看清单：%s（用户用 @%s 点名了这一栏，别把别的清单的数据算进来）", d.ListName, d.ListName)
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "统计：完成 %d 条 / 还没做完 %d 条（其中逾期 %d 条）/ 记事新增 %d 条 / 涉及清单 %d 个\n",
		d.Stats.Completed, d.Stats.Open, d.Stats.Overdue, d.Stats.Notes, d.Stats.Lists)

	if len(d.Completed) > 0 {
		fmt.Fprintf(&b, "\n一、这段时间完成的（%d 条）\n", len(d.Completed))
		writeWorkItems(&b, d.Completed)
	} else {
		b.WriteString("\n一、这段时间完成的：没有记录\n")
	}

	if len(d.Open) > 0 {
		fmt.Fprintf(&b, "\n二、还没做完的（%d 条）\n", len(d.Open))
		writeWorkItems(&b, d.Open)
	} else {
		b.WriteString("\n二、还没做完的：没有\n")
	}

	if len(d.Lists) > 0 {
		b.WriteString("\n三、清单分布\n")
		for _, row := range d.Lists {
			fmt.Fprintf(&b, "- %s：完成 %d / 未完成 %d\n", row.Name, row.Completed, row.Open)
		}
	}

	if len(d.Notes) > 0 {
		fmt.Fprintf(&b, "\n四、这段时间新记的记事（共 %d 条）\n", d.Stats.Notes)
		writeWorkItems(&b, d.Notes)
	}

	if len(d.Courses) > 0 {
		fmt.Fprintf(&b, "\n五、课程表（%d 节）\n", len(d.Courses))
		writeCourseItems(&b, d.Courses)
	}

	if d.Truncated {
		fmt.Fprintf(&b, "\n（提示：数据量较大，完成记录最多列出 %d 条、未完成最多 %d 条、记事最多 %d 条。）\n",
			workDigestMaxCompleted, workDigestMaxOpen, workDigestMaxNotes)
	}
	return strings.TrimRight(b.String(), "\n")
}

func writeWorkItems(b *strings.Builder, items []WorkDigestItem) {
	for i, item := range items {
		stamp := ""
		if item.Day != "" {
			stamp = item.Day
			if item.Clock != "" && item.Clock != "00:00" {
				stamp += " " + item.Clock
			}
			stamp += " "
		}
		line := fmt.Sprintf("%d. %s%s", i+1, stamp, item.Title)
		if item.ListName != "" {
			line += "（" + item.ListName + "）"
		}
		switch {
		case item.Overdue && item.OverdueDays > 0:
			line += fmt.Sprintf("［已逾期 %d 天］", item.OverdueDays)
		case item.Overdue:
			line += "［今天到期未完成］"
		case item.NoDue:
			line += "［没设截止时间］"
		}
		b.WriteString(line + "\n")
	}
}

// DraftReport 是**没有模型时**的兜底成稿：按真实数据直接拼一份中文草稿。
// 它不做任何语言加工（不是「智能总结」），只是把该看的数字和条目摆出来，
// 让「周报」这个按钮在任何时候点下去都有内容。
func (d WorkDigest) DraftReport() string {
	var b strings.Builder
	title := d.Label
	if d.Keyword != "" {
		title = d.Keyword + " · " + title
	}
	fmt.Fprintf(&b, "【%s 工作草稿】\n", title)
	b.WriteString("（这是按「已完成」与「待办」里的真实记录直接整理的草稿，没有经过模型润色；接上模型后同一份数据会写成更顺的成稿。）\n")
	fmt.Fprintf(&b, "\n合计：完成 %d 条 · 还没做完 %d 条（逾期 %d 条）", d.Stats.Completed, d.Stats.Open, d.Stats.Overdue)
	if d.Stats.Notes > 0 {
		fmt.Fprintf(&b, " · 记事新增 %d 条", d.Stats.Notes)
	}
	b.WriteString("\n")

	if len(d.Completed) > 0 {
		fmt.Fprintf(&b, "\n一、完成事项（%d 条）\n", len(d.Completed))
		writeDraftItems(&b, d.Completed)
	}
	if len(d.Open) > 0 {
		fmt.Fprintf(&b, "\n二、还没收尾（%d 条）\n", len(d.Open))
		writeDraftItems(&b, d.Open)
	}
	if len(d.Lists) > 0 {
		b.WriteString("\n三、清单分布\n")
		for _, row := range d.Lists {
			fmt.Fprintf(&b, "- %s：完成 %d / 未完成 %d\n", row.Name, row.Completed, row.Open)
		}
	}
	if len(d.Notes) > 0 {
		fmt.Fprintf(&b, "\n四、新记的记事（%d 条）\n", len(d.Notes))
		writeDraftItems(&b, d.Notes)
	}
	if d.Stats.Completed == 0 && d.Stats.Open == 0 && d.Stats.Notes == 0 {
		if d.ListName != "" {
			fmt.Fprintf(&b, "\n清单「%s」在这段时间里没有记录。", d.ListName)
		} else {
			b.WriteString("\n这段时间没有对应的记录。")
		}
		if d.Keyword != "" {
			fmt.Fprintf(&b, "（关键词「%s」没有命中）", d.Keyword)
		}
		b.WriteString("\n")
	}
	if d.Truncated {
		fmt.Fprintf(&b, "\n（记录较多，这里只列了前 %d 条完成、%d 条未完成。）\n", workDigestMaxCompleted, workDigestMaxOpen)
	}
	return strings.TrimRight(b.String(), "\n")
}

func writeDraftItems(b *strings.Builder, items []WorkDigestItem) {
	for i, item := range items {
		when := ""
		if item.Day != "" {
			when = item.Day[5:] // 草稿里只留 MM-DD，短一点好读
			if item.Clock != "" && item.Clock != "00:00" {
				when += " " + item.Clock
			}
		}
		line := fmt.Sprintf("%d. ", i+1)
		if when != "" {
			line += when + " "
		}
		line += item.Title
		meta := []string{}
		if item.ListName != "" {
			meta = append(meta, item.ListName)
		}
		switch {
		case item.Overdue && item.OverdueDays > 0:
			meta = append(meta, fmt.Sprintf("已逾期 %d 天", item.OverdueDays))
		case item.Overdue:
			meta = append(meta, "今天到期未完成")
		case item.NoDue:
			meta = append(meta, "没设截止时间")
		}
		if len(meta) > 0 {
			line += "（" + strings.Join(meta, " · ") + "）"
		}
		b.WriteString(line + "\n")
	}
}

// ── 自由输入里的时间段识别 ───────────────────────────────────────────────
//
// 用户更习惯直接说「写上周工作总结」，所以小秘在**没选时间段**时也会看一眼
// 这句话里有没有时间词。识别不出来就不附数据（按普通聊天走）。

var workNearRe = regexp.MustCompile(`^(近|最近|前)\s*([0-9]{1,3}|[一二两三四五六七八九十]{1,3})\s*(天|日|周|星期|个月|月|年)`)

// DetectWorkOptions 从一句话里认出时间段。第二个返回值表示有没有认出来。
func DetectWorkOptions(text string, now time.Time) (WorkDigestOptions, bool) {
	loc := shanghai()
	now = now.In(loc)
	raw := strings.TrimSpace(text)
	if raw == "" {
		return WorkDigestOptions{}, false
	}
	// 先把「上周/本月」这类整段区间认掉（它们是用户最常用的说法）。
	named := []struct {
		words  []string
		option string
	}{
		{[]string{"上周", "上星期", "上个星期"}, "lastweek"},
		{[]string{"本周", "这周", "本星期", "这星期", "周报"}, "week"},
		{[]string{"上个月", "上月"}, "lastmonth"},
		{[]string{"本月", "这个月", "月报"}, "month"},
		{[]string{"年报"}, "year"},
		{[]string{"今天", "今日"}, "today"},
		{[]string{"昨天", "昨日"}, "yesterday"},
		{[]string{"今年", "本年"}, "year"},
	}
	for _, item := range named {
		for _, word := range item.words {
			if strings.Contains(raw, word) {
				return WorkDigestOptions{Option: item.option}, true
			}
		}
	}
	if strings.Contains(raw, "去年") {
		// 「去年」不是「已完成」页的筛选选项，直接换算成自定义区间。
		start := time.Date(now.Year()-1, 1, 1, 0, 0, 0, 0, loc)
		end := time.Date(now.Year()-1, 12, 31, 0, 0, 0, 0, loc)
		return WorkDigestOptions{
			Option: "custom",
			From:   start.Format("2006-01-02"),
			To:     end.Format("2006-01-02"),
		}, true
	}
	// 「近 7 天」「最近三个月」这类滚动窗口。
	if m := workNearRe.FindStringSubmatch(raw); m != nil {
		amount, ok := parseWorkAmount(m[2])
		if ok && amount > 0 {
			unitDays := map[string]int{"天": 1, "日": 1, "周": 7, "星期": 7, "个月": 30, "月": 30, "年": 365}[m[3]]
			if unitDays > 0 {
				start := now.AddDate(0, 0, -(amount*unitDays - 1))
				return WorkDigestOptions{
					Option: "custom",
					From:   time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, loc).Format("2006-01-02"),
					To:     now.Format("2006-01-02"),
				}, true
			}
		}
	}
	// 「2026-09-01 到 2026-09-30」这类明确日期。
	if opts, ok := detectExplicitDates(raw, loc); ok {
		return opts, true
	}
	return WorkDigestOptions{}, false
}

var workDateRe = regexp.MustCompile(`(\d{4}-\d{1,2}-\d{1,2})`)

// detectExplicitDates 认「两个日期 + 连接词」的写法（到 / 至 / ~ / -）。
func detectExplicitDates(raw string, loc *time.Location) (WorkDigestOptions, bool) {
	matches := workDateRe.FindAllString(raw, -1)
	if len(matches) < 2 {
		return WorkDigestOptions{}, false
	}
	rest := workDateRe.ReplaceAllString(raw, "")
	if !strings.ContainsAny(rest, "到至~-—") {
		return WorkDigestOptions{}, false
	}
	start, err1 := time.ParseInLocation("2006-01-02", normalizeWorkDate(matches[0]), loc)
	end, err2 := time.ParseInLocation("2006-01-02", normalizeWorkDate(matches[1]), loc)
	if err1 != nil || err2 != nil {
		return WorkDigestOptions{}, false
	}
	return WorkDigestOptions{
		Option: "custom",
		From:   start.Format("2006-01-02"),
		To:     end.Format("2006-01-02"),
	}, true
}

// normalizeWorkDate 把 2026-9-1 补成 2026-09-01，好走统一的解析。
func normalizeWorkDate(value string) string {
	parts := strings.Split(value, "-")
	if len(parts) != 3 {
		return value
	}
	month, _ := strconv.Atoi(parts[1])
	day, _ := strconv.Atoi(parts[2])
	return fmt.Sprintf("%s-%02d-%02d", parts[0], month, day)
}

// parseWorkAmount 认阿拉伯数字与中文数字（「近三个月」）。
func parseWorkAmount(raw string) (int, bool) {
	if n, err := strconv.Atoi(raw); err == nil {
		return n, true
	}
	digits := map[rune]int{'一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10}
	runes := []rune(raw)
	if len(runes) == 1 {
		if n, ok := digits[runes[0]]; ok {
			return n, true
		}
		return 0, false
	}
	// 十一 / 十二 / 二十 / 三十 这类：只处理到 99，够用了。
	if len(runes) == 2 {
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
	}
	return 0, false
}

// ValidateWorkOptions 校验前端传来的时间段参数，并给出人话错误。
func ValidateWorkOptions(opts WorkDigestOptions) error {
	option := strings.TrimSpace(opts.Option)
	switch option {
	case "", "all", "today", "yesterday", "week", "lastweek", "month", "lastmonth", "year", WorkOptionOpen:
		return nil
	case "custom":
		if strings.TrimSpace(opts.From) == "" || strings.TrimSpace(opts.To) == "" {
			return errors.New("自定义时间段要同时给开始与结束日期")
		}
		_, err := ParseCompletedRange("custom", opts.From, opts.To)
		return err
	default:
		return fmt.Errorf("时间段参数无效：%s", option)
	}
}
