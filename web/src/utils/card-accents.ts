// 仪式感卡片的**过渡色色板**（用户 2026-10-11 要求：卡片适配多种过渡色、可自行选择）。
//
// 与后端 `server/reminder/card_accents.go` 的白名单一一对应：这里多一个，写入会被后端拒掉；
// 后端多一个，这里取不到色就回落成默认。改色名时两边一起改。
//
// 每一项是「渐变两端 + 字色」：深色底用白字，浅色底（amber）用深字，保证倒计时看得清。

export interface CardAccent {
  key: string
  label: string
  from: string
  to: string
  /** 文字色（按底色深浅选，浅底用深字） */
  ink: string
  /** 倒计时数字的流光三色（渐变两端 + 中间一道柔光，见 heroStyle） */
  sheen: [string, string, string]
}

export const CARD_ACCENTS: CardAccent[] = [
  { key: '', label: '默认（浅色随机）', from: '#e2e8f0', to: '#cbd5e1', ink: '#0f172a', sheen: ['#0f172a', '#5b6b85', '#94a3b8'] },
  // 深色系：两端都够深，白字对比度 ≥4.7（原来的中浅渐变配白字只有 2.6～3.0，看不清 ——
  // 用户 2026-10-11：「浅色背景影响字体显示，字体是白色的，自动调整字体颜色」）。
  { key: 'slate', label: '石墨', from: '#475569', to: '#1e293b', ink: '#ffffff', sheen: ['#ffffff', '#e2e8f0', '#cbd5e1'] },
  // 金属四档（用户 2026-10-19）：白银浅底深字，黄金/青铜/黑铁按各自亮度取字色。
  { key: 'silver', label: '白银', from: '#e2e8f0', to: '#94a3b8', ink: '#0f172a', sheen: ['#0f172a', '#475569', '#94a3b8'] },
  { key: 'golden', label: '黄金', from: '#facc15', to: '#a16207', ink: '#0f172a', sheen: ['#0f172a', '#854d0e', '#ca8a04'] },
  { key: 'bronze', label: '青铜', from: '#c2703a', to: '#7c2d12', ink: '#ffffff', sheen: ['#ffffff', '#fdba74', '#c2410c'] },
  { key: 'iron', label: '黑铁', from: '#3f3f46', to: '#18181b', ink: '#ffffff', sheen: ['#ffffff', '#d4d4d8', '#a1a1aa'] },
  { key: 'rose', label: '玫红', from: '#e11d48', to: '#9f1239', ink: '#ffffff', sheen: ['#ffffff', '#ffe4e6', '#fda4af'] },
  // 浅色系（琥珀 / 鎏金）：底色浅，自动配深字（对比度 8.3 / 5.5）
  { key: 'amber', label: '琥珀', from: '#fcd34d', to: '#f59e0b', ink: '#0f172a', sheen: ['#0f172a', '#78350f', '#b45309'] },
  { key: 'gold', label: '鎏金', from: '#f9e79f', to: '#b8860b', ink: '#0f172a', sheen: ['#0f172a', '#713f12', '#a16207'] },
  { key: 'orange', label: '暖橘', from: '#c2410c', to: '#7c2d12', ink: '#ffffff', sheen: ['#ffffff', '#ffedd5', '#fdba74'] },
  { key: 'emerald', label: '翡翠', from: '#047857', to: '#064e3b', ink: '#ffffff', sheen: ['#ffffff', '#d1fae5', '#a7f3d0'] },
  { key: 'teal', label: '青碧', from: '#0f766e', to: '#134e4a', ink: '#ffffff', sheen: ['#ffffff', '#ccfbf1', '#99f6e4'] },
  { key: 'sky', label: '天蓝', from: '#0369a1', to: '#0c4a6e', ink: '#ffffff', sheen: ['#ffffff', '#e0f2fe', '#bae6fd'] },
  { key: 'indigo', label: '靛蓝', from: '#4f46e5', to: '#3730a3', ink: '#ffffff', sheen: ['#ffffff', '#e0e7ff', '#c7d2fe'] },
  { key: 'violet', label: '紫罗兰', from: '#7c3aed', to: '#5b21b6', ink: '#ffffff', sheen: ['#ffffff', '#ede9fe', '#ddd6fe'] },
  { key: 'fuchsia', label: '品红', from: '#c026d3', to: '#86198f', ink: '#ffffff', sheen: ['#ffffff', '#fae8ff', '#f5d0fe'] },
]

/**
 * 「默认」档用的**浅色底**（用户 2026-10-11：纯白不好看，浅色随机匹配颜色）。
 *
 * 没挑颜色的卡片会按 `id` 稳定地落到其中一档 —— 用 id 哈希而不是每次渲染随机，
 * 这样**看着是随机搭配、但刷新不会换色**（真随机会让整页颜色乱跳）。
 * 想要每次刷新都换，把 defaultAccentFor 改成 Math.random() 即可。
 */
export interface LightAccent extends CardAccent {
  /** 这一档对应的**浓色**（倒计时块用它，和浅色卡面拉开层次） */
  heroKey: string
}

export const LIGHT_ACCENTS: LightAccent[] = [
  { key: 'light-sky', label: '浅天蓝', from: '#e0f2fe', to: '#bae6fd', ink: '#075985', heroKey: 'sky', sheen: ['#ffffff', '#e0f2fe', '#bae6fd'] },
  { key: 'light-violet', label: '浅紫', from: '#ede9fe', to: '#ddd6fe', ink: '#5b21b6', heroKey: 'violet', sheen: ['#ffffff', '#ede9fe', '#ddd6fe'] },
  { key: 'light-rose', label: '浅玫', from: '#ffe4e6', to: '#fecdd3', ink: '#9f1239', heroKey: 'rose', sheen: ['#ffffff', '#ffe4e6', '#fda4af'] },
  { key: 'light-amber', label: '浅金', from: '#fef3c7', to: '#fde68a', ink: '#92400e', heroKey: 'gold', sheen: ['#0f172a', '#713f12', '#a16207'] },
  { key: 'light-emerald', label: '浅绿', from: '#d1fae5', to: '#a7f3d0', ink: '#065f46', heroKey: 'emerald', sheen: ['#ffffff', '#d1fae5', '#a7f3d0'] },
  { key: 'light-teal', label: '浅青', from: '#ccfbf1', to: '#99f6e4', ink: '#115e59', heroKey: 'teal', sheen: ['#ffffff', '#ccfbf1', '#99f6e4'] },
]

/** 没挑颜色时按 id 稳定落一档浅色（同一张卡每次都是同一个色）。 */
export function defaultAccentFor(id?: number | string): LightAccent {
  const key = String(id ?? '')
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 100000
  return LIGHT_ACCENTS[hash % LIGHT_ACCENTS.length]
}

/**
 * 卡面文字色：
 *   · 默认档的浅色卡面是**不透明**的浅底 —— 必须强制深字，否则深色主题下白字糊在浅底上
 *     （用户 2026-10-11 报的就是这个）；
 *   · 选了颜色的卡面只是薄薄一层同色系浅淡底（透出主题卡面），跟着主题走最自然 → 返回 null（不改）。
 */
export function cardInk(accentKey?: string | null, id?: number | string): string | null {
  if (accentKey) {
    // 显式选了「浅色」档：卡面是浅底，必须强制深字，否则深色主题下白字糊在浅底上。
    const light = LIGHT_ACCENTS.find((a) => a.key === accentKey)
    return light ? bestInk(light.from, light.to) : null
  }
  const a = defaultAccentFor(id)
  return bestInk(a.from, a.to)
}

/** 倒计时块：选了颜色用该色浓郁渐变；没选就用那一档配套的**浓色**（与浅色卡面拉开层次）。 */
export function heroGradient(accentKey?: string | null, id?: number | string): string {
  if (!accentKey) return accentGradient(defaultAccentFor(id).heroKey)
  const light = LIGHT_ACCENTS.find((a) => a.key === accentKey)
  return accentGradient(light ? light.heroKey : accentKey)
}

/** 倒计时块的文字色：与 heroGradient 用的那档配套（琥珀/鎏金这类浅底用深字）。 */
export function heroInk(accentKey?: string | null, id?: number | string): string {
  if (!accentKey) return accentInk(defaultAccentFor(id).heroKey)
  const light = LIGHT_ACCENTS.find((a) => a.key === accentKey)
  if (light) return light.ink
  return accentInk(accentKey)
}

// ---- 字色自动匹配（用户 2026-10-11：「自动调整字体颜色，让字体显示清晰」）----
// 按 WCAG 相对亮度算对比度，在白字 / 深字之间挑「渐变两端里更差的那一端」更好的一个。
// 这样以后改色板颜色也不用逐个手调字色。
const DARK_INK = '#0f172a'
const LIGHT_INK = '#ffffff'

function channel(v: number) {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 对比度（1～21）。 */
export function contrastRatio(a: string, b: string) {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** 一组渐变两端里，哪个字色更清楚：取「两端对比度里较小的那个」更大的字色。 */
export function bestInk(from: string, to: string): string {
  const dark = Math.min(contrastRatio(DARK_INK, from), contrastRatio(DARK_INK, to))
  const light = Math.min(contrastRatio(LIGHT_INK, from), contrastRatio(LIGHT_INK, to))
  return dark >= light ? DARK_INK : LIGHT_INK
}

/** 浅色系的字色（浅底一律深字）；深色档传进来的可能是自定义 hex（如浅色档的 #075985）。 */
export function softInk(ink: string) {
  const dark = ink === DARK_INK || (ink.startsWith('#') && contrastRatio(ink, '#ffffff') > 4.5)
  return dark ? 'rgba(15, 23, 42, .72)' : 'rgba(255, 255, 255, .85)'
}

const BY_KEY = new Map([...CARD_ACCENTS, ...LIGHT_ACCENTS].map((a) => [a.key, a]))

/** 取某个色名对应的色板项；空值或未知色名都回落到「默认」。 */
export function cardAccent(key?: string | null): CardAccent {
  return BY_KEY.get(String(key || '')) || CARD_ACCENTS[0]
}

/** 两个十六进制色按比例混出一个中间色（卡面渐变的中段用）。 */
function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [r1, g1, b1] = parse(a)
  const [r2, g2, b2] = parse(b)
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${ch(r1, r2)}${ch(g1, g2)}${ch(b1, b2)}`
}

/**
 * 卡面背景：不再是一块两色斜拼，而是**三层渐变叠出来的「模板」**——
 *   1) 右上角一层柔光（卡面被光打亮的感觉）；
 *   2) 左下角一层暗角（把内容托住，白字更立得住）；
 *   3) 底色本身用「亮 → 混色 → 暗」三段，过渡更柔。
 * 三层叠完后，再用 ::before 盖一层**径向渐变蒙版**的细斜纹（见 CeremonyPanel 样式），
 * 卡面就有了纸面/绸面的质感，而不是一块纯色。
 * 亮色卡面（琥珀/鎏金）把柔光换成更深的一层，避免整张卡发白。
 */
export function accentSurface(accentKey?: string | null, id?: number | string): string {
  const key = accentKey || defaultAccentFor(id).heroKey
  const a = cardAccent(key)
  const ink = bestInk(a.from, a.to)
  const dark = ink === LIGHT_INK
  const mid = mixHex(a.from, a.to, 0.55)
  return [
    `radial-gradient(135% 100% at 82% -14%, rgba(255,255,255,${dark ? '0.30' : '0.55'}) 0%, rgba(255,255,255,0) 62%)`,
    `radial-gradient(120% 90% at 4% 112%, rgba(2,6,23,${dark ? '0.42' : '0.20'}) 0%, rgba(2,6,23,0) 60%)`,
    `linear-gradient(152deg, ${a.from} 0%, ${mid} 56%, ${a.to} 100%)`,
  ].join(', ')
}

/** 倒计时数字的流光三色：贴着卡面同色系的柔光，不再是紫+青两块撞色。 */
export function accentSheen(accentKey?: string | null, id?: number | string): [string, string, string] {
  const key = accentKey || defaultAccentFor(id).heroKey
  // 浅色档的倒计时块是浓色，数字流光也跟着换成那一档的深色三色，否则淡色数字压在浅底上看不清。
  const light = LIGHT_ACCENTS.find((a) => a.key === key)
  if (light) {
    const hero = cardAccent(light.heroKey)
    return [light.ink, hero.from, hero.to]
  }
  return cardAccent(key).sheen
}

/** 卡面（倒计时块）的 CSS 渐变。 */
export function accentGradient(key?: string | null): string {
  const a = cardAccent(key)
  return `linear-gradient(135deg, ${a.from} 0%, ${a.to} 100%)`
}

/** 与渐变配套的文字色（按渐变两端自动挑，见 bestInk）。 */
export function accentInk(key?: string | null): string {
  const a = cardAccent(key)
  return bestInk(a.from, a.to)
}
