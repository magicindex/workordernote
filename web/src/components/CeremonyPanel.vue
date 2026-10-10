<template>
  <!-- 「人生要有仪式感」栏目页：把这一栏里的事项做成**倒计时卡片**。
       生日、结婚纪念日、情人节、七夕、中秋、高考……这些「一年一次」的事，
       最关心的就是「还有多少天」，所以卡片上最显眼的就是那个天数。 -->
  <section class="space-y-3" data-ceremony-panel>
    <div class="flex flex-wrap items-center gap-2">
      <button class="btn-primary !h-9 !px-4 !text-xs" data-ceremony-add @click="openCreate()">＋ 新建事项</button>
      <button class="btn-secondary !h-9 !px-3 !text-xs" data-ceremony-presets @click="presetOpen = true">常用事项模板</button>
      <span class="ml-auto text-[11px] font-semibold text-muted-foreground" data-ceremony-count>
        共 {{ cards.length }} 项
      </span>
    </div>

    <p v-if="!loading && !cards.length" class="surface rounded-2xl px-4 py-6 text-center text-sm text-muted-foreground">
      还没有事项。点「常用事项模板」一键添加生日、结婚纪念日、情人节、七夕、中秋、高考……
      也可以自己「新建事项」。
    </p>

    <!-- 倒计时卡片：近的排前面 -->
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="entry in cards"
        :key="entry.id"
        class="surface ceremony-card"
        :data-ceremony-card="entry.id"
        :data-ceremony-days="entry.days"
      >
        <div class="flex items-start gap-2">
          <span class="ceremony-icon"><ListIcon :name="entry.icon" :size="22" /></span>
          <div class="min-w-0 flex-1">
            <h3 class="ceremony-title" :data-ceremony-title="entry.id">{{ entry.title }}</h3>
            <p class="ceremony-date">
              {{ entry.dateLabel }}
              <span v-if="entry.lunar" class="tiny-badge ml-1">农历</span>
              <span v-if="entry.repeatLabel" class="tiny-badge ml-1">{{ entry.repeatLabel }}</span>
            </p>
          </div>
          <div class="ceremony-days" :class="entry.daysClass" :data-ceremony-countdown="entry.id">
            <template v-if="entry.days === 0">今天</template>
            <template v-else-if="entry.days === 1">明天</template>
            <template v-else-if="entry.days > 1">还有 <b>{{ entry.days }}</b> 天</template>
            <template v-else>已过 {{ -entry.days }} 天</template>
          </div>
        </div>
        <div class="mt-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
          <span v-if="entry.cycle > 0" class="tiny-badge" :data-ceremony-cycle="entry.id">第 {{ entry.cycle }} 次</span>
          <span v-if="entry.notes" class="truncate">{{ entry.notes }}</span>
          <span class="ml-auto flex items-center gap-1">
            <button class="row-action !opacity-100" title="编辑" :data-ceremony-edit="entry.id" @click="edit(entry)">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M4 20h4L20 8l-4-4L4 16v4Z" stroke-width="1.7" stroke-linejoin="round"/></svg>
            </button>
            <button class="row-action !opacity-100 hover:!text-rose-500" title="删除" :data-ceremony-delete="entry.id" @click="askRemove(entry)">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </span>
        </div>
      </article>
    </div>

    <!-- 常用事项模板：一键创建（固定日期的节日直接算下一次；生日/纪念日/中考要选日期） -->
    <Modal v-model="presetOpen" title="常用事项模板" size="lg">
      <p class="mb-3 text-xs text-muted-foreground">
        点一个模板就会在这一栏里建好条目（每年自动重复）。生日、结婚纪念日、中考/高考这类
        需要填日期的，选好日期再确定。
      </p>
      <div class="grid gap-2 sm:grid-cols-2">
        <button
          v-for="preset in PRESETS"
          :key="preset.key"
          class="ceremony-preset"
          :data-ceremony-preset="preset.key"
          @click="choosePreset(preset)"
        >
          <ListIcon :name="preset.icon" :size="18" />
          <span class="min-w-0 flex-1 text-left">
            <span class="block text-[13px] font-bold">{{ preset.label }}</span>
            <span class="block text-[11px] text-muted-foreground">{{ preset.hint }}</span>
          </span>
        </button>
      </div>
    </Modal>

    <!-- 填日期 / 改名字（模板与「新建事项」共用） -->
    <Modal v-model="createOpen" :title="editingId ? '编辑事项' : '新建事项'" size="lg">
      <div class="space-y-3">
        <label class="field-label">名称
          <input v-model="form.title" class="compact-input mt-1" maxlength="100" data-ceremony-form-title placeholder="例如：妈妈生日" />
        </label>
        <div class="field-label relative">
          日期
          <button ref="dateAnchor" type="button" class="compact-input mt-1 flex h-9 w-full items-center justify-between px-3 text-left text-xs" data-ceremony-form-date @click="dateOpen = !dateOpen">
            <span>{{ form.dueAt ? formatFull(form.dueAt) : '选择日期' }}</span>
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 text-muted-foreground" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.8"/><path d="M8 3v4m8-4v4M3 10h18" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
          <LunarDatePicker v-if="dateOpen" v-model="datePicked" with-time :anchor-el="dateAnchor" @commit="dateOpen = false" />
        </div>
        <label class="field-label">重复
          <select v-model="form.repeat" class="compact-input mt-1" data-ceremony-form-repeat>
            <option value="yearly">每年</option>
            <option value="monthly">每月</option>
            <option value="none">不重复</option>
          </select>
        </label>
        <label class="field-label">按农历
          <select v-model="form.calendar" class="compact-input mt-1" data-ceremony-form-calendar>
            <option value="solar">公历</option>
            <option value="lunar">农历</option>
          </select>
        </label>
        <p class="text-[11px] text-muted-foreground">
          农历 + 每年 = 按农历月日重复（生日、七夕、中秋、春节都用这个）。
        </p>
      </div>
      <div class="mt-4 flex items-center justify-end gap-2">
        <button class="btn-secondary !h-9 !px-4 !text-xs" @click="createOpen = false">取消</button>
        <button class="btn-primary !h-9 !px-4 !text-xs" :disabled="saving || !form.title.trim() || !form.dueAt" data-ceremony-form-save @click="save">保存</button>
      </div>
    </Modal>

    <ConfirmDialog
      :model-value="!!removeTarget"
      danger
      title="删除事项"
      :message="`确定删除「${removeTarget?.title || ''}」吗？倒计时记录会一起消失。`"
      confirm-text="删除"
      @update:model-value="(v: boolean) => { if (!v) removeTarget = null }"
      @confirm="confirmRemove"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import Modal from './Modal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import ListIcon from './ListIcon.vue'
import LunarDatePicker from './LunarDatePicker.vue'
import { createReminder, deleteReminder, updateReminder, convertLunarDate, getReminders, type ReminderItem, type SaveReminderInput } from '../api/reminder'

const props = defineProps<{ list: { id: number; name: string } }>()
const emit = defineEmits<{ (e: 'changed'): void; (e: 'toast', message: string, type?: 'success' | 'error'): void }>()

const items = ref<ReminderItem[]>([])
const loading = ref(true)
const saving = ref(false)
const presetOpen = ref(false)
const createOpen = ref(false)
const dateOpen = ref(false)
const dateAnchor = ref<HTMLElement | null>(null)
const editingId = ref<number | null>(null)
const removeTarget = ref<ReminderItem | null>(null)

const form = reactive({ title: '', dueAt: '' as string, repeat: 'yearly', calendar: 'solar' })

const datePicked = computed({
  get: () => (form.dueAt ? new Date(form.dueAt) : null),
  set: (v: Date | null) => { form.dueAt = v ? toLocalIso(v) : '' },
})

function toLocalIso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
function formatFull(v: string) {
  const d = new Date(v)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function repeatLabelOf(rule: string) {
  return ({ yearly: '每年', monthly: '每月', daily: '每天', weekly: '每周' } as Record<string, string>)[rule] || ''
}

/** 还有几天（按自然日算，今天=0，明天=1，已过=负数）。 */
function daysUntil(iso: string | null | undefined) {
  if (!iso) return null
  const d = new Date(iso)
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  return Math.round((midnight(d) - midnight(new Date())) / 86400000)
}

const cards = computed(() => items.value
  .map((item) => {
    const days = daysUntil(item.due_at)
    const lunar = item.calendar === 'lunar'
    const d = item.due_at ? new Date(item.due_at) : null
    return {
      ...item,
      icon: item.kind === 'note' ? 'notebook' : (item.repeat_rule === 'yearly' && /生日|纪念/.test(item.title) ? 'cake' : 'ceremony'),
      days: days ?? 9999,
      daysClass: days === null ? '' : days < 0 ? 'ceremony-days-past' : days <= 7 ? 'ceremony-days-soon' : '',
      lunar,
      dateLabel: d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` : '未设日期',
      repeatLabel: repeatLabelOf(item.repeat_rule),
      cycle: item.cycle_index || 0,
    }
  })
  .sort((a, b) => a.days - b.days))

async function load() {
  loading.value = true
  try {
    const res = await getReminders({ view: 'all', status: 'all', list_id: props.list.id, sort: 'created_desc' })
    items.value = res.data?.data || []
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

watch(() => props.list.id, () => { void load() }, { immediate: true })
onMounted(() => { if (!items.value.length) void load() })

function openCreate() {
  editingId.value = null
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  Object.assign(form, { title: '', dueAt: toLocalIso(d), repeat: 'yearly', calendar: 'solar' })
  createOpen.value = true
}

function edit(entry: ReminderItem) {
  editingId.value = entry.id
  Object.assign(form, {
    title: entry.title,
    dueAt: entry.due_at || '',
    repeat: entry.repeat_rule === 'none' ? 'none' : entry.repeat_rule,
    calendar: entry.calendar === 'lunar' ? 'lunar' : 'solar',
  })
  createOpen.value = true
}

async function save() {
  if (saving.value || !form.title.trim() || !form.dueAt) return
  saving.value = true
  try {
    const payload: SaveReminderInput = {
      title: form.title.trim(),
      kind: 'task',
      list_id: props.list.id,
      due_at: form.dueAt,
      repeat_rule: form.repeat as SaveReminderInput['repeat_rule'],
      calendar: form.calendar as SaveReminderInput['calendar'],
      channels: ['inapp'],
    }
    if (editingId.value) await updateReminder(editingId.value, { ...payload, version: items.value.find((i) => i.id === editingId.value)?.version })
    else await createReminder(payload)
    createOpen.value = false
    presetOpen.value = false
    await load()
    emit('changed')
    emit('toast', editingId.value ? '事项已保存' : '事项已添加')
  } catch (err: any) {
    emit('toast', err?.response?.data?.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function askRemove(entry: ReminderItem) { removeTarget.value = entry }
async function confirmRemove() {
  const target = removeTarget.value
  removeTarget.value = null
  if (!target) return
  try {
    await deleteReminder(target.id)
    await load()
    emit('changed')
    emit('toast', '事项已删除')
  } catch (err: any) {
    emit('toast', err?.response?.data?.message || '删除失败', 'error')
  }
}

/**
 * 常用事项模板。
 * needsDate = 需要用户填日期（生日/纪念日/考试），其余是固定日期的节日（自动算下一次）。
 * lunar = 按农历月日（七夕/中秋/春节…），创建时用服务端的农历换算接口算下一次的公历日期，
 * 并把农历锚点一起存进去（这样每年都能按农历重复）。
 */
const PRESETS: { key: string; label: string; hint: string; icon: string; title: string; needsDate?: boolean; lunar?: boolean; month?: number; day?: number }[] = [
  { key: 'birthday-solar', label: '生日（公历）', hint: '填出生日期，每年重复', icon: 'cake', title: '生日', needsDate: true },
  { key: 'birthday-lunar', label: '生日（农历）', hint: '填农历生日，每年按农历重复', icon: 'cake', title: '生日', needsDate: true, lunar: true },
  { key: 'anniversary', label: '结婚纪念日', hint: '填结婚日期，每年重复', icon: 'ceremony', title: '结婚纪念日', needsDate: true },
  { key: 'golden-wedding', label: '金婚纪念', hint: '结婚 50 周年（填结婚日期）', icon: 'ceremony', title: '金婚纪念', needsDate: true },
  { key: 'valentine', label: '情人节', hint: '2 月 14 日', icon: 'ceremony', title: '情人节', month: 2, day: 14 },
  { key: 'qixi', label: '七夕', hint: '农历七月初七', icon: 'ceremony', title: '七夕', lunar: true, month: 7, day: 7 },
  { key: 'mid-autumn', label: '中秋', hint: '农历八月十五', icon: 'ceremony', title: '中秋节', lunar: true, month: 8, day: 15 },
  { key: 'spring-festival', label: '春节', hint: '农历正月初一', icon: 'ceremony', title: '春节', lunar: true, month: 1, day: 1 },
  { key: 'dragon-boat', label: '端午', hint: '农历五月初五', icon: 'ceremony', title: '端午节', lunar: true, month: 5, day: 5 },
  { key: 'lantern', label: '元宵', hint: '农历正月十五', icon: 'ceremony', title: '元宵节', lunar: true, month: 1, day: 15 },
  { key: 'national-day', label: '国庆节', hint: '10 月 1 日', icon: 'ceremony', title: '国庆节', month: 10, day: 1 },
  { key: 'new-year', label: '元旦', hint: '1 月 1 日', icon: 'ceremony', title: '元旦', month: 1, day: 1 },
  { key: 'gaokao', label: '高考', hint: '6 月 7 日', icon: 'ceremony', title: '高考', month: 6, day: 7 },
  { key: 'zhongkao', label: '中考', hint: '填当地中考日期', icon: 'ceremony', title: '中考', needsDate: true },
]

function nextSolar(month: number, day: number) {
  const now = new Date()
  let d = new Date(now.getFullYear(), month - 1, day, 9, 0, 0, 0)
  if (d.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    d = new Date(now.getFullYear() + 1, month - 1, day, 9, 0, 0, 0)
  }
  return d
}

async function nextLunar(month: number, day: number) {
  const now = new Date()
  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    try {
      const res = await convertLunarDate({ lunar_year: year, lunar_month: month, lunar_day: day })
      const d = res.data?.data
      if (!d) continue
      const when = new Date(d.year, d.month - 1, d.day, 9, 0, 0, 0)
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (when.getTime() >= today.getTime()) return when
    } catch { /* 换下一年 */ }
  }
  return null
}

async function choosePreset(preset: (typeof PRESETS)[number]) {
  editingId.value = null
  if (preset.needsDate) {
    // 需要日期的：把表单填好让用户选日期（农历生日让他用农历选择器）
    const d = new Date()
    d.setHours(9, 0, 0, 0)
    Object.assign(form, {
      title: preset.title,
      dueAt: toLocalIso(d),
      repeat: 'yearly',
      calendar: preset.lunar ? 'lunar' : 'solar',
    })
    presetOpen.value = false
    createOpen.value = true
    return
  }
  const when = preset.lunar && preset.month && preset.day
    ? await nextLunar(preset.month, preset.day)
    : preset.month && preset.day ? nextSolar(preset.month, preset.day) : null
  if (!when) {
    emit('toast', '算不出下一次日期，请手动新建', 'error')
    return
  }
  saving.value = true
  try {
    await createReminder({
      title: preset.title,
      kind: 'task',
      list_id: props.list.id,
      due_at: toLocalIso(when),
      repeat_rule: 'yearly',
      calendar: preset.lunar ? 'lunar' : 'solar',
      channels: ['inapp'],
    })
    presetOpen.value = false
    await load()
    emit('changed')
    emit('toast', `已添加「${preset.title}」`)
  } catch (err: any) {
    emit('toast', err?.response?.data?.message || '添加失败', 'error')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.ceremony-card { @apply rounded-2xl p-3.5 transition-shadow hover:shadow-[0_18px_40px_-30px_rgba(15,23,42,.6)]; }
.ceremony-icon { @apply flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500; }
.ceremony-title { @apply truncate text-[15px] font-extrabold leading-5; }
.ceremony-date { @apply mt-0.5 text-[11px] font-semibold text-muted-foreground; }
.ceremony-days { @apply shrink-0 rounded-xl bg-muted/70 px-2.5 py-1 text-[12px] font-bold text-foreground; }
.ceremony-days b { @apply text-[16px] leading-none; }
.ceremony-days-soon { @apply bg-amber-500/15 text-amber-600 dark:text-amber-400; }
.ceremony-days-past { @apply bg-muted/50 text-muted-foreground; }
.ceremony-preset { @apply flex items-center gap-2.5 rounded-xl border border-border/70 bg-surface px-3 py-2 text-left transition hover:border-brand-500/40 hover:bg-muted/40; }
.field-label { @apply block text-[11px] font-bold text-muted-foreground; }
</style>
