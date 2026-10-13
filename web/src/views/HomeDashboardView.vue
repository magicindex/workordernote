<template>
  <div class="mx-auto max-w-6xl" data-home-dashboard>
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div class="min-w-0">
        <p class="mb-1 text-xs font-extrabold uppercase tracking-[.18em] text-brand-500 sm:mb-2">首页</p>
        <h1 class="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">接下来 14 天</h1>
        <p class="mt-0.5 text-[13px] text-muted-foreground sm:mt-2">
          左边是 14 天内要办的事，右边是已经逾期的。标题前面那个字就是级别：
          <b class="text-rose-500">急</b>=已逾期、
          <b class="text-amber-500">今</b>=今天、
          <b class="text-sky-500">明</b>=明天、
          <b class="text-sky-500">后</b>=后天，再往后写周几、日期。
        </p>
      </div>
      <span class="shrink-0 text-[11px] font-semibold text-muted-foreground" data-home-counts>
        待办 {{ upcoming.length }} · 逾期 {{ overdue.length }}
      </span>
    </div>

    <div v-if="errorMsg" class="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/[.06] px-4 py-3 text-xs font-bold text-rose-500">
      <span>{{ errorMsg }}</span>
      <button type="button" class="shrink-0 underline" @click="load()">重试</button>
    </div>

    <div v-if="loading" class="grid gap-4 lg:grid-cols-2">
      <div v-for="n in 4" :key="n" class="h-40 animate-pulse rounded-[24px] bg-surface"></div>
    </div>

    <div v-else class="grid gap-4 lg:grid-cols-2">
      <!-- 第 1 列：未来 14 天待办 -->
      <section class="rounded-[24px] border border-border/70 bg-surface/85 p-4 shadow-card backdrop-blur-xl sm:p-5" data-home-column="upcoming">
        <header class="mb-1 flex items-center justify-between gap-2">
          <h2 class="text-sm font-extrabold">未来 14 天待办</h2>
          <span class="rounded-full bg-brand-500/10 px-2.5 py-0.5 text-[11px] font-bold text-brand-600 dark:text-brand-300">{{ upcoming.length }} 条</span>
        </header>
        <!-- 列表自己的说明（用户 2026-10-13：「清单列表补充说明14天待办任务」）：
             14 天口径 + 标题前面那个级别字怎么读，都写在列表里，不用回看页头。 -->
        <p class="mb-3 text-[11px] leading-4 text-muted-foreground" data-home-legend>
          到期时间落在今天到 14 天后、且还没逾期的任务（含循环任务的下一次）。
          标题前的字是级别：<b class="text-rose-500">急</b>=已逾期、
          <b class="text-amber-500">今</b>=今天、<b class="text-sky-500">明</b>=明天、
          <b class="text-sky-500">后</b>=后天、周X=本周内、日期=更远。
        </p>
        <p v-if="!upcoming.length" class="rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-10 text-center text-xs text-muted-foreground">
          接下来 14 天没有待办，安心。
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="row in upcoming"
            :key="row.item.id"
            class="flex items-start gap-2.5 rounded-2xl border border-border/70 bg-surface/70 p-3"
            data-home-item
          >
            <button
              type="button"
              class="mt-0.5 h-4 w-4 shrink-0 rounded border border-border transition hover:border-brand-500"
              :aria-label="`完成：${row.item.title}`"
              :data-home-complete="row.item.id"
              @click="complete(row)"
            ></button>
            <span class="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-black" :class="row.tone" data-home-level>{{ row.level }}</span>
            <div class="min-w-0 flex-1">
              <p class="whitespace-pre-wrap break-words text-sm font-bold text-foreground">{{ row.item.title }}</p>
              <p class="mt-0.5 text-[11px] font-medium text-muted-foreground/80">
                {{ formatDue(row.item) }}<template v-if="row.item.list_name"> · {{ row.item.list_name }}</template>
              </p>
            </div>
          </li>
        </ul>
      </section>

      <!-- 第 2 列：所有逾期任务 -->
      <section class="rounded-[24px] border border-border/70 bg-surface/85 p-4 shadow-card backdrop-blur-xl sm:p-5" data-home-column="overdue">
        <header class="mb-1 flex items-center justify-between gap-2">
          <h2 class="text-sm font-extrabold">已逾期</h2>
          <span class="rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-bold text-rose-500">{{ overdue.length }} 条</span>
        </header>
        <p class="mb-3 text-[11px] leading-4 text-muted-foreground" data-home-legend-overdue>
          到期日当天过了「逾期提醒时间」还没完成的都在这儿（点「知道了」顺延也不会离开这一栏）。
        </p>
        <p v-if="!overdue.length" class="rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-10 text-center text-xs text-muted-foreground">
          没有逾期的事，很好。
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="row in overdue"
            :key="row.item.id"
            class="flex items-start gap-2.5 rounded-2xl border border-rose-500/25 bg-rose-500/[.04] p-3"
            data-home-item
          >
            <button
              type="button"
              class="mt-0.5 h-4 w-4 shrink-0 rounded border border-border transition hover:border-brand-500"
              :aria-label="`完成：${row.item.title}`"
              :data-home-complete="row.item.id"
              @click="complete(row)"
            ></button>
            <span class="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-black" :class="row.tone" data-home-level>{{ row.level }}</span>
            <div class="min-w-0 flex-1">
              <p class="whitespace-pre-wrap break-words text-sm font-bold text-foreground">{{ row.item.title }}</p>
              <p class="mt-0.5 text-[11px] font-medium text-muted-foreground/80">
                {{ formatDue(row.item) }}<template v-if="row.item.list_name"> · {{ row.item.list_name }}</template>
              </p>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { completeReminder, getReminders, type ReminderItem } from '../api/reminder'
import { useAuthStore } from '../stores/auth'
import { clockParts, isOverdueAt, overdueStamp } from '../utils/overdue'

// 「首页」看板（用户 2026-10-13）：打开应用默认落在这一页；10 分钟不操作也回到这里
// （见 MainLayout 的空闲跳转）。左边 14 天内待办、右边所有逾期，标题前一个字标级别。
const authStore = useAuthStore()
const items = ref<ReminderItem[]>([])
const loading = ref(true)
const errorMsg = ref('')
const clockNow = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | undefined

const VIEW_DAYS = 14

const midnight = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const dayDiff = (iso: string | null | undefined) => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const a = midnight(t)
  const b = midnight(clockNow.value)
  return Math.round((a - b) / 86400000)
}

/** 级别字：急（逾期）/ 今 / 明 / 后 / 周几 / 日期 —— 用户要求「用 '今''急'等字区分级别」。 */
function levelOf(item: ReminderItem): { level: string; tone: string } {
  if (item.completed_at) return { level: '完', tone: 'bg-slate-500/10 text-muted-foreground' }
  if (isOverdueAt(item, { cutoff: clockParts(authStore.reminderOverdueTime), graceMinutes: 0, now: clockNow.value })) {
    return { level: '急', tone: 'bg-rose-500/12 text-rose-500' }
  }
  const days = dayDiff(item.due_at)
  if (days === null) return { level: '—', tone: 'bg-slate-500/10 text-muted-foreground' }
  if (days <= 0) return { level: '今', tone: 'bg-amber-500/12 text-amber-600 dark:text-amber-300' }
  if (days === 1) return { level: '明', tone: 'bg-sky-500/12 text-sky-600 dark:text-sky-300' }
  if (days === 2) return { level: '后', tone: 'bg-sky-500/12 text-sky-600 dark:text-sky-300' }
  const d = new Date(String(item.due_at))
  if (days <= 6) return { level: '周' + '日一二三四五六'[d.getDay()], tone: 'bg-slate-500/10 text-muted-foreground' }
  return { level: `${d.getMonth() + 1}/${d.getDate()}`, tone: 'bg-slate-500/10 text-muted-foreground' }
}

type Row = { item: ReminderItem; level: string; tone: string }

const rows = computed<Row[]>(() => items.value.map((item) => ({ item, ...levelOf(item) })))

/** 待办那一列：没逾期的、且到期时间在 [今天, 今天+14 天) 之内。 */
const upcoming = computed(() => rows.value
  .filter((row) => {
    if (row.item.completed_at) return false
    if (overdueStamp(row.item) === null) return false
    if (row.level === '急') return false
    const days = dayDiff(row.item.due_at)
    return days !== null && days < VIEW_DAYS
  })
  .sort((a, b) => new Date(a.item.due_at || 0).getTime() - new Date(b.item.due_at || 0).getTime()))

/** 逾期那一列：所有已经逾期的（不看 14 天窗口）。 */
const overdue = computed(() => rows.value
  .filter((row) => row.level === '急')
  .sort((a, b) => new Date(a.item.due_at || 0).getTime() - new Date(b.item.due_at || 0).getTime()))

async function load() {
  try {
    // 不传 status：默认只取未完成的（status=all 才会带上已完成）
    const res = await getReminders({ view: 'all' })
    const data = res.data?.data
    items.value = Array.isArray(data) ? data : (data?.items || [])
    errorMsg.value = ''
  } catch {
    errorMsg.value = '读取待办失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function complete(row: Row) {
  try {
    await completeReminder(row.item.id)
    await load()
  } catch {
    errorMsg.value = '标记完成失败，请到清单里再试一次'
  }
}

function formatDue(item: ReminderItem) {
  const raw = item.due_at
  if (!raw) return '未设日期'
  const d = new Date(raw)
  const days = dayDiff(raw)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const date = `${d.getMonth() + 1}月${d.getDate()}日`
  if (days === 0) return `今天 ${time}`
  if (days === 1) return `明天 ${time}`
  if (days === 2) return `后天 ${time}`
  if (days !== null && days < 0) return `${date}（已过 ${-days} 天）`
  return `${date} ${time}`
}

function onDataChanged() { void load() }

onMounted(() => {
  void load()
  clockTimer = setInterval(() => { clockNow.value = Date.now() }, 60_000)
  window.addEventListener('reminder-data-changed', onDataChanged)
})
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('reminder-data-changed', onDataChanged)
})
</script>
