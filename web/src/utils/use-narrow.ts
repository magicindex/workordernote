import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 「手机端」的统一判定：视口 ≤640px（Tailwind 的 sm 断点）。
 *
 * 手机上没有日历视图——月历格子在小屏上一天只有 40 多像素宽，日期与安排挤成一团，
 * 因此日历入口隐藏、直接访问 /admin/calendar 也会被送到列表视图。
 * 这个判断在侧栏/顶栏、路由守卫、日历页、打印弹窗几处都要用，统一放这里，
 * 免得几个地方各写一遍 max-width，改一处漏一处。
 */
const NARROW_QUERY = '(max-width: 640px)'

/** 不走响应式的即时判断：路由守卫在组件挂载之前就要用。 */
export function isNarrowNow(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(NARROW_QUERY).matches
}

// 多个组件共用同一个 MediaQueryList 与同一个 ref，避免各挂各的监听
const narrow = ref(isNarrowNow())
let mql: MediaQueryList | null = null
let users = 0
const sync = () => { narrow.value = !!mql?.matches }

/** 组件里用它拿到响应式的「是不是手机」，转屏/拉窗口会实时变。 */
export function useIsNarrow() {
  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    if (!mql) {
      mql = window.matchMedia(NARROW_QUERY)
      narrow.value = mql.matches
      mql.addEventListener('change', sync)
    }
    users += 1
  })
  onBeforeUnmount(() => {
    users -= 1
    if (users <= 0 && mql) {
      mql.removeEventListener('change', sync)
      mql = null
    }
  })
  return narrow
}
