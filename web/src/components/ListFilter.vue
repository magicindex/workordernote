<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="shrink-0 text-[11px] font-bold text-muted-foreground">清单</span>
    <button
      type="button"
      class="quick-chip"
      :class="{ active: modelValue.length === 0 }"
      :title="'显示全部清单'"
      @click="emit('update:modelValue', [])"
    >全部</button>
    <button
      v-for="list in lists"
      :key="list.id"
      type="button"
      class="quick-chip"
      :class="{ active: modelValue.includes(list.id) }"
      :title="modelValue.includes(list.id) ? `不再显示「${list.name}」` : `只显示「${list.name}」`"
      @click="toggle(list.id)"
    >
      <ListIcon :name="list.icon" :size="13" :style="{ color: color(list.color) }" />
      <span class="max-w-[7rem] truncate">{{ list.name }}</span>
    </button>
    <span v-if="modelValue.length" class="shrink-0 text-[11px] font-medium text-muted-foreground">
      已选 {{ modelValue.length }} 个
    </span>
  </div>
</template>

<script setup lang="ts">
import type { ReminderList } from '../api/reminder'
import ListIcon from './ListIcon.vue'
import { listColorHex } from '../utils/list-colors'

const props = defineProps<{
  /** 要筛选的清单；空数组表示全部（不筛选） */
  modelValue: number[]
  lists: ReminderList[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number[]]
}>()

// 与侧栏同一套色名映射，保证同一清单处处同色
// 清单色表在 utils/list-colors.ts：筛选芯片、侧栏图标、任务标题、日历图标同色。
const color = listColorHex

// 多选：点一下加入，再点一下移出；全移出等于「全部」。
function toggle(id: number) {
  const next = props.modelValue.includes(id)
    ? props.modelValue.filter((x) => x !== id)
    : [...props.modelValue, id]
  emit('update:modelValue', next)
}
</script>
