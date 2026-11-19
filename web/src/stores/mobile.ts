/**
 * 手机栏目的个人偏好（用户 2026-11-19）：
 *   · tabOrder —— 底部标签栏从左到右的顺序；
 *   · homeView —— 手机打开应用时先进入哪一页。
 *
 * 值存在服务端的用户配置里（mobile_tabs_order / mobile_home_view，见
 * server/sysconfig/registry.go），这里同时写一份 localStorage 缓存：路由守卫要在
 * 页面渲染前同步决定首屏，等不了接口（见 utils/mobile-nav.ts 的说明）。
 *
 * 为什么不塞进 authStore：这两个值只管手机外壳（底栏 + 首屏），跟登录态/功能开关
 * 不是一类东西，单独一个 store 改起来不容易碰坏别的。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  MOBILE_HOME_VIEW_DEFAULT,
  MOBILE_TAB_ORDER_DEFAULT,
  parseMobileHomeView,
  parseMobileTabOrder,
  readCachedMobileHomeView,
  readCachedMobileTabOrder,
  resolveMobileHomeView,
  serializeMobileTabOrder,
  writeCachedMobileHomeView,
  writeCachedMobileTabOrder,
  type MobileHomeView,
  type MobileTabKey,
} from '../utils/mobile-nav'

export const useMobileNavStore = defineStore('mobileNav', () => {
  const tabOrder = ref<MobileTabKey[]>(readCachedMobileTabOrder())
  const homeView = ref<MobileHomeView>(readCachedMobileHomeView())

  /** 从 /api/configs 的一整份配置里取这两个键（没写过的键会落到默认值）。 */
  function applyFromConfigs(configs: Record<string, unknown> | null | undefined) {
    const cfg = configs || {}
    setTabOrder(String(cfg.mobile_tabs_order ?? ''))
    setHomeView(String(cfg.mobile_home_view ?? ''))
  }

  function setTabOrder(value: string | MobileTabKey[]) {
    const next = Array.isArray(value) ? parseMobileTabOrder(value.join(',')) : parseMobileTabOrder(value)
    tabOrder.value = next
    writeCachedMobileTabOrder(next)
  }

  function setHomeView(value: string | MobileHomeView) {
    const next = parseMobileHomeView(value)
    homeView.value = next
    writeCachedMobileHomeView(next)
  }

  /** 恢复默认：顺序回到 首页 / 计划 / 清单 / 待办 / 提醒，首屏回到首页看板。 */
  function resetToDefaults() {
    tabOrder.value = [...MOBILE_TAB_ORDER_DEFAULT]
    homeView.value = MOBILE_HOME_VIEW_DEFAULT
    writeCachedMobileTabOrder(tabOrder.value)
    writeCachedMobileHomeView(homeView.value)
  }

  /** 当前真正生效的首屏：提醒@他被关掉时退回首页看板。 */
  function effectiveHomeView(nudgeEnabled: boolean): MobileHomeView {
    return resolveMobileHomeView(homeView.value, nudgeEnabled)
  }

  function serializeOrder(): string {
    return serializeMobileTabOrder(tabOrder.value)
  }

  return {
    tabOrder,
    homeView,
    applyFromConfigs,
    setTabOrder,
    setHomeView,
    resetToDefaults,
    effectiveHomeView,
    serializeOrder,
  }
})
