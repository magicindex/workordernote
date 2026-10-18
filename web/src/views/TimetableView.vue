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
      <!-- 多张表：一人一张，顶部标签切换（用户 2026-10-18「支持多人表，通过索引分割标签切换」）。
           2026-10-18 二次改版：每张表带自己的浅彩色（与它课程卡的色系一致），标签与表头背景同色。 -->
      <div v-if="tables.length" class="mt-4 flex min-w-0 items-center gap-2">
        <div class="timetable-tabs" role="tablist" aria-label="课程表">
          <button
            v-for="table in tables"
            :key="table.id"
            type="button"
            role="tab"
            class="timetable-tab"
            :class="table.id === activeId ? tableAccent(table).tabText : ''"
            :style="table.id === activeId ? { backgroundColor: tableAccent(table).tint + '2b' } : undefined"
            :aria-selected="table.id === activeId"
            :data-timetable-tab="table.name"
            @click="selectTable(table.id)"
          >
            <span class="timetable-tab-dot" :class="tableAccent(table).barBg"></span>
            {{ table.name }}
            <span class="timetable-tab-count">{{ table.entry_count }}</span>
          </button>
        </div>
        <label class="flex shrink-0 items-center gap-1.5 rounded-xl border border-border/70 px-2 py-1 text-[11px] font-semibold text-muted-foreground" title="把整周按节次铺成空格子，点一格就能加课">
          <input v-model="showSlots" type="checkbox" class="h-3.5 w-3.5 accent-brand-500" data-timetable-show-slots />
          空节次
        </label>
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

      <!-- 一周七天，各一列；窄屏自动堆成一天一块，手机上不用横向拖。
           七天共用一块底板，列与列之间只留 1px 细线，比七张独立卡片更整。 -->
      <div v-else class="timetable-shell mt-4" data-timetable-board :style="{ backgroundImage: shellGlow }">
        <div class="timetable-grid">
          <section
            v-for="day in days"
            :key="day.weekday"
            class="timetable-day"
            :class="day.weekday === todayWeekday ? 'timetable-day-today' : ''"
            :data-day-column="day.weekday"
          >
            <header class="timetable-day-head">
              <div class="flex items-baseline gap-1.5">
                <span class="timetable-day-name" :class="day.weekday === todayWeekday ? 'text-brand-600 dark:text-brand-300' : 'text-foreground'">{{ day.label }}</span>
                <span class="timetable-day-date">{{ day.date }}</span>
              </div>
              <span v-if="day.weekday === todayWeekday" class="timetable-today">今天</span>
              <span v-else class="timetable-day-count">{{ day.entries.length || '—' }}</span>
            </header>

            <div class="flex flex-1 flex-col gap-2">
              <div
                v-for="period in day.periods"
                :key="period.key"
                class="timetable-period"
                :data-timetable-period="period.key"
              >
                <p class="timetable-period-label" :data-timetable-period-label="period.key">
                    {{ period.label }}
                    <span v-if="period.count" class="timetable-period-count">{{ period.count }}</span>
                  </p>
                  <template v-for="item in period.items" :key="item.kind === 'entry' ? 'e' + item.entry.id : 's' + item.slot.index">
                    <button
                      v-if="item.kind === 'entry'"
                      type="button"
                      class="timetable-card"
                      :class="[paletteOf(item.entry).card, item.entry.kind === 'activity' ? 'timetable-card-activity' : '']"
                      :data-entry-id="item.entry.id"
                      :data-entry-kind="item.entry.kind"
                      @click="openEditEntry(item.entry)"
                    >
                      <span class="timetable-card-bar" :class="paletteOf(item.entry).barBg"></span>
                      <span class="flex min-w-0 flex-1 flex-col">
                        <span class="timetable-card-time">{{ item.entry.start_time }}<span class="opacity-40">–</span>{{ item.entry.end_time }}</span>
                        <span class="flex items-center gap-1">
                          <span class="timetable-card-title" :title="item.entry.title">{{ item.entry.title }}</span>
                          <span v-if="item.entry.kind === 'activity'" class="timetable-activity-tag">活动</span>
                        </span>
                        <span v-if="item.entry.location || item.entry.teacher" class="timetable-card-meta">
                          {{ [item.entry.location, item.entry.teacher].filter(Boolean).join(' · ') }}
                        </span>
                      </span>
                    </button>
                    <button
                      v-else
                      type="button"
                      class="timetable-slot"
                      :data-timetable-slot="item.slot.index"
                      @click="openNewEntry(day.weekday, item.slot.start)"
                    >
                      <span class="timetable-slot-index">第{{ item.slot.index }}节</span>
                      <span class="timetable-slot-time">{{ item.slot.start }}</span>
                      <svg viewBox="0 0 24 24" class="ml-auto h-3 w-3 opacity-50" fill="none" stroke="currentColor"><path d="M12 6v12M6 12h12" stroke-width="2" stroke-linecap="round"/></svg>
                    </button>
                  </template>
              </div>

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

        <label class="block">
          <span class="flex items-center justify-between text-xs font-bold text-foreground">
            节次
            <span class="text-[10px] font-medium text-muted-foreground">按表设置里的节次排</span>
          </span>
          <select class="input-field mt-1" :value="selectedSlotIndex" @change="onPickSlot" data-entry-slot>
            <option :value="0">自定义时间</option>
            <option v-for="slot in slots" :key="slot.index" :value="slot.index">
              {{ sectionLabel(slot.section) }} 第{{ slot.index }}节 · {{ slot.start }}–{{ slot.end }}
            </option>
          </select>
        </label>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">开始</span>
            <input v-model="form.start_time" type="time" class="input-field mt-1" data-entry-start @input="syncEndFromStart" />
          </label>
          <label class="block">
            <span class="flex items-center justify-between text-xs font-bold text-foreground">
              结束
              <button type="button" class="text-[10px] font-semibold text-brand-600 dark:text-brand-300" @click="syncEndFromStart">按课时</button>
            </span>
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
    <Modal v-model="tableOpen" title="课程表设置" size="lg">
      <form class="space-y-3" @submit.prevent="saveTableSettings">
        <label class="block">
          <span class="text-xs font-bold text-foreground">名字</span>
          <input v-model="tableName" class="input-field mt-1" maxlength="20" placeholder="例如：哥哥 / 妹妹 / 我" data-table-name />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">一节课（分钟）</span>
            <input v-model.number="tableForm.lesson" type="number" min="15" max="180" step="5" class="input-field mt-1" data-table-lesson />
          </label>
          <label class="block">
            <span class="text-xs font-bold text-foreground">课间（分钟）</span>
            <input v-model.number="tableForm.brk" type="number" min="0" max="60" step="5" class="input-field mt-1" data-table-break />
          </label>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-bold text-foreground">第一节课开始</span>
            <input v-model="tableForm.first" type="time" class="input-field mt-1" data-table-first />
          </label>
          <span class="flex items-end">
            <button type="button" class="btn-secondary !h-[38px] w-full !px-3 !text-[11.5px]" data-table-regenerate @click="regenerateAll">
              按课时重排
            </button>
          </span>
        </div>

        <div class="space-y-2">
          <p class="text-xs font-bold text-foreground">各段节次与时间段</p>
          <div class="grid gap-2 sm:grid-cols-2">
          <div v-for="section in SECTIONS" :key="section.key" class="rounded-xl border border-border/70 p-2">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="flex items-center gap-1 text-[11.5px] font-bold">
                {{ section.label }}
                <input
                  type="number"
                  min="0"
                  max="16"
                  class="w-9 rounded-md border border-border/70 bg-surface px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums"
                  :value="tableForm.periods.filter((p) => p.section === section.key).length"
                  :data-table-section-count="section.key"
                  @change="setSectionCount(section.key, Number(($event.target as HTMLInputElement).value))"
                />
                <span class="font-medium text-muted-foreground">节</span>
              </span>
              <button
                type="button"
                class="rounded-lg px-1.5 py-0.5 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-500/10 dark:text-brand-300"
                :data-table-add="section.key"
                @click="addPeriod(section.key)"
              >+ 加一节</button>
            </div>
            <div v-if="!tableForm.periods.some((p) => p.section === section.key)" class="px-1 py-1 text-[10.5px] text-muted-foreground">还没有节次</div>
            <div class="space-y-1">
              <template v-for="(period, index) in tableForm.periods" :key="index">
                <div v-if="period.section === section.key" class="grid grid-cols-[42px_1fr_1fr_22px] items-center gap-1.5">
                  <span class="text-[10.5px] font-semibold tabular-nums text-muted-foreground">第{{ index + 1 }}节</span>
                  <input v-model="period.start" type="time" class="input-field !h-8 !px-2 !text-[11px]" :data-table-period-start="index" />
                  <input v-model="period.end" type="time" class="input-field !h-8 !px-2 !text-[11px]" :data-table-period-end="index" />
                  <button
                    type="button"
                    class="text-muted-foreground transition hover:text-destructive"
                    :data-table-remove="index"
                    @click="removePeriod(index)"
                  >×</button>
                </div>
              </template>
            </div>
          </div>
          </div>
        </div>

        <p class="text-[11px] leading-4 text-muted-foreground">
          一个账号可以建多张表，顶部标签切换；每张表的课程各归各的。每节次的时间段按学校作息自己排（早课/上午/下午/晚课分开），
          新建课程时选节次就直接带出起止时间；课间操、早读可以加一节短的，或当成「课外活动」。
        </p>
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
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
  { key: 'indigo', label: '靛蓝', dot: 'bg-indigo-500', card: 'bg-indigo-50/80 border-indigo-200/80 dark:bg-indigo-500/[0.12] dark:border-indigo-400/25', time: 'text-indigo-600 dark:text-indigo-300', barBg: 'bg-indigo-400', tint: '#6366f1', tabText: 'text-indigo-700 dark:text-indigo-300' },
  { key: 'rose', label: '玫红', dot: 'bg-rose-500', card: 'bg-rose-50/80 border-rose-200/80 dark:bg-rose-500/[0.12] dark:border-rose-400/25', time: 'text-rose-600 dark:text-rose-300', barBg: 'bg-rose-400', tint: '#f43f5e', tabText: 'text-rose-700 dark:text-rose-300' },
  { key: 'emerald', label: '翠绿', dot: 'bg-emerald-500', card: 'bg-emerald-50/80 border-emerald-200/80 dark:bg-emerald-500/[0.12] dark:border-emerald-400/25', time: 'text-emerald-600 dark:text-emerald-300', barBg: 'bg-emerald-400', tint: '#10b981', tabText: 'text-emerald-700 dark:text-emerald-300' },
  { key: 'amber', label: '琥珀', dot: 'bg-amber-500', card: 'bg-amber-50/80 border-amber-200/80 dark:bg-amber-500/[0.12] dark:border-amber-400/25', time: 'text-amber-600 dark:text-amber-300', barBg: 'bg-amber-400', tint: '#f59e0b', tabText: 'text-amber-700 dark:text-amber-300' },
  { key: 'sky', label: '天蓝', dot: 'bg-sky-500', card: 'bg-sky-50/80 border-sky-200/80 dark:bg-sky-500/[0.12] dark:border-sky-400/25', time: 'text-sky-600 dark:text-sky-300', barBg: 'bg-sky-400', tint: '#0ea5e9', tabText: 'text-sky-700 dark:text-sky-300' },
  { key: 'violet', label: '紫罗兰', dot: 'bg-violet-500', card: 'bg-violet-50/80 border-violet-200/80 dark:bg-violet-500/[0.12] dark:border-violet-400/25', time: 'text-violet-600 dark:text-violet-300', barBg: 'bg-violet-400', tint: '#8b5cf6', tabText: 'text-violet-700 dark:text-violet-300' },
  { key: 'teal', label: '青碧', dot: 'bg-teal-500', card: 'bg-teal-50/80 border-teal-200/80 dark:bg-teal-500/[0.12] dark:border-teal-400/25', time: 'text-teal-600 dark:text-teal-300', barBg: 'bg-teal-400', tint: '#14b8a6', tabText: 'text-teal-700 dark:text-teal-300' },
  { key: 'slate', label: '石墨', dot: 'bg-slate-500', card: 'bg-slate-50/80 border-slate-200/80 dark:bg-slate-500/[0.12] dark:border-slate-400/25', time: 'text-slate-600 dark:text-slate-300', barBg: 'bg-slate-400', tint: '#64748b', tabText: 'text-slate-700 dark:text-slate-300' },
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

// 本周一到周日的日期，列头写「周一 10/19」；跨天时也一眼知道是哪天。
const weekDates = computed(() => {
  const now = new Date()
  const dow = now.getDay() === 0 ? 7 : now.getDay()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dow - 1))
  return weekdays.map((day) => {
    const dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day.value - 1)
    return `${dt.getMonth() + 1}/${dt.getDate()}`
  })
})

// 一天分早课 / 上午 / 下午 / 晚课四段（用户 2026-10-18 要求）。
// 每节次的时间段是表设置里自己排的（用户 2026-10-19：「允许设置每节次时间段」），
// 所以换学校作息不用改代码；卡片落在哪一段看它离哪一节最近。
const activeTable = ref<TimetableSummary | null>(null)
const showSlots = ref(localStorage.getItem('timetable.show_slots') !== '0')
watch(showSlots, (on) => localStorage.setItem('timetable.show_slots', on ? '1' : '0'))

const SECTIONS = [
  { key: 'early', label: '早课' },
  { key: 'morning', label: '上午' },
  { key: 'afternoon', label: '下午' },
  { key: 'evening', label: '晚课' },
] as const
type PeriodKey = typeof SECTIONS[number]['key']
const sectionLabel = (key: string) => SECTIONS.find((item) => item.key === key)?.label || '上午'

const pacing = computed(() => ({
  lesson: activeTable.value?.lesson_minutes || 45,
  brk: activeTable.value?.break_minutes ?? 10,
  first: activeTable.value?.first_period || '08:00',
}))

// 骨架直接来自表设置里的节次表：第 N 节 + 自己的起止。空格子不写数据库，
// 点一下才变成真正的课程，所以整周模板不会把空节塞进数据里。
const slots = computed(() => {
  const list = activeTable.value?.periods || []
  return list.map((period, i) => ({
    index: i + 1,
    section: (period.section || 'morning') as PeriodKey,
    start: period.start,
    end: period.end,
  }))
})

const sectionsWithSlots = computed(() => SECTIONS.map((section) => ({
  ...section,
  slots: slots.value.filter((slot) => slot.section === section.key),
})))

function minutesOf(hhmm: string) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// 归段：先看有没有正好对上某节；没有就按四段的「起点」落段
// （早课从 0 点到上午第一节，上午到下午第一节，下午到晚课第一节，之后算晚课）。
// 某一节次没排时，用 12:00 / 18:00 兜底，免得手工加的 19:30 课被塞回下午。
function sectionOfStart(start: string): PeriodKey {
  const list = slots.value
  if (!list.length) return 'morning'
  const at = minutesOf(start)
  const exact = list.find((slot) => slot.start === start)
  if (exact) return exact.section
  const firstStart = (key: PeriodKey, fallback: string) => {
    const own = list.filter((slot) => slot.section === key)
    return own.length ? minutesOf(own[0].start) : minutesOf(fallback)
  }
  const morningAt = firstStart('morning', '12:00')
  const afternoonAt = firstStart('afternoon', '12:00')
  const eveningAt = firstStart('evening', '18:00')
  if (at < morningAt) return 'early'
  if (at < afternoonAt) return 'morning'
  if (at < eveningAt) return 'afternoon'
  return 'evening'
}

const days = computed(() => weekdays.map((day, i) => {
  const own = entries.value
    .filter((entry) => entry.weekday === day.value)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
  return {
    weekday: day.value,
    label: day.label,
    date: weekDates.value[i],
    entries: own,
    periods: SECTIONS
      .map((period) => {
        const ownInSection = own.filter((entry) => sectionOfStart(entry.start_time) === period.key)
        const taken = new Set(ownInSection.map((entry) => entry.start_time))
        const items = [
          ...ownInSection.map((entry) => ({ kind: 'entry' as const, at: entry.start_time, entry })),
          ...(showSlots.value ? slots.value : [])
            .filter((slot) => slot.section === period.key && !taken.has(slot.start))
            .map((slot) => ({ kind: 'slot' as const, at: slot.start, slot })),
        ].sort((a, b) => a.at.localeCompare(b.at))
        return { ...period, items, count: ownInSection.length }
      })
      .filter((period) => period.items.length > 0),
  }
}))

// 每张表带一个稳定的浅彩色（按表 id 落在色板里），标签、底板光晕与它自己的课程同色系。
function tableAccent(table: TimetableSummary) {
  return palette[(table.id - 1 + palette.length) % palette.length]
}
const activeAccent = computed(() => {
  const current = tables.value.find((t) => t.id === activeId.value)
  return current ? tableAccent(current) : palette[0]
})
const shellGlow = computed(() => `radial-gradient(760px 300px at 12% -20%, ${activeAccent.value.tint}1f, transparent 68%)`)

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
  activeTable.value = res.data.data?.table || null
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
type DraftPeriod = { section: PeriodKey; start: string; end: string }
const tableForm = reactive({
  lesson: 45, brk: 10, first: '08:00',
  periods: [] as DraftPeriod[],
})

function openTableSettings() {
  // 节次表在详情接口里（列表接口只有摘要），所以以 activeTable 为准。
  const current = activeTable.value?.id === activeId.value
    ? activeTable.value
    : tables.value.find((t) => t.id === activeId.value)
  if (!current) return
  tableName.value = current.name
  tableForm.lesson = pacing.value.lesson
  tableForm.brk = pacing.value.brk
  tableForm.first = pacing.value.first
  tableForm.periods = (current.periods || []).map((period) => ({
    section: (period.section || 'morning') as PeriodKey,
    start: period.start,
    end: period.end,
  }))
  tableError.value = ''
  tableOpen.value = true
}

// 加一节：接在该段最后一节后面（没有就接在上一段后面），时长按「一节课」。
function addPeriod(section: PeriodKey) {
  const list = tableForm.periods
  const inSection = list.filter((period) => period.section === section)
  const previous = inSection.length
    ? inSection[inSection.length - 1]
    : [...list].reverse()[0]
  const start = previous ? addMinutes(previous.end, tableForm.brk) : (tableForm.first || '08:00')
  const insertAt = inSection.length
    ? list.map((period, i) => (period.section === section ? i + 1 : -1)).filter((i) => i >= 0).pop() ?? list.length
    : list.length
  list.splice(insertAt as number, 0, { section, start, end: addMinutes(start, tableForm.lesson) })
}

// 直接改「几节」：多了按课时/课间往后补，少了从这一段的末尾删。
function setSectionCount(section: PeriodKey, raw: number) {
  const list = tableForm.periods
  const own = list.filter((period) => period.section === section)
  const target = Math.max(0, Math.min(16, Math.round(raw || 0)))
  if (target === own.length) return
  if (target > own.length) {
    for (let i = own.length; i < target; i += 1) addPeriod(section)
    return
  }
  let removed = 0
  for (let i = list.length - 1; i >= 0 && removed < own.length - target; i -= 1) {
    if (list[i].section === section) {
      list.splice(i, 1)
      removed += 1
    }
  }
}

function removePeriod(index: number) {
  tableForm.periods.splice(index, 1)
}

// 按「一节课 + 课间」从第一节课开始重排，段结构不动。
function regenerateAll() {
  const first = tableForm.first || '08:00'
  tableForm.periods = tableForm.periods.map((period, i) => {
    const start = addMinutes(first, i * (tableForm.lesson + tableForm.brk))
    return { ...period, start, end: addMinutes(start, tableForm.lesson) }
  })
}

async function saveTableSettings() {
  const name = tableName.value.trim()
  if (!name) { tableError.value = '名字不能为空'; return }
  if (!tableForm.periods.length) { tableError.value = '至少留一节课'; return }
  for (let i = 0; i < tableForm.periods.length; i += 1) {
    const period = tableForm.periods[i]
    if (!period.start || !period.end) { tableError.value = `第 ${i + 1} 节没填时间`; return }
    if (period.end <= period.start) { tableError.value = `第 ${i + 1} 节的结束要晚于开始`; return }
    if (i > 0 && period.start < tableForm.periods[i - 1].end) {
      tableError.value = `第 ${i + 1} 节和第 ${i} 节叠在一起了`
      return
    }
  }
  savingTable.value = true
  tableError.value = ''
  try {
    const res = await updateTimetable(activeId.value, {
      name,
      lesson_minutes: tableForm.lesson,
      break_minutes: tableForm.brk,
      first_period: tableForm.first,
      periods: tableForm.periods,
    })
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

// 把 HH:MM 往后推 n 分钟；跨过 23:59 就卡在当天最后一分钟，不滚到第二天。
function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number)
  const total = Math.min(23 * 60 + 59, (h || 0) * 60 + (m || 0) + minutes)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function blankEntry(start = '08:00'): EntryInput {
  return {
    title: '', kind: 'course', weekday: todayWeekday,
    start_time: start, end_time: addMinutes(start, pacing.value.lesson),
    location: '', teacher: '', note: '', color: palette[0].key,
  }
}

// 新的一节默认接在当天最后一节后面（结束时间 + 课间），没有课就从 08:00 开始。
function nextStartFor(weekday: number) {
  const own = entries.value
    .filter((entry) => entry.weekday === weekday)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
  const last = own[own.length - 1]
  return last ? addMinutes(last.end_time, pacing.value.brk) : '08:00'
}

function openNewEntry(weekday: number, start?: string) {
  entryEditing.value = null
  const at = start || nextStartFor(weekday)
  Object.assign(form, blankEntry(at), { weekday, start_time: at })
  form.end_time = addMinutes(at, pacing.value.lesson)
  entryError.value = ''
  entryOpen.value = true
}

const selectedSlotIndex = computed(() => slots.value.find((slot) => slot.start === form.start_time)?.index || 0)

function onPickSlot(event: Event) {
  const index = Number((event.target as HTMLSelectElement).value)
  const slot = slots.value.find((item) => item.index === index)
  if (!slot) return
  form.start_time = slot.start
  form.end_time = slot.end
}

// 改了开始时间就按「一节课」重算结束；想手动改结束仍然可以。
function syncEndFromStart() {
  if (!form.start_time) return
  form.end_time = addMinutes(form.start_time, pacing.value.lesson)
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
.timetable-tabs {
  @apply flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-2xl border border-border bg-surface/85 p-1 shadow-sm backdrop-blur;
  scrollbar-width: none;
}
.timetable-tabs::-webkit-scrollbar { display: none; }
.timetable-tab {
  @apply inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-bold text-muted-foreground transition duration-150;
}
.timetable-tab:hover { @apply bg-muted/70 text-foreground; }
.timetable-tab-dot { @apply h-2 w-2 rounded-full opacity-90; }
.timetable-tab-count {
  @apply rounded-md bg-foreground/[0.07] px-1 py-0.5 text-[10px] font-semibold leading-none opacity-80;
}

/* 七天共用一块底板：列间只留 1px 细线，整块像一张纸上的周历 */
.timetable-shell { @apply overflow-hidden rounded-[22px] border border-border bg-surface bg-no-repeat shadow-sm; }
.timetable-grid { @apply grid grid-cols-1 gap-px bg-border/70 sm:grid-cols-2 xl:grid-cols-7; }
.timetable-day { @apply flex min-h-[13rem] flex-col gap-2 bg-surface p-3; }
.timetable-day-today { @apply bg-brand-500/[0.035]; }
.timetable-day-head { @apply flex items-center justify-between pb-0.5; }
.timetable-day-name { @apply text-[12.5px] font-extrabold tracking-wide; }
.timetable-day-date { @apply text-[10.5px] font-semibold tabular-nums text-muted-foreground/80; }
.timetable-day-count { @apply text-[10px] font-semibold tabular-nums text-muted-foreground/60; }
.timetable-today {
  @apply rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[9.5px] font-bold leading-none text-brand-600 dark:text-brand-300;
}

.timetable-card { @apply relative flex overflow-hidden rounded-xl border p-2.5 pl-3 text-left transition duration-150; }
.timetable-card:hover { @apply -translate-y-0.5 shadow-md; }
.timetable-card-bar { @apply absolute inset-y-1.5 left-0 w-[3px] rounded-full; }
.timetable-card-activity { @apply border-dashed; }
.timetable-card-time { @apply whitespace-nowrap text-[10.5px] font-bold tabular-nums leading-4 text-foreground/60; }
.timetable-card-title { @apply mt-0.5 truncate text-[13px] font-bold leading-5 text-foreground; }
.timetable-card-meta { @apply truncate text-[10.5px] leading-4 text-foreground/55; }
.timetable-activity-tag {
  @apply shrink-0 whitespace-nowrap rounded bg-surface/70 px-1 py-px text-[9px] font-bold leading-4 text-foreground/60;
}

.timetable-period { @apply flex flex-col gap-1.5; }
.timetable-period + .timetable-period { @apply mt-1; }
.timetable-period-label {
  @apply flex items-center gap-1 px-0.5 text-[10px] font-bold tracking-wide text-muted-foreground/70;
}
.timetable-period-label::after {
  content: '';
  @apply h-px flex-1 bg-border/70;
}
.timetable-period-count { @apply tabular-nums text-[9.5px] font-semibold text-muted-foreground/50; }

.timetable-slot {
  @apply flex items-center gap-1.5 rounded-lg border border-dashed border-border/70 px-2 py-1 text-left text-muted-foreground/70 transition;
}
.timetable-slot:hover { @apply border-brand-300 bg-brand-50/40 text-brand-700 dark:border-brand-400/40 dark:bg-brand-500/[0.06] dark:text-brand-300; }
.timetable-slot-index { @apply text-[10px] font-bold tabular-nums; }
.timetable-slot-time { @apply text-[10px] tabular-nums opacity-70; }

.timetable-add {
  @apply mt-auto flex items-center justify-center gap-1 rounded-lg border border-dashed border-border/80 py-1.5 text-[11px] font-semibold text-muted-foreground/70 transition;
}
.timetable-add:hover { @apply border-brand-400 bg-brand-500/5 text-brand-600 dark:text-brand-300; }

.timetable-kind { @apply rounded-xl border border-border py-2 text-xs font-bold text-muted-foreground transition; }
.timetable-kind-on { @apply border-brand-400 bg-brand-500/10 text-brand-600 dark:text-brand-300; }
</style>
