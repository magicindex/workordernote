<template>
  <!-- 信用卡账单栏目：一张张卡（卡面样式）+ 本期应还 + 还款闭环 + 还款计划，
       下面是那条「今天 + 本周待还」长条卡片。这一页只做卡片相关的事：
       要加卡片就点右上角「新建卡片」。 -->
  <section v-if="isCardList" class="mb-3" data-card-panel>
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 class="flex items-center gap-2 text-sm font-extrabold">
        我的卡片
        <span class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{{ cards.length }} 张</span>
      </h3>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn-secondary !h-8 !px-3 !text-[11px]" :disabled="loading" data-card-refresh @click="load">
          {{ loading ? '读取中…' : '刷新' }}
        </button>
        <button class="btn-primary !h-8 !px-3 !text-[11px]" data-card-add @click="openCreate">+ 新建卡片</button>
      </div>
    </div>

    <p v-if="!cards.length && !loading" class="surface rounded-2xl px-4 py-6 text-center text-sm text-muted-foreground" data-card-empty>
      还没有卡片。点「+ 新建卡片」填银行、卡名、账单日与还款日，系统会自动生成账单日/还款日提醒。
    </p>

    <div class="grid gap-3 lg:grid-cols-2">
      <article v-for="card in cards" :key="card.id" class="surface rounded-2xl p-3" :data-card-item="card.id">
        <!-- 卡面：用卡片配色做渐变，尽量像一张真卡 -->
        <div
          class="relative overflow-hidden rounded-2xl px-4 py-3.5 text-white shadow-lg"
          :style="{ background: gradientOf(card.color) }"
          :data-card-face="card.id"
        >
          <span class="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/10"></span>
          <span class="pointer-events-none absolute -bottom-10 -left-4 h-24 w-24 rounded-full bg-black/10"></span>
          <div class="relative flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="flex items-baseline gap-2">
                <span class="truncate text-sm font-extrabold tracking-wide">{{ cardTitle(card) }}</span>
                <span v-if="card.holder" class="text-[11px] text-white/70">{{ card.holder }}</span>
              </p>
              <p class="mt-1 font-mono text-[15px] tracking-[.18em] text-white/90" data-card-number>
                {{ maskNo(card.no) }}
              </p>
            </div>
            <div class="shrink-0 text-right text-[11px] leading-4 text-white/80">
              <p>账单日 每月 {{ card.statement_day }} 号</p>
              <p>还款日 每月 {{ card.due_day }} 号</p>
              <p v-if="card.limit_cents">额度 ¥{{ formatCents(card.limit_cents) }}</p>
            </div>
          </div>
          <!-- 芯片 -->
          <span class="relative mt-3 block h-6 w-8 rounded-md bg-gradient-to-br from-amber-200/90 to-amber-400/70"></span>
          <p class="relative mt-2 text-[11px] text-white/75">
            免息期 {{ summaryOf(card).grace }} 天
            <span v-if="card.advance_days > 0"> · 还款日前 {{ card.advance_days }} 天提醒</span>
            <span v-if="!card.auto_repeat"> · 未开自动循环</span>
          </p>
        </div>

        <!-- 本期应还 + 还款闭环 -->
        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] font-semibold" data-card-current="period">
          <span class="text-muted-foreground">本期（{{ card.current?.period || '—' }}）</span>
          <span v-if="card.current?.paid_at" class="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400" data-card-paid>
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="m5 13 4 4L19 7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            已还 ¥{{ formatCents(card.current.paid_amount_cents || card.current.amount_cents) }}
            <span v-if="card.current.paid_at" class="text-muted-foreground">· {{ card.current.paid_at.slice(0, 10) }}</span>
          </span>
          <span v-else class="text-foreground" data-card-amount>
            应还 <b class="text-[14px]">¥{{ formatCents(card.current?.amount_cents) }}</b>
            <span v-if="!card.current?.amount_cents" class="text-[11px] font-medium text-muted-foreground">（还没填金额）</span>
          </span>
          <span class="inline-flex items-center gap-1.5" style="color: #e11d48" data-card-due-countdown>
            <i class="h-2 w-2 rounded-full" style="background: #f43f5e"></i>
            还款日 {{ summaryOf(card).dueText }}（{{ summaryOf(card).daysToDue === 0 ? '就是今天' : `还有 ${summaryOf(card).daysToDue} 天` }}）
          </span>
          <span v-if="card.unpaid_count > 1" class="rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400" data-card-unpaid>
            另有 {{ card.unpaid_count - 1 }} 期未还 · 合计 ¥{{ formatCents(card.unpaid_total_cents) }}
          </span>
          <span v-if="isOverdue(card)" class="rounded-full bg-rose-500/12 px-2 py-0.5 text-[11px] font-bold text-rose-500" data-card-overdue>已逾期</span>
        </div>

        <div class="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            v-if="!card.current?.paid_at"
            class="btn-primary !h-8 !px-3 !text-[11px]"
            :disabled="busyId === card.id"
            :data-card-pay="card.id"
            @click="pay(card)"
          >标记已还</button>
          <button
            v-else
            class="btn-secondary !h-8 !px-3 !text-[11px]"
            :disabled="busyId === card.id"
            :data-card-unpay="card.id"
            @click="unpay(card)"
          >撤销已还</button>
          <button class="btn-secondary !h-8 !px-3 !text-[11px]" :data-card-set-amount="card.id" @click="openAmount(card)">
            {{ card.current?.amount_cents ? '改本期金额' : '填本期金额' }}
          </button>
          <button class="btn-secondary !h-8 !px-3 !text-[11px]" :data-card-schedule="card.id" @click="openSchedule(card)">还款计划</button>
          <button class="btn-secondary !h-8 !px-3 !text-[11px]" :data-card-edit="card.id" @click="openEdit(card)">编辑</button>
          <button class="btn-ghost !h-8 !px-2 !text-[11px] text-rose-500" :data-card-delete="card.id" @click="askDelete(card)">删除</button>
        </div>

        <p v-if="card.notes" class="mt-2 whitespace-pre-line text-[11px] leading-5 text-muted-foreground" data-card-notes>{{ card.notes }}</p>
        <p v-if="messageId === card.id && message" class="mt-2 text-[11px] font-semibold" :class="ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'" data-card-message>{{ message }}</p>
      </article>
    </div>

    <!-- 长条卡片：左边今天（日期 + 星期），右边本周要还的卡（小卡面）。
         本周 = 周一到周日（后端算），已经逾期的也列在这里并标红。 -->
    <section class="week-strip mt-3" data-week-strip>
      <div class="min-w-0">
        <p class="text-[11px] font-bold uppercase tracking-[.18em] text-muted-foreground">今天</p>
        <p class="mt-1 font-display text-2xl font-extrabold leading-none tracking-tight" data-week-today>{{ todayLabel }}</p>
        <p class="mt-1.5 text-[12px] font-semibold text-muted-foreground" data-week-weekday>
          {{ week?.weekday || '' }}
          <span v-if="week" class="font-medium">· 本周 {{ shortRange }}</span>
        </p>
        <p class="mt-2 text-[12px] font-semibold" :class="week && week.overdue ? 'text-rose-500' : 'text-muted-foreground'">
          <template v-if="week && week.count">
            本周待还 <b class="text-foreground">{{ week.count }}</b> 张 · 合计
            <b class="text-foreground">¥{{ formatCents(week.total_cents) }}</b>
            <span v-if="week.overdue">（含 {{ week.overdue }} 张逾期）</span>
          </template>
          <template v-else>本周没有要还的卡</template>
        </p>
      </div>

      <div class="flex flex-wrap items-stretch justify-end gap-2" data-week-cards>
        <article
          v-for="item in week?.cards || []"
          :key="item.card_id"
          class="week-mini-card"
          :class="{ 'week-mini-card-overdue': item.overdue }"
          :style="{ background: gradientOf(item.color) }"
          :data-week-card="item.card_id"
        >
          <p class="truncate text-[11px] font-extrabold leading-4">{{ [item.bank, item.name].filter(Boolean).join('') || '信用卡' }}</p>
          <p class="mt-0.5 font-mono text-[10px] tracking-[.16em] text-white/85">{{ item.tail ? `****${item.tail}` : '****' }}</p>
          <p class="mt-1.5 text-[11px] font-bold leading-4">¥{{ item.amount_cents ? formatCents(item.amount_cents) : '—' }}</p>
          <p class="mt-0.5 text-[10px] leading-4 text-white/85">
            {{ item.overdue ? `逾期 ${Math.abs(item.days_left)} 天` : item.days_left === 0 ? '就是今天' : `还有 ${item.days_left} 天` }}
            · {{ monthDay(item.due_date) }}
          </p>
        </article>
        <p v-if="week && !week.cards.length" class="self-center text-xs text-muted-foreground">这周没有到期的还款，安心。</p>
      </div>
    </section>

    <!-- 填/改本期金额 -->
    <Modal v-model="amountOpen" size="md" :title="`本期金额${amountCard ? ` · ${amountCard.current?.period || ''}` : ''}`">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="text-xs font-bold text-foreground">本期应还（元）</span>
          <input v-model="amountYuan" class="input-field mt-1.5 !py-2" inputmode="decimal" placeholder="例如 1234.56" data-amount-input />
        </label>
        <label class="block">
          <span class="text-xs font-bold text-foreground">最低还款（元，可选）</span>
          <input v-model="minimumYuan" class="input-field mt-1.5 !py-2" inputmode="decimal" placeholder="例如 123.45" data-minimum-input />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-xs font-bold text-foreground">备注（可选）</span>
          <input v-model="amountNote" class="input-field mt-1.5 !py-2" maxlength="120" placeholder="例如 本期有分期" data-amount-note />
        </label>
      </div>
      <div class="mt-4 flex items-center gap-3">
        <button class="btn-secondary flex-1" @click="amountOpen = false">取消</button>
        <button class="btn-primary flex-1" :disabled="busyId !== null" data-amount-save @click="saveAmount">保存</button>
      </div>
    </Modal>

    <CardEditorDialog
      v-model="editorOpen"
      :card="editingCard"
      :list-id="list.id"
      @saved="onSaved"
    />
    <CardScheduleDialog v-model="scheduleOpen" :card="scheduleCard" />

    <ConfirmDialog
      v-model="deleteOpen"
      danger
      title="删除这张卡？"
      :message="`「${deleteTarget ? cardTitle(deleteTarget) : ''}」的账单日/还款日提醒会一起删除，账单金额与还款记录也会隐藏。`"
      confirm-text="删除卡片"
      :loading="busyId !== null"
      @confirm="confirmDelete"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Modal from './Modal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import CardEditorDialog from './CardEditorDialog.vue'
import CardScheduleDialog from './CardScheduleDialog.vue'
import {
  deleteCard, getCards, getWeekDueCards, payCardStatement, saveCardStatement, unpayCardStatement,
  type CreditCard, type ReminderList, type WeekDue,
} from '../api/reminder'
import { listColorHex } from '../utils/list-colors'
import { cardTail, daysUntil, formatCardDate, formatCents, graceDays, nextDayOccurrence, parseYuanToCents } from '../utils/card'

const props = defineProps<{ list: ReminderList }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const isCardList = computed(() => props.list?.template === 'credit_card')
const cards = ref<CreditCard[]>([])
// 长条卡片的数据：今天日期 + 本周（周一到周日）要还的卡（含逾期）
const week = ref<WeekDue | null>(null)
const loading = ref(false)
const busyId = ref<number | null>(null)
const message = ref('')
const messageId = ref<number | null>(null)
const ok = ref(true)

const editorOpen = ref(false)
const editingCard = ref<CreditCard | null>(null)
const amountOpen = ref(false)
const amountCard = ref<CreditCard | null>(null)
const amountYuan = ref('')
const minimumYuan = ref('')
const amountNote = ref('')
const scheduleOpen = ref(false)
const scheduleCard = ref<CreditCard | null>(null)
const deleteOpen = ref(false)
const deleteTarget = ref<CreditCard | null>(null)

function cardTitle(card: CreditCard) {
  return `${card.bank || ''}${card.name || ''}`.trim() || '信用卡'
}
function maskNo(no: string) {
  const tail = cardTail(no)
  return tail ? `**** **** **** ${tail}` : '**** **** **** ----'
}
function gradientOf(color: string) {
  const hex = listColorHex(color)
  return `linear-gradient(135deg, ${hex} 0%, ${shade(hex, -22)} 100%)`
}
/** 把颜色加暗一点做渐变的下半段（不引额外依赖，手算即可）。 */
function shade(hex: string, delta: number) {
  const n = parseInt(hex.replace('#', ''), 16)
  const clamp = (v: number) => Math.max(0, Math.min(255, v))
  const r = clamp(((n >> 16) & 255) + delta)
  const g = clamp(((n >> 8) & 255) + delta)
  const b = clamp((n & 255) + delta)
  return `rgb(${r}, ${g}, ${b})`
}
/** 倒计时按本地时间实时算（后端也给，前端这份是为了不依赖刷新）。 */
function summaryOf(card: CreditCard) {
  const now = new Date()
  const statement = nextDayOccurrence(card.statement_day, now)
  const due = nextDayOccurrence(card.due_day, now)
  return {
    statementText: formatCardDate(statement),
    dueText: formatCardDate(due),
    daysToDue: daysUntil(due, now),
    grace: graceDays(card.statement_day, card.due_day, now),
  }
}
function isOverdue(card: CreditCard) {
  const cur = card.current
  if (!cur || cur.paid_at) return false
  return new Date(cur.due_date).getTime() < new Date(new Date().toDateString()).getTime()
}

function notify(id: number, text: string, success = true) {
  messageId.value = id
  message.value = text
  ok.value = success
}

async function load() {
  if (!isCardList.value) return
  loading.value = true
  try {
    // 卡片与本周期数据一起拉：这一栏是固定栏目，不再按 list_id 过滤也拿得到。
    const [cardRes, weekRes] = await Promise.all([getCards(), getWeekDueCards()])
    cards.value = cardRes.data?.data || []
    week.value = weekRes.data?.data || null
  } catch {
    cards.value = []
    week.value = null
  } finally {
    loading.value = false
  }
}

// 长条卡片左边的「今天」：本地时间算，不依赖后端（后端也给了，用于星期与本周区间）。
const todayLabel = computed(() =>
  new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date()))
const shortRange = computed(() => {
  const w = week.value
  if (!w) return ''
  return `${monthDay(w.week_start)} ~ ${monthDay(w.week_end)}`
})
/** "2026-10-09" → "10-09"（长条卡片地方小，年份省略） */
function monthDay(date: string) {
  return date ? date.slice(5) : ''
}

function openCreate() {
  editingCard.value = null
  editorOpen.value = true
}
function openEdit(card: CreditCard) {
  editingCard.value = card
  editorOpen.value = true
}
async function onSaved() {
  await load()
  emit('changed')
}

function openAmount(card: CreditCard) {
  amountCard.value = card
  amountYuan.value = card.current?.amount_cents ? formatCents(card.current.amount_cents) : ''
  minimumYuan.value = card.current?.minimum_cents ? formatCents(card.current.minimum_cents) : ''
  amountNote.value = card.current?.note || ''
  amountOpen.value = true
}
async function saveAmount() {
  const card = amountCard.value
  if (!card?.current?.period) return
  busyId.value = card.id
  try {
    await saveCardStatement(card.id, card.current.period, {
      amount_cents: parseYuanToCents(amountYuan.value),
      minimum_cents: parseYuanToCents(minimumYuan.value),
      note: amountNote.value.trim(),
    })
    amountOpen.value = false
    await load()
    notify(card.id, '本期金额已保存')
    emit('changed')
  } catch (err: any) {
    notify(card.id, err.response?.data?.message || '保存失败', false)
  } finally {
    busyId.value = null
  }
}

async function pay(card: CreditCard) {
  if (!card.current?.period) return
  busyId.value = card.id
  try {
    await payCardStatement(card.id, card.current.period, card.current.amount_cents || 0)
    await load()
    notify(card.id, '已标记这一期还清（完成记录里也留了一笔）')
    emit('changed')
  } catch (err: any) {
    notify(card.id, err.response?.data?.message || '操作失败', false)
  } finally {
    busyId.value = null
  }
}

async function unpay(card: CreditCard) {
  if (!card.current?.period) return
  busyId.value = card.id
  try {
    await unpayCardStatement(card.id, card.current.period)
    await load()
    notify(card.id, '已撤销「已还」标记')
    emit('changed')
  } catch (err: any) {
    notify(card.id, err.response?.data?.message || '操作失败', false)
  } finally {
    busyId.value = null
  }
}

function openSchedule(card: CreditCard) {
  scheduleCard.value = card
  scheduleOpen.value = true
}

function askDelete(card: CreditCard) {
  deleteTarget.value = card
  deleteOpen.value = true
}
async function confirmDelete() {
  const card = deleteTarget.value
  if (!card) return
  busyId.value = card.id
  try {
    await deleteCard(card.id)
    deleteOpen.value = false
    await load()
    emit('changed')
  } catch (err: any) {
    notify(card.id, err.response?.data?.message || '删除失败', false)
  } finally {
    busyId.value = null
  }
}

watch(() => props.list?.id, () => { void load() }, { immediate: true })
watch(isCardList, (v) => { if (v) void load() })
</script>

<style scoped>
/* 长条卡片：左边今天、右边本周待还。窄屏上下排，宽屏左右排。 */
.week-strip {
  @apply flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between;
}
/* 小卡面：跟大卡面同一套渐变，只是缩到能并排放下几张。 */
.week-mini-card {
  @apply w-[8.6rem] shrink-0 rounded-xl px-2.5 py-2 text-white shadow-md;
}
/* 逾期的那张加一圈玫红描边，一眼能挑出来。 */
.week-mini-card-overdue {
  @apply ring-2 ring-rose-400/80;
}
/* 手机端去掉阴影：这一条会常驻在卡片页，滚动时省一点渲染。 */
@media (max-width: 767px), (hover: none) and (pointer: coarse) {
  .week-mini-card { box-shadow: none; }
}
</style>
