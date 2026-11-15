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
export type PageBgDirection = 'vertical' | 'horizontal' | 'diagonal'
export interface PageBgGradient {
  start: string
  end: string
  direction: PageBgDirection
  /** 两个色阶在渐变里的位置（0–100%），1 表示起始色，2 表示结束色。 */
  startStop: number
  endStop: number
  /** 空 = 普通两色渐变；starry = 星空预设（按主题用深空调色板 + 星点层）。 */
  preset: '' | 'starry'
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
      direction: data?.direction === 'horizontal' ? 'horizontal' : data?.direction === 'diagonal' ? 'diagonal' : 'vertical',
      startStop: validStops ? Math.round(startStop) : 0,
      endStop: validStops ? Math.round(endStop) : 100,
      preset: data?.preset === 'starry' ? 'starry' : '',
    }
  } catch {
    return null
  }
}

const STORAGE_MODE = 'reminder-theme-mode'
const STORAGE_BRAND = 'reminder-theme-brand'
const STORAGE_SUN_CITY = 'reminder-theme-sun-city'
const STORAGE_PAGE_BG_TONE = 'reminder-page-bg-tone'
const STORAGE_PAGE_BG_TONE_LIGHT = 'reminder-page-bg-tone-light'
const STORAGE_PAGE_BG_TONE_DARK = 'reminder-page-bg-tone-dark'
const STORAGE_PAGE_BG_GRADIENT = 'reminder-page-bg-gradient'

// 亮度基准：亮色主题默认 0；暗色主题自动压暗一点，让渐变更柔和。
const PAGE_BG_TONE_LIGHT = 0
const PAGE_BG_TONE_DARK = -20

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

function readStoredTones(): { light: number; dark: number } {
  const lightRaw = localStorage.getItem(STORAGE_PAGE_BG_TONE_LIGHT)
  const darkRaw = localStorage.getItem(STORAGE_PAGE_BG_TONE_DARK)
  const legacyRaw = localStorage.getItem(STORAGE_PAGE_BG_TONE)
  const light = lightRaw === null ? null : Number(lightRaw)
  const dark = darkRaw === null ? null : Number(darkRaw)
  // 旧版只有一个值；如果用户以前手动调过，亮/暗都先沿用，之后分开记住。
  if (light === null && dark === null && legacyRaw !== null && Number(legacyRaw) !== 0) {
    const legacy = clampPageBgTone(Number(legacyRaw))
    return { light: legacy, dark: legacy }
  }
  return {
    light: light === null ? PAGE_BG_TONE_LIGHT : clampPageBgTone(light),
    dark: dark === null ? PAGE_BG_TONE_DARK : clampPageBgTone(dark),
  }
}

function hexToRgbTriplet(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mixRgb(a: number[], b: number[], amount: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, amount))
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
  ]
}

function rgbTriplet(rgb: number[]): string {
  return `${rgb[0]} ${rgb[1]} ${rgb[2]}`
}

function relativeLuminance(rgb: number[]): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

/**
 * 深色模式下的有效渐变颜色：保留用户选色的色相，但压暗并收窄对比，
 * 免得亮色渐变在暗色页面里刺眼；同时保证至少有一点明暗差，渐变不会糊成一块。
 */
function effectiveGradientColors(value: PageBgGradient): [string, string] {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  let a = parseHex(value.start)
  let b = parseHex(value.end)
  if (!dark) return [rgbTriplet(a), rgbTriplet(b)]
  const base = [11, 15, 26]
  a = mixRgb(a, base, 0.62)
  b = mixRgb(b, base, 0.48)
  if (Math.abs(relativeLuminance(a) - relativeLuminance(b)) < 0.04) {
    if (relativeLuminance(a) <= relativeLuminance(b)) a = mixRgb(a, [0, 0, 0], 0.18)
    else b = mixRgb(b, [255, 255, 255], 0.14)
  }
  // 两边都太黑时抬一点，保证暗色下也能看见渐变。
  if (Math.max(relativeLuminance(a), relativeLuminance(b)) < 0.035) {
    a = mixRgb(a, [30, 41, 59], 0.32)
    b = mixRgb(b, [71, 85, 105], 0.42)
  }
  return [rgbTriplet(a), rgbTriplet(b)]
}

// 页面背景两色渐变：只写 body 使用的 CSS 变量，卡片/文字颜色完全不动。
function applyPageBgGradient(value: PageBgGradient | null) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!value) {
    root.classList.remove('page-starry')
    root.style.removeProperty('--page-bg-start')
    root.style.removeProperty('--page-bg-end')
    root.style.removeProperty('--page-bg-start-stop')
    root.style.removeProperty('--page-bg-end-stop')
    root.style.removeProperty('--page-bg-angle')
    return
  }
  // 星空预设：亮/暗主题各自一套深空底色，不跟随用户选色，保证星点对比。
  if (value.preset === 'starry') {
    const dark = root.classList.contains('dark')
    const startStop = dark ? '#070d1f' : '#e8f0ff'
    const endStop = dark ? '#172a4a' : '#d6e4ff'
    root.classList.add('page-starry')
    root.style.setProperty('--page-bg-start', rgbTriplet(parseHex(startStop)))
    root.style.setProperty('--page-bg-end', rgbTriplet(parseHex(endStop)))
    root.style.setProperty('--page-bg-start-stop', `${value.startStop}%`)
    root.style.setProperty('--page-bg-end-stop', `${value.endStop}%`)
    root.style.setProperty('--page-bg-angle', value.direction === 'horizontal' ? '90deg' : value.direction === 'diagonal' ? '135deg' : '180deg')
    return
  }
  root.classList.remove('page-starry')
  const [startColor, endColor] = effectiveGradientColors(value)
  root.style.setProperty('--page-bg-start', startColor)
  root.style.setProperty('--page-bg-end', endColor)
  root.style.setProperty('--page-bg-start-stop', `${value.startStop}%`)
  root.style.setProperty('--page-bg-end-stop', `${value.endStop}%`)
  root.style.setProperty('--page-bg-angle', value.direction === 'horizontal' ? '90deg' : value.direction === 'diagonal' ? '135deg' : '180deg')
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
  const storedTones = readStoredTones()
  const pageBgToneLight = ref(storedTones.light)
  const pageBgToneDark = ref(storedTones.dark)
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

  // 亮色/暗色各记一个亮度值，切主题时自动用对应值。
  const pageBgTone = computed(() => isDark.value ? pageBgToneDark.value : pageBgToneLight.value)

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

  function persistTones() {
    localStorage.setItem(STORAGE_PAGE_BG_TONE_LIGHT, String(pageBgToneLight.value))
    localStorage.setItem(STORAGE_PAGE_BG_TONE_DARK, String(pageBgToneDark.value))
    localStorage.removeItem(STORAGE_PAGE_BG_TONE)
  }

  /** 设置当前主题的亮度值；切到另一个主题时仍保留各自的值。 */
  function setPageBgTone(value: number) {
    const next = clampPageBgTone(value)
    if (isDark.value) pageBgToneDark.value = next
    else pageBgToneLight.value = next
    persistTones()
    applyPageBgTone(pageBgTone.value)
  }

  /** 由配置加载时分别写入亮色/暗色值（不必等切到该主题）。 */
  function setPageBgToneFor(dark: boolean, value: number) {
    const next = clampPageBgTone(value)
    if (dark) pageBgToneDark.value = next
    else pageBgToneLight.value = next
    persistTones()
    if (isDark.value === dark) applyPageBgTone(pageBgTone.value)
  }

  /** 恢复默认只重置当前主题；另一个主题的手动值保留。 */
  function resetPageBgTone() {
    if (isDark.value) pageBgToneDark.value = PAGE_BG_TONE_DARK
    else pageBgToneLight.value = PAGE_BG_TONE_LIGHT
    persistTones()
    applyPageBgTone(pageBgTone.value)
  }

  function setPageBgGradient(value: PageBgGradient | null) {
    pageBgGradient.value = value
    if (value) localStorage.setItem(STORAGE_PAGE_BG_GRADIENT, JSON.stringify(value))
    else localStorage.removeItem(STORAGE_PAGE_BG_GRADIENT)
    applyPageBgGradient(value)
  }

  apply()

  return { mode, brand, sunCity, sunDark, pageBgTone, pageBgToneLight, pageBgToneDark, pageBgGradient, isDark, toggle, setMode, setBrand, setSunCity, setPageBgTone, setPageBgToneFor, resetPageBgTone, setPageBgGradient, refreshSun, apply }
})
