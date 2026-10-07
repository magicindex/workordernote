<template>
  <Modal
    :model-value="modelValue"
    size="md"
    :title="card ? '编辑卡片' : '添加卡片'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="block">
        <span class="text-xs font-bold text-foreground">银行</span>
        <input v-model="form.bank" class="input-field mt-1.5 !py-2" maxlength="30" placeholder="例如 招商银行" data-card-bank />
      </label>
      <label class="block">
        <span class="text-xs font-bold text-foreground">卡名</span>
        <input v-model="form.name" class="input-field mt-1.5 !py-2" maxlength="30" placeholder="例如 经典白" data-card-name />
      </label>
      <label class="block">
        <span class="text-xs font-bold text-foreground">卡号</span>
        <input v-model="form.no" class="input-field mt-1.5 !py-2" maxlength="32" placeholder="只用于显示尾号" data-card-no />
      </label>
      <label class="block">
        <span class="text-xs font-bold text-foreground">持卡人（可选）</span>
        <input v-model="form.holder" class="input-field mt-1.5 !py-2" maxlength="30" placeholder="例如 王耀辉" data-card-holder />
      </label>
      <label class="block">
        <span class="text-xs font-bold text-foreground">额度（元，可选）</span>
        <input v-model="limitYuan" class="input-field mt-1.5 !py-2" inputmode="decimal" placeholder="例如 50000" data-card-limit />
      </label>
      <label class="block">
        <span class="text-xs font-bold text-foreground">卡面颜色</span>
        <div class="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="卡面颜色">
          <button
            v-for="color in LIST_COLOR_NAMES"
            :key="color"
            type="button"
            role="radio"
            :aria-checked="color === form.color"
            :aria-label="listColorLabel(color)"
            :title="listColorLabel(color)"
            class="flex h-8 w-8 items-center justify-center rounded-full border-2 transition"
            :class="color === form.color ? 'border-foreground/60 scale-105' : 'border-transparent hover:scale-105'"
            :data-card-color="color"
            @click="form.color = color"
          >
            <span class="h-5 w-5 rounded-full" :style="{ background: listColorHex(color) }"></span>
          </button>
        </div>
      </label>
      <label class="block">
        <span class="text-xs font-bold text-foreground">账单日（每月）</span>
        <select v-model.number="form.statement_day" class="compact-input mt-1.5" data-card-statement>
          <option v-for="d in 31" :key="d" :value="d">{{ d }} 号</option>
        </select>
      </label>
      <label class="block">
        <span class="text-xs font-bold text-foreground">还款日（每月）</span>
        <select v-model.number="form.due_day" class="compact-input mt-1.5" data-card-due>
          <option v-for="d in 31" :key="d" :value="d">{{ d }} 号</option>
        </select>
      </label>
      <label class="block">
        <span class="text-xs font-bold text-foreground">提前提醒</span>
        <select v-model.number="form.advance_days" class="compact-input mt-1.5" data-card-advance>
          <option :value="0">不提前提醒</option>
          <option :value="1">还款日前 1 天</option>
          <option :value="2">还款日前 2 天</option>
          <option :value="3">还款日前 3 天</option>
          <option :value="5">还款日前 5 天</option>
          <option :value="7">还款日前 7 天</option>
        </select>
      </label>
      <label class="flex items-center gap-2 self-end text-xs font-semibold text-foreground">
        <input v-model="form.auto_repeat" type="checkbox" class="h-4 w-4 rounded border-border" data-card-repeat />
        自动循环（每月都生成提醒）
      </label>
      <label class="block sm:col-span-2">
        <span class="text-xs font-bold text-foreground">备注</span>
        <textarea v-model="form.notes" class="input-field mt-1.5 !py-2" rows="2" maxlength="300" placeholder="年费、分期、还款方式…" data-card-notes></textarea>
      </label>
    </div>

    <!-- 实时预览：账单日 → 还款日与免息期 -->
    <div class="mt-3 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-[12px] leading-5" data-card-preview>
      <p class="font-bold text-foreground">
        账单日 {{ preview.statementText }}
        <span class="font-medium text-muted-foreground">（{{ preview.daysToStatement }} 天后）</span>
        <span class="mx-1 text-muted-foreground">→</span>
        还款日 {{ preview.dueText }}
        <span class="font-medium text-muted-foreground">（{{ preview.daysToDue }} 天后）</span>
      </p>
      <p class="mt-0.5 text-muted-foreground">
        免息期 <b class="text-foreground">{{ preview.grace }}</b> 天
        <span v-if="form.advance_days > 0"> · 还款日前 {{ form.advance_days }} 天会提前提醒</span>
      </p>
    </div>

    <p v-if="error" class="mt-3 text-xs font-semibold text-rose-500" data-card-error>{{ error }}</p>

    <div class="mt-5 flex items-center gap-3">
      <button class="btn-secondary flex-1" @click="emit('update:modelValue', false)">取消</button>
      <button class="btn-primary flex-1" :disabled="saving" data-card-submit @click="submit">
        {{ saving ? '保存中…' : card ? '保存并重建提醒' : '添加卡片' }}
      </button>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { createCard, updateCard, type CreditCard } from '../api/reminder'
import { LIST_COLOR_NAMES, listColorHex, listColorLabel, type ListColorName } from '../utils/list-colors'
import { daysUntil, formatCardDate, graceDays, nextDayOccurrence, parseYuanToCents, formatCents } from '../utils/card'

const props = defineProps<{
  modelValue: boolean
  /** 有值 = 编辑这张卡；空 = 新增 */
  card?: CreditCard | null
  listId: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [card: CreditCard]
}>()

const form = reactive({
  bank: '',
  name: '',
  no: '',
  holder: '',
  limit_cents: 0,
  statement_day: 5,
  due_day: 25,
  advance_days: 3,
  auto_repeat: true,
  notes: '',
  color: 'blue' as ListColorName,
})
const limitYuan = ref('')
const saving = ref(false)
const error = ref('')

const preview = computed(() => {
  const now = new Date()
  const statement = nextDayOccurrence(form.statement_day, now)
  const due = nextDayOccurrence(form.due_day, now)
  return {
    statementText: formatCardDate(statement),
    dueText: formatCardDate(due),
    daysToStatement: daysUntil(statement, now),
    daysToDue: daysUntil(due, now),
    grace: graceDays(form.statement_day, form.due_day, now),
  }
})

watch(() => props.modelValue, (open) => {
  if (!open) return
  error.value = ''
  const c = props.card
  form.bank = c?.bank || ''
  form.name = c?.name || ''
  form.no = c?.no || ''
  form.holder = c?.holder || ''
  form.limit_cents = c?.limit_cents || 0
  limitYuan.value = c?.limit_cents ? formatCents(c.limit_cents) : ''
  form.statement_day = c?.statement_day || 5
  form.due_day = c?.due_day || 25
  form.advance_days = c?.advance_days ?? 3
  form.auto_repeat = c?.auto_repeat !== false
  form.notes = c?.notes || ''
  form.color = (LIST_COLOR_NAMES.find((x) => x === c?.color) || 'blue') as ListColorName
})

async function submit() {
  error.value = ''
  if (!form.bank.trim() && !form.name.trim()) {
    error.value = '请至少填写银行或卡名'
    return
  }
  saving.value = true
  try {
    const payload = {
      list_id: props.listId,
      bank: form.bank.trim(),
      name: form.name.trim(),
      no: form.no.trim(),
      holder: form.holder.trim(),
      limit_cents: parseYuanToCents(limitYuan.value),
      statement_day: form.statement_day,
      due_day: form.due_day,
      advance_days: form.advance_days,
      auto_repeat: form.auto_repeat,
      notes: form.notes.trim(),
      color: form.color,
      regenerate_plan: true,
    }
    const res = props.card ? await updateCard(props.card.id, payload) : await createCard(payload)
    emit('saved', res.data?.data)
    emit('update:modelValue', false)
  } catch (err: any) {
    error.value = err.response?.data?.message || '保存失败'
  } finally {
    saving.value = false
  }
}
</script>
