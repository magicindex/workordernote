<template>
  <Modal :model-value="modelValue" size="md" title="新建清单" @update:model-value="emit('update:modelValue', $event)">
    <!-- 模板：通用 / 信用卡。信用卡模板会按账单日+还款日自动生成还款计划。 -->
    <div>
      <p class="text-xs font-bold text-muted-foreground">清单类型</p>
      <div class="mt-2 inline-flex rounded-xl border border-border bg-muted/60 p-0.5" role="group" aria-label="清单类型">
        <button
          type="button"
          class="seg-btn"
          :class="{ 'seg-btn-on': template === 'general' }"
          data-template="general"
          @click="template = 'general'"
        >通用</button>
        <button
          type="button"
          class="seg-btn"
          :class="{ 'seg-btn-on': template === 'credit_card' }"
          data-template="credit_card"
          @click="template = 'credit_card'"
        >信用卡</button>
      </div>
      <p class="mt-1.5 text-[11px] leading-4 text-muted-foreground">
        {{ template === 'credit_card'
          ? '一个清单 = 一张卡。填好后自动生成「账单日 / 还款日」两条提醒，并按你选的周期循环。'
          : '普通的待办清单，和现在一样。' }}
      </p>
    </div>

    <!-- 通用：名称 + 颜色 -->
    <div class="mt-4 space-y-4">
      <label class="block">
        <span class="text-xs font-bold text-foreground">清单名称{{ template === 'credit_card' ? '（留空自动用「银行 + 卡名」）' : '' }}</span>
        <input
          v-model="name"
          class="input-field mt-1.5 !py-2"
          maxlength="40"
          :placeholder="template === 'credit_card' ? '例如 招商银行经典白' : '清单名称'"
          data-list-name
        />
      </label>

      <div>
        <span class="text-xs font-bold text-foreground">颜色</span>
        <div class="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="清单颜色">
          <button
            v-for="color in LIST_COLOR_NAMES"
            :key="color"
            type="button"
            role="radio"
            :aria-checked="color === pickedColor"
            :aria-label="listColorLabel(color)"
            :title="listColorLabel(color)"
            class="flex h-9 w-9 items-center justify-center rounded-full border-2 transition"
            :class="color === pickedColor ? 'border-foreground/60 scale-105' : 'border-transparent hover:scale-105'"
            @click="pickedColor = color"
          >
            <span class="h-6 w-6 rounded-full" :style="{ background: listColorHex(color) }"></span>
          </button>
        </div>
      </div>
    </div>

    <!-- 信用卡：卡片信息 -->
    <div v-if="template === 'credit_card'" class="mt-4 space-y-3 rounded-2xl bg-muted/50 p-3.5">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="text-xs font-bold text-foreground">银行</span>
          <input v-model="cardBank" class="input-field mt-1.5 !py-2" maxlength="30" placeholder="例如 招商银行" data-card-bank />
        </label>
        <label class="block">
          <span class="text-xs font-bold text-foreground">卡名</span>
          <input v-model="cardName" class="input-field mt-1.5 !py-2" maxlength="30" placeholder="例如 经典白" data-card-name />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-xs font-bold text-foreground">卡号</span>
          <input v-model="cardNo" class="input-field mt-1.5 !py-2" maxlength="32" placeholder="可只填尾号，只用于显示" data-card-no />
        </label>
        <label class="block">
          <span class="text-xs font-bold text-foreground">账单日（每月）</span>
          <select v-model.number="statementDay" class="compact-input mt-1.5" data-card-statement>
            <option v-for="d in 31" :key="d" :value="d">{{ d }} 号</option>
          </select>
        </label>
        <label class="block">
          <span class="text-xs font-bold text-foreground">还款日（每月）</span>
          <select v-model.number="dueDay" class="compact-input mt-1.5" data-card-due>
            <option v-for="d in 31" :key="d" :value="d">{{ d }} 号</option>
          </select>
        </label>
        <label class="block sm:col-span-2">
          <span class="text-xs font-bold text-foreground">备注</span>
          <textarea v-model="cardNotes" class="input-field mt-1.5 !py-2" rows="2" maxlength="300" placeholder="年费、额度、还款方式…" data-card-notes></textarea>
        </label>
      </div>

      <label class="flex items-center gap-2 text-xs font-semibold text-foreground">
        <input v-model="autoRepeat" type="checkbox" class="h-4 w-4 rounded border-border" data-card-repeat />
        自动循环（每月都生成账单日与还款日提醒）
      </label>

      <!-- 实时预览：账单日 → 还款日的倒计时与免息期 -->
      <div class="rounded-xl border border-border/70 bg-surface px-3 py-2.5 text-[12px] leading-5" data-card-preview>
        <p class="font-bold text-foreground">
          下一次账单日 {{ preview.statementText }}
          <span class="font-medium text-muted-foreground">（{{ preview.daysToStatement }} 天后）</span>
          <span class="mx-1 text-muted-foreground">→</span>
          还款日 {{ preview.dueText }}
          <span class="font-medium text-muted-foreground">（{{ preview.daysToDue }} 天后）</span>
        </p>
        <p class="mt-0.5 text-muted-foreground">
          免息期 <b class="text-foreground">{{ preview.grace }}</b> 天
          <span v-if="!autoRepeat"> · 只生成最近一次，不循环</span>
          <span v-else> · 每月 1 号起自动滚到下一期</span>
        </p>
      </div>
    </div>

    <p v-if="error" class="mt-3 text-xs font-semibold text-rose-500" data-create-error>{{ error }}</p>

    <div class="mt-5 flex items-center gap-3">
      <button class="btn-secondary flex-1" @click="emit('update:modelValue', false)">取消</button>
      <button class="btn-primary flex-1" :disabled="saving" data-create-submit @click="submit">
        {{ saving ? '创建中…' : '创建' }}
      </button>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { createList } from '../api/reminder'
import { LIST_COLOR_NAMES, listColorHex, listColorLabel, type ListColorName } from '../utils/list-colors'
import { daysUntil, formatCardDate, graceDays, nextDayOccurrence } from '../utils/card'

const props = defineProps<{
  modelValue: boolean
  /** 新建时用哪个颜色（按现有清单数量轮换） */
  defaultColor?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [list: { id: number; name: string; color: string }]
}>()

const template = ref<'general' | 'credit_card'>('general')
const name = ref('')
const pickedColor = ref<ListColorName>(LIST_COLOR_NAMES[0])
const cardName = ref('')
const cardBank = ref('')
const cardNo = ref('')
const statementDay = ref(5)
const dueDay = ref(25)
const cardNotes = ref('')
const autoRepeat = ref(true)
const saving = ref(false)
const error = ref('')

const preview = computed(() => {
  const now = new Date()
  const statement = nextDayOccurrence(statementDay.value, now)
  const due = nextDayOccurrence(dueDay.value, now)
  return {
    statementText: formatCardDate(statement),
    dueText: formatCardDate(due),
    daysToStatement: daysUntil(statement, now),
    daysToDue: daysUntil(due, now),
    grace: graceDays(statementDay.value, dueDay.value, now),
  }
})

watch(() => props.modelValue, (open) => {
  if (!open) return
  template.value = 'general'
  name.value = ''
  const fallback = LIST_COLOR_NAMES.find((c) => c === props.defaultColor) || LIST_COLOR_NAMES[0]
  pickedColor.value = fallback
  cardName.value = ''
  cardBank.value = ''
  cardNo.value = ''
  statementDay.value = 5
  dueDay.value = 25
  cardNotes.value = ''
  autoRepeat.value = true
  error.value = ''
})

async function submit() {
  error.value = ''
  const listName = name.value.trim()
  if (template.value === 'general' && !listName) {
    error.value = '请填写清单名称'
    return
  }
  if (template.value === 'credit_card' && !listName && !(cardBank.value.trim() + cardName.value.trim())) {
    error.value = '请填写银行或卡名（或直接给清单起个名字）'
    return
  }
  saving.value = true
  try {
    const res = await createList({
      name: listName,
      color: pickedColor.value,
      ...(template.value === 'credit_card'
        ? {
            template: 'credit_card' as const,
            card_name: cardName.value.trim(),
            card_bank: cardBank.value.trim(),
            card_no: cardNo.value.trim(),
            card_statement_day: statementDay.value,
            card_due_day: dueDay.value,
            card_notes: cardNotes.value.trim(),
            card_auto_repeat: autoRepeat.value,
          }
        : {}),
    })
    const created = res.data?.data
    emit('created', created)
    emit('update:modelValue', false)
  } catch (err: any) {
    error.value = err.response?.data?.message || '创建失败'
  } finally {
    saving.value = false
  }
}
</script>
