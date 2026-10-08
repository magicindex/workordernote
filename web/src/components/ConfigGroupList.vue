<template>
  <div class="space-y-4 sm:space-y-6">
    <!-- Empty state -->
    <div v-if="groups.length === 0" class="surface rounded-2xl p-10 text-center sm:p-16">
      <div class="flex flex-col items-center gap-3 text-muted-foreground">
        <svg class="w-12 h-12 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        <span class="text-sm">暂无配置项</span>
      </div>
    </div>

    <!-- Group panels -->
    <div
      v-for="group in groups"
      :key="group.key"
      class="surface rounded-2xl overflow-hidden"
    >
      <div class="border-b border-border px-4 py-3 sm:p-5 sm:px-6">
        <h2 class="text-sm font-bold text-foreground sm:text-base">{{ group.title }}</h2>
      </div>
      <div class="divide-y divide-border">
        <div
          v-for="item in group.items"
          :key="item.key"
          class="flex flex-col gap-2.5 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-3 sm:p-5 sm:px-6"
          :data-config-key="item.key"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-semibold text-foreground">{{ item.label }}</span>
              <code class="text-xs text-muted-foreground">{{ item.key }}</code>
              <span
                v-if="isDirty(item)"
                class="badge bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
              >未保存</span>
            </div>
            <div class="text-xs text-muted-foreground mt-1">{{ item.description || '—' }}</div>
          </div>
          <div class="flex items-center gap-2 sm:w-80">
            <!-- bool: accessible toggle switch -->
            <button
              v-if="item.type === 'bool'"
              type="button"
              role="switch"
              :aria-checked="getEditValue(item) === 'true'"
              :aria-label="item.label"
              :disabled="getSaving(item)"
              @click="toggleAndSaveBool(item)"
              :class="[
                'w-11 h-6 shrink-0 overflow-hidden rounded-full transition-colors focus:outline-none focus:ring-4 focus:ring-brand-500/20',
                getEditValue(item) === 'true' ? 'bg-brand-500' : 'bg-muted',
                getSaving(item) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
              ]"
            >
              <span
                :class="[
                  'inline-block w-5 h-5 rounded-full bg-white shadow transform transition-transform mt-0.5',
                  getEditValue(item) === 'true' ? 'translate-x-5' : 'translate-x-0.5',
                ]"
              ></span>
            </button>

            <!-- select: native styled select -->
            <select
              v-else-if="item.type === 'select'"
              :value="getEditValue(item)"
              :disabled="getSaving(item)"
              @change="onSelectChange(item, ($event.target as HTMLSelectElement).value)"
              @keyup.enter="emitSave(item)"
              class="input-field !py-2 flex-1"
            >
              <option v-for="opt in item.options || []" :key="opt" :value="opt">
                {{ optionLabel(item.key, opt) }}
              </option>
            </select>

            <!-- int: number input -->
            <input
              v-else-if="item.type === 'int'"
              type="number"
              :value="getEditValue(item)"
              :disabled="getSaving(item)"
              @input="setEditValue(item, ($event.target as HTMLInputElement).value)"
              @keyup.enter="emitSave(item)"
              class="input-field !py-2 flex-1"
            />

            <!-- string: text input -->
            <input
              v-else
              type="text"
              :value="getEditValue(item)"
              :disabled="getSaving(item)"
              @input="setEditValue(item, ($event.target as HTMLInputElement).value)"
              @keyup.enter="emitSave(item)"
              class="input-field !py-2 flex-1"
            />

            <button
              v-if="item.type !== 'bool'"
              @click="emitSave(item)"
              :disabled="!isDirty(item) || getSaving(item)"
              class="btn-brand !px-4 !py-2 whitespace-nowrap"
            >
              {{ getSaving(item) ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { ConfigMeta } from '../api/config'

interface RowState {
  editValue: string
  saving: boolean
}

const props = defineProps<{
  items: ConfigMeta[]
}>()

const emit = defineEmits<{
  (e: 'save', key: string, value: string): void
}>()

const groupTitleMap: Record<string, string> = {
  general: '站点设置',
  access: '访问控制',
  features: '功能开关',
  reminder: '提醒',
  appearance: '外观',
  system: '系统维护',
  android: '安卓客户端',
}

const selectOptionLabelMap: Record<string, Record<string, string>> = {
  theme_mode: {
    system: '跟随系统',
    light: '浅色',
    dark: '深色',
    sun: '日出日落',
  },
  // 提醒频率（分钟）→ 中文；0 单独说成「第二天」，避免用户以为是「立刻」
  reminder_notify_minutes: { '5': '每 5 分钟', '10': '每 10 分钟', '15': '每 15 分钟', '30': '每 30 分钟', '60': '每小时' },
  reminder_ack_minutes: { '0': '第二天（当天不再提示）', '30': '30 分钟后', '60': '1 小时后', '120': '2 小时后', '240': '4 小时后' },
  // 城市 id 与 web/src/utils/sun.ts 的 SUN_CITIES 一一对应，改一处要改两处。
  sun_location: {
    beijing: '北京', shanghai: '上海', tianjin: '天津', chongqing: '重庆',
    guangzhou: '广州', shenzhen: '深圳', hangzhou: '杭州', nanjing: '南京',
    suzhou: '苏州', wuxi: '无锡', changzhou: '常州', nantong: '南通',
    yangzhou: '扬州', xuzhou: '徐州', ningbo: '宁波', wenzhou: '温州',
    hefei: '合肥', fuzhou: '福州', xiamen: '厦门', nanchang: '南昌',
    jinan: '济南', qingdao: '青岛', yantai: '烟台', zhengzhou: '郑州',
    luoyang: '洛阳', wuhan: '武汉', changsha: '长沙', dongguan: '东莞',
    foshan: '佛山', zhuhai: '珠海', shantou: '汕头', nanning: '南宁',
    haikou: '海口', chengdu: '成都', kunming: '昆明', guiyang: '贵阳',
    xian: '西安', lanzhou: '兰州', xining: '西宁', yinchuan: '银川',
    urumqi: '乌鲁木齐', lhasa: '拉萨', hohhot: '呼和浩特', taiyuan: '太原',
    shijiazhuang: '石家庄', shenyang: '沈阳', dalian: '大连', changchun: '长春',
    harbin: '哈尔滨', kunshan: '昆山',
  },
  calendar_font_size: {
    small: '小',
    medium: '标准',
    large: '大',
    xlarge: '特大',
  },
  default_view: {
    list: '列表视图',
    calendar: '日历视图',
  },
}

function groupTitle(key: string): string {
  return groupTitleMap[key] || key
}

function optionLabel(itemKey: string, opt: string): string {
  return selectOptionLabelMap[itemKey]?.[opt] || opt
}

const rowState = reactive<Record<string, RowState>>({})

// Sync per-row state with the prop:
//  - for new keys, seed editValue from the current value
//  - when an item's value prop changes externally and the row is not in-flight,
//    pull the new value into editValue (parent confirming save or external reload)
watch(
  () => props.items,
  (newItems) => {
    for (const item of newItems) {
      const existing = rowState[item.key]
      if (!existing) {
        rowState[item.key] = { editValue: item.value, saving: false }
      } else if (!existing.saving && existing.editValue !== item.value) {
        existing.editValue = item.value
      }
    }
  },
  { immediate: true, deep: true },
)

function ensureState(item: ConfigMeta) {
  if (!rowState[item.key]) {
    rowState[item.key] = { editValue: item.value, saving: false }
  }
}

function getEditValue(item: ConfigMeta): string {
  return rowState[item.key]?.editValue ?? item.value
}

function getSaving(item: ConfigMeta): boolean {
  return rowState[item.key]?.saving ?? false
}

function setEditValue(item: ConfigMeta, value: string) {
  ensureState(item)
  rowState[item.key].editValue = value
}

function isDirty(item: ConfigMeta): boolean {
  return getEditValue(item) !== item.value
}

function toggleAndSaveBool(item: ConfigMeta) {
  ensureState(item)
  const current = getEditValue(item)
  const next = current === 'true' ? 'false' : 'true'
  rowState[item.key].editValue = next
  if (next !== item.value && !getSaving(item)) {
    rowState[item.key].saving = true
    emit('save', item.key, next)
  }
}

function onSelectChange(item: ConfigMeta, value: string) {
  setEditValue(item, value)
}

function emitSave(item: ConfigMeta) {
  ensureState(item)
  if (!isDirty(item) || getSaving(item)) return
  rowState[item.key].saving = true
  emit('save', item.key, getEditValue(item))
}

// Public methods so the parent can flip saving back off after the request
// resolves — without these, the save button stays disabled until the parent's
// items prop change cascades through the watcher.
defineExpose({
  markSaved(key: string) {
    if (rowState[key]) rowState[key].saving = false
  },
  markFailed(key: string) {
    if (rowState[key]) rowState[key].saving = false
  },
})

const groups = computed(() => {
  const map = new Map<string, ConfigMeta[]>()
  for (const item of props.items) {
    const g = item.group || 'general'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(item)
  }
  return Array.from(map.entries()).map(([key, items]) => ({
    key,
    title: groupTitle(key),
    items,
  }))
})
</script>
