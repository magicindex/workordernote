<template>
  <section class="surface rounded-2xl p-4 sm:p-6" data-mobile-nav-prefs>
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="text-sm font-bold text-foreground">手机栏目</h3>
        <p class="mt-1 text-xs leading-5 text-muted-foreground">
          手机打开应用先显示哪一页、底部导航从左到右怎么排。拖拽下面的把手调整顺序，
          <b class="font-semibold text-foreground">预览确认后生效</b>；只影响你自己的手机界面。
        </p>
      </div>
      <span
        v-if="notice"
        class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-300"
        data-mobile-nav-notice
      >{{ notice }}</span>
    </div>

    <!-- 打开应用先显示 -->
    <div class="mt-4">
      <p class="text-xs font-bold text-foreground">打开应用先显示</p>
      <p class="mt-1 text-[11px] leading-4 text-muted-foreground">
        手机上打开工作序记时第一眼看到哪一页；10 分钟不操作也会回到这一页（电脑端的「默认首页」不受这里影响）。
      </p>
      <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="手机打开先显示">
        <button
          v-for="option in homeViewOptions"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="draftHome === option.value"
          :data-mobile-nav-home-view="option.value"
          class="rounded-xl border px-3 py-2 text-left transition"
          :class="draftHome === option.value
            ? 'border-brand-500/50 bg-brand-500/10 text-brand-700 dark:text-brand-200'
            : 'border-border/70 bg-surface/50 text-foreground hover:border-brand-500/30'"
          @click="draftHome = option.value"
        >
          <span class="flex items-center gap-1.5 text-xs font-bold">
            <span
              class="flex h-3.5 w-3.5 items-center justify-center rounded-full border"
              :class="draftHome === option.value ? 'border-brand-500' : 'border-border'"
              aria-hidden="true"
            >
              <span v-if="draftHome === option.value" class="h-1.5 w-1.5 rounded-full bg-brand-500"></span>
            </span>
            {{ option.label }}
          </span>
          <span class="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{{ option.hint }}</span>
        </button>
      </div>
    </div>

    <!-- 底部导航顺序 -->
    <div class="mt-5" ref="listRef">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p class="text-xs font-bold text-foreground">底部导航顺序</p>
          <p class="mt-1 text-[11px] leading-4 text-muted-foreground">
            按住左侧把手上下拖动，或用 ↑ ↓ 微调；从左到右就是手机底栏的显示顺序。
          </p>
        </div>
        <span class="text-[10px] font-semibold text-muted-foreground" data-mobile-nav-order-text>
          {{ orderLabel }}
        </span>
      </div>

      <ul class="mt-2 space-y-1.5" role="list">
        <li
          v-for="(key, index) in draftOrder"
          :key="key"
          class="flex items-center gap-2 rounded-xl border border-border/70 bg-surface/50 px-2.5 py-2"
          :class="draggingKey === key ? 'border-brand-500/50 bg-brand-500/10 shadow-sm' : ''"
          :data-mobile-nav-row="key"
          :data-mobile-nav-index="index"
        >
          <button
            type="button"
            class="flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
            style="touch-action: none"
            :aria-label="`拖动调整「${MOBILE_TAB_META[key].label}」的位置`"
            :data-mobile-nav-handle="key"
            @pointerdown.stop.prevent="startDrag(key, $event)"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
          </button>
          <span class="mnav-icon bg-brand-500/12 text-brand-600 dark:text-brand-300" v-html="MOBILE_TAB_META[key].icon"></span>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-bold text-foreground">{{ MOBILE_TAB_META[key].label }}</p>
            <p class="truncate text-[10px] text-muted-foreground">
              {{ key === 'nudges' && !authStore.nudgeEnabled ? '栏目已关闭，开启「提醒@他」后才会出现在底栏' : (MOBILE_TAB_META[key].hint || `第 ${index + 1} 个`) }}
            </p>
          </div>
          <span v-if="draftHome === key" class="shrink-0 rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-bold text-brand-600 dark:text-brand-300" data-mobile-nav-home-badge>首屏</span>
          <span class="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
              :disabled="index === 0"
              :aria-label="`「${MOBILE_TAB_META[key].label}」上移`"
              :data-mobile-nav-up="key"
              @click="move(key, -1)"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 14.5 6-6 6 6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
              :disabled="index === draftOrder.length - 1"
              :aria-label="`「${MOBILE_TAB_META[key].label}」下移`"
              :data-mobile-nav-down="key"
              @click="move(key, 1)"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 9.5 6 6 6-6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </span>
        </li>
      </ul>
      <p v-if="dragHint" class="mt-1.5 text-[10px] text-muted-foreground" data-mobile-nav-drag-hint>{{ dragHint }}</p>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="btn-ghost !h-9 !px-3 text-xs"
        :disabled="saving"
        data-mobile-nav-reset
        @click="restoreDefaults"
      >恢复默认值</button>
      <button
        type="button"
        class="btn-primary !h-9 !px-4 text-xs font-bold"
        :disabled="saving"
        data-mobile-nav-preview
        @click="previewOpen = true"
      >预览并保存</button>
      <span v-if="dirty" class="text-[11px] font-semibold text-amber-600 dark:text-amber-300" data-mobile-nav-dirty>
        有未保存的改动，预览确认后才生效
      </span>
      <span v-else class="text-[11px] text-muted-foreground" data-mobile-nav-saved-state>与当前生效的配置一致</span>
    </div>
    <p v-if="errorMsg" class="mt-2 text-[11px] font-medium text-destructive" data-mobile-nav-error>{{ errorMsg }}</p>

    <!-- 预览确认：手机底栏长什么样、打开先到哪一页 -->
    <Modal v-model="previewOpen" title="预览手机栏目">
      <div class="space-y-4" data-mobile-nav-preview-modal>
        <div class="rounded-[26px] border border-border/70 bg-gradient-to-b from-brand-500/10 via-surface to-surface p-3 shadow-inner">
          <p class="px-1 text-[11px] font-semibold text-muted-foreground">手机底栏（从左到右）</p>
          <div class="mt-2 flex items-center justify-around rounded-2xl border border-white/30 bg-surface/95 px-1.5 py-2 shadow-[0_14px_40px_-18px_rgba(15,23,42,.45)]" data-mobile-nav-preview-bar>
            <div
              v-for="key in draftOrder"
              :key="'pv-' + key"
              class="flex w-14 flex-col items-center gap-0.5"
              :class="previewHome === key ? 'text-brand-500' : 'text-muted-foreground'"
              :data-mobile-nav-preview-tab="key"
            >
              <span class="mnav-icon" :class="previewHome === key ? 'bg-brand-500/12' : 'bg-transparent'" v-html="MOBILE_TAB_META[key].icon"></span>
              <small class="text-[10px] font-semibold">{{ MOBILE_TAB_META[key].label }}</small>
            </div>
          </div>
          <p class="mt-2 px-1 text-[11px] leading-4 text-muted-foreground">
            打开应用先进入
            <b class="font-bold text-foreground" data-mobile-nav-preview-home>{{ previewHomeLabel }}</b>
            <template v-if="previewHome === 'nudges' && !authStore.nudgeEnabled">（这个栏目现在是关闭的，开启后才会生效）</template>
          </p>
        </div>

        <ul class="space-y-1 text-xs text-foreground">
          <li>顺序：<b class="font-semibold" data-mobile-nav-preview-order>{{ orderLabel }}</b></li>
          <li>首屏：<b class="font-semibold">{{ previewHomeLabel }}</b></li>
        </ul>

        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="btn-ghost !h-9 !px-3 text-xs"
            data-mobile-nav-cancel
            @click="previewOpen = false"
          >取消</button>
          <button
            type="button"
            class="btn-brand !h-9 !px-4 text-xs"
            :disabled="saving"
            data-mobile-nav-confirm
            @click="applyDraft"
          >{{ saving ? '保存中…' : '确认并生效' }}</button>
        </div>
        <p v-if="previewError" class="text-[11px] font-medium text-destructive" data-mobile-nav-preview-error>{{ previewError }}</p>
      </div>
    </Modal>
  </section>
</template>

<script setup lang="ts">
/**
 * 「偏好设置 → 手机 → 手机栏目」（用户 2026-11-19）：
 *
 *   「增加首页初始页面选择以及底部导航顺序自定义，底部导航顺序支持拖拽调整并持久化保存。
 *     栏目配置支持恢复默认值，并提供预览确认后生效」
 *
 * 设计取舍：
 *   · 草稿态：拖拽 / 选首屏只改本地草稿，点「预览并保存」→ 弹窗里看手机底栏长什么样 →
 *     「确认并生效」才写服务端（两个键各写一次），取消就什么都不变。
 *   · 顺序用固定的 5 个 token（home/planned/lists/today/nudges），归一化在
 *     utils/mobile-nav.ts；服务端只存字符串，不认识的 token 前端会丢掉、缺的补末尾。
 *   · 「提醒@他」关掉时仍保留在顺序里（开启后自动出现在底栏），此时不能选它当首屏。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { getAllConfigs, updateConfig } from '../api/config'
import { useAuthStore } from '../stores/auth'
import { useMobileNavStore } from '../stores/mobile'
import {
  MOBILE_HOME_VIEW_DEFAULT,
  MOBILE_HOME_VIEW_OPTIONS,
  MOBILE_TAB_META,
  MOBILE_TAB_ORDER_DEFAULT,
  mobileTabOrderLabel,
  parseMobileHomeView,
  parseMobileTabOrder,
  serializeMobileTabOrder,
  type MobileHomeView,
  type MobileTabKey,
} from '../utils/mobile-nav'

const authStore = useAuthStore()
const mobileNav = useMobileNavStore()

const draftOrder = ref<MobileTabKey[]>([...MOBILE_TAB_ORDER_DEFAULT])
const draftHome = ref<MobileHomeView>(MOBILE_HOME_VIEW_DEFAULT)
const saving = ref(false)
const notice = ref('')
const errorMsg = ref('')
const previewError = ref('')
const previewOpen = ref(false)
const draggingKey = ref<MobileTabKey | ''>('')
const dragHint = ref('')
const listRef = ref<HTMLElement | null>(null)

// 已保存（当前生效）的值：用来判断有没有未保存的改动
const appliedOrder = computed(() => mobileNav.tabOrder)
const appliedHome = computed(() => mobileNav.homeView)
const dirty = computed(() =>
  draftOrder.value.join(',') !== appliedOrder.value.join(',') || draftHome.value !== appliedHome.value)

const orderLabel = computed(() => mobileTabOrderLabel(draftOrder.value))
const previewHome = computed<MobileTabKey>(() => {
  // 预览里高亮「首屏」那一格；提醒@他关掉时按实际会落到的首页看板高亮
  if (draftHome.value === 'nudges' && !authStore.nudgeEnabled) return 'home'
  return draftHome.value
})
const previewHomeLabel = computed(() =>
  MOBILE_HOME_VIEW_OPTIONS.find((o) => o.value === previewHome.value)?.label || '首页')

// 「提醒@他」关掉时，首屏那一组里不出现它（选了也是白选）
const homeViewOptions = computed(() =>
  MOBILE_HOME_VIEW_OPTIONS.filter((o) => o.value !== 'nudges' || authStore.nudgeEnabled))

let noticeTimer: ReturnType<typeof setTimeout> | undefined
function flash(msg: string) {
  notice.value = msg
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = '' }, 2600)
}

function syncDraftFromApplied() {
  draftOrder.value = [...appliedOrder.value]
  draftHome.value = appliedHome.value
  if (draftHome.value === 'nudges' && !authStore.nudgeEnabled) draftHome.value = 'home'
}

onMounted(async () => {
  syncDraftFromApplied()
  try {
    const res = await getAllConfigs()
    mobileNav.applyFromConfigs(res.data?.data || {})
  } catch { /* 读不到就用缓存的偏好，面板仍可编辑 */ }
  syncDraftFromApplied()
})

watch(() => authStore.nudgeEnabled, (on) => {
  if (!on && draftHome.value === 'nudges') draftHome.value = 'home'
})

// ---------------- 拖拽排序 ----------------
let dragStartY = 0
let dragStartIndex = -1
let rowHeight = 52

function startDrag(key: MobileTabKey, event: PointerEvent) {
  if (saving.value) return
  const rows = listRef.value?.querySelectorAll<HTMLElement>('[data-mobile-nav-row]')
  rowHeight = rows && rows.length ? rows[0].offsetHeight + 6 : 52
  dragStartY = event.clientY
  dragStartIndex = draftOrder.value.indexOf(key)
  draggingKey.value = key
  dragHint.value = '正在调整顺序…松手即定位（还没保存）'
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
}

function onDragMove(event: PointerEvent) {
  if (!draggingKey.value) return
  const steps = Math.round((event.clientY - dragStartY) / rowHeight)
  const maxIndex = draftOrder.value.length - 1
  const target = Math.max(0, Math.min(maxIndex, dragStartIndex + steps))
  const from = draftOrder.value.indexOf(draggingKey.value)
  if (from < 0 || target === from) return
  const next = [...draftOrder.value]
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  draftOrder.value = next
}

function endDrag() {
  draggingKey.value = ''
  dragHint.value = ''
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
}

onBeforeUnmount(() => {
  endDrag()
  if (noticeTimer) clearTimeout(noticeTimer)
})

function move(key: MobileTabKey, delta: number) {
  const from = draftOrder.value.indexOf(key)
  const to = from + delta
  if (from < 0 || to < 0 || to >= draftOrder.value.length) return
  const next = [...draftOrder.value]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  draftOrder.value = next
}

// ---------------- 恢复默认 / 保存 ----------------
function restoreDefaults() {
  draftOrder.value = [...MOBILE_TAB_ORDER_DEFAULT]
  draftHome.value = MOBILE_HOME_VIEW_DEFAULT
  dragHint.value = ''
  flash('已恢复默认值，预览确认后生效')
}

async function applyDraft() {
  if (saving.value) return
  saving.value = true
  previewError.value = ''
  errorMsg.value = ''
  const orderValue = serializeMobileTabOrder(draftOrder.value)
  const homeValue = parseMobileHomeView(draftHome.value)
  try {
    await updateConfig('mobile_tabs_order', orderValue)
    await updateConfig('mobile_home_view', homeValue)
    mobileNav.setTabOrder(orderValue)
    mobileNav.setHomeView(homeValue)
    // 外壳（MainLayout）的底栏不用刷新就跟上：它监听同一个事件。
    window.dispatchEvent(new CustomEvent('config-changed', { detail: { key: 'mobile_tabs_order', value: orderValue } }))
    window.dispatchEvent(new CustomEvent('config-changed', { detail: { key: 'mobile_home_view', value: homeValue } }))
    previewOpen.value = false
    flash('已生效')
  } catch (err: any) {
    previewError.value = err.response?.data?.message || '保存失败，请稍后重试'
    errorMsg.value = previewError.value
  } finally {
    saving.value = false
  }
}

// 打开预览时清掉上一次的报错，避免「上次失败」的字挂在新的预览里
watch(previewOpen, (open) => { if (open) previewError.value = '' })
</script>

<style scoped>
/* 顺序行/预览里的小图标块：v-html 插入的 svg 不带 scoped 属性，尺寸要 :deep 指进去 */
.mnav-icon {
  display: flex;
  width: 1.25rem;
  height: 1.25rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.65rem;
}
.mnav-icon :deep(svg) {
  width: 18px;
  height: 18px;
}
</style>
