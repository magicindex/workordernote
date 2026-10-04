<template>
  <div class="animate-fade-in flex flex-col gap-2.5 lg:min-h-[calc(100dvh-8.5rem)]" :style="{ '--cal-task-font': calendarFontPx + 'px' }">
    <!-- 不再单独放一个页头：顶栏和侧栏已经表明当前在日历，重复的标题+描述白占 52px
         （外加两段 24px 间距），把这段还给日历格子。 -->
    <div v-if="errorMsg" class="surface rounded-2xl px-5 py-3 text-sm text-destructive">
      {{ errorMsg }}
    </div>

    <!-- 工具条：翻月 / 回今天 / 计数 -->
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div class="flex items-center gap-1.5 sm:gap-2">
        <button class="icon-button" aria-label="上个月" @click="shiftMonth(-1)">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m15 6-6 6 6 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn-secondary !h-9 !px-3 !text-xs sm:!text-sm" @click="goToday">今天</button>
        <button class="icon-button" aria-label="下个月" @click="shiftMonth(1)">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m9 6 6 6-6 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <h2 class="ml-1 text-base font-extrabold tracking-tight sm:text-lg">{{ monthTitle }}</h2>
        <span v-if="lunarYearName" class="hidden text-xs font-semibold text-muted-foreground md:inline">{{ lunarYearName }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <!-- 选择哪些清单显示在日历里；不选=全部。选择记在本地。 -->
        <ListFilter v-model="listFilter" :lists="lists" />
        <div class="flex items-center gap-3 text-[11px] font-semibold text-muted-foreground sm:text-xs">
          <span class="inline-flex items-center gap-1.5"><i class="h-2 w-2 rounded-full bg-brand-500"></i>未完成 {{ openCount }}</span>
          <span class="inline-flex items-center gap-1.5"><i class="h-2 w-2 rounded-full bg-emerald-500"></i>已完成 {{ doneCount }}</span>
        </div>
      </div>
    </div>

    <div class="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <!-- 月历网格 -->
      <section class="surface flex min-h-0 flex-col overflow-hidden rounded-2xl p-2 sm:p-3">
        <div class="grid grid-cols-7 gap-1 pb-1.5">
          <div
            v-for="(w, i) in weekdays"
            :key="w"
            class="py-1 text-center text-[11px] font-bold sm:text-xs"
            :class="i >= 5 ? 'text-rose-500/85' : 'text-muted-foreground'"
          >{{ w }}</div>
        </div>

        <div v-if="loading && !cells.length" class="grid flex-1 grid-cols-7 gap-1">
          <div v-for="n in 35" :key="n" class="min-h-[4.5rem] animate-pulse rounded-xl bg-muted/70"></div>
        </div>

        <div v-else class="grid flex-1 auto-rows-fr grid-cols-7 gap-1">
          <button
            v-for="cell in cells"
            :key="cellKey(cell)"
            type="button"
            class="cal-cell group flex flex-col rounded-xl border p-1 text-left transition sm:p-1.5"
            :class="cellClass(cell)"
            @click="selectedDate = cellKey(cell)"
          >
            <div class="flex items-start justify-between gap-1">
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none sm:h-6 sm:w-6 sm:text-xs"
                :class="dayNumberClass(cell)"
              >{{ cell.day }}</span>
              <span
                v-if="lunarLabel(cell)"
                class="mt-0.5 truncate text-[9px] font-semibold leading-none sm:text-[10px]"
                :class="lunarClass(cell)"
              >{{ lunarLabel(cell) }}</span>
            </div>

            <!-- 桌面：显示提醒标题；手机：只显示圆点 -->
            <div class="mt-1 hidden min-w-0 flex-1 flex-col gap-0.5 sm:flex">
              <span
                v-for="item in visibleItems(cell)"
                :key="item.id"
                class="cal-task flex min-w-0 items-center gap-1 rounded-md px-1 py-[1px] font-semibold leading-tight"
                :class="{ 'opacity-55 line-through': item.completed }"
                :style="{ background: tint(item.list_color), color: ink(item.list_color) }"
              >
                <i class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ background: dot(item.list_color) }"></i>
                <span class="truncate">{{ item.title }}</span>
              </span>
              <span v-if="extraCount(cell) > 0" class="cal-task px-1 font-bold text-muted-foreground">+{{ extraCount(cell) }}</span>
            </div>
            <div class="mt-auto flex flex-wrap gap-0.5 pt-0.5 sm:hidden">
              <i
                v-for="item in visibleItems(cell).slice(0, 4)"
                :key="item.id"
                class="h-1.5 w-1.5 rounded-full"
                :class="{ 'opacity-45': item.completed }"
                :style="{ background: dot(item.list_color) }"
              ></i>
            </div>
          </button>
        </div>
      </section>

      <!-- 选中日详情 -->
      <aside class="surface flex min-h-0 flex-col rounded-2xl p-3 sm:p-4">
        <div class="flex items-baseline justify-between gap-2">
          <h3 class="text-sm font-extrabold sm:text-base">{{ selectedTitle }}</h3>
          <span v-if="selectedLunar" class="text-[11px] font-semibold text-muted-foreground">{{ selectedLunar }}</span>
        </div>
        <p v-if="selectedTags.length" class="mt-1 flex flex-wrap gap-1">
          <span v-for="tag in selectedTags" :key="tag.text" class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="tag.cls">{{ tag.text }}</span>
        </p>

        <div v-if="loading && !items.length" class="mt-3 space-y-2">
          <div v-for="n in 3" :key="n" class="h-12 animate-pulse rounded-xl bg-muted/70"></div>
        </div>

        <div v-else-if="selectedItems.length" class="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
          <article
            v-for="item in selectedItems"
            :key="item.id"
            class="flex items-start gap-2 rounded-xl border border-border/70 bg-surface/60 p-2 transition hover:border-brand-500/35"
          >
            <button
              class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition"
              :class="item.completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-brand-500/30 text-transparent hover:border-brand-500'"
              :aria-label="item.completed ? '恢复提醒' : '完成提醒'"
              @click="toggle(item)"
            >
              <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor"><path d="m6 12 4 4 8-9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="min-w-0 flex-1 text-left" @click="openEditor(item)">
              <div class="flex items-center gap-1.5">
                <h4 class="cal-task-lg truncate font-bold" :class="{ 'line-through opacity-60': item.completed }">{{ item.title }}</h4>
                <span v-if="item.priority" class="shrink-0 text-[10px] font-black text-rose-500">{{ '!'.repeat(item.priority) }}</span>
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <span>{{ timeLabel(item) }}</span>
                <span v-if="item.repeat_rule && item.repeat_rule !== 'none'" class="tiny-badge">{{ ruleLabel(item.repeat_rule) }}</span>
              </div>
              <div class="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <i class="h-2 w-2 rounded-full" :style="{ background: dot(item.list_color) }"></i>
                <span class="truncate">{{ item.list_name }}</span>
              </div>
            </button>
            <span class="row-action !opacity-100" title="在列表中编辑" @click="openEditor(item)">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </article>
        </div>

        <p v-else class="mt-4 flex-1 text-sm text-muted-foreground">这天没有安排。</p>

        <p class="mt-3 border-t border-border/60 pt-2.5 text-[11px] leading-4 text-muted-foreground">
          点标题就地编辑；勾选即完成，重复提醒会自动排到下一次。
        </p>
      </aside>
    </div>

    <!-- 与列表页共用同一个提醒编辑器，改一处两边同时生效 -->
    <ReminderEditor
      v-model="editorOpen"
      :reminder-id="editingId"
      :lists="lists"
      :channels="channels"
      @saved="onEditorSaved"
    />

    <Toast :message="toast.message" :type="toast.type" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import ListFilter from '../components/ListFilter.vue'
import ReminderEditor from '../components/ReminderEditor.vue'
import Toast from '../components/Toast.vue'
import { getAllConfigs } from '../api/config'
import {
  completeReminder, getCalendarItems, getChannelStatuses, getLists, getLunarCalendar, listIdsParam, restoreReminder,
  type CalendarItem, type ChannelStatus, type LunarDayInfo, type ReminderList,
} from '../api/reminder'

const toast = reactive<{ message: string; type: 'success' | 'error' }>({ message: '', type: 'success' })
function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.message = ''
  setTimeout(() => Object.assign(toast, { message, type }), 0)
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

const now = new Date()
const cursor = ref({ year: now.getFullYear(), month: now.getMonth() + 1 })
const cells = ref<LunarDayInfo[]>([])
const items = ref<CalendarItem[]>([])
const selectedDate = ref(keyOf(now.getFullYear(), now.getMonth() + 1, now.getDate()))
const loading = ref(false)
const errorMsg = ref('')
const saving = ref(false)

// 编码器需要清单与通知渠道列表
const lists = ref<ReminderList[]>([])
const channels = ref<ChannelStatus[]>([])
const editorOpen = ref(false)
const editingId = ref<number | null>(null)

// 日历任务字号：读「偏好设置 → 日历任务字号」，映射成像素后用 CSS 变量下发，
// 格子里的小字、详情面板的标题、格子最小高度都跟着它走。
// 日历里显示哪些清单；空数组 = 全部。跟人走、跟设备走，存本地即可。
const FILTER_KEY = 'ui_calendar_lists'
const listFilter = ref<number[]>(readFilter())
function readFilter(): number[] {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((n) => typeof n === 'number' && n > 0) : []
  } catch { return [] }
}
watch(listFilter, (v) => {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(v)) } catch { /* 隐私模式忽略 */ }
  void load()
})

const FONT_SIZES: Record<string, number> = { small: 9, medium: 10, large: 12, xlarge: 13 }
const fontSizeKey = ref('medium')
const calendarFontPx = computed(() => FONT_SIZES[fontSizeKey.value] ?? FONT_SIZES.medium)

const monthTitle = computed(() => `${cursor.value.year} 年 ${cursor.value.month} 月`)
const lunarYearName = computed(() => cells.value.find(c => c.lunar_year_name)?.lunar_year_name || '')

const cellKey = (c: LunarDayInfo) => keyOf(c.year, c.month, c.day)
const isToday = (c: LunarDayInfo) => cellKey(c) === keyOf(now.getFullYear(), now.getMonth() + 1, now.getDate())

// 后端已经按上海时区把每条提醒归到 due_date，这里直接按字符串分桶，
// 不用浏览器时区换算，避免非 +08 时区打开时整体错一天。
const byDate = computed(() => {
  const map = new Map<string, CalendarItem[]>()
  for (const item of items.value) {
    const list = map.get(item.due_date)
    if (list) list.push(item)
    else map.set(item.due_date, [item])
  }
  return map
})
const selectedItems = computed(() => byDate.value.get(selectedDate.value) || [])

const openCount = computed(() => items.value.filter(i => !i.completed).length)
const doneCount = computed(() => items.value.filter(i => i.completed).length)

const selectedCell = computed(() => cells.value.find(c => cellKey(c) === selectedDate.value))
const selectedTitle = computed(() => {
  const c = selectedCell.value
  if (!c) return selectedDate.value
  const d = new Date(c.year, c.month - 1, c.day)
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${c.month} 月 ${c.day} 日 周${week}`
})
const selectedLunar = computed(() => {
  const c = selectedCell.value
  if (!c) return ''
  return [c.lunar, c.term, c.festival].filter(Boolean).join(' · ')
})
const selectedTags = computed(() => {
  const c = selectedCell.value
  if (!c) return [] as { text: string; cls: string }[]
  const tags: { text: string; cls: string }[] = []
  if (c.festival) tags.push({ text: c.festival, cls: 'bg-rose-500/12 text-rose-500' })
  if (c.term) tags.push({ text: c.term, cls: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' })
  return tags
})

// 月历单元格里最多铺 3 条，其余折成 +N；手机上只显示圆点。
const MAX_CHIPS = 3
function visibleItems(c: LunarDayInfo) {
  return (byDate.value.get(cellKey(c)) || []).slice(0, MAX_CHIPS)
}
function extraCount(c: LunarDayInfo) {
  return Math.max(0, (byDate.value.get(cellKey(c)) || []).length - MAX_CHIPS)
}

// 农历标签优先显示节日/节气，其次才是农历日名——节日节气更值得一眼看到。
function lunarLabel(c: LunarDayInfo) {
  if (c.festival) return c.festival
  if (c.term) return c.term
  if (c.lunar_day === 1) return c.lunar
  return c.lunar
}
function lunarClass(c: LunarDayInfo) {
  if (c.festival) return 'text-rose-500'
  if (c.term) return 'text-emerald-600 dark:text-emerald-400'
  return 'text-muted-foreground/85'
}
function cellClass(c: LunarDayInfo) {
  const selected = cellKey(c) === selectedDate.value
  if (selected) return 'border-brand-500/60 bg-brand-500/8 ring-2 ring-brand-500/25'
  if (!c.in_month) return 'border-transparent bg-transparent opacity-45 hover:bg-muted/60'
  return 'border-border/60 bg-surface/50 hover:border-brand-500/35 hover:bg-muted/60'
}
function dayNumberClass(c: LunarDayInfo) {
  if (isToday(c)) return 'bg-brand-500 text-white shadow-sm'
  if (cellKey(c) === selectedDate.value) return 'text-brand-600 dark:text-brand-300'
  return 'text-foreground'
}

const COLORS: Record<string, string> = {
  blue: '#3182f6', violet: '#8b5cf6', rose: '#f43f5e', amber: '#f59e0b', emerald: '#10b981',
}
const hex = (name: string) => COLORS[name] || COLORS.blue
// 用清单色做浅底 + 深字，同一清单在日历里和侧栏同色。
const tint = (name: string) => `${hex(name)}1f`
const ink = (name: string) => hex(name)
const dot = (name: string) => hex(name)

function timeLabel(item: CalendarItem) {
  if (item.all_day) return '全天'
  const d = new Date(item.due_at)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
function ruleLabel(rule: string) {
  return ({ daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' } as Record<string, string>)[rule] || '循环'
}

const rangeStart = computed(() => (cells.value.length ? cellKey(cells.value[0]) : ''))
const rangeEnd = computed(() => {
  if (!cells.value.length) return ''
  const last = cells.value[cells.value.length - 1]
  const d = new Date(last.year, last.month - 1, last.day + 1)
  return keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())
})

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    // 农历接口直接返回「周一起始、整周对齐」的网格，含相邻月份的格子，
    // 所以日历网格不用自己算，节气/节日标签也是现成的。
    const lunarRes = await getLunarCalendar(cursor.value.year, cursor.value.month)
    cells.value = lunarRes.data?.data?.days || []
    if (!cells.value.length) {
      items.value = []
      return
    }
    const res = await getCalendarItems({
      from: rangeStart.value,
      to: rangeEnd.value,
      list_ids: listIdsParam(listFilter.value),
    })
    items.value = res.data?.data || []
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '加载日历失败'
  } finally {
    loading.value = false
  }
}

function shiftMonth(delta: number) {
  const d = new Date(cursor.value.year, cursor.value.month - 1 + delta, 1)
  cursor.value = { year: d.getFullYear(), month: d.getMonth() + 1 }
  load()
}
function goToday() {
  const d = new Date()
  cursor.value = { year: d.getFullYear(), month: d.getMonth() + 1 }
  selectedDate.value = keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())
  load()
}

async function toggle(item: CalendarItem) {
  if (saving.value) return
  saving.value = true
  try {
    if (item.completed) await restoreReminder(item.id)
    else await completeReminder(item.id)
    await load()
    showToast(item.completed ? '已恢复提醒' : item.repeat_rule !== 'none' ? '已完成，下一次提醒已安排' : '做得好，已完成')
  } catch (err: any) {
    showToast(err.response?.data?.message || '操作失败', 'error')
  } finally {
    saving.value = false
  }
}

// 就地打开编辑器：与列表页共用同一个组件，不再跳走。
// 编辑器保存后重新拉一次日历，改动立刻反映在格子里。
function openEditor(item: CalendarItem) {
  editingId.value = item.id
  editorOpen.value = true
}
async function onEditorSaved() {
  await load()
}

// 清单与通知渠道是编辑器需要的，字号设置来自「偏好设置」。三者都只拉一次，
// 失败也不该挡住日历本身，所以单独 try 掉。
async function loadEditorContext() {
  try {
    const [listRes, channelRes, configRes] = await Promise.all([
      getLists(), getChannelStatuses(), getAllConfigs(),
    ])
    lists.value = listRes.data?.data || []
    channels.value = channelRes.data?.data || []
    const key = configRes.data?.data?.calendar_font_size
    if (key && FONT_SIZES[key]) fontSizeKey.value = key
  } catch {
    /* 读不到就用默认字号、空清单，日历照常可用 */
  }
}

onMounted(() => {
  loadEditorContext()
  load()
})
</script>

<style scoped>
/* 字号由根元素上的 --cal-task-font 变量驱动（见 calendarFontPx），
   格子最小高度也跟着缩放，字号调大时不会把任务条挤没。 */
.cal-task { font-size: var(--cal-task-font, 10px); }
.cal-task-lg { font-size: calc(var(--cal-task-font, 10px) + 4px); }
.cal-cell { min-height: calc(var(--cal-task-font, 10px) * 6.8); }
@media (min-width: 640px) {
  .cal-cell { min-height: calc(var(--cal-task-font, 10px) * 8.4); }
}
</style>
