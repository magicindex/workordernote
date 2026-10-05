<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="panel"
      class="fixed z-[80] w-[11rem] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      role="menu"
      :aria-label="heading || '操作'"
      @click.stop
      @contextmenu.prevent.stop
    >
      <p v-if="heading" class="truncate px-3 py-1.5 text-[10px] font-bold text-muted-foreground">{{ heading }}</p>
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        role="menuitem"
        :disabled="item.disabled"
        :title="item.title || item.label"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition disabled:opacity-40"
        :class="item.danger
          ? 'text-destructive hover:bg-destructive/10 disabled:hover:bg-transparent'
          : 'text-foreground hover:bg-muted disabled:hover:bg-transparent'"
        @click="choose(item)"
      >
        <span v-if="item.icon" class="shrink-0" v-html="item.icon"></span>
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'

export interface ContextMenuItem {
  key: string
  label: string
  /** 一小段 svg 字符串（v-html），与侧栏图标同一套写法 */
  icon?: string
  danger?: boolean
  disabled?: boolean
  title?: string
}

const props = defineProps<{
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  /** 菜单顶部的小标题（例如那一条的标题） */
  heading?: string
}>()

const emit = defineEmits<{
  (e: 'select', key: string): void
  (e: 'update:open', value: boolean): void
}>()

const panel = ref<HTMLElement | null>(null)
const pos = reactive({ x: 0, y: 0 })

/**
 * 位置在**渲染后按实际尺寸**收进视口，不写死菜单宽高。
 * 上一轮日历那个菜单就是拿常量 152 去钳制、但 CSS 改成 176 后忘了同步，右下角直接出屏；
 * 这里改成量一次矩形，尺寸怎么变都不会再错位。
 */
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    pos.x = props.x
    pos.y = props.y
    await nextTick()
    const el = panel.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const margin = 8
    if (pos.x + rect.width > vw - margin) pos.x = Math.max(margin, vw - rect.width - margin)
    if (pos.y + rect.height > vh - margin) pos.y = Math.max(margin, vh - rect.height - margin)
    if (pos.x < margin) pos.x = margin
    if (pos.y < margin) pos.y = margin
  },
  { immediate: true },
)

function choose(item: ContextMenuItem) {
  if (item.disabled) return
  emit('update:open', false)
  emit('select', item.key)
}

function close() {
  emit('update:open', false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

// 打开期间自己挂收起时机：点别处、在别处右键、Esc、滚动、窗口尺寸变化。
// 注意：调用方在触发菜单的那次点击上要 .stop（或 .prevent.stop），否则同一个点击会
// 冒泡到这里立刻把菜单关掉。
function detach() {
  if (typeof document === 'undefined') return
  document.removeEventListener('click', close)
  document.removeEventListener('contextmenu', close)
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('scroll', close, true)
  window.removeEventListener('resize', close)
}

watch(
  () => props.open,
  (open) => {
    detach()
    if (typeof document === 'undefined' || !open) return
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
  },
)

// 组件被卸载（例如切路由）时别把监听留在 document 上
onBeforeUnmount(detach)
</script>
