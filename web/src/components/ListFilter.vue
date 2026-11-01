<template>
  <div ref="root" data-list-filter class="relative flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
    <span class="shrink-0 text-[11px] font-bold text-muted-foreground">清单</span>
    <button
      type="button"
      class="quick-chip shrink-0"
      :class="{ active: modelValue.length === 0 }"
      :title="'显示全部清单'"
      @click="emit('update:modelValue', [])"
    >全部
      <span v-if="allOpenCount" class="tabular-nums opacity-70">{{ allOpenCount }}</span>
    </button>
    <button
      v-for="list in visibleLists"
      :key="list.id"
      type="button"
      data-list-chip
      class="quick-chip shrink-0"
      :class="{ active: modelValue.includes(list.id) }"
      :title="modelValue.includes(list.id) ? `不再显示「${list.name}」` : `只显示「${list.name}」`"
      @click="toggle(list.id)"
    >
      <ListIcon :name="list.icon" :size="13" :style="{ color: color(list.color) }" />
      <span class="max-w-[7rem] truncate">{{ list.name }}</span>
      <span v-if="list.open_count" class="tabular-nums opacity-70">{{ list.open_count }}</span>
    </button>
    <div v-if="overflowLists.length" class="relative shrink-0" :class="moreAlignEnd ? 'ml-auto' : ''">
      <button
        type="button"
        class="quick-chip"
        :class="{ active: selectedOverflow > 0 }"
        :aria-expanded="open"
        aria-haspopup="menu"
        title="清单太多，收进下拉菜单"
        data-list-filter-more
        @click="open = !open"
      >
        更多
        <span v-if="selectedOverflow" class="tabular-nums">· {{ selectedOverflow }}</span>
        <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div
        v-if="open"
        class="surface absolute right-0 top-full z-50 mt-1 max-h-72 w-56 overflow-y-auto rounded-xl p-1 shadow-xl"
        role="menu"
        data-list-filter-menu
      >
        <button
          v-for="list in overflowLists"
          :key="list.id"
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium hover:bg-muted/70"
          :class="{ 'bg-brand-500/10 text-brand-600 dark:text-brand-300': modelValue.includes(list.id) }"
          role="menuitemcheckbox"
          :aria-checked="modelValue.includes(list.id)"
          @click="toggle(list.id)"
        >
          <ListIcon :name="list.icon" :size="14" :style="{ color: color(list.color) }" />
          <span class="min-w-0 flex-1 truncate">{{ list.name }}</span>
          <span v-if="list.open_count" class="shrink-0 tabular-nums text-[11px] text-muted-foreground">{{ list.open_count }}</span>
          <svg v-if="modelValue.includes(list.id)" viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" aria-hidden="true"><path d="m5 12 4 4 10-10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ReminderList } from '../api/reminder'
import ListIcon from './ListIcon.vue'
import { listColorHex } from '../utils/list-colors'

const props = defineProps<{
  /** 要筛选的清单；空数组表示全部（不筛选） */
  modelValue: number[]
  lists: ReminderList[]
  /** 让「更多」贴到容器最右侧（日历工具条用）。 */
  moreAlignEnd?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number[]]
}>()

// 与侧栏同一套色名映射，保证同一清单处处同色
// 清单色表在 utils/list-colors.ts：筛选芯片、侧栏图标、任务标题、日历图标同色。
const color = listColorHex
const allOpenCount = computed(() => props.lists.reduce((n, l) => n + (l.open_count || 0), 0))

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const inlineCount = ref(1)
let measuring = false
let pendingMeasure = false

/** 先临时全部展开，量出每颗芯片的真实宽度，再把装不下的收进「更多」；窗口/清单变化时重算。 */
async function recalcInline() {
  const el = root.value
  if (!el) return
  if (measuring) { pendingMeasure = true; return }
  measuring = true
  const prev = inlineCount.value
  inlineCount.value = Math.max(1, props.lists.length)
  await nextTick()
  const right = el.getBoundingClientRect().right
  const chips = [...el.querySelectorAll('[data-list-chip]')] as HTMLElement[]
  // 先看「不预留更多」时能不能全部放下：能就全展开，不显示更多按钮。
  if (chips.every((chip) => chip.getBoundingClientRect().right <= right - 14)) {
    inlineCount.value = props.lists.length
    measuring = false
    await nextTick()
    if (pendingMeasure) { pendingMeasure = false; void recalcInline() }
    return
  }
  const more = el.querySelector('[data-list-filter-more]') as HTMLElement | null
  const moreW = more?.offsetWidth || 76
  const limit = right - moreW - 14
  let fit = 0
  for (const chip of chips) {
    if (chip.getBoundingClientRect().right <= limit) fit++
    else break
  }
  const next = Math.max(1, Math.min(fit, props.lists.length))
  inlineCount.value = next === prev && next === props.lists.length ? prev : next
  measuring = false
  await nextTick()
  if (pendingMeasure) { pendingMeasure = false; void recalcInline() }
}

const visibleLists = computed(() => props.lists.slice(0, inlineCount.value))
const overflowLists = computed(() => props.lists.slice(visibleLists.value.length))
const selectedOverflow = computed(() => overflowLists.value.filter((l) => props.modelValue.includes(l.id)).length)

// 多选：点一下加入，再点一下移出；全移出等于「全部」。
function toggle(id: number) {
  const next = props.modelValue.includes(id)
    ? props.modelValue.filter((x) => x !== id)
    : [...props.modelValue, id]
  emit('update:modelValue', next)
}

function onPointerDown(ev: PointerEvent) {
  if (open.value && root.value && !root.value.contains(ev.target as Node)) open.value = false
}
function onKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Escape') open.value = false
}

let ro: ResizeObserver | null = null
onMounted(() => {
  void recalcInline()
  if (root.value) {
    ro = new ResizeObserver(() => { void recalcInline() })
    ro.observe(root.value)
  }
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeydown)
})
watch(() => props.lists.map((l) => l.id).join(','), () => { void recalcInline() })
onBeforeUnmount(() => {
  ro?.disconnect()
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>
