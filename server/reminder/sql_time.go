package reminder

import "time"

// SQLite 把时间列存成**文本**，而文本里的时区偏移并不统一：历史版本的前端写过
// `...Z`（+00:00），从对端同步过来的行也可能带别的偏移。SQLite 的 `<` / `>`
// 对文本是按**字符串**比的，于是
//
//	'2026-10-10 00:00:00+00:00'（本地 10-10 08:00，其实是明天）
//	  < '2026-10-10 00:00:00+08:00'（今天 24 点）
//
// 成立 —— 明天的条目就这么漏进了「今天」页。0.15.4 上线后实测到：今天页多出
// 一张「明天 · 10月10日」的卡片，而那条数据的 due_at 正是 +00:00 偏移。
//
// 解决办法：比较与排序时用 SQLite 的 datetime() 把两边都换算成 UTC。
// datetime() 认 ISO-8601 的偏移（'+08:00' → 减 8 小时），返回不带偏移的 UTC
// 文本，字符串序就等于时间序。**存储与同步都不动、不做数据迁移**，历史数据与
// 今后任何偏移的行都能正确比较。
//
// 用法：
//
//	q.Where(tsUTC("due_at")+" < datetime(?)", sqlTimeArg(endToday))
//	Order(tsUTC("completed_at") + " DESC")
//
// 参数侧一律走 sqlTimeArg：不同驱动绑定 time.Time 的格式不一样（有的绑整数
// 时间戳），自己格式化成 datetime() 认识的 UTC 文本最稳。
func tsUTC(col string) string { return "datetime(" + col + ")" }

// sqlTimeArg 把 Go 时间转成 datetime() 能直接吃的 UTC 文本。
func sqlTimeArg(t time.Time) string { return t.UTC().Format("2006-01-02 15:04:05") }
