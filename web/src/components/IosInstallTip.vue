<template>
  <Teleport to="body">
    <Transition name="ios-tip">
      <div v-if="visible" class="ios-install-tip" data-ios-install-banner role="region" aria-label="添加到主屏幕">
        <span class="ios-install-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M12 3v10m0 0 4-4m-4 4-4-4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="min-w-0 flex-1">
          <b class="block text-[13px] font-bold text-foreground">把工作序记放到主屏幕</b>
          <span class="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
            {{ inApp ? '请先用 Safari 打开本页' : 'Safari 分享 → 添加到主屏幕，打开就是全屏 App' }}
          </span>
        </span>
        <button type="button" class="ios-install-help" data-ios-install-help @click="stepsOpen = true">看步骤</button>
        <button type="button" class="ios-install-close" data-ios-install-dismiss aria-label="关闭提示" @click="dismiss">×</button>
      </div>
    </Transition>

    <div v-if="stepsOpen" class="ios-install-mask" data-ios-install-steps @click.self="stepsOpen = false">
      <section class="ios-install-dialog" role="dialog" aria-modal="true" aria-label="添加到 iPhone 主屏幕">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-bold uppercase tracking-[.16em] text-brand-500">iPhone / iPad</p>
            <h3 class="mt-1 text-lg font-bold text-foreground">添加到主屏幕</h3>
          </div>
          <button type="button" class="ios-install-close" aria-label="关闭" @click="stepsOpen = false">×</button>
        </div>
        <ol class="mt-4 space-y-3 text-[13px] leading-5 text-muted-foreground">
          <li><b class="text-foreground">1.</b> 用 Safari 打开本页（微信 / QQ 内置浏览器不支持）</li>
          <li><b class="text-foreground">2.</b> 点底部中间的「分享」按钮</li>
          <li><b class="text-foreground">3.</b> 在列表里选「添加到主屏幕」</li>
          <li><b class="text-foreground">4.</b> 点右上角「添加」，桌面就会出现图标</li>
        </ol>
        <p class="mt-4 rounded-xl bg-muted/60 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          添加后从桌面图标打开就是全屏应用；内网 HTTP 也能添加，离线缓存需要 HTTPS。
        </p>
        <button type="button" class="btn-primary mt-4 w-full !h-10" data-ios-install-close @click="stepsOpen = false">知道了</button>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

const DISMISS_KEY = 'reminders.ios-install-tip-dismissed-at'
const WEEK = 7 * 24 * 60 * 60 * 1000

const visible = ref(false)
const stepsOpen = ref(false)
const inApp = ref(false)

function ua() {
  return navigator.userAgent || ''
}

function isIOSDevice() {
  const u = ua()
  return /iPad|iPhone|iPod/.test(u) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
}

function wasDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return at > 0 && Date.now() - at < WEEK
  } catch {
    return false
  }
}

function dismiss() {
  visible.value = false
  stepsOpen.value = false
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* 隐私模式 */ }
}

onMounted(() => {
  const u = ua()
  inApp.value = /MicroMessenger|QQ\/|Weibo|AlipayClient/i.test(u)
  visible.value = isIOSDevice() && !isStandalone() && !wasDismissed()
})
</script>

<style scoped>
.ios-install-tip {
  position: fixed;
  left: 0.75rem;
  right: 0.75rem;
  bottom: calc(4.9rem + env(safe-area-inset-bottom));
  z-index: 61;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  max-width: 30rem;
  margin: 0 auto;
  padding: 0.7rem 0.75rem;
  border: 1px solid rgb(var(--color-border) / 0.65);
  border-radius: 1.1rem;
  background: rgb(var(--color-surface) / 0.94);
  box-shadow: 0 18px 45px -18px rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(18px) saturate(140%);
}
.ios-install-icon {
  display: grid;
  place-items: center;
  width: 2.35rem;
  height: 2.35rem;
  flex: none;
  border-radius: 0.8rem;
  color: rgb(var(--color-brand-500));
  background: rgb(var(--color-brand-500) / 0.12);
}
.ios-install-icon svg { width: 1.15rem; height: 1.15rem; }
.ios-install-help {
  flex: none;
  height: 1.9rem;
  padding: 0 0.65rem;
  border-radius: 0.7rem;
  background: rgb(var(--color-brand-500));
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.ios-install-close {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  flex: none;
  border-radius: 999px;
  color: rgb(var(--color-muted-foreground));
  font-size: 18px;
  line-height: 1;
  background: rgb(var(--color-muted) / 0.55);
}
.ios-install-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1rem;
  padding-bottom: calc(1rem + env(safe-area-inset-bottom));
  background: rgba(2, 6, 23, 0.58);
}
.ios-install-dialog {
  width: 100%;
  max-width: 26rem;
  padding: 1.1rem;
  border-radius: 1.4rem;
  background: rgb(var(--color-surface));
  box-shadow: 0 24px 70px -20px rgba(2, 6, 23, 0.75);
}
.ios-tip-enter-active, .ios-tip-leave-active { transition: opacity .18s ease, transform .18s ease; }
.ios-tip-enter-from, .ios-tip-leave-to { opacity: 0; transform: translateY(10px); }
@media (min-width: 1024px) { .ios-install-tip { display: none; } }
</style>
