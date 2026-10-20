/**
 * 清单颜色的唯一来源。
 *
 * 侧栏圆点、清单筛选芯片、列表页任务标题、日历格子与详情面板都从这里取色。
 * 这张表原先在 MainLayout / ListFilter / HomeView / CalendarView 里各抄了一份，
 * 改动一处就会出现「侧栏是蓝的、日历还是绿的」这种对不上的现象（也正是
 * 「改了清单颜色，日历要跟着变」这条需求最容易翻车的地方）。
 *
 * 后端 reminder.supportedListColors 是同一份白名单（写入时校验），加颜色名时
 * 两边一起改，并且 data/release-notes.ts 里提一句。
 */
export const LIST_COLOR_NAMES = ['blue', 'violet', 'rose', 'amber', 'emerald'] as const

export type ListColorName = (typeof LIST_COLOR_NAMES)[number]

/** 颜色名 → 主色。这五个色值在浅色与深色主题下都够亮，直接当文字色也读得清。 */
const HEX: Record<string, string> = {
  blue: '#3182f6',
  violet: '#8b5cf6',
  rose: '#f43f5e',
  amber: '#f59e0b',
  emerald: '#10b981',
}

/** 中文名，用于颜色选择器的无障碍标签。 */
export const LIST_COLOR_LABELS: Record<string, string> = {
  blue: '蓝色',
  violet: '紫色',
  rose: '玫红',
  amber: '琥珀',
  emerald: '绿色',
}

/** 未知颜色名一律回落到蓝色：库里若有历史脏值，界面不该整块失色。 */
export function listColorHex(name?: string | null): string {
  return HEX[name || ''] || HEX.blue
}

/** 清单色的浅底（日历格子里的色块背景）。 */
export function listTint(name?: string | null): string {
  return `${listColorHex(name)}1f`
}

/** 清单色的文字/圆点色。 */
export function listInk(name?: string | null): string {
  return listColorHex(name)
}

export function listColorLabel(name: string): string {
  return LIST_COLOR_LABELS[name] || name
}
