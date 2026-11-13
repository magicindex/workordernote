<template>
  <!-- 「呼叫小秘」的桌面入口（用户 2026-11-13）：
       原来在侧栏顶部，现在改成右下角一颗可拖动的悬浮球；拖到哪儿就记住哪儿，
       刷新 / 下次打开还在原处。手机上保持原样（顶栏图标 + 侧栏入口），
       所以这颗球只在 lg（≥1024px）显示，见样式里的媒体查询。 -->
  <button
    ref="ballEl"
    type="button"
    class="assistant-ball orb-flow"
    :class="{ 'assistant-ball-hidden': panelOpen, 'assistant-ball-dragging': dragging }"
    :style="ballStyle"
    :aria-label="`呼叫${assistant.displayName}（AI 助手）`"
    :title="`呼叫${assistant.displayName}：写周报、一句话建任务（按住可拖动）`"
    :aria-hidden="panelOpen ? 'true' : undefined"
    :tabindex="panelOpen ? -1 : undefined"
    data-assistant-trigger
    data-assistant-ball
    @click="onClick"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @dragstart.prevent
    @contextmenu.prevent
  >
    <svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" aria-hidden="true">
      <path
        d="m12 3.6 1.9 4.4 4.4 1.9-4.4 1.9L12 16.2l-1.9-4.4-4.4-1.9 4.4-1.9L12 3.6Z"
        stroke-width="1.7"
        stroke-linejoin="round"
      />
      <path
        d="M18.6 15.4l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
    <!-- 读屏与旧用例都认这行文字：「呼叫小秘」；视觉上只露出图标。 -->
    <span class="sr-only">呼叫{{ assistant.displayName }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAssistantStore } from '../stores/assistant'
import { SK } from '../utils/storage-keys'

defineProps<{ panelOpen?: boolean }>()
const emit = defineEmits<{ open: [] }>()

/** 小秘的名字：每个人可自定义，tooltip / aria-label / 读屏文字都跟着换。 */
const assistant = useAssistantStore()
assistant.loadName()

/** 球的直径与贴边留白：拖动时按这个尺寸算边界，球永远整颗留在视口里。 */
const BALL_SIZE = 56
const EDGE = 12
/** 松手后这段时间内的 click 视为拖动的尾巴，不再打开面板。 */
const SUPPRESS_CLICK_MS = 500

const ballEl = ref<HTMLButtonElement | null>(null)
const dragging = ref(false)
/** 用户亲手拖过 / 存过位置：窗口缩放时夹回视口，而不是回到默认角落。 */
const custom = ref(false)

function viewport() {
  return {
    w: typeof window === 'undefined' ? 1280 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }
}

function defaultPos() {
  const { w, h } = viewport()
  return { x: w - BALL_SIZE - 24, y: h - BALL_SIZE - 96 }
}

/** 把坐标夹回视口：贴边留 12px，转屏 / 拉窗口后不会留在屏幕外。 */
function clamp(value: { x: number; y: number }) {
  const { w, h } = viewport()
  const maxX = Math.max(EDGE, w - BALL_SIZE - EDGE)
  const maxY = Math.max(EDGE, h - BALL_SIZE - EDGE)
  return {
    x: Math.min(Math.max(Math.round(value.x), EDGE), maxX),
    y: Math.min(Math.max(Math.round(value.y), EDGE), maxY),
  }
}

function loadPos() {
  const fallback = defaultPos()
  try {
    const raw = localStorage.getItem(SK.assistantBallPos)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const x = Number(parsed?.x)
    const y = Number(parsed?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback
    custom.value = true
    return clamp({ x, y })
  } catch {
    // 存坏了 / 隐私模式读不到：按默认右下角来，不影响呼叫。
    return fallback
  }
}

function persistPos() {
  try {
    localStorage.setItem(SK.assistantBallPos, JSON.stringify(pos.value))
  } catch {
    // 隐私模式写不进去就只在本次会话里记住，不打断使用。
  }
}

/** 首屏直接按记住的位置画，避免先闪一下左上角再跳过去。 */
const pos = ref(loadPos())
const ballStyle = computed(() => ({ left: `${pos.value.x}px`, top: `${pos.value.y}px` }))

/** 拖动过程：记录起点与按下时的位置，移动超过 4px 才算拖动。 */
let drag: {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
} | null = null
let suppressClickUntil = 0

function onPointerDown(event: PointerEvent) {
  // 只响应左键 / 单指触摸；右键、中键不参与拖动。
  if (event.pointerType === 'mouse' && event.button !== 0) return
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: pos.value.x,
    originY: pos.value.y,
    moved: false,
  }
  dragging.value = true
  try {
    ballEl.value?.setPointerCapture?.(event.pointerId)
  } catch {
    // 个别内核/指针状态下会拒绝捕获；不捕获也能拖，只是移出按钮后可能丢事件。
  }
}

function onPointerMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  // 鼠标在窗口外松开时收不到 pointerup：按键已经抬起就当作取消，
  // 免得球继续跟着光标跑。
  if (event.pointerType === 'mouse' && event.buttons === 0) {
    onPointerCancel()
    return
  }
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true
  if (!drag.moved) return
  event.preventDefault()
  pos.value = clamp({ x: drag.originX + dx, y: drag.originY + dy })
}

function onPointerUp(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const moved = drag.moved
  drag = null
  dragging.value = false
  try {
    ballEl.value?.releasePointerCapture?.(event.pointerId)
  } catch {
    // 指针已经释放（例如系统手势抢走）就算了。
  }
  if (moved) {
    custom.value = true
    suppressClickUntil = Date.now() + SUPPRESS_CLICK_MS
    persistPos()
  }
}

function onPointerCancel() {
  if (!drag) return
  // 已经拖到新位置（只是最后一下被系统手势/窗口切换打断）也把位置记住。
  if (drag.moved) {
    custom.value = true
    persistPos()
  }
  drag = null
  dragging.value = false
}

function onClick() {
  if (Date.now() < suppressClickUntil) return
  emit('open')
}

function onResize() {
  if (!custom.value) {
    pos.value = defaultPos()
    return
  }
  const next = clamp(pos.value)
  if (next.x !== pos.value.x || next.y !== pos.value.y) {
    pos.value = next
    persistPos()
  }
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('orientationchange', onResize)
})
</script>

<style scoped>
.assistant-ball {
  position: fixed;
  z-index: 55;
  display: flex;
  width: 56px;
  height: 56px;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: #fff;
  background:
    radial-gradient(120% 120% at 22% 18%, rgba(255, 255, 255, 0.34), transparent 58%),
    linear-gradient(135deg, #3b82f6 0%, #6366f1 52%, #8b5cf6 100%);
  box-shadow:
    0 18px 40px -14px rgba(59, 130, 246, 0.8),
    0 8px 22px -12px rgba(99, 102, 241, 0.9),
    inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    opacity 0.2s ease,
    transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1),
    box-shadow 0.2s ease;
}

.assistant-ball:hover {
  transform: translateY(-2px) scale(1.03);
  box-shadow:
    0 22px 46px -14px rgba(59, 130, 246, 0.9),
    0 10px 26px -12px rgba(99, 102, 241, 0.95),
    inset 0 0 0 1px rgba(255, 255, 255, 0.24);
}

.assistant-ball:focus-visible {
  outline: 2px solid rgb(var(--color-brand-500));
  outline-offset: 4px;
}

.assistant-ball:active,
.assistant-ball-dragging {
  cursor: grabbing;
  transform: scale(0.96);
  transition: none;
}

/* 面板展开时球淡出：桌面端窗口就停在球的旁边，留着会挡视线/和关闭按钮打架。
   不设 display:none，留出透明度动画的时间。 */
.assistant-ball-hidden {
  opacity: 0;
  pointer-events: none;
  transform: scale(0.7);
}

.assistant-ball > svg {
  position: relative;
  z-index: 2;
  filter: drop-shadow(0 2px 6px rgba(15, 23, 42, 0.28));
}

/* 只出现在桌面：手机上保持「顶栏 AI 图标 + 侧栏入口」的现状。
   放在基础样式之后（同特异性、后来的赢），否则会被上面的 display:flex 盖掉。
   用 max-width 而不是 Tailwind 的 hidden lg:flex，方便和侧栏断点（1024px）对齐。 */
@media (max-width: 1023.98px) {
  .assistant-ball {
    display: none;
  }
}
</style>
