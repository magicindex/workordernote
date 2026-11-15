import {
  defineStore
} from 'pinia'
import {
  ref,
  computed
} from 'vue'
import { DEFAULT_SUN_CITY, SUN_CITIES, isNightAt } from '../utils/sun'

// 'sun' = 日出日落：按所选城市的日出/日落时刻自动切浅色/深色。
export type ThemeMode = 'light' | 'dark' | 'system' | 'sun'
export type ThemeBrand = 'default'  // extend this union when adding brand-* palettes
export type PageBgDirection = 'vertical' | 'horizontal'
export interface PageBgGradient {
  start: string
  end: string
  direction: PageBgDirection
  /** 两个色阶在渐变里的位置（0–100%），1 表示起始色，2 表示结束色。 */
  startStop: number
  endStop: number
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** 解析偏好里的两色渐变；任何字段不合法都回退到主题默认，不让坏值进 CSS。 */
export function parsePageBgGradient(raw: string): PageBgGradient | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    const start = String(data?.start || '')
    const end = String(data?.end || '')
    if (!HEX_COLOR.test(start) || !HEX_COLOR.test(end)) return null
    const startStop = Number(data?.startStop)
    const endStop = Number(data?.endStop)
    const validStops = Number.isFinite(startStop) && Number.isFinite(endStop)
      && startStop >= 0 && startStop <= 100 && endStop >= 0 && endStop <= 100
      && startStop < endStop
    return {
      start: start.toLowerCase(),
      end: end.toLowerCase(),
      direction: data?.direction === 'horizontal' ? 'horizontal' : 'vertical',
      startStop: validStops ? Math.round(startStop) : 0,
      endStop: validStops ? Math.round(endStop) : 100,
    }
  } catch {
    return null
  }
}

const STORAGE_MODE = 'reminder-theme-mode'
const STORAGE_BRAND = 'reminder-theme-brand'
const STORAGE_SUN_CITY = 'reminder-theme-sun-city'
const STORAGE_PAGE_BG_TONE = 'reminder-page-bg-tone'
const STORAGE_PAGE_BG_GRADIENT = 'reminder-page-bg-gradient'

function readStoredMode(): ThemeMode {
  const v = localStorage.getItem(STORAGE_MODE)
  return v === 'light' || v === 'dark' || v === 'system' || v === 'sun' ? v : 'system'
}

function readStoredBrand(): ThemeBrand {
  const v = localStorage.getItem(STORAGE_BRAND)
  return (v as ThemeBrand) || 'default'
}

// 位置以服务端用户配置为准（跨设备一致），本地缓存一份用于首屏 —— 配置要等
// /api/configs/user/meta 回来才知道，先按上次的值渲染，避免闪一下再变。
function readStoredSunCity(): string {
  const v = localStorage.getItem(STORAGE_SUN_CITY)
  return v && SUN_CITIES[v] ? v : DEFAULT_SUN_CITY
}

function clampPageBgTone(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-100, Math.min(100, Math.round(value)))
}

// 页面背景亮度：-100 最暗，0 默认，+100 最亮。只写 body 背景叠加层的 CSS 变量，
// 不碰 --color-surface / --color-foreground，所以卡片和文字不受影响。
function applyPageBgTone(value: number) {
  if (typeof document === 'undefined') return
  const tone = clampPageBgTone(value)
  const root = document.documentElement
  const alpha = Math.min(0.72, Math.abs(tone) / 100 * 0.72)
  root.style.setProperty('--page-bg-tint', tone < 0 ? '0 0 0' : '255 255 255')
  root.style.setProperty('--page-bg-alpha', alpha.toFixed(3))
}

function readStoredPageBgTone(): number {
  const v = localStorage.getItem(STORAGE_PAGE_BG_TONE)
  return v === null ? 0 : clampPageBgTone(Number(v))
}

function hexToRgbTriplet(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

// 页面背景两色渐变：只写 body 使用的 CSS 变量，卡片/文字颜色完全不动。
function applyPageBgGradient(value: PageBgGradient | null) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!value) {
    root.style.removeProperty('--page-bg-start')
    root.style.removeProperty('--page-bg-end')
    root.style.removeProperty('--page-bg-start-stop')
    root.style.removeProperty('--page-bg-end-stop')
    root.style.removeProperty('--page-bg-angle')
    return
  }
  root.style.setProperty('--page-bg-start', hexToRgbTriplet(value.start))
  root.style.setProperty('--page-bg-end', hexToRgbTriplet(value.end))
  root.style.setProperty('--page-bg-start-stop', `${value.startStop}%`)
  root.style.setProperty('--page-bg-end-stop', `${value.endStop}%`)
  root.style.setProperty('--page-bg-angle', value.direction === 'horizontal' ? '90deg' : '180deg')
}

function readStoredPageBgGradient(): PageBgGradient | null {
  return parsePageBgGradient(localStorage.getItem(STORAGE_PAGE_BG_GRADIENT) || '')
}

const systemDark = ref(
  typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches,
)

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', e => { systemDark.value = e.matches })
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStoredMode())
  const brand = ref<ThemeBrand>(readStoredBrand())
  const pageBgTone = ref(readStoredPageBgTone())
  const pageBgGradient = ref<PageBgGradient | null>(readStoredPageBgGradient())
  const sunCity = ref<string>(readStoredSunCity())
  // 当前时刻按日出日落算出来是不是夜间。只在 mode === 'sun' 时参与判断。
  const sunDark = ref<boolean>(isNightAt(new Date(), sunCity.value))

  function refreshSun() {
    sunDark.value = isNightAt(new Date(), sunCity.value)
  }

  // 每分钟对一次表就够了：日落那一下最多晚 60 秒变深色；顺便在页面重新可见时
  // 立刻校正（笔记本合盖过夜、系统休眠后定时器会被节流甚至暂停）。
  if (typeof window !== 'undefined') {
    window.setInterval(refreshSun, 60_000)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshSun()
    })
  }

  // isDark tracks mode AND the OS preference (via systemDark ref) so
  // consumers bound to it update when the OS theme flips in 'system'.
  // 'sun' 同理：sunDark 变了这里也跟着变。
  const isDark = computed(() =>
    mode.value === 'dark'
    || (mode.value === 'system' && systemDark.value)
    || (mode.value === 'sun' && sunDark.value),
  )

  function resolveDark(): boolean {
    if (mode.value === 'dark') return true
    if (mode.value === 'light') return false
    if (mode.value === 'sun') return isNightAt(new Date(), sunCity.value)
    return systemDark.value
  }

  function apply() {
    const root = document.documentElement
    root.classList.toggle('dark', resolveDark())

    for (const cls of Array.from(root.classList)) {
      if (cls.startsWith('brand-') && cls !== `brand-${brand.value}`) {
        root.classList.remove(cls)
      }
    }
    if (brand.value !== 'default') {
      root.classList.add(`brand-${brand.value}`)
    }
    applyPageBgTone(pageBgTone.value)
    applyPageBgGradient(pageBgGradient.value)
  }

  function setMode(m: ThemeMode) {
    mode.value = m
    localStorage.setItem(STORAGE_MODE, m)
    if (m === 'sun') refreshSun()
    apply()
  }

  function setBrand(b: ThemeBrand) {
    brand.value = b
    localStorage.setItem(STORAGE_BRAND, b)
    apply()
  }

  // 由「偏好设置 → 日出日落位置」以及登录后的用户配置同步调用。
  function setSunCity(id: string) {
    const next = SUN_CITIES[id] ? id : DEFAULT_SUN_CITY
    sunCity.value = next
    localStorage.setItem(STORAGE_SUN_CITY, next)
    refreshSun()
    apply()
  }

  // 3-state cycle documented in AGENTS.md. Components should call this so
  // the cycle stays in one place. 'sun' 不进这个循环（在偏好设置里选），
  // 点一下先回到深色，行为可预期。
  function toggle() {
    const next: ThemeMode = mode.value === 'dark'
      ? 'light'
      : mode.value === 'light'
        ? 'system'
        : 'dark'
    setMode(next)
  }

  function setPageBgTone(value: number) {
    pageBgTone.value = clampPageBgTone(value)
    localStorage.setItem(STORAGE_PAGE_BG_TONE, String(pageBgTone.value))
    applyPageBgTone(pageBgTone.value)
  }

  function setPageBgGradient(value: PageBgGradient | null) {
    pageBgGradient.value = value
    if (value) localStorage.setItem(STORAGE_PAGE_BG_GRADIENT, JSON.stringify(value))
    else localStorage.removeItem(STORAGE_PAGE_BG_GRADIENT)
    applyPageBgGradient(value)
  }

  apply()

  return { mode, brand, sunCity, sunDark, pageBgTone, pageBgGradient, isDark, toggle, setMode, setBrand, setSunCity, setPageBgTone, setPageBgGradient, refreshSun, apply }
})
