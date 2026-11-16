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

/**
 * 卡面跟随「卡片透明度」偏好（用户 2026-11-16：「卡片透明度没有跟随变化」）。
 *
 * 彩色卡面原来是不透明渐变，拖动滑块时别的卡片都变透明了、只有它还实心，
 * 看着像贴上去的。这里把渐变两端的颜色按同一个透明度改成 rgba，
 * 卡面就透出背后的页面背景；文字仍保持不透明，再按「叠出来的颜色」选黑/白字。
 */
export interface FaceOptions {
  /** 卡面不透明度 0–1（= 偏好里的百分比）。默认 1 = 不透明。 */
  alpha?: number
  /** 卡片背后是否偏暗（暗色主题 / 深色页面背景）：低透明度时文字用白色。 */
  dark?: boolean
}

/** 把偏好百分比（20–100）夹成 0.2–1 的透明度。 */
export function faceAlpha(percent?: number | null): number {
  if (percent === undefined || percent === null || !Number.isFinite(Number(percent))) return 1
  return Math.max(0.2, Math.min(1, Number(percent) / 100))
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)) }

/** #rrggbb 或 rgb()/rgba() → [r, g, b]。 */
function rgbTuple(color: string): [number, number, number] {
  const value = String(color || '').trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return [0, 0, 0]
}

/** 普通色 → rgba（不透明时保持 rgb，避免无谓改动既有卡面样式）。 */
function rgbaOf(color: string, alpha: number): string {
  const [r, g, b] = rgbTuple(color)
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`
}

/**
 * 半透明卡面的文字色：按「渐变中间色叠在背后底色上」的结果选黑/白。
 * 100% 时原样返回各档自己的字色，不动现有观感。
 */
function faceInk(alpha: number, dark: boolean, solidInk: string, from: string, to: string): string {
  if (alpha >= 1) return solidInk
  const [fr, fg, fb] = rgbTuple(from)
  const [tr, tg, tb] = rgbTuple(to)
  const [br, bg, bb] = dark ? [15, 23, 42] : [255, 255, 255]
  const blend = (f: number, t: number, b: number) => Math.round(((f + t) / 2) * alpha + b * (1 - alpha))
  const hex = '#' + [blend(fr, tr, br), blend(fg, tg, bg), blend(fb, tb, bb)]
    .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')
  return inkFor(hex)
}

/**
 * 一张卡面的背景 + 文字色（大卡面/缩略卡面共用）。
 * `solidInk` 是不透明时的文字色（各档自己决定，见 urgencyOf）。
 */
export function faceStyle(
  from: string,
  to: string,
  opts: FaceOptions = {},
  solidInk = '#ffffff',
): { gradient: string; ink: string } {
  const alpha = opts.alpha === undefined ? 1 : Math.max(0.2, Math.min(1, opts.alpha))
  const gradient = alpha >= 1
    ? `linear-gradient(135deg, ${from} 0%, ${to} 100%)`
    : `linear-gradient(135deg, ${rgbaOf(from, alpha)} 0%, ${rgbaOf(to, alpha)} 100%)`
  return { gradient, ink: faceInk(alpha, !!opts.dark, solidInk, from, to) }
}

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

/**
 * 算出这张卡当前处于哪个阶段，以及对应的卡面配色。
 * `opts` 让卡面跟随「卡片透明度」：半透明时字色按透出来的底色自动转深/转白。
 */
export function urgencyOf(card: CreditCard, opts: FaceOptions = {}): Urgency {
  /** 一档卡面：背景 + 字色 + 进度条（低透明度时进度条改深色，否则在白底上看不见）。 */
  const face = (from: string, to: string, solidInk = '#ffffff', lightBar = 'rgba(255,255,255,.85)') => {
    const style = faceStyle(from, to, opts, solidInk)
    return {
      gradient: style.gradient,
      ink: style.ink,
      barColor: style.ink === '#ffffff' ? lightBar : 'rgba(15,23,42,.32)',
    }
  }
  const base: Urgency = {
    level: 'normal', ...face(DEFAULT_FROM, DEFAULT_TO),
    barWidth: '0%', status: '账单日未到',
  }
  const cur = card.current
  if (!cur?.due_date) return base

  const days = daysFromToday(cur.due_date)
  if (cur.paid_at) {
    return { ...base, level: 'paid', status: `本期已还 · 下次还款 ${cur.due_date.slice(0, 10)}` }
  }
  if (days < 0) {
    return {
      level: 'overdue', ...face(URGENT_FROM, URGENT_TO, '#ffffff', '#fecaca'),
      barWidth: '100%',
      status: `已逾期 ${-days} 天 · 应还 ¥${formatCents(cur.amount_cents)}`,
    }
  }
  if (days <= 3) {
    return {
      level: 'urgent', ...face(URGENT_FROM, URGENT_TO, '#ffffff', '#fecaca'),
      barWidth: '100%',
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
  const to = lerpHex(SOON_TO, '#c2410c', progress)
  return {
    level: 'soon', ...face(from, to, inkFor(from), 'rgba(255,255,255,.9)'),
    barWidth: `${Math.round(progress * 100)}%`,
    status: `账单已出 · 还有 ${days} 天到还款日 · 应还 ¥${formatCents(cur.amount_cents)}`,
  }
}
