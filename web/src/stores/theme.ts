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

const STORAGE_MODE = 'reminder-theme-mode'
const STORAGE_BRAND = 'reminder-theme-brand'
const STORAGE_SUN_CITY = 'reminder-theme-sun-city'

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

  apply()

  return { mode, brand, sunCity, sunDark, isDark, toggle, setMode, setBrand, setSunCity, refreshSun, apply }
})
