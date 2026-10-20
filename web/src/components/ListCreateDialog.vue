<template>
  <Modal :model-value="modelValue" size="md" title="新建清单" @update:model-value="emit('update:modelValue', $event)">
    <!-- 只建普通清单：信用卡不在「新建清单」里设定，它是侧栏那个固定栏目
         「信用卡账单」，卡片都归到那一栏里（见 CreditCardPanel / card_bucket.go）。 -->
    <div class="space-y-4">
      <label class="block">
        <span class="text-xs font-bold text-foreground">清单名称</span>
        <input
          v-model="name"
          class="input-field mt-1.5 !py-2"
          maxlength="40"
          placeholder="清单名称"
          data-list-name
        />
      </label>

      <div>
        <span class="text-xs font-bold text-foreground">图标</span>
        <p class="mt-1 text-[11px] leading-4 text-muted-foreground">侧栏与日历里用图标标识这个清单。</p>
        <div class="mt-2 grid grid-cols-8 gap-1.5 sm:grid-cols-10" role="radiogroup" aria-label="清单图标">
          <button
            v-for="icon in LIST_ICONS"
            :key="icon.key"
            type="button"
            role="radio"
            :aria-checked="pickedIcon === icon.key"
            :aria-label="icon.label"
            :title="icon.label"
            class="flex h-8 w-8 items-center justify-center rounded-lg border transition"
            :class="pickedIcon === icon.key
              ? 'border-brand-500 bg-brand-500/12 text-brand-600 dark:text-brand-300'
              : 'border-border text-muted-foreground hover:border-brand-500/40 hover:text-foreground'"
            :data-list-icon-option="icon.key"
            @click="pickedIcon = icon.key"
          >
            <ListIcon :name="icon.key" :size="16" />
          </button>
        </div>
      </div>

      <div>
        <span class="text-xs font-bold text-foreground">颜色</span>
        <div class="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="清单颜色">
          <button
            v-for="color in LIST_COLOR_NAMES"
            :key="color"
            type="button"
            role="radio"
            :aria-checked="color === pickedColor"
            :data-list-color="color"
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

      <!-- AI 提示词（用户 2026-10-17：「后期新建清单也能自定义提示词，或者多个栏目共用一个」）：
           写在清单上，小秘分析到这一栏的数据时一起交给模型；「引用」是复制一份，之后各改各的。 -->
      <div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-bold text-foreground">AI 提示词（可选）</span>
          <select
            v-if="promptSources.length"
            v-model="referenceId"
            class="input-field !h-7 !w-32 !py-0 text-[11px]"
            aria-label="引用其他栏目的提示词"
            data-list-ai-prompt-ref
            @change="applyReference"
          >
            <option value="">引用其他栏目…</option>
            <option v-for="item in promptSources" :key="item.id" :value="String(item.id)">{{ item.name }}</option>
          </select>
        </div>
        <textarea
          v-model="aiPrompt"
          rows="2"
          maxlength="600"
          class="input-field mt-1.5 !py-2 text-[13px] leading-5"
          placeholder="例如：按基站/线路分组，多说进度与遗留问题"
          data-list-ai-prompt
        ></textarea>
        <p class="mt-1 text-[11px] leading-4 text-muted-foreground">
          小秘分析这一栏的数据时会把这句要求一起给模型，只作用于这一栏；留空就不加要求。
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
import { ref, watch } from 'vue'
import Modal from './Modal.vue'
import { createList, getLists, type ReminderList } from '../api/reminder'
import ListIcon from './ListIcon.vue'
import { LIST_COLOR_NAMES, listColorHex, listColorLabel, type ListColorName } from '../utils/list-colors'
import { LIST_ICONS } from '../utils/list-icons'

const props = defineProps<{
  modelValue: boolean
  /** 新建时用哪个颜色（按现有清单数量轮换） */
  defaultColor?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [list: { id: number; name: string; color: string }]
}>()

const name = ref('')
const pickedColor = ref<ListColorName>(LIST_COLOR_NAMES[0])
const pickedIcon = ref('list')
const aiPrompt = ref('')
/** 引用其他栏目的提示词：选一个就把那段文字复制进 textarea（一次性，之后各改各的）。 */
const referenceId = ref('')
const promptSources = ref<ReminderList[]>([])
const saving = ref(false)
const error = ref('')

watch(() => props.modelValue, (open) => {
  if (!open) return
  name.value = ''
  const fallback = LIST_COLOR_NAMES.find((c) => c === props.defaultColor) || LIST_COLOR_NAMES[0]
  pickedColor.value = fallback
  pickedIcon.value = 'list' 
  aiPrompt.value = ''
  referenceId.value = ''
  error.value = ''
  void loadPromptSources()
})

/** 只有已经写了提示词的清单才值得出现在「引用」里。 */
async function loadPromptSources() {
  try {
    const res = await getLists()
    const rows: ReminderList[] = res.data?.data || []
    promptSources.value = rows.filter((item) => (item.ai_prompt || '').trim() !== '')
  } catch {
    promptSources.value = []
  }
}

function applyReference() {
  const picked = promptSources.value.find((item) => String(item.id) === referenceId.value)
  if (picked) aiPrompt.value = picked.ai_prompt || ''
  referenceId.value = ''
}

async function submit() {
  error.value = ''
  const listName = name.value.trim()
  if (!listName) {
    error.value = '请填写清单名称'
    return
  }
  saving.value = true
  try {
    const res = await createList({
      name: listName,
      color: pickedColor.value,
      icon: pickedIcon.value,
      ai_prompt: aiPrompt.value.trim(),
    })
    emit('created', res.data?.data)
    emit('update:modelValue', false)
  } catch (err: any) {
    error.value = err.response?.data?.message || '创建失败'
  } finally {
    saving.value = false
  }
}
</script>
