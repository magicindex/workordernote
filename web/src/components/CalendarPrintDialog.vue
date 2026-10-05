<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6">
        <div class="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" @click="close"></div>

        <section
          class="relative w-full max-w-4xl rounded-2xl border border-border bg-background p-4 shadow-2xl sm:p-6"
          :data-print-orientation="effectiveOrientation"
          :data-print-font="effectiveFontSize"
          :data-print-layout="mode"
          :data-print-columns="mode === 'list' ? activeColumns.length : 0"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-base font-extrabold sm:text-lg">打印日历</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                打印当前显示的这一个月（{{ year }} 年 {{ month }} 月）：
                <b>月历</b>是整月格子、与屏幕一致；<b>列表</b>把本月安排按行列出（和「已完成记录」一样的表格），一页能排更多条。
              </p>
            </div>
            <button class="row-action !opacity-100" aria-label="关闭" @click="close">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>

          <!-- 打印形式：月历格子 / 列表 -->
          <div class="mt-4">
            <p class="text-xs font-bold text-muted-foreground">打印形式</p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <div class="inline-flex rounded-xl border border-border bg-muted/60 p-0.5">
                <button
                  type="button"
                  class="seg-btn"
                  :class="{ active: mode === 'calendar' }"
                  data-print-mode="calendar"
                  @click="setMode('calendar')"
                >月历</button>
                <button
                  type="button"
                  class="seg-btn"
                  :class="{ active: mode === 'list' }"
                  data-print-mode="list"
                  @click="setMode('list')"
                >列表</button>
              </div>
              <span class="text-[11px] font-semibold text-muted-foreground">
                {{ mode === 'calendar' ? '整月格子，和屏幕上看到的一样' : '一行一条，按日期时间排序（像「已完成记录」那样）' }}
              </span>
            </div>
          </div>

          <!-- 打印哪些内容：记事 / 已完成是筛选，两种形式都生效 -->
          <div class="mt-4">
            <p class="text-xs font-bold text-muted-foreground">打印哪些内容</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="opt in toggles"
                :key="opt.key"
                type="button"
                class="channel-pill"
                :class="{ selected: opt.on }"
                :data-print-toggle="opt.key"
                @click="opt.set(!opt.on)"
              >{{ opt.label }}</button>
            </div>
          </div>

          <!-- 列表模式：像「已完成记录」那样勾选要打印的列 -->
          <div v-if="mode === 'list'" class="mt-4">
            <div class="flex items-center justify-between gap-2">
              <p class="text-xs font-bold text-muted-foreground">打印哪些列（已选 {{ selected.length }} / {{ columns.length }}）</p>
              <div class="flex items-center gap-2 text-[11px] font-semibold">
                <button class="text-brand-600 hover:underline dark:text-brand-300" data-print-allcols @click="selectAll">全选</button>
                <span class="text-border">|</span>
                <button class="text-brand-600 hover:underline dark:text-brand-300" data-print-resetcols @click="resetColumns">恢复默认</button>
              </div>
            </div>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="col in columns"
                :key="col.key"
                type="button"
                class="channel-pill"
                :class="{ selected: selected.includes(col.key) }"
                :data-print-col="col.key"
                @click="toggleColumn(col.key)"
              >{{ col.label }}</button>
            </div>
            <p v-if="!selected.length" class="mt-2 text-[11px] font-semibold text-rose-500">至少选一列才能打印</p>
          </div>

          <!-- 版式 -->
          <div class="mt-4 grid gap-3 sm:grid-cols-3">
            <label class="editor-field sm:col-span-1">
              <span>纸张方向</span>
              <select v-model="orientation" aria-label="纸张方向">
                <option value="auto">自动（{{ autoOrientation === 'landscape' ? '横向' : '纵向' }}）</option>
                <option value="portrait">纵向</option>
                <option value="landscape">横向</option>
              </select>
            </label>
            <label class="editor-field sm:col-span-1">
              <span>字号</span>
              <select v-model="fontSize" aria-label="字号">
                <option value="auto">自动（{{ autoFontLabel }}）</option>
                <option value="small">小</option>
                <option value="medium">中</option>
                <option value="large">大</option>
              </select>
            </label>
            <label class="editor-field sm:col-span-1">
              <span>标题</span>
              <input v-model="docTitle" aria-label="打印标题" maxlength="60" placeholder="工作序记 · 日历" />
            </label>
          </div>

          <label class="mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <input v-model="withSummary" type="checkbox" class="h-4 w-4 rounded border-border" />
            在{{ mode === 'calendar' ? '日历' : '表格' }}上方打印说明（月份 / 清单 / 条数 / 打印时间）
          </label>

          <!-- 预览：所见即所得 -->
          <div class="mt-4">
            <p class="mb-2 text-xs font-bold text-muted-foreground">
              预览（打印的就是这一份，共 {{ printedCount }} 条安排{{ mode === 'list' ? '，这里最多显示 8 行' : '' }}）
            </p>
            <div class="max-h-80 overflow-auto rounded-xl border border-border bg-white p-3">
              <div class="print-doc" :class="[`size-${effectiveFontSize}`, mode === 'calendar' ? 'print-cal' : '']">
                <h1 v-if="docTitle">{{ docTitle }}</h1>
                <p v-if="withSummary" class="meta">{{ metaLine }}</p>
                <PrintCalendarGrid v-if="mode === 'calendar'" />
                <table v-else-if="activeColumns.length">
                  <thead>
                    <tr><th v-for="col in activeColumns" :key="col.key" :class="col.cls">{{ col.label }}</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, i) in listRows.slice(0, 8)" :key="row.key">
                      <td v-for="col in activeColumns" :key="col.key" :class="col.cls">{{ col.value(row, i) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="mt-5 flex items-center gap-3">
            <button class="btn-secondary flex-1" @click="close">取消</button>
            <button
              class="btn-primary flex-1"
              :disabled="printing || (mode === 'calendar' ? !weeks.length : (!selected.length || !listRows.length))"
              @click="doPrint"
            >{{ printing ? '打印中…' : '打印' }}</button>
          </div>
        </section>
      </div>
    </Transition>

    <!-- 真正被打印的整页内容：屏幕上看不见，@media print 时只显示它 -->
    <div v-if="modelValue" id="print-root">
      <div class="print-doc" :class="[`size-${effectiveFontSize}`, mode === 'calendar' ? 'print-cal' : '']">
        <h1 v-if="docTitle">{{ docTitle }}</h1>
        <p v-if="withSummary" class="meta">{{ metaLine }}</p>
        <PrintCalendarGrid v-if="mode === 'calendar'" />
        <table v-else-if="activeColumns.length">
          <thead>
            <tr><th v-for="col in activeColumns" :key="col.key" :class="col.cls">{{ col.label }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in listRows" :key="row.key">
              <td v-for="col in activeColumns" :key="col.key" :class="col.cls">{{ col.value(row, i) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { CalendarItem, LunarDayInfo } from '../api/reminder'
import { listColorHex, listInk, listTint } from '../utils/list-colors'

const props = defineProps<{
  modelValue: boolean
  /** 当前这一屏的月历格子（后端返回的整周对齐网格，含相邻月份的补位格） */
  cells: LunarDayInfo[]
  /** 当前这一屏的日历条目（与右侧详情、格子里显示的同源） */
  items: CalendarItem[]
  year: number
  month: number
  /** 顶部说明里的清单筛选（空 = 全部） */
  listLabel: string
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const cellKey = (c: LunarDayInfo) => keyOf(c.year, c.month, c.day)

/**
 * 打印形式：月历格子，或像「已完成记录」那样的列表表格。
 * 注意：手机端进不了日历视图（见 utils/use-narrow），这个弹窗只在电脑上能打开，
 * 所以这里不做窄屏分支——两种情况都要保证和所见即所得一致。
 */
const mode = ref<'calendar' | 'list'>('calendar')
function setMode(next: 'calendar' | 'list') {
  mode.value = next
  syncAutoTitle()
}

// ---- 打印哪些内容（筛选，两种形式都生效）----
const showLunar = ref(true)
const showNotes = ref(true)
const showCompleted = ref(true)
const showTime = ref(false)

// 月历模式：农历标签与格子里的小时间有意义；列表模式这两项由「列」承担，
// 所以只保留「记事 / 已完成」两个筛选。
const toggles = computed(() => {
  const filters = [
    { key: 'notes', label: '记事', on: showNotes.value, set: (v: boolean) => { showNotes.value = v } },
    { key: 'completed', label: '已完成', on: showCompleted.value, set: (v: boolean) => { showCompleted.value = v } },
  ]
  if (mode.value !== 'calendar') return filters
  return [
    { key: 'lunar', label: '农历 / 节气', on: showLunar.value, set: (v: boolean) => { showLunar.value = v } },
    ...filters,
    { key: 'time', label: '时间', on: showTime.value, set: (v: boolean) => { showTime.value = v } },
  ]
})

// ---- 列表模式的列（cls 决定纸上的宽度策略，样式复用「已完成记录」那套 .print-doc 规则）----
interface ListRow { key: string; item: CalendarItem }

function listTime(row: ListRow) {
  const d = new Date(row.item.due_at)
  if (Number.isNaN(d.getTime())) return ''
  if (row.item.all_day && row.item.kind !== 'note') return '全天'
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const weekdayLabel = (row: ListRow) =>
  ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${row.item.due_date}T00:00:00`).getDay()] || ''
const kindLabel = (row: ListRow) => (row.item.kind === 'note' ? '记事' : '提醒')
const statusLabel = (row: ListRow) => (row.item.kind === 'note' ? '记录' : row.item.completed ? '已完成' : '未完成')
const repeatLabel = (row: ListRow) =>
  ({ none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }[row.item.repeat_rule] || row.item.repeat_rule || '不重复')

const columns = [
  { key: 'index', label: '序号', cls: 'col-num', defaultValue: true, value: (_r: ListRow, idx: number) => String(idx + 1) },
  { key: 'date', label: '日期', cls: 'col-time', defaultValue: true, value: (r: ListRow) => r.item.due_date },
  { key: 'weekday', label: '星期', cls: 'col-tight', defaultValue: false, value: (r: ListRow) => weekdayLabel(r) },
  { key: 'time', label: '时间', cls: 'col-time', defaultValue: true, value: (r: ListRow) => listTime(r) },
  { key: 'title', label: '标题', cls: '', defaultValue: true, value: (r: ListRow) => r.item.title },
  { key: 'kind', label: '类型', cls: 'col-tight', defaultValue: true, value: (r: ListRow) => kindLabel(r) },
  { key: 'list', label: '清单', cls: 'col-tight', defaultValue: true, value: (r: ListRow) => r.item.list_name || '—' },
  { key: 'status', label: '状态', cls: 'col-tight', defaultValue: true, value: (r: ListRow) => statusLabel(r) },
  { key: 'repeat', label: '重复', cls: 'col-tight', defaultValue: false, value: (r: ListRow) => repeatLabel(r) },
]
const defaultKeys = () => columns.filter((c) => c.defaultValue).map((c) => c.key)
const selected = ref<string[]>(defaultKeys())
const activeColumns = computed(() => columns.filter((c) => selected.value.includes(c.key)))
function toggleColumn(key: string) {
  selected.value = selected.value.includes(key)
    ? selected.value.filter((k) => k !== key)
    : columns.filter((c) => selected.value.includes(c.key) || c.key === key).map((c) => c.key)
}
function selectAll() { selected.value = columns.map((c) => c.key) }
function resetColumns() { selected.value = defaultKeys() }

// ---- 版式 ----
const orientation = ref<'auto' | 'portrait' | 'landscape'>('auto')
const fontSize = ref<'auto' | 'small' | 'medium' | 'large'>('auto')
const withSummary = ref(true)
const docTitle = ref('')

// 月历是横向铺开的，默认横向更好排；显示时间/记事时字号默认收小一档。
// 列表模式照「已完成记录」的规则：列 ≥5 横排、≥6 收小字号。
const autoOrientation = computed(() => (mode.value === 'calendar'
  ? 'landscape'
  : (activeColumns.value.length >= 5 ? 'landscape' : 'portrait')))
const autoFontSize = computed(() => (mode.value === 'calendar'
  ? ((showTime.value || showNotes.value) ? 'small' : 'medium')
  : (activeColumns.value.length >= 6 ? 'small' : 'medium')))
const autoFontLabel = computed(() => (autoFontSize.value === 'small' ? '小' : '中'))
const effectiveOrientation = computed(() => (orientation.value === 'auto' ? autoOrientation.value : orientation.value))
const effectiveFontSize = computed(() => (fontSize.value === 'auto' ? autoFontSize.value : fontSize.value))

// ---- 筛选与分桶（与日历视图同一口径：后端已按上海时区归到 due_date）----
const filteredItems = computed(() => props.items.filter((item) => {
  if (item.kind === 'note' && !showNotes.value) return false
  if (item.kind !== 'note' && item.completed && !showCompleted.value) return false
  return true
}))

const byDate = computed(() => {
  const map = new Map<string, CalendarItem[]>()
  for (const item of filteredItems.value) {
    const list = map.get(item.due_date)
    if (list) list.push(item)
    else map.set(item.due_date, [item])
  }
  return map
})

const itemsFor = (c: LunarDayInfo) => byDate.value.get(cellKey(c)) || []

/** 后端给的是整周对齐的一维网格，按 7 个一行切出每一周。 */
const weeks = computed(() => {
  const out: LunarDayInfo[][] = []
  for (let i = 0; i < props.cells.length; i += 7) out.push(props.cells.slice(i, i + 7))
  return out
})

/** 列表模式的行：按日期 → 时间 → 标题排序（记事也按它的记录时间参与排序）。 */
const listRows = computed<ListRow[]>(() => filteredItems.value
  .slice()
  .sort((a, b) => (a.due_date === b.due_date
    ? (a.due_at === b.due_at ? a.title.localeCompare(b.title, 'zh') : a.due_at.localeCompare(b.due_at))
    : a.due_date.localeCompare(b.due_date)))
  .map((item) => ({ key: `${item.kind}-${item.id}`, item })))

const printedCount = computed(() => (mode.value === 'calendar'
  ? weeks.value.reduce((n, w) => n + w.reduce((m, c) => m + itemsFor(c).length, 0), 0)
  : listRows.value.length))

const pad2 = (n: number) => String(n).padStart(2, '0')
function formatTime(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const metaLine = computed(() => {
  const rows = filteredItems.value
  const open = rows.filter((i) => i.kind !== 'note' && !i.completed).length
  const done = rows.filter((i) => i.kind !== 'note' && i.completed).length
  const notes = rows.filter((i) => i.kind === 'note').length
  const parts = [
    `月份：${props.year} 年 ${props.month} 月`,
    `清单：${props.listLabel || '全部'}`,
    `共 ${rows.length} 条（未完成 ${open} / 已完成 ${done}${notes ? ` / 记事 ${notes}` : ''}）`,
    `打印时间：${formatTime(new Date().toISOString())}`,
  ]
  return parts.join('　·　')
})

/** 格子里的安排：左侧色条 + 清单同色文字，即使浏览器关了「打印背景」也还能分辨清单。 */
function chipStyle(item: CalendarItem) {
  return {
    borderLeftColor: listColorHex(item.list_color),
    color: listInk(item.list_color),
    background: listTint(item.list_color),
  }
}

function lunarLabel(c: LunarDayInfo) {
  if (c.festival) return c.festival
  if (c.term) return c.term
  return c.lunar
}

function timeLabel(item: CalendarItem) {
  const d = new Date(item.due_at)
  if (Number.isNaN(d.getTime())) return ''
  if (item.kind === 'note') return `记 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (item.all_day) return '全天'
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * 月历格子用渲染函数写一份，预览与打印区共用同一个组件——
 * 复制两份模板最容易「改一处忘一处」，打印出来的和预览看到的不一样。
 */
const PrintCalendarGrid = () => {
  const head = h('div', { class: 'cal-print-weekdays' },
    weekdays.map((w, i) => h('span', { class: i >= 5 ? 'weekend' : '' }, w)))
  const rows = weeks.value.map((week, wi) => {
    const cells = week.map((c) => {
      const chips = itemsFor(c).map((item) => h('li', {
        key: String(item.id),
        class: item.completed && item.kind !== 'note' ? 'done' : '',
        style: chipStyle(item),
      }, [
        item.kind === 'note' ? h('span', { class: 'mark' }, '记') : null,
        showTime.value ? h('span', { class: 't' }, timeLabel(item)) : null,
        h('span', { class: 'ti' }, item.title),
      ]))
      return h('div', { class: ['cal-print-cell', c.in_month ? '' : 'out'], key: cellKey(c) }, [
        h('div', { class: 'cal-print-head' }, [
          h('span', { class: 'd' }, String(c.day)),
          showLunar.value ? h('span', { class: 'l' }, lunarLabel(c)) : null,
        ]),
        h('ul', { class: 'cal-print-tasks' }, chips),
      ])
    })
    return h('div', { class: 'cal-print-row', key: `w${wi}` }, cells)
  })
  return h('div', { class: 'cal-print-body' }, [head, h('div', { class: 'cal-print-grid' }, rows)])
}

function close() { emit('update:modelValue', false) }

// 纸张方向靠 @page 规则，只能在打印前动态塞进文档里
let pageStyleEl: HTMLStyleElement | null = null
function applyPageRule() {
  if (!pageStyleEl) {
    pageStyleEl = document.createElement('style')
    pageStyleEl.id = 'print-page-rule'
    document.head.appendChild(pageStyleEl)
  }
  pageStyleEl.textContent = `@page { size: A4 ${effectiveOrientation.value}; margin: 10mm; }`
}

const printing = ref(false)
async function doPrint() {
  if (mode.value === 'calendar' ? !weeks.value.length : (!selected.value.length || !listRows.value.length)) return
  printing.value = true
  applyPageRule()
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  window.print()
  printing.value = false
}

// 打印完把 @page 规则撤掉，免得影响用户之后自己按 Ctrl+P
function cleanup() {
  if (pageStyleEl) { pageStyleEl.remove(); pageStyleEl = null }
}
window.addEventListener('afterprint', cleanup)

/** 标题是自动生成的（用户手改过就不再覆盖）：月历叫「日历」、列表叫「安排」。 */
const AUTO_TITLE = /^工作序记 · \d{4} 年 \d{1,2} 月 (日历|安排)$/
function autoTitle(y = props.year, m = props.month) {
  return `工作序记 · ${y} 年 ${m} 月 ${mode.value === 'calendar' ? '日历' : '安排'}`
}
function syncAutoTitle() {
  if (!docTitle.value || AUTO_TITLE.test(docTitle.value)) docTitle.value = autoTitle()
}

watch(() => props.modelValue, (open) => {
  if (open) {
    syncAutoTitle()
    applyPageRule()
  } else {
    cleanup()
  }
})

watch([() => props.year, () => props.month], ([y, m]) => {
  if (!docTitle.value || AUTO_TITLE.test(docTitle.value)) docTitle.value = autoTitle(y, m)
})

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
