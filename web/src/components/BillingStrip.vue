<template>
  <!-- 头部时间卡片：左边今天（日期 / 星期 / 待还合计），右边**账单已出、当期未还**的卡（缩略小卡面）。
       位置在信用卡页**页面标题那一行**的右侧（见 HomeView），窄屏自动折行到标题下方。
       - 口径见后端 card_billing.go：账单日已过且这一期没还的卡才进来，逾期与「还款日前 3 天」的
         （红色）排最前，其余按账单日由早到晚；
       - 小卡面配色复用大卡面的 urgencyOf()，所以缩略图与对应大卡永远同色同字色；
       - 卡片超出宽度时不显示滚动条，可以**按住鼠标左右拖动**查看。 -->
  <section class="billing-strip" data-billing-strip>
    <div class="min-w-0">
      <p class="flex items-baseline gap-x-2">
        <span class="text-[11px] font-bold uppercase tracking-[.18em] text-muted-foreground">今天</span>
        <span class="font-display text-xl font-extrabold leading-none tracking-tight" data-billing-today>{{ todayLabel }}</span>
      </p>
      <p class="mt-1.5 text-[12px] font-semibold text-muted-foreground" data-billing-weekday>
        {{ billing?.weekday || '' }}
        <span class="font-medium">· 账单已出 {{ billing?.count || 0 }} 张</span>
      </p>
      <p class="mt-1 text-[12px] font-semibold" :class="billing && billing.overdue ? 'text-rose-500' : 'text-muted-foreground'">
        <template v-if="billing && billing.count">
          待还 <b class="text-foreground">{{ billing.count }}</b> 张 · 合计
          <b class="text-foreground">¥{{ formatCents(billing.total_cents) }}</b>
          <span v-if="billing.overdue">（含 {{ billing.overdue }} 张逾期）</span>
        </template>
        <template v-else>账单日还没到，暂无待还</template>
      </p>
    </div>

    <div
      v-if="billing && billing.cards.length"
      class="billing-cards"
      :class="{ 'billing-cards-dragging': dragging }"
      data-billing-cards
      @mousedown.prevent="startDrag"
      @mousemove="onDrag"
      @mouseup="endDrag"
      @mouseleave="endDrag"
    >
      <article
        v-for="item in billing.cards"
        :key="item.card_id"
        class="billing-mini-card"
        :style="{ background: gradientOf(item), color: inkOf(item) }"
        :data-billing-card="item.card_id"
      >
        <p class="truncate text-[11px] font-extrabold leading-4">{{ [item.bank, item.name].filter(Boolean).join('') || '信用卡' }}</p>
        <p class="mt-0.5 font-mono text-[10px] tracking-[.16em] opacity-85">{{ item.tail ? `****${item.tail}` : '****' }}</p>
        <p class="mt-1 text-[11px] font-bold leading-4">¥{{ item.amount_cents ? formatCents(item.amount_cents) : '—' }}</p>
        <!-- 时间信息保留原位置（卡片底部两行），改成**右对齐**（用户 2026-10-10 要求：
             「卡片中的时间信息保留位置使用卡片方式右对齐」—— 与大卡面右侧
             「账单日 / 还款日 / 额度」那种右对齐写法一致）。 -->
        <p class="mt-0.5 text-right text-[10px] leading-4 opacity-85">
          {{ item.overdue ? `逾期 ${Math.abs(item.days_left)} 天` : item.days_left === 0 ? '就是今天' : `还有 ${item.days_left} 天` }}
          · {{ monthDay(item.due_date) }}
        </p>
        <p class="mt-0.5 text-right text-[10px] leading-4 opacity-75">账单日 {{ monthDay(item.statement_date) }}</p>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getBillingCards, getCards, type Billing, type BillingCard, type CreditCard } from '../api/reminder'
import { formatCents } from '../utils/card'
import { DEFAULT_GRADIENT, URGENT_GRADIENT, urgencyOf } from '../utils/card-urgency'

const props = defineProps<{
  /** 变了就重新拉一次（卡片增删改之后由父组件 +1） */
  refreshKey?: number
}>()

const billing = ref<Billing | null>(null)
const cards = ref<CreditCard[]>([])

const todayLabel = computed(() =>
  new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date()))

/** "2026-10-09" → "10-09"（地方小，年份省略） */
function monthDay(date: string) {
  return date ? date.slice(5) : ''
}

async function load() {
  try {
    const [billingRes, cardRes] = await Promise.all([getBillingCards(), getCards()])
    billing.value = billingRes.data?.data || null
    cards.value = cardRes.data?.data || []
  } catch {
    billing.value = null
    cards.value = []
  }
}

// 缩略小卡面跟大卡面同源：找那张卡再算一次；找不到就按逾期标记兜底
function urgencyOfItem(item: BillingCard) {
  const card = cards.value.find((c) => c.id === item.card_id)
  if (!card) {
    return { gradient: item.overdue ? URGENT_GRADIENT : DEFAULT_GRADIENT, ink: '#ffffff' }
  }
  const u = urgencyOf(card)
  return { gradient: u.gradient, ink: u.ink }
}
function gradientOf(item: BillingCard) { return urgencyOfItem(item).gradient }
function inkOf(item: BillingCard) { return urgencyOfItem(item).ink }

// ---- 按住鼠标左右拖动（不显示滚动条，见样式） ----
const dragging = ref(false)
let startX = 0
let startLeft = 0
function startDrag(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  dragging.value = true
  startX = e.clientX
  startLeft = el.scrollLeft
}
function onDrag(e: MouseEvent) {
  if (!dragging.value) return
  const el = e.currentTarget as HTMLElement
  el.scrollLeft = startLeft - (e.clientX - startX)
}
function endDrag() { dragging.value = false }

watch(() => props.refreshKey, () => { void load() }, { immediate: true })
</script>

<style scoped>
/* 时间卡片：整体可换行——页面窄时「今天」与小卡面自动分行 */
.billing-strip {
  @apply flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-border/70 bg-surface px-4 py-2.5;
}
/* 小卡面一行排开，超出就横向滚动；**不显示滚动条**，用鼠标按住拖动看 */
.billing-cards {
  @apply flex min-w-0 items-stretch gap-2 overflow-x-auto pb-0.5;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.billing-cards::-webkit-scrollbar { display: none; }
.billing-cards-dragging { cursor: grabbing; }
.billing-cards:not(.billing-cards-dragging) { cursor: grab; }
.billing-mini-card {
  @apply w-[7.6rem] shrink-0 rounded-xl px-2.5 py-2 shadow-md;
  user-select: none;
}
@media (max-width: 767px), (hover: none) and (pointer: coarse) {
  .billing-mini-card { box-shadow: none; }
}
</style>
