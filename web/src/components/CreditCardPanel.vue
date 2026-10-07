<template>
  <!-- 信用卡清单的卡片面板：账单日/还款日倒计时、免息期、卡号尾号与备注，
       外加「重新生成还款计划」与「编辑卡片信息」。只在信用卡清单上显示。 -->
  <section v-if="isCard" class="surface mb-3 rounded-2xl p-3 sm:p-4" data-card-panel>
    <div class="flex flex-wrap items-start gap-3">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/12 text-rose-500">
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" aria-hidden="true">
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke-width="1.7"/>
          <path d="M2.5 10h19M6 15h4" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
      </span>
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span class="text-sm font-extrabold">{{ cardTitle }}</span>
          <span v-if="tail" class="text-[11px] font-bold text-muted-foreground">尾号 {{ tail }}</span>
        </p>

        <!-- 倒计时：账单日与还款日各一个，颜色与日历里的标记一致 -->
        <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold">
          <span class="inline-flex items-center gap-1.5" style="color: #d97706" data-card-countdown="statement">
            <i class="h-2 w-2 rounded-full" style="background: #f59e0b"></i>
            账单日 {{ summary.statementText }}
            <b>{{ summary.daysToStatement === 0 ? '就是今天' : `还有 ${summary.daysToStatement} 天` }}</b>
          </span>
          <span class="inline-flex items-center gap-1.5" style="color: #e11d48" data-card-countdown="due">
            <i class="h-2 w-2 rounded-full" style="background: #f43f5e"></i>
            还款日 {{ summary.dueText }}
            <b>{{ summary.daysToDue === 0 ? '就是今天' : `还有 ${summary.daysToDue} 天` }}</b>
          </span>
          <span class="inline-flex items-center gap-1.5 text-muted-foreground" data-card-grace>
            免息期 <b class="text-foreground">{{ summary.grace }}</b> 天
          </span>
          <span v-if="!autoRepeat" class="text-muted-foreground">· 未开自动循环</span>
        </div>

        <p v-if="list.card_notes" class="mt-1.5 whitespace-pre-line text-[12px] leading-5 text-muted-foreground" data-card-notes>{{ list.card_notes }}</p>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <button class="btn-secondary !h-8 !px-3 !text-[11px]" :disabled="busy" data-card-edit @click="openEditor">编辑卡片信息</button>
        <button class="btn-secondary !h-8 !px-3 !text-[11px]" :disabled="busy" data-card-regenerate @click="regenerate">
          {{ busy ? '处理中…' : '重新生成还款计划' }}
        </button>
      </div>
    </div>

    <p v-if="message" class="mt-2 text-[11px] font-semibold" :class="ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'" data-card-message>{{ message }}</p>

    <!-- 编辑卡片信息：改完直接重建还款计划 -->
    <Modal v-model="editorOpen" size="md" title="编辑卡片信息">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="text-xs font-bold text-foreground">银行</span>
          <input v-model="draft.bank" class="input-field mt-1.5 !py-2" maxlength="30" data-edit-bank />
        </label>
        <label class="block">
          <span class="text-xs font-bold text-foreground">卡名</span>
          <input v-model="draft.name" class="input-field mt-1.5 !py-2" maxlength="30" data-edit-name />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-xs font-bold text-foreground">卡号</span>
          <input v-model="draft.no" class="input-field mt-1.5 !py-2" maxlength="32" data-edit-no />
        </label>
        <label class="block">
          <span class="text-xs font-bold text-foreground">账单日</span>
          <select v-model.number="draft.statementDay" class="compact-input mt-1.5" data-edit-statement>
            <option v-for="d in 31" :key="d" :value="d">{{ d }} 号</option>
          </select>
        </label>
        <label class="block">
          <span class="text-xs font-bold text-foreground">还款日</span>
          <select v-model.number="draft.dueDay" class="compact-input mt-1.5" data-edit-due>
            <option v-for="d in 31" :key="d" :value="d">{{ d }} 号</option>
          </select>
        </label>
        <label class="block sm:col-span-2">
          <span class="text-xs font-bold text-foreground">备注</span>
          <textarea v-model="draft.notes" class="input-field mt-1.5 !py-2" rows="2" maxlength="300" data-edit-notes></textarea>
        </label>
      </div>
      <label class="mt-3 flex items-center gap-2 text-xs font-semibold text-foreground">
        <input v-model="draft.autoRepeat" type="checkbox" class="h-4 w-4 rounded border-border" data-edit-repeat />
        自动循环（每月都生成账单日与还款日提醒）
      </label>
      <p class="mt-2 text-[11px] leading-4 text-muted-foreground">
        保存后会自动重建这两条提醒（旧的自动生成项会被删掉）；只改备注不会动提醒。
      </p>
      <div class="mt-4 flex items-center gap-3">
        <button class="btn-secondary flex-1" @click="editorOpen = false">取消</button>
        <button class="btn-primary flex-1" :disabled="busy" data-edit-save @click="save">
          {{ busy ? '保存中…' : '保存并重建' }}
        </button>
      </div>
    </Modal>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Modal from './Modal.vue'
import { regenerateCardPlan, updateList, type ReminderList } from '../api/reminder'
import { cardTail, daysUntil, formatCardDate, graceDays, nextDayOccurrence } from '../utils/card'

const props = defineProps<{ list: ReminderList }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const isCard = computed(() => props.list?.template === 'credit_card')
const tail = computed(() => cardTail(props.list?.card_no))
const autoRepeat = computed(() => props.list?.card_auto_repeat !== false)
const cardTitle = computed(() => {
  const t = `${props.list?.card_bank || ''}${props.list?.card_name || ''}`.trim()
  return t || props.list?.name || '信用卡'
})

/** 倒计时按本地时间实时算（后端也会给一份，前端这份是为了不依赖刷新）。 */
const summary = computed(() => {
  const s = props.list?.card_statement_day || 1
  const d = props.list?.card_due_day || 1
  const now = new Date()
  const statement = nextDayOccurrence(s, now)
  const due = nextDayOccurrence(d, now)
  return {
    statementText: formatCardDate(statement),
    dueText: formatCardDate(due),
    daysToStatement: daysUntil(statement, now),
    daysToDue: daysUntil(due, now),
    grace: graceDays(s, d, now),
  }
})

const editorOpen = ref(false)
const busy = ref(false)
const message = ref('')
const ok = ref(true)
const draft = reactive({ bank: '', name: '', no: '', statementDay: 5, dueDay: 25, notes: '', autoRepeat: true })

function openEditor() {
  draft.bank = props.list?.card_bank || ''
  draft.name = props.list?.card_name || ''
  draft.no = props.list?.card_no || ''
  draft.statementDay = props.list?.card_statement_day || 5
  draft.dueDay = props.list?.card_due_day || 25
  draft.notes = props.list?.card_notes || ''
  draft.autoRepeat = autoRepeat.value
  message.value = ''
  editorOpen.value = true
}

async function save() {
  busy.value = true
  message.value = ''
  try {
    const daysChanged = draft.statementDay !== props.list?.card_statement_day || draft.dueDay !== props.list?.card_due_day
    await updateList(props.list.id, {
      card_bank: draft.bank,
      card_name: draft.name,
      card_no: draft.no,
      card_statement_day: draft.statementDay,
      card_due_day: draft.dueDay,
      card_notes: draft.notes,
      card_auto_repeat: draft.autoRepeat,
      // 账单日/还款日变了才重建；只改备注不动提醒
      regenerate_plan: daysChanged,
    })
    ok.value = true
    message.value = daysChanged ? '已保存并重建还款计划' : '已保存'
    editorOpen.value = false
    emit('changed')
  } catch (err: any) {
    ok.value = false
    message.value = err.response?.data?.message || '保存失败'
  } finally {
    busy.value = false
  }
}

async function regenerate() {
  busy.value = true
  message.value = ''
  try {
    const res = await regenerateCardPlan(props.list.id)
    const n = res.data?.data?.generated ?? 0
    ok.value = true
    message.value = `已重新生成 ${n} 条提醒`
    emit('changed')
  } catch (err: any) {
    ok.value = false
    message.value = err.response?.data?.message || '生成失败'
  } finally {
    busy.value = false
  }
}
</script>
