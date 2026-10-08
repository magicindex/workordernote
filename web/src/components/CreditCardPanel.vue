<template>
  <!-- 信用卡账单栏目：最上面是「今天 + 本周待还」那条长条卡片（时间卡片），
       下面才是一张张银行卡（卡面）+ 本期应还 + 还款闭环 + 还款计划。
       这一页只做卡片相关的事：要加卡片就点右上角「新建卡片」。 -->
  <section v-if="isCardList" class="mb-3" data-card-panel>
    <div class="mb-1.5 flex flex-wrap items-center justify-between gap-2">
      <h3 class="flex items-center gap-2 text-sm font-extrabold">
        我的卡片
        <span class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{{ cards.length }} 张</span>
      </h3>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn-secondary !h-8 !px-3 !text-[11px]" data-card-sort @click="openSortMenu">
          排序：{{ sortLabel }}
        </button>
        <button class="btn-secondary !h-8 !px-3 !text-[11px]" :disabled="loading" data-card-refresh @click="refreshAll">
          {{ loading ? '读取中…' : '刷新' }}
        </button>
        <button class="btn-primary !h-8 !px-3 !text-[11px]" data-card-add @click="openCreate">+ 新建卡片</button>
      </div>
    </div>

    <!-- 卡面配色说明：账单日前后与最后 3 天的颜色规则（用户要求写清楚） -->
    <p class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-muted-foreground" data-card-legend>
      <span>卡面配色：</span>
      <span class="inline-flex items-center gap-1"><i class="h-2.5 w-2.5 rounded-full" style="background:#64748b"></i>账单日前默认色</span>
      <span class="inline-flex items-center gap-1"><i class="h-2.5 w-2.5 rounded-full" style="background:#facc15"></i>账单日已出转黄</span>
      <span class="inline-flex items-center gap-1"><i class="h-2.5 w-2.5 rounded-full" style="background:#f97316"></i>越接近还款日越橘</span>
      <span class="inline-flex items-center gap-1"><i class="h-2.5 w-2.5 rounded-full" style="background:#ef4444"></i>还款日前 3 天（含逾期）转红</span>
    </p>

    <p v-if="!cards.length && !loading" class="surface rounded-2xl px-4 py-6 text-center text-sm text-muted-foreground" data-card-empty>
      还没有卡片。点「+ 新建卡片」填银行、卡名、账单日与还款日，系统会自动生成账单日/还款日提醒。
    </p>

    <!-- 一行三张（窄屏一张、中屏两张），卡片靠银行标志区分；顺序见 sortedCards() -->
    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <article v-for="card in sortedCards" :key="card.id" class="surface rounded-2xl p-3" :data-card-item="card.id">
        <!-- 卡面：所有卡默认同一套配色 + 银行标志区分；
             账单日之后黄→橘，还款日前 3 天（含逾期）变红。 -->
        <div
          class="relative overflow-hidden rounded-2xl px-4 py-3.5 shadow-lg"
          :style="{ background: urgencyOf(card).gradient, color: urgencyOf(card).ink }"
          :data-card-face="card.id"
          :data-card-urgency="urgencyOf(card).level"
        >
          <span class="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/10"></span>
          <span class="pointer-events-none absolute -bottom-10 -left-4 h-24 w-24 rounded-full bg-black/10"></span>
          <div class="relative flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2.5">
              <!-- 银行标志：白底圆片，卡面靠它区分（认不出就退回银行名首字） -->
              <span class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/95 p-1 shadow-sm" data-card-face-logo>
                <img v-if="logoOf(card)" :src="logoOf(card)" alt="" class="h-full w-full object-contain" />
                <span v-else class="text-[13px] font-black text-slate-600">{{ initialOf(card) }}</span>
              </span>
              <div class="min-w-0">
                <p class="truncate text-sm font-extrabold tracking-wide" data-card-title>{{ cardTitle(card) }}</p>
                <p class="mt-1 font-mono text-[15px] tracking-[.18em] opacity-90" data-card-number>
                  {{ maskNo(card.no) }}
                </p>
              </div>
            </div>
            <div class="shrink-0 text-right text-[11px] leading-4 opacity-85">
              <p>账单日 每月 {{ card.statement_day }} 号</p>
              <p>还款日 每月 {{ card.due_day }} 号</p>
              <p data-card-limit>
                <template v-if="card.limit_cents">信用额度 ¥{{ formatCents(card.limit_cents) }}</template>
                <template v-else>额度未填</template>
              </p>
            </div>
          </div>
          <!-- 持卡人单独一行、靠右下：卡名再长也不会把它挤掉（原来跟卡名同一行） -->
          <p v-if="card.holder" class="relative mt-2.5 text-right text-[11px] font-semibold opacity-80" data-card-holder>
            {{ card.holder }}
          </p>
          <p class="relative mt-2 text-[11px] opacity-80">
            免息期 {{ summaryOf(card).grace }} 天
            <span v-if="card.advance_days > 0"> · 还款日前 {{ card.advance_days }} 天提醒</span>
            <span v-if="!card.auto_repeat"> · 未开自动循环</span>
          </p>
          <!-- 账期进度：账单日 → 还款日前三天；进了最后 3 天整条变红 -->
          <div class="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/15">
            <span class="block h-full rounded-full" :style="{ width: urgencyOf(card).barWidth, background: urgencyOf(card).barColor }"></span>
          </div>
          <p class="relative mt-1 text-[11px] font-extrabold" data-card-status>{{ urgencyOf(card).status }}</p>
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

    <!-- 排序设定菜单（与清单右键菜单同一个组件） -->
    <ContextMenu
      v-model:open="sortMenu.open"
      :x="sortMenu.x"
      :y="sortMenu.y"
      heading="卡片排序"
      :items="sortMenuItems"
      @select="onSortSelect"
    />

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
import { computed, reactive, ref, watch } from 'vue'
import Modal from './Modal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import CardEditorDialog from './CardEditorDialog.vue'
import CardScheduleDialog from './CardScheduleDialog.vue'
import ContextMenu from './ContextMenu.vue'
import {
  deleteCard, getCards, payCardStatement, saveCardStatement, unpayCardStatement,
  type CreditCard, type ReminderList,
} from '../api/reminder'
import { bankLogoOf } from '../utils/banks'
import { daysFromToday, urgencyOf } from '../utils/card-urgency'
import { cardTail, daysUntil, formatCardDate, formatCents, graceDays, nextDayOccurrence, parseYuanToCents } from '../utils/card'

const props = defineProps<{ list: ReminderList }>()
const emit = defineEmits<{
  (e: 'changed'): void
  /** 手动「刷新」时顺带让头部时间卡片也重拉一次（它自己管数据） */
  (e: 'refresh-strip'): void
}>()

const isCardList = computed(() => props.list?.template === 'credit_card')
const cards = ref<CreditCard[]>([])
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
function logoOf(card: CreditCard): string {
  return bankLogoOf(card.bank) || ''
}
function initialOf(card: CreditCard) {
  return (card.bank || card.name || '卡').trim().slice(0, 1)
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
    // 这一栏是固定栏目：不传 list_id 也能拿到全部卡片（时间卡片自己拉自己那份数据）
    const cardRes = await getCards()
    cards.value = cardRes.data?.data || []
  } catch {
    cards.value = []
  } finally {
    loading.value = false
  }
}


/** 刷新：卡片 + 头部时间卡片一起刷新（只刷卡片的话，头部还显示旧的口径） */
async function refreshAll() {
  await load()
  emit('refresh-strip')
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

// ---- 卡片排序：默认「智能」（红色最前 → 账单日 → 还款日），可选按账单日 / 按还款日；
// 选择记在本地（显示偏好，跟设备走，不参与同步）。
type SortMode = 'smart' | 'statement' | 'due'
const SORT_KEY = 'ui_card_sort'
const sortMode = ref<SortMode>((localStorage.getItem(SORT_KEY) as SortMode) || 'smart')
const sortMenu = reactive({ open: false, x: 0, y: 0 })
const sortItems: { key: SortMode; label: string; hint: string }[] = [
  { key: 'smart', label: '智能排序（默认）', hint: '红色（≤3 天/逾期）最前，再按账单日、还款日' },
  { key: 'statement', label: '按账单日', hint: '账单日早的在前' },
  { key: 'due', label: '按还款日', hint: '离还款日近的在前' },
]
const sortLabel = computed(() => sortItems.find((i) => i.key === sortMode.value)?.label.replace('（默认）', '') || '智能')
const sortMenuItems = computed(() => sortItems.map((i) => ({
  key: i.key,
  label: i.key === sortMode.value ? `${i.label} ✓` : i.label,
  title: i.hint,
})))

function openSortMenu(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  sortMenu.x = rect.left
  sortMenu.y = rect.bottom + 6
  sortMenu.open = true
}
function onSortSelect(key: string) {
  sortMode.value = key as SortMode
  localStorage.setItem(SORT_KEY, sortMode.value)
  sortMenu.open = false
}

/** 还款日还剩几天；没有当期就排到最后。 */
function daysToDue(card: CreditCard) {
  return card.current?.due_date ? daysFromToday(card.current.due_date) : 9999
}
const isRed = (card: CreditCard) => ['overdue', 'urgent'].includes(urgencyOf(card).level)

const sortedCards = computed(() => {
  const list = [...cards.value]
  list.sort((a, b) => {
    if (sortMode.value === 'due') {
      return daysToDue(a) - daysToDue(b) || a.statement_day - b.statement_day
    }
    if (sortMode.value === 'statement') {
      return a.statement_day - b.statement_day || daysToDue(a) - daysToDue(b)
    }
    // 智能：红色最前 → 账单日早的在前 → 还款日近的在前
    return Number(isRed(b)) - Number(isRed(a))
      || a.statement_day - b.statement_day
      || daysToDue(a) - daysToDue(b)
  })
  return list
})

watch(() => props.list?.id, () => { void load() }, { immediate: true })
watch(isCardList, (v) => { if (v) void load() })
</script>

<style scoped>
/* 卡面配色（默认统一 / 账单日后黄→橘 / 最后 3 天与逾期红）在 utils/card-urgency.ts，
   时间卡片里的缩略小卡面也调它，保证同色。 */
</style>
