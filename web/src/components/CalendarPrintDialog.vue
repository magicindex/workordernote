<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6">
        <div class="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" @click="close"></div>

        <section
          class="relative w-full max-w-4xl rounded-2xl border border-border bg-background p-4 shadow-2xl sm:p-6"
          :data-print-orientation="effectiveOrientation"
          :data-print-font="effectiveFontSize"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-base font-extrabold sm:text-lg">打印日历</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                打印当前显示的这一个月（{{ year }} 年 {{ month }} 月），格子里的安排与屏幕上一致；内容多时字号会自动收小。
              </p>
            </div>
            <button class="row-action !opacity-100" aria-label="关闭" @click="close">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>

          <!-- 显示哪些内容 -->
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
            在日历上方打印说明（月份 / 清单 / 条数 / 打印时间）
          </label>

          <!-- 预览：所见即所得 -->
          <div class="mt-4">
            <p class="mb-2 text-xs font-bold text-muted-foreground">预览（打印的就是这一份，共 {{ printedCount }} 条安排）</p>
            <div class="max-h-80 overflow-auto rounded-xl border border-border bg-white p-3">
              <div class="print-doc print-cal" :class="`size-${effectiveFontSize}`">
                <h1 v-if="docTitle">{{ docTitle }}</h1>
                <p v-if="withSummary" class="meta">{{ metaLine }}</p>
                <div class="cal-print-weekdays">
                  <span v-for="(w, i) in weekdays" :key="w" :class="{ weekend: i >= 5 }">{{ w }}</span>
                </div>
                <div class="cal-print-grid">
                  <div v-for="(week, wi) in weeks" :key="wi" class="cal-print-row">
                    <div v-for="c in week" :key="cellKey(c)" class="cal-print-cell" :class="{ out: !c.in_month }">
                      <div class="cal-print-head">
                        <span class="d">{{ c.day }}</span>
                        <span v-if="showLunar" class="l">{{ lunarLabel(c) }}</span>
                      </div>
                      <ul class="cal-print-tasks">
                        <li
                          v-for="item in itemsFor(c)"
                          :key="item.id"
                          :class="{ done: item.completed && item.kind !== 'note' }"
                          :style="chipStyle(item)"
                        >
                          <span v-if="item.kind === 'note'" class="mark">记</span>
                          <span v-if="showTime" class="t">{{ timeLabel(item) }}</span>
                          <span class="ti">{{ item.title }}</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-5 flex items-center gap-3">
            <button class="btn-secondary flex-1" @click="close">取消</button>
            <button class="btn-primary flex-1" :disabled="printing || !weeks.length" @click="doPrint">{{ printing ? '打印中…' : '打印' }}</button>
          </div>
        </section>
      </div>
    </Transition>

    <!-- 真正被打印的整页内容：屏幕上看不见，@media print 时只显示它 -->
    <div v-if="modelValue" id="print-root">
      <div class="print-doc print-cal" :class="`size-${effectiveFontSize}`">
        <h1 v-if="docTitle">{{ docTitle }}</h1>
        <p v-if="withSummary" class="meta">{{ metaLine }}</p>
        <div class="cal-print-weekdays">
          <span v-for="(w, i) in weekdays" :key="w" :class="{ weekend: i >= 5 }">{{ w }}</span>
        </div>
        <div class="cal-print-grid">
          <div v-for="(week, wi) in weeks" :key="wi" class="cal-print-row">
            <div v-for="c in week" :key="cellKey(c)" class="cal-print-cell" :class="{ out: !c.in_month }">
              <div class="cal-print-head">
                <span class="d">{{ c.day }}</span>
                <span v-if="showLunar" class="l">{{ lunarLabel(c) }}</span>
              </div>
              <ul class="cal-print-tasks">
                <li
                  v-for="item in itemsFor(c)"
                  :key="item.id"
                  :class="{ done: item.completed && item.kind !== 'note' }"
                  :style="chipStyle(item)"
                >
                  <span v-if="item.kind === 'note'" class="mark">记</span>
                  <span v-if="showTime" class="t">{{ timeLabel(item) }}</span>
                  <span class="ti">{{ item.title }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
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

// ---- 打印哪些内容 ----
const showLunar = ref(true)
const showNotes = ref(true)
const showCompleted = ref(true)
const showTime = ref(false)

const toggles = computed(() => [
  { key: 'lunar', label: '农历 / 节气', on: showLunar.value, set: (v: boolean) => { showLunar.value = v } },
  { key: 'notes', label: '记事', on: showNotes.value, set: (v: boolean) => { showNotes.value = v } },
  { key: 'completed', label: '已完成', on: showCompleted.value, set: (v: boolean) => { showCompleted.value = v } },
  { key: 'time', label: '时间', on: showTime.value, set: (v: boolean) => { showTime.value = v } },
])

// ---- 版式 ----
const orientation = ref<'auto' | 'portrait' | 'landscape'>('auto')
const fontSize = ref<'auto' | 'small' | 'medium' | 'large'>('auto')
const withSummary = ref(true)
const docTitle = ref('')

// 月历是横向铺开的，默认横向更好排；显示时间/记事时字号默认收小一档。
const autoOrientation = computed(() => 'landscape')
const autoFontSize = computed(() => ((showTime.value || showNotes.value) ? 'small' : 'medium'))
const autoFontLabel = computed(() => (autoFontSize.value === 'small' ? '小' : '中'))
const effectiveOrientation = computed(() => (orientation.value === 'auto' ? autoOrientation.value : orientation.value))
const effectiveFontSize = computed(() => (fontSize.value === 'auto' ? autoFontSize.value : fontSize.value))

// ---- 数据分桶（与日历视图同一口径：后端已按上海时区归到 due_date） ----
const byDate = computed(() => {
  const map = new Map<string, CalendarItem[]>()
  for (const item of props.items) {
    if (item.kind === 'note' && !showNotes.value) continue
    if (item.kind !== 'note' && item.completed && !showCompleted.value) continue
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

const printedCount = computed(() => weeks.value.reduce((n, w) => n + w.reduce((m, c) => m + itemsFor(c).length, 0), 0))

const pad2 = (n: number) => String(n).padStart(2, '0')
function formatTime(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const metaLine = computed(() => {
  const monthItems = props.items.filter((i) => (i.kind !== 'note' || showNotes.value) && !(i.kind !== 'note' && i.completed && !showCompleted.value))
  const open = monthItems.filter((i) => i.kind !== 'note' && !i.completed).length
  const done = monthItems.filter((i) => i.kind !== 'note' && i.completed).length
  const notes = monthItems.filter((i) => i.kind === 'note').length
  const parts = [
    `月份：${props.year} 年 ${props.month} 月`,
    `清单：${props.listLabel || '全部'}`,
    `共 ${monthItems.length} 条（未完成 ${open} / 已完成 ${done}${notes ? ` / 记事 ${notes}` : ''}）`,
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
  if (!weeks.value.length) return
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

watch(() => props.modelValue, (open) => {
  if (open) {
    if (!docTitle.value) docTitle.value = `工作序记 · ${props.year} 年 ${props.month} 月 日历`
    applyPageRule()
  } else {
    cleanup()
  }
})

// 标题里的月份跟着翻月走（用户手动改过就不再覆盖）
watch([() => props.year, () => props.month], ([y, m]) => {
  const auto = /^工作序记 · \d{4} 年 \d{1,2} 月 日历$/
  if (!docTitle.value || auto.test(docTitle.value)) docTitle.value = `工作序记 · ${y} 年 ${m} 月 日历`
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
