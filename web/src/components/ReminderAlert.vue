<template>
  <Teleport to="body">
    <Transition name="alert">
      <div
        v-if="open"
        class="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]"
      >
        <section
          role="alertdialog"
          aria-modal="true"
          :aria-label="title"
          class="surface-modal w-full max-w-sm overflow-hidden rounded-2xl"
        >
          <!-- 顶部品牌条：站内提醒是「有事找你」，不是普通提示，视觉上要一眼看到 -->
          <div class="flex items-center gap-3 border-b border-border/70 bg-gradient-to-r from-blue-500/12 to-indigo-500/12 px-5 py-3.5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-[0_8px_20px_-8px_rgba(59,130,246,.9)]">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">工作序记</p>
              <p class="truncate text-sm font-bold text-foreground">{{ timeLabel }}</p>
            </div>
            <span
              v-if="pendingCount > 0"
              class="shrink-0 rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] font-bold text-brand-600 dark:text-brand-300"
            >还有 {{ pendingCount }} 条</span>
          </div>

          <div class="px-5 pb-5 pt-4">
            <h2 class="text-lg font-bold leading-6 text-foreground">{{ title }}</h2>
            <p v-if="body" class="mt-1.5 text-[13px] leading-5 text-muted-foreground">{{ body }}</p>

            <p v-if="error" class="mt-3 text-[13px] text-rose-600 dark:text-rose-400">{{ error }}</p>

            <!-- 只有两个动作：「知道了」=当天不再提示、第二天继续提醒；
                 「稍后提醒」=按偏好里的提醒频率过一会儿再弹。**不再有「完成」**——
                 要完成请到列表里勾选，免得误点把事办了。
                 主按钮文案由 MainLayout 传进来（默认「知道了（任务延期明天提醒）」）：
                 用户 2026-10-12 反馈「昨天到期的任务新建后进了逾期，点知道了就出了逾期」——
                 按钮本身要写清楚点了等于延期，不能只写「知道了」。 -->
            <div class="mt-5 flex flex-col gap-2.5">
              <button ref="ackButtonRef" type="button" class="btn-brand w-full" :disabled="busy" @click="emit('ack')">
                <svg v-if="busy" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                {{ busy ? '处理中…' : ackText }}
              </button>
              <!-- 「稍后提醒」要有可以顺延的提醒才显示：提醒@他推来的通知没有关联任务，
                   按钮点了也只能标已读 —— 藏掉更诚实（用户 2026-10-13 的「提醒一下」弹窗）。 -->
              <button v-if="showSnooze" type="button" class="btn-ghost w-full" :disabled="busy" @click="emit('snooze')">
                {{ snoozeText }}
              </button>
              <!-- 兜底出口：操作失败时（网络断了、服务端报错）总得能关掉，
                   否则用户被困在这个弹窗里出不去（用户报过这种「取消不掉」）。 -->
              <button
                v-if="error"
                type="button"
                class="w-full rounded-xl px-4 py-2 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-white/[0.06]"
                :disabled="busy"
                data-alert-dismiss
                @click="emit('dismiss')"
              >
                关闭弹窗
              </button>
              <p class="text-center text-[11px] leading-4 text-muted-foreground">{{ hint }}</p>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// 站内提醒弹窗。
//
// 为什么要有它：站内通知以前只在右下角飘一条 toast，手机端那个位置既容易被
// 忽略、也容易被底部标签栏挡住——提醒到点却什么也没看见，等于没提醒。这里改成
// 屏幕中央的弹窗，必须由用户处理（完成 / 稍后提醒 / 知道了）才消失，PC 与手机
// 一致。
//
// 可访问性：role=alertdialog + 打开时自动聚焦「知道了」，Esc 等同于「知道了」。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  /** 是否显示「稍后提醒」：提醒@他推来的通知没有关联任务，给 false。 */
  showSnooze?: boolean
  open: boolean
  title?: string
  body?: string
  createdAt?: string
  /** 队列里还排着多少条，让用户知道后面还有。 */
  pendingCount?: number
  busy?: boolean
  error?: string
  /** 「稍后提醒」按钮上的文案（按偏好里的提醒频率显示间隔） */
  snoozeLabel?: string
  /** 主按钮上的文案：点它 = 顺延（默认「知道了（任务延期明天提醒）」） */
  ackLabel?: string
  /** 主按钮下面那行小字，说明「知道了」之后什么时候再提醒 */
  ackHint?: string
}>(), {
  title: '',
  body: '',
  createdAt: '',
  showSnooze: true,
  pendingCount: 0,
  busy: false,
  error: '',
  snoozeLabel: '稍后提醒',
  ackLabel: '知道了（任务延期明天提醒）',
  ackHint: '',
})

const emit = defineEmits<{
  /** 知道了：当天不再提示（服务端按偏好里的「知道了后的提醒频率」顺延） */
  ack: []
  snooze: []
  /** 兜底：「操作失败」时只把弹窗关掉，不改动提醒 */
  dismiss: []
}>()

const snoozeText = computed(() => props.snoozeLabel || '稍后提醒')
const ackText = computed(() => props.ackLabel || '知道了')
const hint = computed(() => props.ackHint || '')
const ackButtonRef = ref<HTMLButtonElement | null>(null)

const timeLabel = computed(() => {
  if (!props.createdAt) return '到点了'
  const at = new Date(props.createdAt)
  if (Number.isNaN(at.getTime())) return '到点了'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at)
})

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  if (props.busy) return
  emit('ack')
}

watch(() => props.open, async (open) => {
  if (open) {
    window.addEventListener('keydown', onKeydown)
    await nextTick()
    ackButtonRef.value?.focus()
    return
  }
  window.removeEventListener('keydown', onKeydown)
}, { immediate: true })

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.alert-enter-active,
.alert-leave-active {
  transition: opacity 0.2s ease;
}
.alert-enter-from,
.alert-leave-to {
  opacity: 0;
}
.alert-enter-active section,
.alert-leave-active section {
  transition: transform 0.2s ease;
}
.alert-enter-from section,
.alert-leave-to section {
  transform: scale(0.95) translateY(8px);
}
</style>
