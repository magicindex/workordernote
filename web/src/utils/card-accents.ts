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
}

export const CARD_ACCENTS: CardAccent[] = [
  { key: '', label: '默认（浅色随机）', from: '#e2e8f0', to: '#cbd5e1', ink: '#0f172a' },
  { key: 'slate', label: '石墨', from: '#64748b', to: '#1e293b', ink: '#ffffff' },
  { key: 'rose', label: '玫红', from: '#fb7185', to: '#be123c', ink: '#ffffff' },
  { key: 'amber', label: '琥珀', from: '#fcd34d', to: '#f59e0b', ink: '#3f2404' },
  // 鎏金（用户 2026-10-11 要求）：比琥珀更「金」、带一点暗纹感，浅底所以用深字
  { key: 'gold', label: '鎏金', from: '#f9e79f', to: '#b8860b', ink: '#3f2c05' },
  { key: 'orange', label: '暖橘', from: '#fb923c', to: '#ea580c', ink: '#ffffff' },
  { key: 'emerald', label: '翡翠', from: '#34d399', to: '#047857', ink: '#ffffff' },
  { key: 'teal', label: '青碧', from: '#2dd4bf', to: '#0f766e', ink: '#ffffff' },
  { key: 'sky', label: '天蓝', from: '#38bdf8', to: '#0369a1', ink: '#ffffff' },
  { key: 'indigo', label: '靛蓝', from: '#818cf8', to: '#4338ca', ink: '#ffffff' },
  { key: 'violet', label: '紫罗兰', from: '#c084fc', to: '#7e22ce', ink: '#ffffff' },
  { key: 'fuchsia', label: '品红', from: '#e879f9', to: '#a21caf', ink: '#ffffff' },
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
  { key: 'light-sky', label: '浅天蓝', from: '#e0f2fe', to: '#bae6fd', ink: '#075985', heroKey: 'sky' },
  { key: 'light-violet', label: '浅紫', from: '#ede9fe', to: '#ddd6fe', ink: '#5b21b6', heroKey: 'violet' },
  { key: 'light-rose', label: '浅玫', from: '#ffe4e6', to: '#fecdd3', ink: '#9f1239', heroKey: 'rose' },
  { key: 'light-amber', label: '浅金', from: '#fef3c7', to: '#fde68a', ink: '#92400e', heroKey: 'gold' },
  { key: 'light-emerald', label: '浅绿', from: '#d1fae5', to: '#a7f3d0', ink: '#065f46', heroKey: 'emerald' },
  { key: 'light-teal', label: '浅青', from: '#ccfbf1', to: '#99f6e4', ink: '#115e59', heroKey: 'teal' },
]

/** 没挑颜色时按 id 稳定落一档浅色（同一张卡每次都是同一个色）。 */
export function defaultAccentFor(id?: number | string): LightAccent {
  const key = String(id ?? '')
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 100000
  return LIGHT_ACCENTS[hash % LIGHT_ACCENTS.length]
}

/** 卡片**整卡底色**：选了颜色就用该色的浅淡版（同色系），没选就用上面那档浅色。
    透明度压得很低（12% → 6%），浅色/深色主题下都只是「有点颜色」，不抢内容。 */
export function cardTint(accentKey?: string | null, id?: number | string): string {
  if (!accentKey) {
    const a = defaultAccentFor(id)
    return `linear-gradient(135deg, ${a.from} 0%, ${a.to} 100%)`
  }
  const a = cardAccent(accentKey)
  return `linear-gradient(135deg, ${a.from}29 0%, ${a.to}14 100%)`
}

/** 倒计时块：选了颜色用该色浓郁渐变；没选就用那一档配套的**浓色**（与浅色卡面拉开层次）。 */
export function heroGradient(accentKey?: string | null, id?: number | string): string {
  if (!accentKey) return accentGradient(defaultAccentFor(id).heroKey)
  return accentGradient(accentKey)
}

/** 倒计时块的文字色：与 heroGradient 用的那档配套（琥珀/鎏金这类浅底用深字）。 */
export function heroInk(accentKey?: string | null, id?: number | string): string {
  if (!accentKey) return accentInk(defaultAccentFor(id).heroKey)
  return accentInk(accentKey)
}

const BY_KEY = new Map(CARD_ACCENTS.map((a) => [a.key, a]))

/** 取某个色名对应的色板项；空值或未知色名都回落到「默认」。 */
export function cardAccent(key?: string | null): CardAccent {
  return BY_KEY.get(String(key || '')) || CARD_ACCENTS[0]
}

/** 卡面（倒计时块）的 CSS 渐变。 */
export function accentGradient(key?: string | null): string {
  const a = cardAccent(key)
  return `linear-gradient(135deg, ${a.from} 0%, ${a.to} 100%)`
}

/** 与渐变配套的文字色。 */
export function accentInk(key?: string | null): string {
  return cardAccent(key).ink
}
