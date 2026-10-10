<template>
  <!-- 日历里**单击任务**弹出的「查看」页（用户 2026-10-10 要求）：
       只读地看这一条的标题 / 类型 / 清单 / 时间 / 重复 / 备注 / 状态，
       底部一个「编辑」按钮切到编辑器（双击任务也是直接进编辑器）。
       壳样式**自带一份**（不能借用 ReminderEditor 的 .editor-panel：那是 scoped 样式，
       别的组件拿不到，会退化成没有定位的块 → 透明遮罩盖在上面、按钮点不到）。 -->
  <Transition name="view-sheet">
    <div
      v-if="item"
      class="fixed inset-0 z-[75] flex items-center justify-center p-3 sm:p-6"
      data-reminder-view
    >
      <div class="absolute inset-0 bg-slate-950/25 backdrop-blur-sm" @click="$emit('close')"></div>
      <aside class="view-card" role="dialog" aria-label="查看提醒">
        <div class="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-5">
          <div>
            <p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground">查看</p>
            <h2 class="mt-0.5 text-base font-extrabold sm:mt-1 sm:text-lg">
              {{ item.kind === 'note' ? '记事详情' : '提醒详情' }}
            </h2>
          </div>
          <button class="row-action !opacity-100" aria-label="关闭" data-view-close @click="$emit('close')">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>

        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:space-y-4 sm:p-5">
          <div class="flex min-w-0 items-start gap-2">
            <span
              v-if="item.kind === 'note'"
              class="cal-note-mark mt-0.5 h-5 w-5 shrink-0"
              title="记事（记录，无需完成）"
            >记</span>
            <h3
              class="min-w-0 flex-1 text-lg font-extrabold leading-snug"
              :class="{ 'line-through opacity-60': item.completed && item.kind !== 'note' }"
              data-view-title
            >{{ item.title }}</h3>
          </div>

          <div class="flex flex-wrap gap-1.5">
            <span class="tiny-badge">{{ item.kind === 'note' ? '记事' : '任务' }}</span>
            <span v-if="item.priority" class="tiny-badge !text-rose-500">{{ '!'.repeat(item.priority) }} 重要</span>
            <span v-if="item.repeat_rule && item.repeat_rule !== 'none'" class="tiny-badge">{{ ruleLabel(item.repeat_rule) }}</span>
            <span v-if="item.completed" class="tiny-badge !text-emerald-600">
              {{ item.kind === 'note' ? '已记录' : '已完成' }}
            </span>
            <span v-else-if="item.kind !== 'note'" class="tiny-badge !text-muted-foreground">未完成</span>
          </div>

          <dl class="grid gap-2.5 text-sm" data-view-fields>
            <div class="flex items-start gap-3">
              <dt class="w-16 shrink-0 text-xs font-bold text-muted-foreground">清单</dt>
              <dd class="flex min-w-0 items-center gap-1.5 font-semibold">
                <ListIcon :name="item.list_icon || 'list'" :size="13" class="shrink-0" :style="{ color: listInk(item.list_color) }" />
                <span class="truncate">{{ item.list_name }}</span>
              </dd>
            </div>
            <div class="flex items-start gap-3">
              <dt class="w-16 shrink-0 text-xs font-bold text-muted-foreground">{{ item.kind === 'note' ? '记录时间' : '时间' }}</dt>
              <dd class="min-w-0 font-semibold" data-view-time>{{ whenText }}</dd>
            </div>
            <div v-if="item.kind !== 'note' && item.end_at" class="flex items-start gap-3">
              <dt class="w-16 shrink-0 text-xs font-bold text-muted-foreground">时间段</dt>
              <dd class="min-w-0 font-semibold" data-view-range>{{ rangeText }}</dd>
            </div>
            <div v-if="cardRoleText" class="flex items-start gap-3">
              <dt class="w-16 shrink-0 text-xs font-bold text-muted-foreground">来源</dt>
              <dd class="min-w-0 font-semibold">信用卡 · {{ cardRoleText }}</dd>
            </div>
            <div class="flex items-start gap-3">
              <dt class="w-16 shrink-0 text-xs font-bold text-muted-foreground">备注</dt>
              <dd class="min-w-0 whitespace-pre-wrap leading-6 text-foreground/90" data-view-notes>{{ item.notes?.trim() || '（无）' }}</dd>
            </div>
          </dl>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-6 sm:py-4">
          <button type="button" class="btn-secondary !h-9 !px-4 !text-xs" data-view-close-btn @click="$emit('close')">关闭</button>
          <button type="button" class="btn-primary !h-9 !px-4 !text-xs" data-view-edit @click="$emit('edit')">编辑</button>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ListIcon from './ListIcon.vue'
import type { CalendarItem } from '../api/reminder'
import { listColorHex } from '../utils/list-colors'

const props = defineProps<{ item: CalendarItem | null }>()
defineEmits<{ close: []; edit: [] }>()

const listInk = listColorHex

/** "2026-10-10T20:00:00+08:00" → { 10月10日, 20:00, 周五 }（当年不带年份，跨年才带） */
function stamp(iso: string): { date: string; time: string; week: string } | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const date = sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return { date, time, week }
}

const whenText = computed(() => {
  const it = props.item
  if (!it) return ''
  const s = stamp(it.due_at)
  if (!s) return ''
  if (it.all_day) return `${s.date}${s.week} · 全天`
  if (it.kind === 'note') return `${s.date} ${s.time}`
  return `${s.date}${s.week} ${s.time}`
})

/** 时间段任务：开始 → 结束（同一天只写结束时分，跨天把两边日期都写全） */
const rangeText = computed(() => {
  const it = props.item
  if (!it || !it.end_at) return ''
  const from = stamp(it.start_at || it.due_at)
  const to = stamp(it.end_at)
  if (!from || !to) return ''
  const sameDay = from.date === to.date
  return sameDay ? `${from.date} ${from.time} – ${to.time}` : `${from.date} ${from.time} – ${to.date} ${to.time}`
})

const cardRoleText = computed(() => {
  const role = props.item?.card_role
  if (!role) return ''
  return ({ statement: '账单日', due: '还款日', advance: '还款提醒' } as Record<string, string>)[role] || ''
})

function ruleLabel(rule: string) {
  return ({ daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' } as Record<string, string>)[rule] || '循环'
}
</script>

<style scoped>
/* 居中弹窗（与 ReminderEditor 的 modal 观感一致，但样式自带一份）：
   relative + z-10 是关键 —— 遮罩是 absolute 的，不定位的面板会被它盖住，按钮就点不到了。 */
.view-card {
  @apply relative z-10 flex max-h-full w-full max-w-[30rem] flex-col overflow-hidden rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur-2xl;
}
.view-sheet-enter-active, .view-sheet-leave-active { transition: opacity .18s ease; }
.view-sheet-enter-from, .view-sheet-leave-to { opacity: 0; }
.view-sheet-enter-active .view-card, .view-sheet-leave-active .view-card { transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .18s ease; }
.view-sheet-enter-from .view-card, .view-sheet-leave-to .view-card { transform: translateY(10px) scale(.97); opacity: 0; }
</style>
