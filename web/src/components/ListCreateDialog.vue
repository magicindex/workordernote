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
import { createList } from '../api/reminder'
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
const saving = ref(false)
const error = ref('')

watch(() => props.modelValue, (open) => {
  if (!open) return
  name.value = ''
  const fallback = LIST_COLOR_NAMES.find((c) => c === props.defaultColor) || LIST_COLOR_NAMES[0]
  pickedColor.value = fallback
  pickedIcon.value = 'list' 
  error.value = ''
})

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
