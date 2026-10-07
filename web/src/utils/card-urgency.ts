// 卡面配色与「账期阶段」的唯一权威实现：大卡面（CreditCardPanel）与时间卡片里的
// 缩略小卡面（WeekDueStrip）都调这里，保证两者永远同色同字色。
//
// 规则（用户指定）：
//   · 默认：所有卡同一套配色，靠银行标志区分；
//   · 账单日之后：按账期进度从**黄**渐变到**橘**（越接近还款日越橘）；
//   · 还款日前 3 天（含逾期）：整张转**红**；
//   · 本期已还：回到默认色。

import type { CreditCard } from '../api/reminder'
import { formatCents } from './card'

export const DEFAULT_FROM = '#64748b' // slate-500
export const DEFAULT_TO = '#1e293b'   // slate-800
export const SOON_FROM = '#facc15'    // yellow-400
export const SOON_TO = '#f97316'      // orange-500
export const URGENT_FROM = '#ef4444'  // red-500
export const URGENT_TO = '#991b1b'    // red-800
export const DEFAULT_GRADIENT = `linear-gradient(135deg, ${DEFAULT_FROM} 0%, ${DEFAULT_TO} 100%)`
export const URGENT_GRADIENT = `linear-gradient(135deg, ${URGENT_FROM} 0%, ${URGENT_TO} 100%)`

export type UrgencyLevel = 'paid' | 'normal' | 'soon' | 'urgent' | 'overdue'

export interface Urgency {
  level: UrgencyLevel
  /** 卡面背景（CSS gradient） */
  gradient: string
  /** 卡面文字色：黄色档自动换深色字，保证看得清 */
  ink: string
  /** 进度条宽度 / 颜色 / 右下角状态文案 */
  barWidth: string
  barColor: string
  status: string
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)) }

/** 两个 #rrggbb 之间插值（t=0 → a，t=1 → b）；SOON_TO 传进来的是十六进制、另一头也可能是。 */
function lerpHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const k = clamp01(t)
  const ch = (shift: number) => {
    const va = (pa >> shift) & 255
    const vb = (pb >> shift) & 255
    return Math.round(va + (vb - va) * k)
  }
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

/** 底色亮的时候用深色字（黄色卡面上白字看不清）。 */
export function inkFor(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? '#0f172a' : '#ffffff'
}

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function today0() { return startOfDay(new Date()) }

/** 今天到某日期相差几天（按自然日算）。 */
export function daysFromToday(date: string | Date) {
  const d = startOfDay(typeof date === 'string' ? new Date(date) : date)
  return Math.round((d.getTime() - today0().getTime()) / 86400000)
}

/** 算出这张卡当前处于哪个阶段，以及对应的卡面配色。 */
export function urgencyOf(card: CreditCard): Urgency {
  const base: Urgency = {
    level: 'normal', gradient: DEFAULT_GRADIENT, ink: '#ffffff',
    barWidth: '0%', barColor: 'rgba(255,255,255,.85)', status: '账单日未到',
  }
  const cur = card.current
  if (!cur?.due_date) return base

  const days = daysFromToday(cur.due_date)
  if (cur.paid_at) {
    return { ...base, level: 'paid', status: `本期已还 · 下次还款 ${cur.due_date.slice(0, 10)}` }
  }
  if (days < 0) {
    return {
      level: 'overdue', gradient: URGENT_GRADIENT, ink: '#ffffff',
      barWidth: '100%', barColor: '#fecaca',
      status: `已逾期 ${-days} 天 · 应还 ¥${formatCents(cur.amount_cents)}`,
    }
  }
  if (days <= 3) {
    return {
      level: 'urgent', gradient: URGENT_GRADIENT, ink: '#ffffff',
      barWidth: '100%', barColor: '#fecaca',
      status: days === 0
        ? `今天到期 · 应还 ¥${formatCents(cur.amount_cents)}`
        : `${days} 天后到期 · 应还 ¥${formatCents(cur.amount_cents)}`,
    }
  }
  const statement = cur.statement_date ? startOfDay(new Date(cur.statement_date)) : null
  if (!statement || today0().getTime() < statement.getTime()) {
    return { ...base, status: `还有 ${days} 天到还款日` }
  }
  // 账单日之后：黄 → 橘（进度按「账单日 → 还款日前 3 天」这一段算）
  const windowEnd = new Date(startOfDay(new Date(cur.due_date)).getTime() - 3 * 86400000)
  const span = Math.max(1, windowEnd.getTime() - statement.getTime())
  const progress = clamp01((today0().getTime() - statement.getTime()) / span)
  const from = lerpHex(SOON_FROM, SOON_TO, progress)
  return {
    level: 'soon',
    gradient: `linear-gradient(135deg, ${from} 0%, ${lerpHex(SOON_TO, '#c2410c', progress)} 100%)`,
    ink: inkFor(from),
    barWidth: `${Math.round(progress * 100)}%`,
    barColor: 'rgba(255,255,255,.9)',
    status: `账单已出 · 还有 ${days} 天到还款日 · 应还 ¥${formatCents(cur.amount_cents)}`,
  }
}
