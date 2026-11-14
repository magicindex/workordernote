<template>
  <div :class="columns === 2 ? 'grid items-start gap-4 sm:gap-5 md:grid-cols-2' : 'space-y-4 sm:space-y-6'">
    <!-- Empty state -->
    <div v-if="groups.length === 0" class="surface rounded-2xl p-10 text-center sm:p-16 md:col-span-2">
      <div class="flex flex-col items-center gap-3 text-muted-foreground">
        <svg class="w-12 h-12 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        <span class="text-sm">暂无配置项</span>
      </div>
    </div>

    <!-- Group panels -->
    <div
      v-for="group in groups"
      v-show="!visibleGroups || visibleGroups.includes(group.key)"
      :key="group.key"
      class="space-y-4"
    >
      <div class="surface rounded-2xl overflow-hidden">
      <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 class="text-sm font-bold text-foreground">{{ group.title }}</h2>
        <span class="text-[11px] font-semibold text-muted-foreground">{{ visibleCount(group) }} 项</span>
      </div>
      <slot v-if="customGroups?.includes(group.key)" name="group-body" :group="group"></slot>
      <div v-else class="divide-y divide-border">
        <div
          v-for="item in group.items"
          v-show="isItemVisible(item)"
          :key="item.key"
          class="flex flex-col gap-2.5 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-3"
          :data-config-key="item.key"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-semibold text-foreground">{{ item.label }}</span>
              <code class="sr-only">{{ item.key }}</code>
              <span
                v-if="isDirty(item)"
                class="badge bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
              >未保存</span>
            </div>
            <div class="text-xs text-muted-foreground mt-1">{{ item.description || '—' }}</div>
          </div>
          <div class="flex items-center gap-2 sm:w-64">
            <!-- bool: accessible toggle switch
                 用 inline-flex + p-0.5 定位滑块：原来靠 inline-block 的 translate，
                 button 默认 text-align:center 会先把滑块居中再位移，滑块整个被推到
                 轨道右边、又被 overflow-hidden 裁掉一截（用户报的「开关按钮错位」）。 -->
            <button
              v-if="item.type === 'bool'"
              type="button"
              role="switch"
              :aria-checked="getEditValue(item) === 'true'"
              :aria-label="item.label"
              :disabled="getSaving(item)"
              @click="toggleAndSaveBool(item)"
              :class="[
                'inline-flex h-6 w-11 shrink-0 items-center overflow-hidden rounded-full p-0.5 transition-colors focus:outline-none focus:ring-4 focus:ring-brand-500/20',
                getEditValue(item) === 'true' ? 'bg-brand-500' : 'bg-muted',
                getSaving(item) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
              ]"
            >
              <span
                :class="[
                  'h-5 w-5 shrink-0 rounded-full bg-white shadow transition-transform',
                  getEditValue(item) === 'true' ? 'translate-x-5' : 'translate-x-0',
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

            <!-- time: 一天里的某个时刻（HH:MM）。原生 time 输入会给出 HH:MM，
                 服务端再统一补零校验一次（见 sysconfig.NormalizeClock）。 -->
            <input
              v-else-if="item.type === 'time'"
              type="time"
              :value="getEditValue(item)"
              :disabled="getSaving(item)"
              @input="setEditValue(item, ($event.target as HTMLInputElement).value)"
              @keyup.enter="emitSave(item)"
              class="input-field !py-2 flex-1"
            />

            <!-- string: text input；密码类字段用密码框（WebDAV 密码等） -->
            <input
              v-else
              :type="isSecret(item.key) ? 'password' : 'text'"
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
          <slot name="item-after" :item="item"></slot>
        </div>
      </div>
      </div>
      <slot v-if="extraGroup === group.key" name="group-extra"></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { ACK_MINUTES_LABELS, NOTIFY_MINUTES_LABELS } from '../utils/reminder-options'
import type { ConfigMeta } from '../api/config'

interface RowState {
  editValue: string
  saving: boolean
}

const props = defineProps<{
  items: ConfigMeta[]
  /** 只显示这些分组；不传则全部显示（系统配置页沿用）。 */
  visibleGroups?: string[]
  /** 2 = 桌面双列卡片；默认单列（系统配置页字段多、控件宽）。 */
  columns?: number
  /** 在该分组的配置项下面追加一个自定义槽位（目前用于「默认清单」）。 */
  extraGroup?: string
  /** 这些分组不用通用行渲染，改由 #group-body 插槽接管（WebDAV 连接组件）。 */
  customGroups?: string[]
}>()

const emit = defineEmits<{
  (e: 'save', key: string, value: string): void
}>()

const groupTitleMap: Record<string, string> = {
  general: '站点设置',
  access: '访问控制',
  features: '功能开关',
  reminder: '提醒',
  // 免打扰时间段（用户 2026-10-16）：dnd_enabled / dnd_start_time / dnd_end_time
  dnd: '免打扰',
  appearance: '外观',
  system: '系统维护',
  backup: '备份计划',
  backup_local: '本机备份',
  backup_remote: 'WebDAV 远程备份',
  security: '账号安全',
}

const selectOptionLabelMap: Record<string, Record<string, string>> = {
  theme_mode: {
    system: '跟随系统',
    light: '浅色',
    dark: '深色',
    sun: '日出日落',
  },
  // 提醒频率 / 「知道了」后的提醒频率：文案在 utils/reminder-options.ts（弹窗按钮也读同一份，
  // 用户 2026-10-13 要求「显示保持与后台一致」）
  reminder_notify_minutes: NOTIFY_MINUTES_LABELS,
  task_overdue_after_minutes: {
    '0': '立即',
    '15': '15 分钟',
    '30': '30 分钟',
    '60': '1 小时',
    '120': '2 小时',
    '240': '4 小时',
  },
  reminder_ack_minutes: ACK_MINUTES_LABELS,
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
    home: '首页看板',
    list: '列表视图',
    calendar: '日历视图',
  },
  // 周起始日（用户 2026-10-10：原来直接显示 monday/sunday）
  calendar_week_start: {
    monday: '周一',
    sunday: '周日',
  },
  assistant_entry_style: {
    topbar: '顶栏图标',
    floating: '悬浮球',
  },
}

function isSecret(key: string): boolean {
  return /password|secret|token/i.test(key)
}

function groupTitle(key: string): string {
  return groupTitleMap[key] || key
}

// 备份的从属项：总开关关着时只留开关，避免一上来就摆一长串 WebDAV 字段。
const backupDependent: Record<string, string> = {
  backup_local_dir: 'backup_local_enabled',
  backup_webdav_url: 'backup_webdav_enabled',
  backup_webdav_username: 'backup_webdav_enabled',
  backup_webdav_password: 'backup_webdav_enabled',
  backup_webdav_dir: 'backup_webdav_enabled',
  backup_webdav_insecure: 'backup_webdav_enabled',
}

function isItemVisible(item: ConfigMeta): boolean {
  const parentKey = backupDependent[item.key]
  if (!parentKey) return true
  const parent = props.items.find((it) => it.key === parentKey)
  if (!parent) return true
  return getEditValue(parent) === 'true'
}

function visibleCount(group: { items: ConfigMeta[] }): number {
  return group.items.filter(isItemVisible).length
}

// 配置接口按 key 字母序返回；备份组里按“先开关、再连接信息、最后高级项”重排，
// 避免出现「子目录 → 开关 → 跳过证书 → 密码 → 地址」这种跳跃顺序。
const backupOrder: Record<string, number> = {
  backup_enabled: 0, backup_time: 1, backup_keep: 2,
  backup_local_enabled: 0, backup_local_dir: 1,
  backup_webdav_enabled: 0, backup_webdav_url: 1, backup_webdav_username: 2,
  backup_webdav_password: 3, backup_webdav_dir: 4, backup_webdav_insecure: 5,
}
function orderOf(key: string): number {
  return backupOrder[key] ?? 999
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
    items: [...items].sort((a, b) => orderOf(a.key) - orderOf(b.key)),
  }))
})
</script>
