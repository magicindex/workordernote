<template>
  <!-- 浏览器安装（PWA）：把网页像 App 一样装到手机桌面 / 电脑上。
       能不能装取决于浏览器：需要 HTTPS（或 localhost）+ manifest + Service Worker；
       内网纯 http 打开时 Chrome 不提供安装，这里就如实说明并给出替代方案。 -->
  <h4 class="mt-5 text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">装到桌面</h4>
  <div class="mt-2 rounded-2xl border border-border/70 p-3.5" data-install-card>
    <div class="flex flex-wrap items-center gap-2">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M12 3v10m0 0 4-4m-4 4-4-4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-bold">{{ installed ? '已经装到这台设备上了' : '把工作序记装到桌面' }}</p>
        <p class="mt-0.5 text-[11px] font-medium text-muted-foreground" data-install-hint>{{ hint }}</p>
      </div>
      <button
        v-if="canPrompt && !installed"
        class="btn-primary !h-9 !px-4 !text-xs"
        data-install-button
        @click="promptInstall"
      >立即安装</button>
    </div>

    <ul v-if="!installed && !canPrompt" class="mt-3 space-y-1.5 text-[12px] leading-5 text-muted-foreground">
      <li v-for="(line, i) in steps" :key="i" class="flex gap-2">
        <span class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500/60"></span>
        <span>{{ line }}</span>
      </li>
    </ul>

    <p v-if="!installed && !canPrompt" class="mt-2.5 flex items-start gap-1.5 rounded-xl bg-muted/60 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
      <svg viewBox="0 0 24 24" class="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 8v5m0 3h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>{{ reason }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferred = ref<InstallPromptEvent | null>(null)
const installed = ref(false)
/** 安全上下文：https、localhost、127.0.0.1 才算；内网 http 打开时不是。 */
const secure = ref(true)

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // iOS Safari 的老写法
  (window.navigator as unknown as { standalone?: boolean }).standalone === true

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
const isAndroid = () => /Android/.test(navigator.userAgent)
const canPrompt = computed(() => !!deferred.value && !installed.value)

const hint = computed(() => {
  if (installed.value) return '从桌面图标打开就是全屏应用，和安卓客户端一样'
  if (canPrompt.value) return '点右边的按钮，浏览器会把它装成独立应用（有图标、无地址栏）'
  if (isIOS()) return 'iPhone / iPad 用 Safari 的「分享 → 添加到主屏幕」'
  if (isAndroid()) return '安卓 Chrome 用右上角菜单里的「安装应用 / 添加到主屏幕」'
  return '电脑 Chrome / Edge 地址栏右侧会出现安装图标，点一下就装好'
})

const steps = computed(() => {
  if (isIOS()) {
    return [
      '用 Safari 打开本页（微信/QQ 内置浏览器不支持安装）',
      '点底部中间的「分享」按钮',
      '在列表里选「添加到主屏幕」，确认即可',
    ]
  }
  if (isAndroid()) {
    return [
      '用 Chrome 打开本页',
      '点右上角「⋮」菜单',
      '选「安装应用」或「添加到主屏幕」',
    ]
  }
  return [
    '用 Chrome / Edge 打开本页',
    '看地址栏右侧的安装图标（显示器 + 箭头），点它',
    '或点浏览器菜单里的「安装工作序记」',
  ]
})

const reason = computed(() => {
  if (!secure.value) {
    return '浏览器只有在 HTTPS（或 localhost）下才允许安装，当前是内网 http 地址。'
      + '可以在外面用 HTTPS 域名打开本页再安装，或直接装安卓客户端（自带服务器地址设置，内网也能用）。'
  }
  return '这台浏览器暂时没有提供安装入口（可能已经装过、或用的是内置浏览器）。按上面的步骤手动添加也可以。'
})

// 安装事件由 main.ts 在应用启动时就捕获（它可能早于这个弹窗组件挂载），
// 这里只负责读取与响应后续通知。
function readDeferred() {
  const evt = (window as unknown as { __deferredInstallPrompt?: InstallPromptEvent }).__deferredInstallPrompt
  deferred.value = evt || null
}

function onPromptReady() {
  readDeferred()
}

function onInstalled() {
  installed.value = true
  deferred.value = null
}

async function promptInstall() {
  const evt = deferred.value
  if (!evt) return
  try {
    await evt.prompt()
    await evt.userChoice
  } catch { /* 用户取消或浏览器不支持，忽略 */ }
  ;(window as unknown as { __deferredInstallPrompt?: InstallPromptEvent }).__deferredInstallPrompt = undefined
  deferred.value = null
}

onMounted(() => {
  installed.value = standalone()
  secure.value = window.isSecureContext !== false
  readDeferred()
  window.addEventListener('install-prompt-ready', onPromptReady)
  window.addEventListener('appinstalled', onInstalled)
})

onBeforeUnmount(() => {
  window.removeEventListener('install-prompt-ready', onPromptReady)
  window.removeEventListener('appinstalled', onInstalled)
})
</script>
