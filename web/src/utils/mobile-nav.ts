/**
 * 手机底部标签栏的「栏目」定义（用户 2026-11-19 要求）：
 *
 *   「偏好设置：手机栏目：增加首页初始页面选择以及底部导航顺序自定义，
 *     底部导航顺序支持拖拽调整并持久化保存。栏目配置支持恢复默认值，
 *     并提供预览确认后生效」
 *
 * 一份定义给三处共用：
 *   · MainLayout —— 画手机底部标签栏（顺序、图标、文字都从这里取）；
 *   · router/index.ts —— 冷启动首屏要**同步**知道「打开先显示」是哪一页，
 *     所以偏好值另在 localStorage 缓存一份（见 readCachedMobileHomeView）；
 *   · MobileNavPrefs 偏好面板 —— 拖拽排序、恢复默认、预览里都按这份定义画。
 *
 * 服务端配置项见 server/sysconfig/registry.go 的 mobile_tabs_order / mobile_home_view。
 * 顺序值用逗号分隔的固定 token，不认识的 token 丢掉、缺的补在末尾 ——
 * 这样以后加/删栏目时，老用户存下的顺序不会把新栏目弄丢。
 */

import { SK } from './storage-keys'

export type MobileTabKey = 'home' | 'planned' | 'lists' | 'today' | 'nudges'
export type MobileHomeView = 'home' | 'today' | 'planned' | 'nudges'

export const MOBILE_TAB_KEYS: MobileTabKey[] = ['home', 'planned', 'lists', 'today', 'nudges']
export const MOBILE_TAB_ORDER_DEFAULT: MobileTabKey[] = ['home', 'planned', 'lists', 'today', 'nudges']
export const MOBILE_HOME_VIEW_DEFAULT: MobileHomeView = 'home'

export interface MobileTabMeta {
  key: MobileTabKey
  label: string
  /** 清单是弹层入口，没有自己的路由 */
  to?: string
  /** 与侧栏「智能清单」同一套线性图标（home 的屋顶/墙体是 2026-11-09 那版） */
  icon: string
  hint?: string
}

export const MOBILE_TAB_META: Record<MobileTabKey, MobileTabMeta> = {
  home: {
    key: 'home',
    label: '首页',
    to: '/admin/home',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3.8 10.6 12 3.9l8.2 6.7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.7 9.4V19a1.7 1.7 0 0 0 1.7 1.7h9.2a1.7 1.7 0 0 0 1.7-1.7V9.4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.9 20.7v-4.6a2.1 2.1 0 0 1 4.2 0v4.6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  planned: {
    key: 'planned',
    label: '计划',
    to: '/admin/planned',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="1.8"/><path d="M12 7v5l3.2 2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  lists: {
    key: 'lists',
    label: '清单',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8.5 6h11m-11 6h11m-11 6h11M4 6h.01M4 12h.01M4 18h.01" stroke-width="1.9" stroke-linecap="round"/></svg>',
    hint: '弹层入口：点它弹出全部清单',
  },
  today: {
    key: 'today',
    label: '待办',
    to: '/admin',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="5" width="16" height="15" rx="3" stroke-width="1.8"/><path d="M8 3v4m8-4v4M4 10h16" stroke-width="1.8" stroke-linecap="round"/><path d="M9 15h6" stroke-width="2" stroke-linecap="round"/></svg>',
  },
  nudges: {
    key: 'nudges',
    label: '提醒',
    to: '/admin/nudges',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15.5 8.5a3.5 3.5 0 1 0-7 0c0 4-2 4-2 5.5h11c0-1.5-2-1.5-2-5.5Z" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 17a1.6 1.6 0 0 0 3 0" stroke-width="1.7" stroke-linecap="round"/><circle cx="18.5" cy="6.5" r="3.2" fill="currentColor" stroke="none"/></svg>',
    hint: '提醒@他：别人推给你的提醒',
  },
}

/** 「打开应用先显示」可选项。清单是弹层，不能当首屏，所以不在这一组里。 */
export const MOBILE_HOME_VIEW_OPTIONS: { value: MobileHomeView; label: string; hint: string }[] = [
  { value: 'home', label: '首页', hint: '14 天待办 + 已逾期两列看板（默认）' },
  { value: 'today', label: '待办', hint: '今天的待办列表（原「近 7 天」页）' },
  { value: 'planned', label: '计划', hint: '按天排的计划列表' },
  { value: 'nudges', label: '提醒@他', hint: '别人推给你的提醒（需先开启这个栏目）' },
]

const KNOWN_TABS = new Set<string>(MOBILE_TAB_KEYS)
const HOME_VIEWS = new Set<string>(MOBILE_HOME_VIEW_OPTIONS.map((o) => o.value))

/**
 * 归一化底部导航顺序：只认已知 token、去重，缺的按默认顺序补在末尾。
 * 传空值/坏值（例如老库里没有这一行）一律回到默认顺序。
 */
export function parseMobileTabOrder(raw: unknown): MobileTabKey[] {
  const tokens = String(raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => KNOWN_TABS.has(t)) as MobileTabKey[]
  const out: MobileTabKey[] = []
  for (const token of tokens) if (!out.includes(token)) out.push(token)
  for (const key of MOBILE_TAB_ORDER_DEFAULT) if (!out.includes(key)) out.push(key)
  return out
}

export function serializeMobileTabOrder(order: MobileTabKey[]): string {
  return parseMobileTabOrder(order.join(',')).join(',')
}

export function parseMobileHomeView(raw: unknown): MobileHomeView {
  const value = String(raw ?? '').trim()
  return (HOME_VIEWS.has(value) ? value : MOBILE_HOME_VIEW_DEFAULT) as MobileHomeView
}

/** 首屏落点：配置值 → 路由名。清单不算页面，所以只有这四种。 */
export function mobileHomeRouteName(view: MobileHomeView): 'Dashboard' | 'Home' | 'Planned' | 'Nudges' {
  switch (view) {
    case 'today': return 'Home'
    case 'planned': return 'Planned'
    case 'nudges': return 'Nudges'
    default: return 'Dashboard'
  }
}

/** 首屏落点：配置值 → 路径（登录后直接 push 用，省一次路由解析）。 */
export function mobileHomePath(view: MobileHomeView): string {
  switch (view) {
    case 'today': return '/admin'
    case 'planned': return '/admin/planned'
    case 'nudges': return '/admin/nudges'
    default: return '/admin/home'
  }
}

/** 提醒@他关掉时，「打开先显示=提醒@他」退回首页看板。 */
export function resolveMobileHomeView(view: MobileHomeView, nudgeEnabled: boolean): MobileHomeView {
  return view === 'nudges' && !nudgeEnabled ? 'home' : view
}

/** 面包屑/预览里的一句话说明，例如「首页 → 计划 → 清单 → 待办 → 提醒」。 */
export function mobileTabOrderLabel(order: MobileTabKey[]): string {
  return order.map((key) => MOBILE_TAB_META[key]?.label || key).join(' → ')
}

// ---------------- 本机缓存 ----------------
// 为什么要有缓存：首屏落点要在**路由守卫里同步**决定，而偏好是异步接口拿的；
// 靠接口会先渲染一页再跳（正是 2026-11-17 修过的「闪一下待办」）。
// 缓存只在每次读到/写到配置时更新，属于纯加速，不参与同步。
const CACHE_ORDER = SK.mobileTabOrder
const CACHE_HOME_VIEW = SK.mobileHomeView

export function readCachedMobileTabOrder(): MobileTabKey[] {
  try {
    return parseMobileTabOrder(localStorage.getItem(CACHE_ORDER) || '')
  } catch {
    return [...MOBILE_TAB_ORDER_DEFAULT]
  }
}

export function writeCachedMobileTabOrder(order: MobileTabKey[]) {
  try {
    localStorage.setItem(CACHE_ORDER, serializeMobileTabOrder(order))
  } catch { /* 隐私模式写不进去时忽略，界面已经按内存里的顺序画好了 */ }
}

export function readCachedMobileHomeView(): MobileHomeView {
  try {
    return parseMobileHomeView(localStorage.getItem(CACHE_HOME_VIEW) || '')
  } catch {
    return MOBILE_HOME_VIEW_DEFAULT
  }
}

export function writeCachedMobileHomeView(view: MobileHomeView) {
  try {
    localStorage.setItem(CACHE_HOME_VIEW, parseMobileHomeView(view))
  } catch { /* 同上 */ }
}
