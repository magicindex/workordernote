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
      <!-- 「新建提醒」原来是侧栏最上面那个按钮，用户 2026-10-16 要求挪到这一页、
           与「接下来 14 天」同行靠右。它派发 MainLayout 的 open-quick-add 事件，
           由那边的 openQuickAdd() 把用户送到列表页再展开新建卡片。
           按钮左边原来还有一个「待办 N · 逾期 N」计数，用户 2026-10-16 下午要求删掉
           （两列标题条上各自就有「N 条」，这一处是重复的）。 -->
      <button type="button" class="dashboard-new-button" data-dashboard-new-reminder title="新建提醒" @click="openQuickAdd">
        <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-width="2.2" stroke-linecap="round"/></svg>
        新建提醒
      </button>
    </div>

    <div v-if="errorMsg" class="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/[.06] px-4 py-3 text-xs font-bold text-rose-500">
      <span>{{ errorMsg }}</span>
      <button type="button" class="shrink-0 underline" @click="load()">重试</button>
    </div>

    <div v-if="loading" class="grid gap-4 lg:grid-cols-2">
      <div v-for="n in 4" :key="n" class="h-40 animate-pulse rounded-[24px] bg-surface"></div>
    </div>

    <div v-else class="grid gap-4 lg:grid-cols-2">
      <!-- 第 1 列：未来 14 天待办（标题条带底色，与「今天」页的按天卡片同一套样式） -->
      <section class="home-col" data-home-column="upcoming">
        <header class="home-col-head" data-home-head="upcoming">
          <h2 class="home-col-label">未来 14 天待办</h2>
          <span class="home-col-count">{{ upcoming.length }} 条</span>
        </header>
        <div class="home-col-body">
        <p v-if="!upcoming.length" class="rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-10 text-center text-xs text-muted-foreground">
          接下来 14 天没有待办，安心。
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="row in upcoming"
            :key="row.item.id"
            class="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-brand-500/25 bg-brand-500/[.04] p-3 transition hover:border-brand-500/45 hover:bg-brand-500/[.07]"
            data-home-item
            :data-home-goto="row.item.id"
            :title="`去「${row.item.list_name || '清单'}」里看这条`"
            @click="gotoList(row)"
          >
            <!-- 前面显示**栏目图标**（用户 2026-10-14：「首页栏目前边不显示复选框，显示栏目图标」），
                 整行点进去就定位到它所在的清单 -->
            <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500" :data-home-icon="row.item.id">
              <ListIcon :name="listIconOf(row.item)" :size="15" />
            </span>
            <span class="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-black" :class="row.tone" data-home-level>{{ row.level }}</span>
            <div class="min-w-0 flex-1">
              <p class="whitespace-pre-wrap break-words text-sm font-bold text-foreground">{{ row.item.title }}</p>
              <!-- 时间信息（用户 2026-10-15：「首页，提醒下面的时间信息改为橘黄色醒目显示创建时间，
                   结束时间，清单，剩余时间」；2026-10-16 定下这一行的读法：
                   「创建 昨天 16:46—结束 今天 23:59；工作安排；剩余 22:37」——创建与结束用「—」连成一段、
                   清单名去掉「清单」二字、各段用「；」隔开，首页两列的所有条目都按这个格式）。
                   剩余时间的口径与 2026-10-14 那个行尾倒计时完全一样（每分钟刷新，逾期的写
                   「已逾期 N 天」），所以行尾不再重复显示。 -->
              <p class="mt-1 text-[11px] font-bold leading-5 text-orange-500 dark:text-orange-400" data-home-meta>
                <span data-home-created>创建 {{ formatCreated(row.item) }}</span>
                <span>—</span>
                <span data-home-due>结束 {{ formatDue(row.item) }}</span>
                <span v-if="row.item.list_name">；</span>
                <span v-if="row.item.list_name" data-home-list>{{ row.item.list_name }}</span>
                <span>；</span>
                <span :class="{ 'text-rose-500': remainingUrgent(row.item) }" data-home-remaining>{{ remainingOf(row) }}</span>
              </p>
            </div>
          </li>
        </ul>
        </div>
      </section>

      <!-- 第 2 列：所有逾期任务（标题条染一点红，与「今天」页那张「已逾期」卡片一致） -->
      <section class="home-col" data-home-column="overdue">
        <header class="home-col-head" data-home-head="overdue">
          <h2 class="home-col-label">已逾期</h2>
          <span class="home-col-count">{{ overdue.length }} 条</span>
        </header>
        <div class="home-col-body">
        <p v-if="!overdue.length" class="rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-10 text-center text-xs text-muted-foreground">
          没有逾期的事，很好。
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="row in overdue"
            :key="row.item.id"
            class="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-rose-500/25 bg-rose-500/[.04] p-3 transition hover:border-brand-500/40"
            data-home-item
            :data-home-goto="row.item.id"
            :title="`去「${row.item.list_name || '清单'}」里看这条`"
            @click="gotoList(row)"
          >
            <!-- 前面显示**栏目图标**（用户 2026-10-14：「首页栏目前边不显示复选框，显示栏目图标」），
                 整行点进去就定位到它所在的清单 -->
            <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500" :data-home-icon="row.item.id">
              <ListIcon :name="listIconOf(row.item)" :size="15" />
            </span>
            <span class="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-black" :class="row.tone" data-home-level>{{ row.level }}</span>
            <div class="min-w-0 flex-1">
              <p class="whitespace-pre-wrap break-words text-sm font-bold text-foreground">{{ row.item.title }}</p>
              <!-- 时间信息同「未来 14 天待办」那一列：创建—结束 用「—」连起来，清单名与剩余用「；」隔开 -->
              <p class="mt-1 text-[11px] font-bold leading-5 text-orange-500 dark:text-orange-400" data-home-meta>
                <span data-home-created>创建 {{ formatCreated(row.item) }}</span>
                <span>—</span>
                <span data-home-due>结束 {{ formatDue(row.item) }}</span>
                <span v-if="row.item.list_name">；</span>
                <span v-if="row.item.list_name" data-home-list>{{ row.item.list_name }}</span>
                <span>；</span>
                <span :class="{ 'text-rose-500': remainingUrgent(row.item) }" data-home-remaining>{{ remainingOf(row) }}</span>
              </p>
            </div>
          </li>
        </ul>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ListIcon from '../components/ListIcon.vue'
import { getLists, getReminders, type ReminderItem } from '../api/reminder'
import { useAuthStore } from '../stores/auth'
import { clockParts, isOverdueAt, overdueStamp } from '../utils/overdue'
import { remainingText } from '../utils/remaining'

// 「首页」看板（用户 2026-10-13）：打开应用默认落在这一页；10 分钟不操作也回到这里
// （见 MainLayout 的空闲跳转）。左边 14 天内待办、右边所有逾期，标题前一个字标级别。
const authStore = useAuthStore()
const router = useRouter()

/** 标题行右侧的「新建提醒」：这一页没有新建面板，交给 MainLayout 的同名流程
 *  （它会把用户送到「待办」页并展开新建卡片，和以前侧栏那个按钮行为一致）。 */
function openQuickAdd() {
  window.dispatchEvent(new CustomEvent('open-quick-add'))
}

// 清单 id → 图标 key（列表接口不返回 list_icon，这里自己查一份）
const listIcons = ref<Record<number, string>>({})
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

async function loadListIcons() {
  try {
    const res = await getLists()
    const rows = res.data?.data?.items || res.data?.data || []
    const map: Record<number, string> = {}
    for (const l of rows) map[l.id] = l.icon || 'list'
    listIcons.value = map
  } catch {
    listIcons.value = {}
  }
}

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

/** 这一条属于哪个清单的图标（拿不到就用默认的清单图标）。 */
function listIconOf(item: ReminderItem) {
  return listIcons.value[item.list_id] || 'list'
}

/** 点一条 → 定位到它所在的清单，并高亮那一条（用户 2026-10-14：「首页点击提醒定位到对应清单」）。 */
function gotoList(row: Row) {
  if (!row.item.list_id) return
  void router.push({ path: `/admin/list/${row.item.list_id}`, query: { highlight: String(row.item.id) } })
}

/** 每行末尾的倒计时：逾期的写「已逾期 N 天」，其余的写「剩余 天 时:分」。 */
function remainingOf(row: Row) {
  if (row.level === '急') {
    const days = dayDiff(row.item.due_at)
    const late = days === null ? 0 : Math.max(0, -days)
    return late > 0 ? `已逾期 ${late} 天` : '已逾期'
  }
  return remainingText(row.item.due_at, clockNow.value)
}

/** 剩余不足 24 小时：只有倒计时那段转红，整行其它字保持原色（用户 2026-10-20）。 */
function remainingUrgent(item: ReminderItem) {
  if (!item.due_at) return false
  const at = new Date(item.due_at).getTime()
  if (!Number.isFinite(at)) return false
  return at - clockNow.value < 24 * 3_600_000
}

/** 创建时间（用户 2026-10-15 要求这一行里显示）：今天 / 昨天用相对说法，更早写 M月D日 时:分 */
function formatCreated(item: ReminderItem) {
  if (!item.created_at) return '未知'
  const d = new Date(item.created_at)
  const days = dayDiff(item.created_at)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (days === 0) return `今天 ${time}`
  if (days === -1) return `昨天 ${time}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`
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

function onDataChanged() { void load(); void loadListIcons() }

onMounted(() => {
  void load()
  void loadListIcons()
  clockTimer = setInterval(() => { clockNow.value = Date.now() }, 60_000)
  window.addEventListener('reminder-data-changed', onDataChanged)
})
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('reminder-data-changed', onDataChanged)
})
</script>

<style scoped>
/* 标题行右侧的「新建提醒」：沿用原来侧栏那个按钮的蓝紫渐变观感，缩小到行内高度 */
.dashboard-new-button { @apply inline-flex h-10 shrink-0 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-500 px-3.5 text-sm font-bold text-white shadow-[0_14px_30px_-14px_rgba(59,130,246,.8)] transition hover:brightness-105 active:scale-[0.99]; }
/* 栏目卡片：与「今天」页的按天卡片同一套观感（标题条带底色 + 卡片圆角/边框/阴影） */
.home-col { @apply overflow-hidden rounded-[22px] border border-border/70 bg-surface/85 shadow-card backdrop-blur-xl; }
.home-col-head { @apply flex items-center gap-2 border-b border-border/60 bg-brand-500/10 px-4 py-2.5 sm:px-5; }
.home-col-label { @apply text-[13px] font-extrabold tracking-tight text-brand-700 sm:text-sm dark:text-brand-300; }
.home-col-count { @apply ml-auto text-[11px] font-bold text-brand-600/80 dark:text-brand-300/80; }
.home-col-body { @apply px-4 pb-4 pt-3 sm:px-5 sm:pb-5 sm:pt-4; }
/* 逾期那一列：标题条与计数都染红，跟行里的「急」呼应 */
.home-col[data-home-column='overdue'] .home-col-head { @apply bg-rose-500/10; }
.home-col[data-home-column='overdue'] .home-col-label { @apply text-rose-600 dark:text-rose-400; }
.home-col[data-home-column='overdue'] .home-col-count { @apply text-rose-500/80; }
</style>
