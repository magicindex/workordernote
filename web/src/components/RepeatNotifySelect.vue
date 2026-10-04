<template>
  <div class="repeat-notify">
    <select :value="presetValue" class="preset" @change="onPresetChange">
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
      <option value="custom">自定义…</option>
    </select>
    <div v-if="customizing" class="custom">
      <input
        v-model.number="customValue"
        type="number"
        min="1"
        max="44640"
        class="custom-number"
        @change="applyCustom"
        @keydown.enter="applyCustom"
      />
      <select v-model="customUnit" class="custom-unit" @change="applyCustom">
        <option :value="1">分钟</option>
        <option :value="60">小时</option>
        <option :value="1440">天</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  /** 过期提醒间隔（分钟），0 表示不提醒 */
  modelValue: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
}>()

const options = [
  { value: 0, label: '不过期提醒' },
  { value: 5, label: '每 5 分钟' },
  { value: 15, label: '每 15 分钟' },
  { value: 30, label: '每 30 分钟' },
  { value: 60, label: '每 1 小时' },
  { value: 120, label: '每 2 小时' },
  { value: 240, label: '每 4 小时' },
  { value: 1440, label: '每 1 天' },
]

const customizing = ref(false)
const customValue = ref(30)
const customUnit = ref(60)
const MAX_MINUTES = 60 * 24 * 31

const presetValue = computed(() => {
  if (customizing.value) return 'custom'
  return options.some(o => o.value === props.modelValue) ? props.modelValue : 'custom'
})

watch(() => props.modelValue, value => {
  if (value !== 0 && !options.some(o => o.value === value)) {
    // 服务端返回了自定义间隔：展开编辑框并换算默认单位
    enterCustom(value)
  } else if (value === 0) {
    customizing.value = false
  }
}, { immediate: true })

function onPresetChange(event: Event) {
  const raw = (event.target as HTMLSelectElement).value
  if (raw === 'custom') {
    enterCustom(props.modelValue || 60)
    applyCustom()
    return
  }
  customizing.value = false
  emit('update:modelValue', Number(raw))
}

function enterCustom(minutes: number) {
  customizing.value = true
  if (minutes > 0 && minutes % 1440 === 0) {
    customValue.value = minutes / 1440
    customUnit.value = 1440
  } else if (minutes > 0 && minutes % 60 === 0) {
    customValue.value = minutes / 60
    customUnit.value = 60
  } else if (minutes > 0) {
    customValue.value = minutes
    customUnit.value = 1
  }
}

function applyCustom() {
  const minutes = Math.round((customValue.value || 0) * customUnit.value)
  emit('update:modelValue', Math.max(0, Math.min(MAX_MINUTES, minutes)))
}
</script>

<style scoped>
/* 这里只负责结构与占位，外观（高度 / 圆角 / 字号 / 内边距）交给宿主字段样式：
   scoped 样式进不了子组件内部，写死一套尺寸必然在另一处对不齐，所以两处宿主
   各自用 :deep() 把它对齐到本地的字段样式：
     - ReminderEditor 的 .editor-field（与「重复 / 按农历循环」同一行）
     - HomeView 快速新建的 .field-label + .compact-input（紧凑那排）
   新增使用处时记得也给 .repeat-notify 的 select/input 补上字段样式。 */
.repeat-notify { @apply flex items-center gap-1.5; }
.repeat-notify .preset { @apply min-w-0 flex-1; }
.repeat-notify .custom { @apply flex shrink-0 items-center gap-1.5; }
/* 自定义时的两个小控件只收窄，高度跟着宿主走。 */
.repeat-notify .custom-number { @apply w-16 shrink-0 text-center sm:w-20; }
.repeat-notify .custom-unit { @apply w-auto shrink-0; }
</style>
