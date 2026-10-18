<template>
  <div class="page-container animate-fade-in">
    <PageHeader title="课程表" description="按周几排课：一张表一个人，课程与课外活动分开标色。">
      <template #actions>
        <button type="button" class="btn-primary !h-9 !px-3 !text-xs" data-timetable-add-table @click="openNewTable">
          <svg viewBox="0 0 24 24" class="mr-1 h-4 w-4" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-width="2" stroke-linecap="round"/></svg>
          新建表
        </button>
      </template>
    </PageHeader>

    <div v-if="errorMsg" class="mt-4 surface rounded-2xl px-5 py-3 text-sm text-destructive">{{ errorMsg }}</div>

    <div v-if="loading" class="mt-4 space-y-3">
      <div class="h-10 w-64 rounded-xl bg-muted animate-pulse"></div>
      <div class="h-64 rounded-2xl bg-muted/60 animate-pulse"></div>
    </div>

    <template v-else>
      <!-- 多张表：一人一张，顶部标签切换（用户 2026-10-18「支持多人表，通过索引分割标签切换」） -->
      <div v-if="tables.length" class="mt-4 flex flex-wrap items-center gap-2">
        <div class="flex flex-wrap items-center gap-1 rounded-2xl border border-border bg-muted/40 p-1" role="tablist" aria-label="课程表">
          <button
            v-for="table in tables"
            :key="table.id"
            type="button"
            role="tab"
            class="timetable-tab"
            :class="table.id === activeId ? 'timetable-tab-on' : ''"
            :aria-selected="table.id === activeId"
            :data-timetable-tab="table.name"
            @click="selectTable(table.id)"
          >
            {{ table.name }}
            <span class="ml-1 text-[10px] font-semibold opacity-60">{{ table.entry_count }}</span>
          </button>
        </div>
        <button
          type="button"
          class="icon-button !h-8 !w-8 text-muted-foreground"
          aria-label="课程表设置"
          title="重命名或删除这张表"
          data-timetable-settings
          @click="openTableSettings"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/></svg>
        </button>
      </div>

      <div v-if="!tables.length" class="mt-6 surface rounded-2xl px-6 py-14 text-center" data-timetable-empty>
        <p class="text-base font-bold text-foreground">还没有课程表</p>
        <p class="mt-1 text-sm text-muted-foreground">给家里每个人建一张，课程和课外活动都能放进来。</p>
        <button type="button" class="btn-primary mt-4 !h-9 !px-4 !text-xs" @click="openNewTable">建第一张表</button>
      </div>

      <!-- 一周七天，各一列；窄屏自动堆成一天一块，手机上不用横向拖 -->
      <div v-else class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7" data-timetable-board>
        <section
          v-for="day in days"
          :key="day.weekday"
          class="surface flex flex-col rounded-2xl p-2.5"
          :class="day.weekday === todayWeekday ? 'ring-2 ring-brand-400/60' : ''"
          :data-day-column="day.weekday"
        >
          <header class="flex items-center justify-between px-1 pb-2">
            <span class="text-xs font-extrabold" :class="day.weekday === todayWeekday ? 'text-brand-600 dark:text-brand-300' : 'text-foreground'">
              {{ day.label }}
            </span>
            <span v-if="day.weekday === todayWeekday" class="rounded-full bg-brand-500/12 px-1.5 py-0.5 text-[10px] font-bold text-brand-600 dark:text-brand-300">今天</span>
            <span v-else class="text-[10px] font-semibold text-muted-foreground">{{ day.entries.length || '' }}</span>
          </header>

          <div class="flex flex-1 flex-col gap-2">
            <button
              v-for="entry in day.entries"
              :key="entry.id"
              type="button"
              class="timetable-card text-left"
              :class="[paletteOf(entry).card, entry.kind === 'activity' ? 'timetable-card-activity' : '']"
              :data-entry-id="entry.id"
              :data-entry-kind="entry.kind"
              @click="openEditEntry(entry)"
            >
              <span class="text-[11px] font-bold tabular-nums text-foreground/65">{{ entry.start_time }}–{{ entry.end_time }}</span>
              <p class="mt-1 truncate text-[13px] font-bold text-foreground" :title="entry.title">{{ entry.title }}</p>
              <p v-if="entry.location || entry.teacher" class="mt-0.5 truncate text-[10.5px] leading-4 text-foreground/60">
                {{ [entry.kind === 'activity' ? '活动' : '', entry.location, entry.teacher].filter(Boolean).join(' · ') }}
              </p>
            </button>

            <button
              type="button"
              class="timetable-add"
              :data-timetable-add-entry="day.weekday"
              :aria-label="`给${day.label}加一节`"
              @click="openNewEntry(day.weekday)"
            >
              <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="M12 6v12M6 12h12" stroke-width="2" stroke-linecap="round"/></svg>
              添加
            </button>
          </div>
        </section>
      </div>
    </template>

    <!-- 新建/编辑课程 -->
    <Modal v-model="entryOpen" :title="entryEditing ? '编辑课程' : '添加课程'">
      <form class="space-y-3" data-entry-dialog @submit.prevent="saveEntry">
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="timetable-kind" :class="form.kind === 'course' ? 'timetable-kind-on' : ''" data-entry-kind-course @click="form.kind = 'course'">课程</button>
          <button type="button" class="timetable-kind" :class="form.kind === 'activity' ? 'timetable-kind-on' : ''" data-entry-kind-activity @click="form.kind = 'activity'">课外活动</button>
        </div>

        <label class="block">
          <span class="text-xs font-bold text-foreground">名称</span>
          <input v-model="form.title" class="input-field mt-1" maxlength="40" placeholder="例如：数学 / 机器人社团" data-entry-title />
        </label>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">星期</span>
            <select v-model.number="form.weekday" class="input-field mt-1" data-entry-weekday>
              <option v-for="day in weekdays" :key="day.value" :value="day.value">{{ day.label }}</option>
            </select>
          </label>
          <label class="block">
            <span class="text-xs font-bold text-foreground">颜色</span>
            <span class="mt-1 flex h-[38px] items-center gap-1.5">
              <button
                v-for="color in palette"
                :key="color.key"
                type="button"
                class="h-6 w-6 rounded-full ring-2 ring-transparent transition"
                :class="[color.dot, form.color === color.key ? 'ring-offset-1 ring-foreground/40' : '']"
                :data-entry-color="color.key"
                :aria-label="color.label"
                @click="form.color = color.key"
              ></button>
            </span>
          </label>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">开始</span>
            <input v-model="form.start_time" type="time" class="input-field mt-1" data-entry-start />
          </label>
          <label class="block">
            <span class="text-xs font-bold text-foreground">结束</span>
            <input v-model="form.end_time" type="time" class="input-field mt-1" data-entry-end />
          </label>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">地点（可选）</span>
            <input v-model="form.location" class="input-field mt-1" maxlength="40" placeholder="三班 / 体育馆" data-entry-location />
          </label>
          <label class="block">
            <span class="text-xs font-bold text-foreground">老师（可选）</span>
            <input v-model="form.teacher" class="input-field mt-1" maxlength="30" placeholder="李老师" data-entry-teacher />
          </label>
        </div>

        <label class="block">
          <span class="text-xs font-bold text-foreground">备注（可选）</span>
          <textarea v-model="form.note" rows="2" maxlength="300" class="input-field mt-1" placeholder="带泳衣 / 周五交作业…" data-entry-note></textarea>
        </label>

        <p v-if="entryError" class="text-xs font-semibold text-destructive">{{ entryError }}</p>

        <div class="flex items-center gap-2 pt-1">
          <button v-if="entryEditing" type="button" class="btn-secondary !h-9 !px-3 !text-xs text-destructive" data-entry-delete @click="removeEntry">删除</button>
          <span class="flex-1"></span>
          <button type="button" class="btn-secondary !h-9 !px-3 !text-xs" @click="entryOpen = false">取消</button>
          <button type="submit" class="btn-primary !h-9 !px-4 !text-xs" :disabled="savingEntry" data-entry-save>
            {{ savingEntry ? '保存中…' : '保存' }}
          </button>
        </div>
      </form>
    </Modal>

    <!-- 表设置：改名 / 删除 -->
    <Modal v-model="tableOpen" title="课程表设置">
      <form class="space-y-3" @submit.prevent="saveTableSettings">
        <label class="block">
          <span class="text-xs font-bold text-foreground">名字</span>
          <input v-model="tableName" class="input-field mt-1" maxlength="20" placeholder="例如：哥哥 / 妹妹 / 我" data-table-name />
        </label>
        <p class="text-[11px] leading-4 text-muted-foreground">一个账号可以建多张表，顶部标签切换；每张表的课程各归各的。</p>
        <p v-if="tableError" class="text-xs font-semibold text-destructive">{{ tableError }}</p>
        <div class="flex items-center gap-2 pt-1">
          <button type="button" class="btn-secondary !h-9 !px-3 !text-xs text-destructive" data-table-delete @click="removeTable">删除这张表</button>
          <span class="flex-1"></span>
          <button type="button" class="btn-secondary !h-9 !px-3 !text-xs" @click="tableOpen = false">取消</button>
          <button type="submit" class="btn-primary !h-9 !px-4 !text-xs" :disabled="savingTable" data-table-save>保存</button>
        </div>
      </form>
    </Modal>

    <!-- 新建表（与设置共用一个弹窗会分不清「新建」还是「改名」） -->
    <Modal v-model="createOpen" title="新建课程表">
      <form class="space-y-3" @submit.prevent="submitNewTable">
        <label class="block">
          <span class="text-xs font-bold text-foreground">名字</span>
          <input v-model="newTableName" class="input-field mt-1" maxlength="20" placeholder="例如：哥哥 / 妹妹" data-new-table-name />
        </label>
        <p v-if="newTableError" class="text-xs font-semibold text-destructive">{{ newTableError }}</p>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" class="btn-secondary !h-9 !px-3 !text-xs" @click="createOpen = false">取消</button>
          <button type="submit" class="btn-primary !h-9 !px-4 !text-xs" :disabled="creatingTable" data-new-table-save>
            {{ creatingTable ? '创建中…' : '创建' }}
          </button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import Modal from '../components/Modal.vue'
import {
  createEntry, createTimetable, deleteEntry, deleteTimetable,
  getTimetable, getTimetables, updateEntry, updateTimetable,
  type EntryInput, type TimetableEntry, type TimetableSummary,
} from '../api/timetable'

const weekdays = [
  { value: 1, label: '周一' }, { value: 2, label: '周二' }, { value: 3, label: '周三' },
  { value: 4, label: '周四' }, { value: 5, label: '周五' }, { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

// 课程配色：与清单/卡片同一套审美，浅底 + 同色描边；深色模式自动降透明度。
const palette = [
  { key: 'indigo', label: '靛蓝', dot: 'bg-indigo-500', card: 'bg-indigo-50/80 border-indigo-200/80 dark:bg-indigo-500/[0.12] dark:border-indigo-400/25', time: 'text-indigo-600 dark:text-indigo-300' },
  { key: 'rose', label: '玫红', dot: 'bg-rose-500', card: 'bg-rose-50/80 border-rose-200/80 dark:bg-rose-500/[0.12] dark:border-rose-400/25', time: 'text-rose-600 dark:text-rose-300' },
  { key: 'emerald', label: '翠绿', dot: 'bg-emerald-500', card: 'bg-emerald-50/80 border-emerald-200/80 dark:bg-emerald-500/[0.12] dark:border-emerald-400/25', time: 'text-emerald-600 dark:text-emerald-300' },
  { key: 'amber', label: '琥珀', dot: 'bg-amber-500', card: 'bg-amber-50/80 border-amber-200/80 dark:bg-amber-500/[0.12] dark:border-amber-400/25', time: 'text-amber-600 dark:text-amber-300' },
  { key: 'sky', label: '天蓝', dot: 'bg-sky-500', card: 'bg-sky-50/80 border-sky-200/80 dark:bg-sky-500/[0.12] dark:border-sky-400/25', time: 'text-sky-600 dark:text-sky-300' },
  { key: 'violet', label: '紫罗兰', dot: 'bg-violet-500', card: 'bg-violet-50/80 border-violet-200/80 dark:bg-violet-500/[0.12] dark:border-violet-400/25', time: 'text-violet-600 dark:text-violet-300' },
  { key: 'teal', label: '青碧', dot: 'bg-teal-500', card: 'bg-teal-50/80 border-teal-200/80 dark:bg-teal-500/[0.12] dark:border-teal-400/25', time: 'text-teal-600 dark:text-teal-300' },
  { key: 'slate', label: '石墨', dot: 'bg-slate-500', card: 'bg-slate-50/80 border-slate-200/80 dark:bg-slate-500/[0.12] dark:border-slate-400/25', time: 'text-slate-600 dark:text-slate-300' },
]

const tables = ref<TimetableSummary[]>([])
const activeId = ref<number>(0)
const entries = ref<TimetableEntry[]>([])
const loading = ref(true)
const errorMsg = ref('')

const todayWeekday = (() => {
  const d = new Date().getDay()
  return d === 0 ? 7 : d
})()

const days = computed(() => weekdays.map((day) => ({
  weekday: day.value,
  label: day.label,
  entries: entries.value.filter((entry) => entry.weekday === day.value),
})))

function paletteOf(entry: TimetableEntry) {
  // 没选颜色时按标题做稳定落档：同一个课程刷新后颜色不变。
  if (entry.color) {
    const hit = palette.find((p) => p.key === entry.color)
    if (hit) return hit
  }
  let hash = 0
  for (const ch of entry.title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return palette[hash % palette.length]
}

async function loadTables(keep = 0) {
  const res = await getTimetables()
  if (res.data?.code !== 0) throw new Error(res.data?.message || '读取课程表失败')
  const list: TimetableSummary[] = res.data.data?.tables || []
  tables.value = list
  const nextId = keep && list.some((t) => t.id === keep) ? keep : list[0]?.id || 0
  activeId.value = nextId
  if (nextId) await loadEntries(nextId)
  else entries.value = []
}

async function loadEntries(id: number) {
  const res = await getTimetable(id)
  if (res.data?.code !== 0) throw new Error(res.data?.message || '读取课程表失败')
  entries.value = res.data.data?.entries || []
}

async function selectTable(id: number) {
  if (id === activeId.value) return
  activeId.value = id
  errorMsg.value = ''
  try {
    await loadEntries(id)
  } catch (err: any) {
    errorMsg.value = err.message || '读取课程表失败'
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await loadTables()
  } catch (err: any) {
    errorMsg.value = err.message || '读取课程表失败'
  } finally {
    loading.value = false
  }
})

// ---------- 新建 / 改名 / 删除表 ----------
const createOpen = ref(false)
const newTableName = ref('')
const newTableError = ref('')
const creatingTable = ref(false)

function openNewTable() {
  newTableName.value = ''
  newTableError.value = ''
  createOpen.value = true
}

async function submitNewTable() {
  const name = newTableName.value.trim()
  if (!name) { newTableError.value = '给表起个名字'; return }
  creatingTable.value = true
  newTableError.value = ''
  try {
    const res = await createTimetable(name)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '创建失败')
    createOpen.value = false
    await loadTables(res.data.data?.id || 0)
  } catch (err: any) {
    newTableError.value = err.message || '创建失败'
  } finally {
    creatingTable.value = false
  }
}

const tableOpen = ref(false)
const tableName = ref('')
const tableError = ref('')
const savingTable = ref(false)

function openTableSettings() {
  const current = tables.value.find((t) => t.id === activeId.value)
  if (!current) return
  tableName.value = current.name
  tableError.value = ''
  tableOpen.value = true
}

async function saveTableSettings() {
  const name = tableName.value.trim()
  if (!name) { tableError.value = '名字不能为空'; return }
  savingTable.value = true
  tableError.value = ''
  try {
    const res = await updateTimetable(activeId.value, { name })
    if (res.data?.code !== 0) throw new Error(res.data?.message || '保存失败')
    tableOpen.value = false
    await loadTables(activeId.value)
  } catch (err: any) {
    tableError.value = err.message || '保存失败'
  } finally {
    savingTable.value = false
  }
}

async function removeTable() {
  const current = tables.value.find((t) => t.id === activeId.value)
  if (!current) return
  if (!window.confirm(`删除「${current.name}」和里面的全部课程？`)) return
  tableError.value = ''
  try {
    const res = await deleteTimetable(current.id)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '删除失败')
    tableOpen.value = false
    await loadTables()
  } catch (err: any) {
    tableError.value = err.message || '删除失败'
  }
}

// ---------- 课程 / 课外活动 ----------
const entryOpen = ref(false)
const entryEditing = ref<TimetableEntry | null>(null)
const entryError = ref('')
const savingEntry = ref(false)
const form = reactive<EntryInput>(blankEntry())

function blankEntry(): EntryInput {
  return {
    title: '', kind: 'course', weekday: todayWeekday,
    start_time: '08:00', end_time: '08:45',
    location: '', teacher: '', note: '', color: palette[0].key,
  }
}

function openNewEntry(weekday: number) {
  entryEditing.value = null
  Object.assign(form, blankEntry(), { weekday })
  entryError.value = ''
  entryOpen.value = true
}

function openEditEntry(entry: TimetableEntry) {
  entryEditing.value = entry
  Object.assign(form, {
    title: entry.title, kind: entry.kind, weekday: entry.weekday,
    start_time: entry.start_time, end_time: entry.end_time,
    location: entry.location, teacher: entry.teacher,
    note: entry.note, color: entry.color || '',
  })
  entryError.value = ''
  entryOpen.value = true
}

async function saveEntry() {
  if (!form.title.trim()) { entryError.value = '课程名称不能为空'; return }
  if (form.start_time >= form.end_time) { entryError.value = '结束时间要晚于开始时间'; return }
  savingEntry.value = true
  entryError.value = ''
  try {
    const payload: EntryInput = { ...form, title: form.title.trim() }
    const res = entryEditing.value
      ? await updateEntry(entryEditing.value.id, payload)
      : await createEntry(activeId.value, payload)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '保存失败')
    entryOpen.value = false
    await Promise.all([loadEntries(activeId.value), loadTables(activeId.value)])
  } catch (err: any) {
    entryError.value = err.message || '保存失败'
  } finally {
    savingEntry.value = false
  }
}

async function removeEntry() {
  if (!entryEditing.value) return
  if (!window.confirm(`删掉「${entryEditing.value.title}」这节课？`)) return
  try {
    const res = await deleteEntry(entryEditing.value.id)
    if (res.data?.code !== 0) throw new Error(res.data?.message || '删除失败')
    entryOpen.value = false
    await Promise.all([loadEntries(activeId.value), loadTables(activeId.value)])
  } catch (err: any) {
    entryError.value = err.message || '删除失败'
  }
}
</script>

<style scoped>
.timetable-tab {
  @apply rounded-xl px-3 py-1.5 text-xs font-bold text-muted-foreground transition;
}
.timetable-tab:hover { @apply text-foreground bg-surface/70; }
.timetable-tab-on {
  @apply bg-surface text-foreground shadow-sm;
}
.timetable-card {
  @apply rounded-xl border p-2.5 transition duration-150;
}
.timetable-card:hover { @apply -translate-y-0.5 shadow-md; }
.timetable-card-activity { @apply border-dashed; }
.timetable-add {
  @apply flex items-center justify-center gap-1 rounded-lg border border-dashed border-border py-1.5 text-[11px] font-semibold text-muted-foreground transition;
}
.timetable-add:hover { @apply border-brand-400 text-brand-600 dark:text-brand-300; }
.timetable-kind {
  @apply rounded-xl border border-border py-2 text-xs font-bold text-muted-foreground transition;
}
.timetable-kind-on {
  @apply border-brand-400 bg-brand-500/10 text-brand-600 dark:text-brand-300;
}
</style>
