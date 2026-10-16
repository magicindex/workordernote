/**
 * 信用卡账单日/还款日的日期口径。
 *
 * 必须与后端 `server/reminder/card_service.go` 保持一致：
 *   · 某月没有那一天（如 2 月 31 号）就取当月最后一天；
 *   · 「下一个账单日」把当天算作还没过去；
 *   · 免息期 = 账单日 → 它对应的还款日，还款日 ≤ 账单日按跨月算。
 * 前端这份只用于「填表时实时预览」，真正的还款计划由后端生成，以后端为准。
 */

/** 某年某月的第 day 天；该月没有这一天就取当月最后一天。 */
export function dateWithDay(year: number, month: number, day: number): Date {
  const last = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(Math.max(day, 1), last))
}

/** 从今天算起、还没过去的那个「每月 day 号」（今天算没过去）。 */
export function nextDayOccurrence(day: number, from: Date = new Date()): Date {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  let at = dateWithDay(today.getFullYear(), today.getMonth(), day)
  if (at.getTime() < today.getTime()) {
    const next = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    at = dateWithDay(next.getFullYear(), next.getMonth(), day)
  }
  return at
}

/** 账单日到还款日的天数（免息期）。 */
export function graceDays(statementDay: number, dueDay: number, from: Date = new Date()): number {
  const statement = nextDayOccurrence(statementDay, from)
  let due = dateWithDay(statement.getFullYear(), statement.getMonth(), dueDay)
  if (dueDay <= statementDay) {
    const next = new Date(statement.getFullYear(), statement.getMonth() + 1, 1)
    due = dateWithDay(next.getFullYear(), next.getMonth(), dueDay)
  }
  return Math.round((due.getTime() - statement.getTime()) / 86400000)
}

/** 距某个日子还有几天（今天=0）。 */
export function daysUntil(target: Date, from: Date = new Date()): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function formatCardDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 卡号只显示尾号：多余的空格与分隔符都去掉。 */
export function cardTail(no?: string | null): string {
  const digits = String(no || '').replace(/\D/g, '')
  return digits.length > 4 ? digits.slice(-4) : digits
}


/** 分 → 元（两位小数，带千分位）。金额一律用「分」在前后端传递，避免浮点误差。 */
export function formatCents(cents?: number | null): string {
  const n = Number(cents || 0) / 100
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 元（用户输入的字符串）→ 分。非法输入按 0 处理。 */
export function parseYuanToCents(input: string | number): number {
  const n = typeof input === 'number' ? input : Number(String(input).replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}
