package main

import (
	// 嵌入 IANA 时区库：本应用的日历语义（今天/计划视图过滤、重复规则、汇总
	// 计数）依赖 Asia/Shanghai，代码里多处 `time.LoadLocation("Asia/Shanghai")`
	// 都忽略了错误。宿主环境（精简的 fnOS 根文件系统、最小化容器镜像）可能
	// 没有 /usr/share/zoneinfo，此时 LoadLocation 返回 nil，相关接口会直接
	// 500（实测：无 tzdata 的环境下 /api/reminder/items 与 /api/reminder/summary
	// 返回 500，装上 tzdata 后恢复 200）。嵌入后与宿主机是否带时区库无关。
	_ "time/tzdata"

	"strings"
	"time"

	"gorm.io/gorm"

	"smallgo/server/assistant"
	"smallgo/server/config"
	"smallgo/server/server"

	// Apps are imported for their side effects (init registers routes), but the
	// reminder app also needs the upload dir: ceremony-card background images are
	// deleted together with their card (see reminder/background.go). It cannot be
	// wired from the server package — reminder's tests import server, which would
	// be an import cycle — so it happens here, before the server starts.
	"smallgo/server/reminder"
)

func main() {
	// `make dev` starts the binary from the repository root. Loading .env here
	// makes provider credentials available locally without changing production
	// environment-variable precedence.
	config.LoadDotEnv(".env", "server/.env")
	cfg := config.Parse()
	reminder.SetUploadDir(cfg.UploadDir)
	// 小秘要能按真实工作数据作答（周报/月报/工作清单/关键词查询），也要能把
	// 一段回答存成记事：两件事的实现都在 reminder 包，这里注入进去，assistant
	// 就不必直接依赖提醒库（reminder 的测试 import 根包 server，而根包 import
	// assistant，直接依赖会绕成 import cycle）。
	assistant.RegisterWorkDigestProvider(workDigestProvider)
	assistant.RegisterNoteSaver(saveAssistantNote)
	server.Start()
}

// saveAssistantNote 是「保存到记事本」的落库那一步：与小秘面板手动新建记事
// 共用 reminder.CreateNote（创建即完成、并广播给别的端）。
func saveAssistantNote(db *gorm.DB, userID uint, title, notes, originClientID string) (assistant.SavedNote, error) {
	item, err := reminder.CreateNote(db, userID, title, notes, originClientID)
	if err != nil {
		return assistant.SavedNote{}, err
	}
	return assistant.SavedNote{ID: item.ID, Title: item.Title, ListID: item.ListID, ListName: item.ListName}, nil
}

// workDigestProvider 是「呼叫小秘」的数据来源：认时间段 → 取数据 → 交给模型
// 的文本与给用户的草稿一次备好。口径识别与查询都在 reminder 包（与「已完成」
// 页同一套），这里只做搬运。
func workDigestProvider(db *gorm.DB, userID uint, req assistant.WorkDigestRequest) (assistant.WorkDigestResult, error) {
	now := time.Now()
	opts := reminder.WorkDigestOptions{Option: req.Option, From: req.From, To: req.To, Keyword: req.Keyword}
	// 「@清单名」：用户点名了某一栏，这一轮的数据只看它（打 @ 弹出的选择器只是
	// 把名字补进输入框，手打的 @名称 也认）。
	mentionedID, mentionedName, mentioned := reminder.FindMentionedList(db, userID, req.Text)
	opts.ListID, opts.ListName = mentionedID, mentionedName
	if strings.TrimSpace(opts.Option) == "" && strings.TrimSpace(opts.Keyword) == "" {
		// 面板没选时间段：看用户这句话里有没有「上周」「近 7 天」这类时间词。
		detected, ok := reminder.DetectWorkOptions(req.Text, now)
		if !ok {
			if !mentioned && reminder.LooksLikeScheduleQuery(req.Text) {
				// 问课表但没带时间词：把本周的课表附上，工作数据按本周算。
				detected, ok = reminder.WorkDigestOptions{Option: "week"}, true
			} else if !mentioned {
				return assistant.WorkDigestResult{}, nil // Found=false：这一轮不附数据
			}
		}
		if ok {
			detected.ListID, detected.ListName = opts.ListID, opts.ListName
			opts = detected
		}
	}
	if err := reminder.ValidateWorkOptions(opts); err != nil {
		return assistant.WorkDigestResult{}, err
	}
	digest, err := reminder.BuildWorkDigest(db, userID, opts, now)
	if err != nil {
		return assistant.WorkDigestResult{}, err
	}
	return assistant.WorkDigestResult{
		Found:     true,
		Option:    digest.Option,
		Label:     digest.Label,
		Start:     digest.Start,
		End:       digest.End,
		Keyword:   digest.Keyword,
		ListID:    digest.ListID,
		ListName:  digest.ListName,
		Completed: digest.Stats.Completed,
		Open:      digest.Stats.Open,
		Overdue:   digest.Stats.Overdue,
		Notes:     digest.Stats.Notes,
		Lists:     digest.Stats.Lists,
		Courses:   digest.Stats.Courses,
		Truncated: digest.Truncated,
		Markdown:  digest.Markdown(),
		Draft:     digest.DraftReport(),
		// 各栏目的 AI 提示词：用户在清单上写的「这一栏该怎么分析」。
		ListPrompts: listPromptsOf(digest.Prompts),
	}, nil
}

// listPromptsOf 把 reminder 的提示词结构搬成 assistant 的（两个包互不 import）。
func listPromptsOf(prompts []reminder.WorkDigestPrompt) []assistant.ListPrompt {
	if len(prompts) == 0 {
		return nil
	}
	out := make([]assistant.ListPrompt, 0, len(prompts))
	for _, item := range prompts {
		out = append(out, assistant.ListPrompt{Name: item.Name, Prompt: item.Prompt})
	}
	return out
}
