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
        <!-- 预设下拉（带银行标志）：卡面靠标志区分，所以这里不让人随便打错字 -->
        <div class="mt-1.5 flex items-center gap-2">
          <img v-if="pickedLogo" :src="pickedLogo" alt="" class="h-7 w-7 shrink-0 rounded-full bg-white object-contain p-0.5 ring-1 ring-border" data-card-bank-logo />
          <select
            v-model="bankChoice"
            class="compact-input"
            data-card-bank-select
          >
            <option value="">请选择银行…</option>
            <option v-for="b in BANK_PRESETS" :key="b.code" :value="b.code">{{ b.name }}</option>
            <option value="__other__">其它银行（手动填写）</option>
          </select>
        </div>
        <input
          v-if="bankChoice === '__other__'"
          v-model="form.bank"
          class="input-field mt-1.5 !py-2"
          maxlength="30"
          placeholder="例如 某某银行"
          data-card-bank
        />
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
        <span class="text-xs font-bold text-foreground">信用额度（元，可选）</span>
        <input v-model="limitYuan" class="input-field mt-1.5 !py-2" inputmode="decimal" placeholder="例如 50000" data-card-limit />
      </label>
      <div class="block">
        <span class="text-xs font-bold text-foreground">卡面颜色</span>
        <p class="mt-1.5 rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          不用选：所有卡默认同一套卡面，靠**银行标志**区分；账单日之后会从黄变橘，
          还款日前 3 天变成红色。
        </p>
      </div>
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
      <!-- 「还款日前 N 天提前提醒」这一项没有了（用户 2026-10-13）：还款提醒现在是
           **从账单日一直提醒到还款日**，账单日到还款日通常 20 天上下，任何「提前 N 天」
           都落在窗口里、等于重复。字段仍随卡片保存（老数据不丢），只是不再单独生成提醒。 -->
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
        <span> · 从账单日开始提醒，一直到还款日；还款日 23:59 到期</span>
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
import { BANK_PRESETS, bankLogoOf, type BankPreset } from '../utils/banks'
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
  // 卡面颜色不再由用户选（统一默认色 + 按日期变化），字段保留只为兼容旧数据
  color: 'blue',
})
const limitYuan = ref('')
const bankChoice = ref('')
const saving = ref(false)
const error = ref('')

// 选了预设银行就显示它的标志；没选/其它银行则按卡上的名字尽力识别
const pickedLogo = computed(() => {
  if (bankChoice.value && bankChoice.value !== '__other__') {
    return BANK_PRESETS.find((b: BankPreset) => b.code === bankChoice.value)?.logo || null
  }
  return bankLogoOf(form.bank)
})

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
  bankChoice.value = BANK_PRESETS.find((b) => b.name === form.bank.trim())?.code
    || (form.bank.trim() ? '__other__' : '')
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
  form.color = c?.color || 'blue'
})

async function submit() {
  error.value = ''
  if (bankChoice.value && bankChoice.value !== '__other__') {
    form.bank = BANK_PRESETS.find((b) => b.code === bankChoice.value)?.name || form.bank
  }
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
      color: form.color || 'blue',
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
