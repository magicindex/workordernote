<template>
  <!-- 时间卡片：左边今天（日期 / 星期 / 本周区间 / 待还合计），右边本周要还的卡（缩略小卡面）。
       位置在信用卡页**页面标题那一行**的右侧（见 HomeView），窄屏自动折行到标题下方；
       卡片整体 width 有上限（见使用处的 max-w），内容按页面宽度自动换行。
       小卡面的配色复用大卡面的 urgencyOf()，所以缩略图与对应大卡永远同色同字色。 -->
  <section class="week-strip" data-week-strip>
    <!-- 左侧固定三行：① 今天 + 日期 ② 星期 + 本周区间 ③ 待还张数 + 合计 -->
    <div class="min-w-0">
      <p class="flex items-baseline gap-x-2">
        <span class="text-[11px] font-bold uppercase tracking-[.18em] text-muted-foreground">今天</span>
        <span class="font-display text-xl font-extrabold leading-none tracking-tight" data-week-today>{{ todayLabel }}</span>
      </p>
      <p class="mt-1.5 text-[12px] font-semibold text-muted-foreground" data-week-weekday>
        {{ week?.weekday || '' }}
        <span v-if="week" class="font-medium">· 本周 {{ shortRange }}</span>
      </p>
      <p class="mt-1 text-[12px] font-semibold" :class="week && week.overdue ? 'text-rose-500' : 'text-muted-foreground'">
        <template v-if="week && week.count">
          待还 <b class="text-foreground">{{ week.count }}</b> 张 · 合计
          <b class="text-foreground">¥{{ formatCents(week.total_cents) }}</b>
          <span v-if="week.overdue">（含 {{ week.overdue }} 张逾期）</span>
        </template>
        <template v-else>本周没有要还的卡</template>
      </p>
    </div>

    <div v-if="week && week.cards.length" class="flex flex-wrap items-stretch gap-2" data-week-cards>
      <article
        v-for="item in week.cards"
        :key="item.card_id"
        class="week-mini-card"
        :class="{ 'week-mini-card-overdue': item.overdue }"
        :style="{ background: gradientOf(item), color: inkOf(item) }"
        :data-week-card="item.card_id"
      >
        <p class="truncate text-[11px] font-extrabold leading-4">{{ [item.bank, item.name].filter(Boolean).join('') || '信用卡' }}</p>
        <p class="mt-0.5 font-mono text-[10px] tracking-[.16em] opacity-85">{{ item.tail ? `****${item.tail}` : '****' }}</p>
        <p class="mt-1 text-[11px] font-bold leading-4">¥{{ item.amount_cents ? formatCents(item.amount_cents) : '—' }}</p>
        <p class="mt-0.5 text-[10px] leading-4 opacity-85">
          {{ item.overdue ? `逾期 ${Math.abs(item.days_left)} 天` : item.days_left === 0 ? '就是今天' : `还有 ${item.days_left} 天` }}
          · {{ monthDay(item.due_date) }}
        </p>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getCards, getWeekDueCards, type CreditCard, type WeekDue, type WeekDueCard } from '../api/reminder'
import { formatCents } from '../utils/card'
import { DEFAULT_GRADIENT, URGENT_GRADIENT, urgencyOf } from '../utils/card-urgency'

const props = defineProps<{
  /** 变了就重新拉一次（卡片增删改之后由父组件 +1） */
  refreshKey?: number
}>()

const week = ref<WeekDue | null>(null)
const cards = ref<CreditCard[]>([])

const todayLabel = computed(() =>
  new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date()))

const shortRange = computed(() => {
  const w = week.value
  if (!w) return ''
  return `${monthDay(w.week_start)} ~ ${monthDay(w.week_end)}`
})

/** "2026-10-09" → "10-09"（地方小，年份省略） */
function monthDay(date: string) {
  return date ? date.slice(5) : ''
}

async function load() {
  try {
    const [weekRes, cardRes] = await Promise.all([getWeekDueCards(), getCards()])
    week.value = weekRes.data?.data || null
    cards.value = cardRes.data?.data || []
  } catch {
    week.value = null
    cards.value = []
  }
}

// 缩略小卡面跟大卡面同源：找那张卡再算一次；找不到就按逾期标记兜底
function urgencyOfItem(item: WeekDueCard) {
  const card = cards.value.find((c) => c.id === item.card_id)
  if (!card) {
    return { gradient: item.overdue ? URGENT_GRADIENT : DEFAULT_GRADIENT, ink: '#ffffff' }
  }
  const u = urgencyOf(card)
  return { gradient: u.gradient, ink: u.ink }
}
function gradientOf(item: WeekDueCard) { return urgencyOfItem(item).gradient }
function inkOf(item: WeekDueCard) { return urgencyOfItem(item).ink }

watch(() => props.refreshKey, () => { void load() }, { immediate: true })
</script>

<style scoped>
/* 时间卡片：整体可换行——页面窄时「今天」与小卡面自动分行，小卡面之间也会换行。 */
.week-strip {
  @apply flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-border/70 bg-surface px-4 py-2.5;
}
/* 缩略小卡面：沿用大卡面的渐变，只是缩小 */
.week-mini-card {
  @apply w-[7.6rem] shrink-0 rounded-xl px-2.5 py-2 shadow-md;
}
.week-mini-card-overdue {
  @apply ring-2 ring-rose-400/80;
}
@media (max-width: 767px), (hover: none) and (pointer: coarse) {
  .week-mini-card { box-shadow: none; }
}
</style>
