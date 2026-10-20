<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6">
        <div class="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" @click="close"></div>

        <section
          class="relative w-full max-w-3xl rounded-2xl border border-border bg-background p-4 shadow-2xl sm:p-6"
          :data-print-orientation="effectiveOrientation"
          :data-print-font="effectiveFontSize"
          :data-print-columns="activeColumns.length"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-base font-extrabold sm:text-lg">打印完成记录</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                勾选要打印的列，表格会按内容自动排布（列多时自动横排、字号自动收小）。
              </p>
            </div>
            <button class="row-action !opacity-100" aria-label="关闭" @click="close">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>

          <!-- 选择列 -->
          <div class="mt-4">
            <div class="flex items-center justify-between gap-2">
              <p class="text-xs font-bold text-muted-foreground">打印哪些列（已选 {{ selected.length }} / {{ columns.length }}）</p>
              <div class="flex items-center gap-2 text-[11px] font-semibold">
                <button class="text-brand-600 hover:underline dark:text-brand-300" @click="selectAll">全选</button>
                <span class="text-border">|</span>
                <button class="text-brand-600 hover:underline dark:text-brand-300" @click="resetColumns">恢复默认</button>
              </div>
            </div>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="col in columns"
                :key="col.key"
                type="button"
                class="channel-pill"
                :class="{ selected: selected.includes(col.key) }"
                @click="toggle(col.key)"
              >{{ col.label }}</button>
            </div>
            <p v-if="!selected.length" class="mt-2 text-[11px] font-semibold text-rose-500">至少选一列才能打印</p>
          </div>

          <!-- 版式 -->
          <div class="mt-4 grid gap-3 sm:grid-cols-3">
            <label class="editor-field sm:col-span-1">
              <span>纸张方向</span>
              <select v-model="orientation">
                <option value="auto">自动（{{ autoOrientation === 'landscape' ? '横向' : '纵向' }}）</option>
                <option value="portrait">纵向</option>
                <option value="landscape">横向</option>
              </select>
            </label>
            <label class="editor-field sm:col-span-1">
              <span>字号</span>
              <select v-model="fontSize">
                <option value="auto">自动（{{ autoFontLabel }}）</option>
                <option value="small">小</option>
                <option value="medium">中</option>
                <option value="large">大</option>
              </select>
            </label>
            <label class="editor-field sm:col-span-1">
              <span>标题</span>
              <input v-model="docTitle" maxlength="60" placeholder="工作序记 · 已完成记录" />
            </label>
          </div>

          <label class="mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <input v-model="withSummary" type="checkbox" class="h-4 w-4 rounded border-border" />
            在表格上方打印筛选说明（时间段 / 清单 / 条数 / 打印时间）
          </label>

          <!-- 预览：所见即所得，先看清再打印 -->
          <div class="mt-4">
            <p class="mb-2 text-xs font-bold text-muted-foreground">预览（最多 8 行，实际打印 {{ items.length }} 行）</p>
            <div class="max-h-64 overflow-auto rounded-xl border border-border bg-white p-3">
              <div class="print-doc" :class="`size-${effectiveFontSize}`">
                <h1 v-if="docTitle">{{ docTitle }}</h1>
                <p v-if="withSummary" class="meta">{{ metaLine }}</p>
                <table>
                  <thead>
                    <tr><th v-for="col in activeColumns" :key="col.key" :class="col.cls">{{ col.label }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(item, i) in items.slice(0, 8)" :key="`${item.source}-${item.id}`">
                      <td v-for="col in activeColumns" :key="col.key" :class="col.cls">{{ col.value(item, i) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="mt-5 flex items-center gap-3">
            <button class="btn-secondary flex-1" @click="close">取消</button>
            <button class="btn-primary flex-1" :disabled="!selected.length || printing" @click="doPrint">{{ printing ? '打印中…' : '打印' }}</button>
          </div>
        </section>
      </div>
    </Transition>

    <!-- 真正被打印的整页内容：屏幕上看不见，@media print 时只显示它 -->
    <div v-if="modelValue" id="print-root">
      <div class="print-doc" :class="`size-${effectiveFontSize}`">
        <h1 v-if="docTitle">{{ docTitle }}</h1>
        <p v-if="withSummary" class="meta">{{ metaLine }}</p>
        <table>
          <thead>
            <tr><th v-for="col in activeColumns" :key="col.key" :class="col.cls">{{ col.label }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in items" :key="`${item.source}-${item.id}`">
              <td v-for="col in activeColumns" :key="col.key" :class="col.cls">{{ col.value(item, i) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { CompletedItem } from '../api/reminder'

const props = defineProps<{
  modelValue: boolean
  /** 要打印的行：就是当前屏幕上这份筛选结果 */
  items: CompletedItem[]
  /** 顶部说明里的上下文：时间段区间、清单筛选、站点名 */
  rangeLabel: string
  listLabel: string
  siteTitle: string
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const pad = (n: number) => String(n).padStart(2, '0')
function formatTime(value: string | null | undefined, withTime = true) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date
}
const kindLabel = (item: CompletedItem) => (item.kind === 'note' ? '记事' : '提醒')
const repeatLabel = (rule: string) => ({
  none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年',
}[rule] || rule || '不重复')
const sourceLabel = (item: CompletedItem) =>
  (item.source === 'history' ? '重复提醒的完成' : '提醒完成') + (item.reminder_exists ? '' : '（提醒已删除）')

/** 可打印的列。cls 决定这一列在纸上的宽度策略：
 *  col-num 只占 1%；col-time 不换行（日期时间断行会很难读）；标题列留 auto 自动分配并允许折行。 */
const columns = [
  { key: 'index', label: '序号', cls: 'col-num', defaultValue: true, value: (_i: CompletedItem, idx: number) => String(idx + 1) },
  { key: 'title', label: '标题', cls: '', defaultValue: true, value: (i: CompletedItem) => i.title },
  { key: 'kind', label: '类型', cls: 'col-tight', defaultValue: true, value: (i: CompletedItem) => kindLabel(i) },
  { key: 'list', label: '清单', cls: 'col-tight', defaultValue: true, value: (i: CompletedItem) => i.list_name || '—' },
  { key: 'completed', label: '完成时间', cls: 'col-time', defaultValue: true, value: (i: CompletedItem) => formatTime(i.completed_at) },
  { key: 'scheduled', label: '原定时间', cls: 'col-time', defaultValue: false, value: (i: CompletedItem) => formatTime(i.scheduled_for) || '—' },
  { key: 'repeat', label: '重复', cls: 'col-tight', defaultValue: false, value: (i: CompletedItem) => repeatLabel(i.repeat_rule) },
  { key: 'source', label: '记录来源', cls: 'col-tight', defaultValue: false, value: (i: CompletedItem) => sourceLabel(i) },
]

const defaultKeys = () => columns.filter((c) => c.defaultValue).map((c) => c.key)
const selected = ref<string[]>(defaultKeys())
const orientation = ref<'auto' | 'portrait' | 'landscape'>('auto')
const fontSize = ref<'auto' | 'small' | 'medium' | 'large'>('auto')
const withSummary = ref(true)
const docTitle = ref('工作序记 · 已完成记录')

const activeColumns = computed(() => columns.filter((c) => selected.value.includes(c.key)))

// 「按内容自适应」：列多就自动横排 + 收小字号，列少就纵向 + 正常字号。
// 用户手动选了具体值就听用户的，选「自动」才用这里的推断。
const autoOrientation = computed(() => (activeColumns.value.length >= 5 ? 'landscape' : 'portrait'))
const autoFontSize = computed(() => (activeColumns.value.length >= 6 ? 'small' : 'medium'))
const autoFontLabel = computed(() => (autoFontSize.value === 'small' ? '小' : '中'))
const effectiveOrientation = computed(() => (orientation.value === 'auto' ? autoOrientation.value : orientation.value))
const effectiveFontSize = computed(() => (fontSize.value === 'auto' ? autoFontSize.value : fontSize.value))

const metaLine = computed(() => {
  const parts = [
    `时间段：${props.rangeLabel || '不限时间'}`,
    props.listLabel ? `清单：${props.listLabel}` : '清单：全部',
    `共 ${props.items.length} 条`,
    `打印时间：${formatTime(new Date().toISOString())}`,
  ]
  return parts.join('　·　')
})

function toggle(key: string) {
  selected.value = selected.value.includes(key)
    ? selected.value.filter((k) => k !== key)
    : columns.filter((c) => selected.value.includes(c.key) || c.key === key).map((c) => c.key)
}
function selectAll() { selected.value = columns.map((c) => c.key) }
function resetColumns() { selected.value = defaultKeys() }

function close() { emit('update:modelValue', false) }

// 纸张方向靠 @page 规则，只能在打印前动态塞进文档里
let pageStyleEl: HTMLStyleElement | null = null
function applyPageRule() {
  if (!pageStyleEl) {
    pageStyleEl = document.createElement('style')
    pageStyleEl.id = 'print-page-rule'
    document.head.appendChild(pageStyleEl)
  }
  pageStyleEl.textContent = `@page { size: A4 ${effectiveOrientation.value}; margin: 12mm; }`
}

const printing = ref(false)
async function doPrint() {
  if (!selected.value.length) return
  printing.value = true
  applyPageRule()
  await nextTick()
  // 让浏览器先把 #print-root 排好版再调起打印
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  window.print()
  printing.value = false
}

// 打印完把 @page 规则撤掉，免得影响用户之后自己按 Ctrl+P
function cleanup() {
  if (pageStyleEl) { pageStyleEl.remove(); pageStyleEl = null }
}
window.addEventListener('afterprint', cleanup)

watch(() => props.modelValue, (open) => {
  if (open) {
    if (!selected.value.length) selected.value = defaultKeys()
    if (!docTitle.value) docTitle.value = '工作序记 · 已完成记录'
    applyPageRule()
  } else {
    cleanup()
  }
})

// 列数变化会影响自动方向/字号，@page 规则要跟着更新
watch([effectiveOrientation, effectiveFontSize], () => {
  if (props.modelValue) applyPageRule()
})

onBeforeUnmount(() => {
  window.removeEventListener('afterprint', cleanup)
  cleanup()
})
</script>

<style scoped>
.editor-field { @apply block text-xs font-bold text-muted-foreground; }
.editor-field input, .editor-field select { @apply mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground outline-none transition focus:border-brand-500/45 focus:ring-4 focus:ring-brand-500/10 sm:rounded-2xl; }
</style>
