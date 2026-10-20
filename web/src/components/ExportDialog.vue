<template>
  <Modal
    :model-value="modelValue"
    size="lg"
    title="导出表格"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="text-xs leading-5 text-muted-foreground">
      导出<strong>所有数据</strong>（不受页面上的月份与时间范围影响）。下面选好清单与列，导出 CSV 用 Excel/WPS 直接打开。
    </p>

    <!-- 清单多选：默认全选（含信用卡账单、记事本这些系统栏目）。 -->
    <section class="mt-4">
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-xs font-bold text-foreground">清单（{{ selectedLists.length }}/{{ lists.length }}）</h4>
        <div class="flex items-center gap-2">
          <button type="button" class="text-[11px] font-bold text-brand-600 hover:underline dark:text-brand-300" @click="selectAllLists">全选</button>
          <button type="button" class="text-[11px] font-bold text-muted-foreground hover:underline" @click="selectedLists = []">清空</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5" data-export-lists>
        <button
          v-for="list in lists"
          :key="list.id"
          type="button"
          role="checkbox"
          :aria-checked="selectedLists.includes(list.id)"
          :data-export-list="String(list.id)"
          class="quick-chip !h-8"
          :class="{ active: selectedLists.includes(list.id) }"
          @click="toggleList(list.id)"
        >{{ list.name }}</button>
      </div>
    </section>

    <!-- 列多选：key 与后端 exportColumns 一一对应。 -->
    <section class="mt-5">
      <div class="mb-2 flex items-center justify-between">
        <h4 class="text-xs font-bold text-foreground">列（{{ selectedColumns.length }}/{{ EXPORT_COLUMNS.length }}）</h4>
        <div class="flex items-center gap-2">
          <button type="button" class="text-[11px] font-bold text-brand-600 hover:underline dark:text-brand-300" @click="selectAllColumns">全选</button>
          <button type="button" class="text-[11px] font-bold text-muted-foreground hover:underline" @click="selectedColumns = []">清空</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5" data-export-columns>
        <button
          v-for="col in EXPORT_COLUMNS"
          :key="col.key"
          type="button"
          role="checkbox"
          :aria-checked="selectedColumns.includes(col.key)"
          :data-export-column="col.key"
          class="quick-chip !h-8"
          :class="{ active: selectedColumns.includes(col.key) }"
          @click="toggleColumn(col.key)"
        >{{ col.label }}</button>
      </div>
    </section>

    <div class="mt-6 flex items-center gap-3">
      <button class="btn-secondary flex-1" data-export-cancel @click="emit('update:modelValue', false)">取消</button>
      <button
        class="btn-primary flex-1"
        data-export-confirm
        :disabled="!selectedLists.length || !selectedColumns.length"
        @click="confirm"
      >导出 CSV</button>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Modal from './Modal.vue'
import type { ReminderList } from '../api/reminder'

/** 列 key 必须与后端 exportColumns（server/reminder/export.go）一一对应。 */
const EXPORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'title', label: '标题' },
  { key: 'kind', label: '类型' },
  { key: 'list', label: '清单' },
  { key: 'status', label: '状态' },
  { key: 'due', label: '到期时间' },
  { key: 'completed', label: '完成时间' },
  { key: 'repeat', label: '重复' },
  { key: 'notes', label: '备注' },
]

const props = defineProps<{
  modelValue: boolean
  lists: ReminderList[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [payload: { lists: number[]; columns: string[] }]
}>()

const selectedLists = ref<number[]>([])
const selectedColumns = ref<string[]>([])

// 每次打开都回到「全选」：这是用户要求的默认值，也保证「直接点导出」得到的就是
// 与改动前完全一致的全量结果。
watch(() => props.modelValue, (open) => {
  if (!open) return
  selectAllLists()
  selectAllColumns()
})

function selectAllLists() { selectedLists.value = props.lists.map((l) => l.id) }
function selectAllColumns() { selectedColumns.value = EXPORT_COLUMNS.map((c) => c.key) }
function toggleList(id: number) {
  selectedLists.value = selectedLists.value.includes(id)
    ? selectedLists.value.filter((x) => x !== id)
    : [...selectedLists.value, id]
}
function toggleColumn(key: string) {
  selectedColumns.value = selectedColumns.value.includes(key)
    ? selectedColumns.value.filter((x) => x !== key)
    : [...selectedColumns.value, key]
}
function confirm() {
  if (!selectedLists.value.length || !selectedColumns.value.length) return
  emit('confirm', { lists: [...selectedLists.value], columns: [...selectedColumns.value] })
  emit('update:modelValue', false)
}
</script>
