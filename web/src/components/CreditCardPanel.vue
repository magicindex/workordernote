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

    <!-- 一行三张（窄屏一张、中屏两张、宽屏三张；2026-10-10 用户确认「三列最合适、
         效果最好」，不再上到四列），卡片靠银行标志区分；顺序见 sortedCards()。
         卡片按 1.586:1 的真卡比例，标志与右侧那列信息字号跟着卡片大小走
         （见下面的 max-w-[4.5rem] 与 10px）。 -->
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-card-grid>
      <!-- 抽屉打开时把这张卡片抬到同排之上：抽屉是 absolute 的，
           后面的兄弟卡片（.surface 自带 backdrop-blur，各自成层）会盖住它
           —— 用户报的「更多按钮弹出会被遮挡」就是这个。 -->
      <article
        v-for="card in sortedCards"
        :key="card.id"
        class="surface relative rounded-2xl p-3"
        :class="{ 'z-30': drawerOpen === card.id }"
        :data-card-item="card.id"
      >
        <!-- 卡面：所有卡默认同一套配色 + 银行标志区分；
             账单日之后黄→橘，还款日前 3 天（含逾期）变红。 -->
        <!-- 按真卡的 85.6×54mm（≈1.586:1）给一个固定比例：卡片高度跟着宽度走，
             看起来就是一张银行卡，而不是一条信息框（用户要求「增加卡片高度」）。 -->
        <div
          class="relative flex aspect-[1.586/1] flex-col overflow-hidden rounded-2xl px-3 py-2.5 shadow-lg sm:px-3.5"
          :style="{ background: urgencyOf(card).gradient, color: urgencyOf(card).ink }"
          :data-card-face="card.id"
          :data-card-urgency="urgencyOf(card).level"
        >
          <span class="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/10"></span>
          <span class="pointer-events-none absolute -bottom-10 -left-4 h-24 w-24 rounded-full bg-black/10"></span>
          <div class="relative flex flex-col gap-1">
            <!-- 第一行：银行标志（左上）+ 账单日/还款日/额度（右上，**固定不换行**）。
                 第二行：卡名与持卡人**同一行** —— 卡名左端与标志左端齐，
                 持卡人右对齐到**卡面右边缘**（用户 2026-10-10 要求
                 「账号名称放在银行图标下边、与图标对齐，持卡人与账号名称同行右对齐」）。
                 两行分开排的原因：持卡人要和整张卡面对齐，不能被右上角那列信息截断。 -->
            <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
              <div class="card-face-logo" data-card-face-logo>
                <img v-if="logoOf(card)" :src="logoOf(card)" alt="" class="h-5 w-auto max-w-[4.5rem] object-contain sm:h-6" />
                <svg v-else class="h-5 w-5 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" stroke-width="1.6" />
                  <path d="M2.5 10h19M6 13.5h4" stroke-width="1.6" stroke-linecap="round" />
                </svg>
                <!-- 非银行平台（支付宝 / 微信 / 京东金融）的标志认不出名字，
                     在图标右边补上名字；银行仍只有标志（用户此前的要求）。 -->
                <span
                  v-if="faceLabelOf(card)"
                  class="whitespace-nowrap text-[11px] font-extrabold leading-none tracking-wide opacity-95 sm:text-[12px]"
                  data-card-face-label
                >{{ faceLabelOf(card) }}</span>
              </div>
              <div class="shrink-0 whitespace-nowrap text-right text-[10px] leading-4 opacity-85 sm:text-[10.5px]" data-card-meta>
                <p>账单日 每月 {{ card.statement_day }} 号</p>
                <p>还款日 每月 {{ card.due_day }} 号</p>
                <p data-card-limit>
                  <template v-if="card.limit_cents">信用额度 ¥{{ formatCents(card.limit_cents) }}</template>
                  <template v-else>额度未填</template>
                </p>
              </div>
            </div>
            <div class="flex min-w-0 items-end justify-between gap-2" data-card-name-row>
              <p class="card-title text-[13px] font-extrabold leading-[18px] tracking-wide" data-card-title>{{ cardTitle(card) }}</p>
              <p v-if="card.holder" class="shrink-0 whitespace-nowrap text-[11px] font-semibold opacity-80" data-card-holder>{{ card.holder }}</p>
            </div>
          </div>
          <!-- 卡号单独一行、**左对齐**（用户要求）：位置换一下之后卡号不再跟卡名抢宽度，
               窄屏也能完整显示尾号；左对齐是为了跟卡名/持卡人那一列对齐。 -->
          <p class="relative mt-auto pt-2 text-left font-mono text-[12px] leading-5 tracking-[.04em] opacity-90 sm:text-[13px] sm:tracking-[.08em]" data-card-number>
            {{ maskNo(card.no) }}
          </p>
          <p class="relative mt-2 text-[11px] opacity-80">
            免息期 {{ summaryOf(card).grace }} 天
            <span> · 账单日起提醒，还款日 23:59 到期</span>
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
          <!-- 循环周期：这是这张卡的第几期（按开卡月份算，第 1 期就是开卡那个月） -->
          <span v-if="periodIndex(card) > 0" class="tiny-badge" :data-card-period-index="card.id">第 {{ periodIndex(card) }} 期</span>
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
          <!-- 刚还过的那一期：当期已经跳到下一期了，这里保留一行「已还 + 撤销」，
               否则点完还款就没法撤销（用户报过点完已还款之后的状态问题）。 -->
          <span
            v-if="card.last_paid"
            class="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"
            data-card-paid
          >
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="m5 13 4 4L19 7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {{ card.last_paid.period }} 已还 ¥{{ formatCents(card.last_paid.paid_amount_cents || card.last_paid.amount_cents) }}
          </span>
          <button
            v-if="card.last_paid"
            class="!h-6 rounded-full border border-border px-2 text-[11px] font-semibold text-muted-foreground hover:text-rose-500"
            :disabled="busyId === card.id"
            :data-card-unpay="card.id"
            @click="unpay(card)"
          >撤销已还</button>
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
          <button class="btn-secondary !h-8 !px-3 !text-[11px]" :data-card-set-amount="card.id" @click="openAmount(card)">
            {{ card.current?.amount_cents ? '改本期金额' : '填本期金额' }}
          </button>
          <!-- 次要操作收进抽屉：桌面鼠标移上去自动展开、移开自动收缩；触屏点一下展开
               （用户要求：解决手机端按钮太多换行占空间的问题）。 -->
          <div
            class="relative ml-auto"
            data-card-actions
            @mouseenter="drawerOpen = card.id"
            @mouseleave="drawerOpen = null"
          >
            <button
              class="btn-secondary !h-8 !px-3 !text-[11px]"
              :data-card-more="card.id"
              :aria-expanded="drawerOpen === card.id"
              @click="drawerOpen = drawerOpen === card.id ? null : card.id"
            >⋯ 更多</button>
            <div
              v-show="drawerOpen === card.id"
              class="absolute right-0 top-full z-20 mt-1 flex min-w-max flex-col gap-1 rounded-xl border border-border bg-surface p-1 shadow-xl"
              data-card-drawer
            >
              <button class="btn-secondary !h-8 !justify-start !px-3 !text-[11px]" :data-card-schedule="card.id" @click="openSchedule(card)">还款计划</button>
              <button class="btn-secondary !h-8 !justify-start !px-3 !text-[11px]" :data-card-edit="card.id" @click="openEdit(card)">编辑</button>
              <button class="btn-ghost !h-8 !justify-start !px-3 !text-[11px] text-rose-500" :data-card-delete="card.id" @click="askDelete(card)">删除</button>
            </div>
          </div>
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
import { bankFaceLabelOf, bankLogoOf } from '../utils/banks'
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

/** 这张卡的「第几期」：从开卡那个月算到当前账单期（同月 = 第 1 期）。
    账单期的期号本身是 YYYY-MM，两者相减就是期数；拿不到月份时返回 0（不显示角标）。 */
function periodIndex(card: CreditCard) {
  const period = String(card.current?.period || '')
  const created = String(card.created_at || '')
  const pm = /^(\d{4})-(\d{2})$/.exec(period)
  const cm = /^(\d{4})-(\d{2})/.exec(created)
  if (!pm || !cm) return 0
  const delta = (Number(pm[1]) - Number(cm[1])) * 12 + (Number(pm[2]) - Number(cm[2]))
  return delta >= 0 ? delta + 1 : 0
}

function cardTitle(card: CreditCard) {
  // 只显示卡名：银行名由卡面上的**完整银行标志**表达（用户要求「图标后边不再加 XX银行字样」）。
  return (card.name || '').trim() || card.bank || '信用卡'
}
function maskNo(no: string) {
  const tail = cardTail(no)
  return tail ? `**** **** **** ${tail}` : '**** **** **** ----'
}
function logoOf(card: CreditCard): string {
  return bankLogoOf(card.bank) || ''
}
/** 卡片上标志旁边的名字：只有非银行平台（支付宝 / 微信 / 京东金融）才写。 */
function faceLabelOf(card: CreditCard): string {
  return bankFaceLabelOf(card.bank)
}

/** 倒计时按本地时间实时算（后端也给，前端这份是为了不依赖刷新）。 */
function summaryOf(card: CreditCard) {
  const now = new Date()
  // 优先跟**当前这一期**走：还过款之后后端会把当期推到下一期，倒计时与排序都跟着变
  // （用户报的「已还款后倒计时没跳到下一周期」）。没有当期时退回「下一个还款日号」。
  const cur = card.current
  const statement = cur?.statement_date ? new Date(cur.statement_date) : nextDayOccurrence(card.statement_day, now)
  const due = cur?.due_date ? new Date(cur.due_date) : nextDayOccurrence(card.due_day, now)
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
  // 撤销的是**刚还过的那一期**：还完款之后 current 已经推进到下一期，
  // 用 current.period 去撤销会打在没还过的期上（撤销无效）。
  const period = card.last_paid?.period || card.current?.period
  if (!period) return
  busyId.value = card.id
  try {
    await unpayCardStatement(card.id, period)
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
// 卡片次要操作的抽屉：桌面靠悬停、手机靠点击（见模板里的 @mouseenter/@click）
const drawerOpen = ref<number | null>(null)
const sortMenu = reactive({ open: false, x: 0, y: 0 })
const sortItems: { key: SortMode; label: string; hint: string }[] = [
  { key: 'smart', label: '智能排序（默认）', hint: '还款日近的在前（逾期 / ≤3 天最前），再按账单日' },
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
    // 智能：红色（≤3 天/逾期）最前 → **还款日近的在前** → 账单日早的在前。
    // 还款日必须是第一顺位：用户报过「交通银行还款日只剩 11 天却排在最后」——
    // 因为旧的第二顺位是账单日，跨月卡（账单日 25 / 还款日 19）在账单日上永远吃亏。
    // 红色本身就是「还款日 ≤3 天或已过」，所以它天然排在最前面，这里保留一项做兜底。
    return Number(isRed(b)) - Number(isRed(a))
      || daysToDue(a) - daysToDue(b)
      || a.statement_day - b.statement_day
  })
  return list
})

watch(() => props.list?.id, () => { void load() }, { immediate: true })
watch(isCardList, (v) => { if (v) void load() })
</script>

<style scoped>
/* 卡面配色（默认统一 / 账单日后黄→橘 / 最后 3 天与逾期红）在 utils/card-urgency.ts，
   时间卡片里的缩略小卡面也调它，保证同色。 */

/* 标志与卡名（用户 2026-10-10 第二次调整）：
   标志单独一行在左上；下面一行「卡名 …… 持卡人」—— 卡名左端与标志左端齐（同一个
   竖列起点），持卡人在同一行、右对齐。layout 用 flex 而不是 grid：
   卡名可以换行，换下来的行仍从标志左端开始（与图标对齐），持卡人不被挤走。 */
/* 标志 + 非银行平台的名字（名字只在非银行平台出现，见 utils/banks.ts 的 nonBank） */
.card-face-logo { @apply inline-flex items-center gap-1.5; }
.card-title { @apply min-w-0; }

/* 卡名不按字断行：中文默认逐字换行，窄屏时「广发银行DIY卡」会被挤成一列一个字。
   keep-all 让一整串中文当成一个词，只有确实放不下时才由 break-word 在词内断开。 */
.card-title {
  word-break: keep-all;
  overflow-wrap: break-word;
}
</style>
