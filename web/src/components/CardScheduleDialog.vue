<template>
  <Modal :model-value="modelValue" size="lg" :title="`还款计划 · ${card ? cardTitle : ''}`" @update:model-value="emit('update:modelValue', $event)">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-muted-foreground">
        账单日 每月 {{ card?.statement_day }} 号 · 还款日 每月 {{ card?.due_day }} 号
        <span v-if="totals.unpaidCount"> · 未还 {{ totals.unpaidCount }} 期，合计 ¥{{ formatCents(totals.unpaid) }}</span>
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <select v-model.number="months" class="compact-input !w-auto !text-xs" data-schedule-months @change="load">
          <option :value="6">看 6 期</option>
          <option :value="12">看 12 期</option>
          <option :value="24">看 24 期</option>
        </select>
        <button class="btn-secondary !h-8 !px-3 !text-[11px]" :disabled="!periods.length" data-schedule-export @click="exportCSV">导出表格</button>
        <button class="btn-secondary !h-8 !px-3 !text-[11px]" :disabled="!periods.length" data-schedule-print @click="print">打印</button>
      </div>
    </div>

    <div class="mt-3 max-h-[55vh] overflow-auto rounded-xl border border-border">
      <table class="w-full text-left text-[12px]" data-schedule-table>
        <thead class="sticky top-0 bg-muted/80 backdrop-blur">
          <tr class="text-[11px] font-bold text-muted-foreground">
            <th class="px-2.5 py-2">账单期</th>
            <th class="px-2.5 py-2">账单日</th>
            <th class="px-2.5 py-2">还款日</th>
            <th class="px-2.5 py-2 text-right">本期应还</th>
            <th class="px-2.5 py-2 text-right">最低还款</th>
            <th class="px-2.5 py-2">状态</th>
            <th class="px-2.5 py-2">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in periods"
            :key="p.period"
            class="border-t border-border/60"
            :class="{ 'bg-brand-500/6': p.current }"
            :data-schedule-period="p.period"
          >
            <td class="px-2.5 py-1.5 font-semibold">
              {{ p.period }}
              <span v-if="p.current" class="ml-1 rounded-full bg-brand-500/12 px-1.5 text-[10px] font-bold text-brand-600 dark:text-brand-300">本期</span>
            </td>
            <td class="px-2.5 py-1.5 text-muted-foreground">{{ p.statement_date }}</td>
            <td class="px-2.5 py-1.5 text-muted-foreground">{{ p.due_date }}</td>
            <td class="px-2.5 py-1.5 text-right tabular-nums">{{ p.amount_cents ? `¥${formatCents(p.amount_cents)}` : '—' }}</td>
            <td class="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">{{ p.minimum_cents ? `¥${formatCents(p.minimum_cents)}` : '—' }}</td>
            <td class="px-2.5 py-1.5">
              <span v-if="p.paid" class="text-emerald-600 dark:text-emerald-400">已还 {{ p.paid_at }}</span>
              <span v-else-if="p.overdue" class="font-bold text-rose-500">已逾期</span>
              <span v-else-if="p.current" class="font-semibold text-brand-600 dark:text-brand-300">待还</span>
              <span v-else class="text-muted-foreground">未出账</span>
            </td>
            <td class="px-2.5 py-1.5 text-muted-foreground">{{ p.note || '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="!periods.length && !loading" class="mt-3 text-xs text-muted-foreground">还没有可显示的期数。</p>

    <!-- 打印用：屏幕上不显示，@media print 时只显示它（复用全局打印样式） -->
    <div v-if="modelValue" id="print-root">
      <div class="print-doc size-medium">
        <h1>还款计划 · {{ cardTitle }}</h1>
        <p class="meta">
          账单日 每月 {{ card?.statement_day }} 号　·　还款日 每月 {{ card?.due_day }} 号
          <span v-if="card?.no">　·　尾号 {{ tailNo }}</span>
          <span>　·　打印时间：{{ printedAt }}</span>
        </p>
        <table>
          <thead>
            <tr><th>账单期</th><th>账单日</th><th>还款日</th><th>本期应还</th><th>最低还款</th><th>状态</th><th>备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in periods" :key="`print-${p.period}`">
              <td>{{ p.period }}</td>
              <td class="col-time">{{ p.statement_date }}</td>
              <td class="col-time">{{ p.due_date }}</td>
              <td>{{ p.amount_cents ? `¥${formatCents(p.amount_cents)}` : '' }}</td>
              <td>{{ p.minimum_cents ? `¥${formatCents(p.minimum_cents)}` : '' }}</td>
              <td class="col-tight">{{ p.paid ? `已还 ${p.paid_at}` : p.overdue ? '已逾期' : p.current ? '待还' : '未出账' }}</td>
              <td>{{ p.note || '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { getCardSchedule, type CardPeriod, type CreditCard } from '../api/reminder'
import { cardTail, formatCents } from '../utils/card'

const props = defineProps<{ modelValue: boolean; card?: CreditCard | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const periods = ref<CardPeriod[]>([])
const months = ref(12)
const loading = ref(false)

const cardTitle = computed(() => {
  const c = props.card
  return c ? `${c.bank || ''}${c.name || ''}`.trim() || '信用卡' : ''
})
const tailNo = computed(() => cardTail(props.card?.no))
const totals = computed(() => {
  const unpaid = periods.value.filter((p) => !p.paid && p.amount_cents > 0)
  return { unpaid: unpaid.reduce((sum, p) => sum + p.amount_cents, 0), unpaidCount: unpaid.length }
})
const printedAt = computed(() => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

async function load() {
  if (!props.card) return
  loading.value = true
  try {
    const res = await getCardSchedule(props.card.id, months.value)
    periods.value = res.data?.data?.periods || []
  } catch {
    periods.value = []
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (open) => { if (open) void load() })
watch(() => props.card?.id, () => { if (props.modelValue) void load() })

/** 导出 CSV：与表格同一份数据，Excel 打开不乱码（带 BOM）。 */
function exportCSV() {
  const header = ['账单期', '账单日', '还款日', '本期应还', '最低还款', '状态', '已还金额', '已还日期', '备注']
  const status = (p: CardPeriod) => (p.paid ? '已还' : p.overdue ? '已逾期' : p.current ? '待还' : '未出账')
  const rows = periods.value.map((p) => [
    p.period, p.statement_date, p.due_date,
    (p.amount_cents / 100).toFixed(2), (p.minimum_cents / 100).toFixed(2), status(p),
    p.paid_amount_cents ? (p.paid_amount_cents / 100).toFixed(2) : '', p.paid_at || '', p.note || '',
  ])
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const csv = [header, ...rows].map((r) => r.map(escape).join(',')).join('\r\n')
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `还款计划-${cardTitle.value}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 打印：靠全局的 #print-root + @media print（与「已完成记录」那套一致）。 */
async function print() {
  const style = document.createElement('style')
  style.id = 'print-page-rule'
  style.textContent = '@page { size: A4 landscape; margin: 10mm; }'
  document.head.appendChild(style)
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  window.print()
  style.remove()
}
</script>
