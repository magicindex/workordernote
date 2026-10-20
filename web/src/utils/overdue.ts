// 逾期判定的**唯一口径**（列表页、首页看板、任何要标「已逾期」的地方都用这一份）。
//
// 为什么抽出来：这套口径（生效时间不看 snoozed_until、按「逾期提醒时间」当天算、
// 再加宽限分钟）原本只写在 HomeView 里，首页看板要用同一套，抄一份迟早会跑偏。
import type { ReminderItem } from '../api/reminder'

/** 逾期判定的「生效时间」：时间段最后一天 > 开始时间 > 到期时间；**不看 snoozed_until**。
 *
 * 「知道了 / 稍后提醒」只决定「什么时候再提醒我」，不该把一条已经逾期的任务从
 * 「已逾期」里摘掉（用户 2026-10-13）。与服务端 deadlineStamp 同一口径。
 * 记事没有排期、已完成的不算 —— 一律返回 null。
 */
export function overdueStamp(item: ReminderItem): number | null {
  if (item.completed_at || item.kind === 'note') return null
  const raw = item.end_at || item.start_at || item.due_at
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? null : t
}

/** 把 "HH:MM" 拆成时分；非法值给 0:0。 */
export function clockParts(value: string | null | undefined): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim())
  if (!m) return { h: 0, m: 0 }
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return { h: 0, m: 0 }
  return { h, m: min }
}

/** 逾期判定的**截止时刻**：到期时刻与「当天那个逾期提醒时间」取晚？不 —— 取当天那个点
 *  （用户 2026-10-12 明确：到期日当天到了逾期提醒时间就算逾期，与任务写了几点无关）。
 *  逾期时间写 00:00 时表示「按到期时刻算、不按天顺延」。 */
export function overdueDeadlineAt(item: ReminderItem, cutoff: { h: number; m: number }): number | null {
  const t = overdueStamp(item)
  if (t === null) return null
  if (cutoff.h === 0 && cutoff.m === 0) return t
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), cutoff.h, cutoff.m, 0, 0).getTime()
}

/** 过期了吗：过了截止时刻、再加上「宽限分钟」。 */
export function isOverdueAt(
  item: ReminderItem,
  opts: { cutoff: { h: number; m: number }; graceMinutes: number; now: number },
): boolean {
  const t = overdueDeadlineAt(item, opts.cutoff)
  if (t === null) return false
  return t + opts.graceMinutes * 60_000 < opts.now
}
