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
        :style="cardStyle(entry)"
        :data-ceremony-card="entry.id"
        :data-ceremony-days="entry.days"
        :data-ceremony-bg="entry.accent || 'default'"
      >
        <!-- 倒计时**放到最上面、放大**（用户 2026-10-10 要求：卡片加高、倒计时醒目）：
             天数用 30px 的字、单位小一号，整块带底色，一眼就能看到还有多少天。 -->
        <div
          class="ceremony-hero"
          :class="entry.daysClass"
          :style="heroStyle(entry)"
          :data-ceremony-countdown="entry.id"
          :data-ceremony-accent="entry.accent || 'default'"
        >
          <template v-if="entry.days === 0">就是<b>今天</b></template>
          <template v-else-if="entry.days === 1">还有 <b>1</b> 天</template>
          <template v-else-if="entry.days > 1">还有 <b>{{ entry.days }}</b> 天</template>
          <template v-else>已过 <b>{{ -entry.days }}</b> 天</template>
        </div>
        <!-- 图标挪到内容**左侧**并放大 2 倍（用户 2026-10-12：「图标放内容左侧放大2倍」）；
             名称 / 时间 / 循环 / 次数等一并放大。整组（图标 + 文字）在卡片里居中。 -->
        <div class="ceremony-body">
          <span class="ceremony-icon"><ListIcon :name="entry.icon" :size="44" /></span>
          <div class="min-w-0 text-left">
            <h3 class="ceremony-title" :data-ceremony-title="entry.id">{{ entry.title }}</h3>
            <p class="ceremony-date">
              {{ entry.dateLabel }}
              <span v-if="entry.lunar" class="tiny-badge ml-1">农历</span>
              <span v-if="entry.repeatLabel" class="tiny-badge ml-1">{{ entry.repeatLabel }}</span>
            </p>
            <p v-if="entry.cycle > 0 || entry.notes" class="ceremony-extra">
              <span v-if="entry.cycle > 0" class="tiny-badge" :data-ceremony-cycle="entry.id">第 {{ entry.cycle }} 次</span>
              <span v-if="entry.notes" class="truncate">{{ entry.notes }}</span>
            </p>
          </div>
        </div>
        <div class="ceremony-actions">
          <span class="flex items-center gap-1">
            <button class="row-action !opacity-100" title="编辑" :data-ceremony-edit="entry.id" @click="edit(entry)">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="M4 20h4L20 8l-4-4L4 16v4Z" stroke-width="1.7" stroke-linejoin="round"/></svg>
            </button>
            <button class="row-action !opacity-100 hover:!text-rose-500" title="删除" :data-ceremony-delete="entry.id" @click="askRemove(entry)">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
        <!-- 卡片过渡色（用户 2026-10-11 要求：多种过渡色、可自行选择） -->
        <div class="field-label">
          卡片颜色
          <div class="mt-1.5 flex flex-wrap gap-1.5" data-ceremony-form-accents>
            <button
              v-for="a in CARD_ACCENTS"
              :key="a.key || 'default'"
              type="button"
              class="accent-swatch"
              :class="{ selected: form.accent === a.key }"
              :style="{ background: swatchGradient(a) }"
              :title="a.label"
              :aria-label="`卡片颜色：${a.label}`"
              :data-ceremony-form-accent="a.key || 'default'"
              @click="form.accent = a.key"
            ><span v-if="form.accent === a.key">✓</span></button>
          </div>
        </div>
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
import { CARD_ACCENTS, cardInk, cardTint, heroGradient, heroInk, softInk, type CardAccent } from '../utils/card-accents'
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

const form = reactive({ title: '', dueAt: '' as string, repeat: 'yearly', calendar: 'solar', accent: '' })

/** 色板按钮的底色 */
const swatchGradient = (a: CardAccent) => `linear-gradient(135deg, ${a.from} 0%, ${a.to} 100%)`
/**
 * 倒计时块：选了颜色用该色的浓郁渐变 + 配套字色；「默认」档也给一档**浅色**
 * （按 id 稳定随机，见 utils/card-accents.ts），不再是一块死灰。
 */
function heroStyle(entry: { accent?: string; id: number }) {
  return { background: heroGradient(entry.accent, entry.id), color: heroInk(entry.accent, entry.id) }
}
/**
 * 整卡底色 + **配套的字色**（用户 2026-10-11：纯白不好看 → 加浅色底；
 * 接着又报「浅色背景影响字体显示，字体是白色的，自动调整字体颜色」）。
 * 默认档的浅色卡面是不透明浅底，这里按卡面颜色自动给一套深字（含次级文字的柔化色）；
 * 选了颜色的卡面只是薄薄一层同色系浅淡底，字色交回主题。
 */
function cardStyle(entry: { accent?: string; id: number }) {
  const style: Record<string, string> = { backgroundImage: cardTint(entry.accent, entry.id) }
  const ink = cardInk(entry.accent, entry.id)
  if (ink) {
    style.color = ink
    style['--ceremony-ink-soft'] = softInk(ink)
  }
  return style
}

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
      undated: days === null,
      daysClass: days === null ? '' : days < 0 ? 'ceremony-days-past' : days <= 7 ? 'ceremony-days-soon' : '',
      lunar,
      dateLabel: d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` : '未设日期',
      repeatLabel: repeatLabelOf(item.repeat_rule),
      cycle: item.cycle_index || 0,
      accent: item.accent || '',
    }
  })
  // 排序（用户 2026-10-11 要求「倒计时最短的在最前边，以此类推」）：
  //   ① 还没到的按「还有 N 天」从小到大（就是今天 0 → 1 天 → 2 天 …）；
  //   ② 「已过 N 天」的排到最后（过得最少的在前 —— 它离下一次最近）；
  //   ③ 没日期的排最末。
  // 原来直接 `a.days - b.days`，负数（已过）会顶到最前面，一开页先看到「已过 2817 天」。
  .sort((a, b) => {
    const key = (e: { days: number; undated: boolean }) => (e.undated ? 2_000_000 : e.days >= 0 ? e.days : 1_000_000 + -e.days)
    return key(a) - key(b)
  }))

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
  Object.assign(form, { title: '', dueAt: toLocalIso(d), repeat: 'yearly', calendar: 'solar', accent: '' })
  createOpen.value = true
}

function edit(entry: ReminderItem) {
  editingId.value = entry.id
  Object.assign(form, {
    title: entry.title,
    dueAt: entry.due_at || '',
    repeat: entry.repeat_rule === 'none' ? 'none' : entry.repeat_rule,
    calendar: entry.calendar === 'lunar' ? 'lunar' : 'solar',
    accent: entry.accent || '',
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
      accent: form.accent,
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
/* 卡片加高（用户要求）：倒计时独占最上面一行，所以卡片比原来高、信息也不会挤。
   2026-10-11 用户又说「倒计时还不够显眼，继续放大」——数字从 30px 提到 44px（手机 36px），
   底色更实、上下留白更多，整块成为卡片的视觉重心。 */
/* 底色由 cardStyle() 内联给（浅色随机 / 同色系浅淡版），这里只保证圆角、内边距与居中；
   不加 bg-* 类，免得把内联的渐变盖掉。深色主题下这些浅色只是很淡的一层，不刺眼。 */
.ceremony-card { @apply flex min-h-[11rem] flex-col items-stretch rounded-2xl p-4 text-center transition-shadow hover:shadow-[0_18px_40px_-30px_rgba(15,23,42,.6)]; }
/* 图标：从 36px 方框 / 22px 图标放大 2 倍 → 64px 方框 / 44px 图标（用户 2026-10-12） */
.ceremony-icon { @apply flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500; }
/* 内容整组（图标 + 文字）在卡片里居中，文字内部左对齐 */
.ceremony-body { @apply mt-3 flex items-center justify-center gap-3; }
.ceremony-actions { @apply mt-2.5 flex items-center justify-center gap-2 text-center text-[13px] font-semibold text-muted-foreground; }
/* 名称 / 时间 / 次数都放大（用户 2026-10-12：「所有内容均放大」） */
.ceremony-title { @apply truncate text-[19px] font-extrabold leading-6; }
.ceremony-date { @apply mt-1 text-[14px] font-semibold leading-5 text-muted-foreground; }
.ceremony-extra { @apply mt-1 flex flex-wrap items-center gap-1 text-[13px] font-semibold text-muted-foreground; }
/* 卡面上的小徽标（农历 / 每年 / 第 N 次）也跟着放大一号 */
.ceremony-card .tiny-badge { @apply px-2 py-0.5 text-[12px]; }
/* 浅色卡面（默认档）上：次级文字与行内按钮改用卡面配套的深字，避免深色主题下白字糊在浅底上 */
.ceremony-card[data-ceremony-bg='default'] .ceremony-date,
.ceremony-card[data-ceremony-bg='default'] .tiny-badge,
.ceremony-card[data-ceremony-bg='default'] .row-action { color: var(--ceremony-ink-soft); }
/* 倒计时：大字 + 底色，放在卡片最上面 */
.ceremony-hero { @apply flex items-baseline justify-center gap-2 rounded-xl bg-muted/70 px-3.5 py-3 text-center text-[16px] font-extrabold leading-none text-foreground sm:px-4; }
.ceremony-hero b { @apply text-[36px] font-black leading-none tracking-tight sm:text-[44px]; }
.ceremony-days-soon { @apply bg-amber-500/15 text-amber-600 dark:text-amber-400; }
.ceremony-days-past { @apply bg-muted/50 text-muted-foreground; }
.accent-swatch { @apply flex h-7 w-7 items-center justify-center rounded-full border-2 border-transparent text-[12px] font-black text-white/95 shadow-sm transition hover:scale-105; }
.accent-swatch.selected { @apply border-foreground/60 ring-2 ring-brand-500/40; }
.ceremony-preset { @apply flex items-center gap-2.5 rounded-xl border border-border/70 bg-surface px-3 py-2 text-left transition hover:border-brand-500/40 hover:bg-muted/40; }
.field-label { @apply block text-[11px] font-bold text-muted-foreground; }
</style>
