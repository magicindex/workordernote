<template>
  <Transition name="drawer">
    <div v-if="modelValue" class="fixed inset-0 z-[70] flex justify-end">
      <div class="absolute inset-0 bg-slate-950/25 backdrop-blur-sm" @click="close"></div>
      <aside class="editor-panel">
        <div class="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-5">
          <div>
            <p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground">{{ isCreate ? '新建' : '提醒详情' }}</p>
            <h2 class="mt-0.5 text-base font-extrabold sm:mt-1 sm:text-lg">
              {{ (isCreate ? '新建' : '编辑') + (editing.kind === 'note' ? '记事' : '提醒') }}
            </h2>
          </div>
          <button class="row-action !opacity-100" aria-label="关闭" @click="close">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>

        <p v-if="errorMsg" class="mx-4 mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive sm:mx-6">{{ errorMsg }}</p>

        <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="save">
          <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:space-y-6 sm:p-6">
            <label class="editor-field"><span>标题</span><input v-model="editing.title" autofocus maxlength="200" :placeholder="editing.kind === 'note' ? '记点什么…' : '要提醒什么？'" /></label>
            <div class="editor-field">
              <span>类型</span>
              <div class="mt-1.5 flex gap-2">
                <button type="button" class="channel-pill flex-1" :class="{ selected: editing.kind !== 'note' }" @click="setKind('task')">任务（需确认完成）</button>
                <button type="button" class="channel-pill flex-1" :class="{ selected: editing.kind === 'note' }" @click="setKind('note')">记事（仅作记录）</button>
              </div>
            </div>
            <label class="editor-field"><span>备注</span><textarea v-model="editing.notes" rows="4" maxlength="5000" placeholder="补充一些细节…"></textarea></label>

            <div v-if="editing.kind !== 'note'" class="grid grid-cols-2 gap-3">
              <div class="editor-field relative">
                <span>日期时间</span>
                <button ref="dateAnchor" type="button" class="mt-1.5 flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-medium sm:mt-2 sm:rounded-2xl sm:px-4 sm:py-3" :class="dateOpen ? 'border-brand-500/45 ring-4 ring-brand-500/10' : 'border-border'" @click="dateOpen = !dateOpen">
                  <span :class="{ 'text-muted-foreground/55': !editing.due_at }">{{ editing.due_at ? formatFullDue(editing.due_at) : '选择日期' }}</span>
                  <svg viewBox="0 0 24 24" class="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.8"/><path d="M8 3v4m8-4v4M3 10h18" stroke-width="1.8" stroke-linecap="round"/></svg>
                </button>
                <LunarDatePicker v-if="dateOpen" v-model="datePicked" with-time :anchor-el="dateAnchor" @commit="dateOpen = false" />
              </div>
              <label class="editor-field"><span>清单</span><select v-model.number="editing.list_id"><option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option></select></label>
              <label class="editor-field"><span>优先级</span><select v-model.number="editing.priority"><option :value="0">无</option><option :value="1">低</option><option :value="2">中</option><option :value="3">高</option></select></label>
              <label class="editor-field"><span>重复</span><select v-model="editing.repeat_rule"><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label>
              <label class="editor-field"><span>按农历循环</span><select v-model="editing.calendar" @change="upgradeCalendarToYearly"><option value="solar">公历</option><option value="lunar">农历</option></select></label>
              <label class="editor-field"><span>过期提醒频率</span><RepeatNotifySelect :model-value="editing.repeat_notify_minutes ?? 0" @update:model-value="editing.repeat_notify_minutes = $event" /></label>
              <p class="col-span-2 mt-1 text-[10px] leading-4 text-muted-foreground">“过期提醒频率”在到点未完成时按所选间隔重复通知，点击完成后停止；配合“每天”等重复规则可实现固定时间的每日催办。</p>
              <p v-if="editing.calendar === 'lunar'" class="col-span-2 -mt-3 text-[10px] leading-4 text-muted-foreground">“按农历循环”按所选日期对应的农历月/日重复，适合农历生日等纪念日期；腊月三十遇小年自动改为除夕当天，闰月日期遇无闰月年份自动用对应平月。</p>
            </div>
            <p v-else class="rounded-2xl bg-muted/65 p-3 text-xs leading-5 text-muted-foreground">记事只作记录：不需要日期、重复和通知，保存后直接归入「已完成」。</p>

            <div v-if="editing.kind !== 'note'">
              <p class="mb-3 text-xs font-bold text-muted-foreground">通知方式</p>
              <div class="grid grid-cols-2 gap-2">
                <button v-for="channel in channels" :key="channel.channel" type="button" class="channel-option" :class="{ selected: isChannelSelected(channel.channel) }" :disabled="channel.channel !== 'inapp' && (!channel.bound || channel.status !== 'active')" @click="toggleChannel(channel.channel)">
                  <span class="channel-check"><svg v-if="isChannelSelected(channel.channel)" viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor"><path d="m6 12 4 4 8-9" stroke-width="2.5" stroke-linecap="round"/></svg></span>
                  <span class="text-left"><strong>{{ channel.label }}</strong><small>{{ channel.bound || channel.channel === 'inapp' ? '可用' : '未绑定' }}</small></span>
                </button>
              </div>
              <RouterLink to="/admin/channels" class="mt-3 inline-flex text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">管理通知方式 →</RouterLink>
              <div v-if="isChannelSelected('email') && emailBindings.length > 1" class="mt-4 rounded-2xl bg-muted/65 p-3">
                <p class="mb-2 text-xs font-bold text-muted-foreground">这个提醒发送到</p>
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="channel-pill" :class="{ selected: emailTargets.length === 0 }" @click="editing.channel_targets = undefined">全部接收邮箱</button>
                  <button v-for="binding in emailBindings" :key="binding.id" type="button" class="channel-pill" :class="{ selected: emailTargets.includes(binding.id) }" @click="toggleEmailTarget(binding.id)">
                    {{ binding.target_masked }}
                  </button>
                </div>
                <p class="mt-2 text-[10px] leading-4 text-muted-foreground">选择“全部接收邮箱”时不指定具体邮箱；所选邮箱被删除后会自动改发全部已启用的邮箱。</p>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-3 border-t border-border bg-surface/80 p-3.5 backdrop-blur sm:p-5">
            <button type="button" class="btn-secondary flex-1" @click="close">取消</button>
            <button class="btn-primary flex-1" :disabled="saving || loading || !editing.title.trim()">
              {{ saving ? '保存中…' : editing.kind === 'note' ? '保存记事' : '保存提醒' }}
            </button>
          </div>
        </form>
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import LunarDatePicker from './LunarDatePicker.vue'
import RepeatNotifySelect from './RepeatNotifySelect.vue'
import {
  createReminder, getReminder, updateReminder,
  type ChannelStatus, type ReminderChannel, type ReminderItem, type ReminderKind,
  type ReminderList, type SaveReminderInput,
} from '../api/reminder'

const props = defineProps<{
  modelValue: boolean
  /** 要编辑的提醒 id；打开时按它拉一次最新数据（顺带拿到最新 version，减少保存冲突） */
  reminderId: number | null
  /**
   * 新建模式：给一份预填内容（日历里双击某天就用它带上那天的时间）。
   * 有 preset 时忽略 reminderId，保存走创建接口。
   */
  preset?: SaveReminderInput | null
  lists: ReminderList[]
  channels: ChannelStatus[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 保存成功。父组件据此刷新自己的列表/日历 */
  saved: []
}>()

const isCreate = computed(() => props.preset != null)

const blankInput = (): SaveReminderInput & { id?: number } => ({
  title: '', notes: '', kind: 'task', list_id: 0, priority: 0, due_at: null,
  all_day: false, repeat_rule: 'none', calendar: 'solar', repeat_notify_minutes: 0, channels: ['inapp'],
})

const editing = reactive<SaveReminderInput & { id?: number }>(blankInput())
const saving = ref(false)
const loading = ref(false)
const errorMsg = ref('')
const dateOpen = ref(false)
const dateAnchor = ref<HTMLElement | null>(null)

const datePicked = computed({
  get: () => (editing.due_at ? new Date(editing.due_at) : null),
  set: value => { editing.due_at = value ? toLocalIso(value) : null },
})

const emailBindings = computed(() => props.channels.find(c => c.channel === 'email')?.bindings || [])
const emailTargets = computed(() => editing.channel_targets?.email || [])

// toLocalIso 序列化为带本地时区偏移的 RFC3339 串（后端 time.Time 只认 RFC3339），
// 既保住所选墙钟时间又不会因缺时区后缀被拒。
function toLocalIso(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMinutes = -d.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
}
function formatFullDue(value: string | null | undefined) {
  if (!value) return ''
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function applyItem(item: ReminderItem) {
  Object.assign(editing, {
    id: item.id, title: item.title, notes: item.notes, kind: item.kind || 'task', list_id: item.list_id,
    priority: item.priority, due_at: item.due_at, all_day: item.all_day,
    repeat_rule: item.repeat_rule, calendar: item.calendar || 'solar',
    repeat_notify_minutes: item.repeat_notify_minutes || 0,
    channels: [...(item.channels || [])], version: item.version,
    lunar_anchor: item.lunar_anchor || '',
    channel_targets: item.channel_targets ? { ...item.channel_targets } : undefined,
  })
}

// 打开时按 id 拉最新数据：日历/列表里的那份可能是缓存，version 过期会保存失败。
// 新建模式直接用 preset 填表，不请求、也不带 id。
watch(() => [props.modelValue, props.reminderId, props.preset] as const, async ([open, id]) => {
  if (!open) { dateOpen.value = false; return }
  errorMsg.value = ''
  dateOpen.value = false
  if (props.preset) {
    Object.assign(editing, blankInput(), props.preset)
    return
  }
  if (!id) { errorMsg.value = '没有指定要编辑的提醒'; return }
  Object.assign(editing, blankInput(), { id: Number(id) })
  loading.value = true
  try {
    const res = await getReminder(Number(id))
    if (res.data?.data) applyItem(res.data.data)
    else errorMsg.value = '这条提醒已不存在'
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '读取提醒失败'
  } finally {
    loading.value = false
  }
}, { immediate: true })

// 农历循环只对每月/每年重复生效（后端会拒绝其余组合）。用户直接选农历时
// 自动把重复规则升到每年（农历生日等纪念日的默认用法）。
function upgradeCalendarToYearly() {
  if (editing.calendar === 'lunar' && editing.repeat_rule !== 'monthly' && editing.repeat_rule !== 'yearly') {
    editing.repeat_rule = 'yearly'
  }
}
watch(() => editing.repeat_rule, rule => {
  if (rule !== 'monthly' && rule !== 'yearly') editing.calendar = 'solar'
})

function setKind(kind: ReminderKind) {
  editing.kind = kind
  if (kind === 'note') {
    editing.due_at = null
    editing.priority = 0
    editing.repeat_rule = 'none'
    editing.calendar = 'solar'
    editing.repeat_notify_minutes = 0
  }
}
function toggleChannel(channel: ReminderChannel) {
  const list = editing.channels || []
  editing.channels = list.includes(channel) ? list.filter(x => x !== channel) : [...list, channel]
  if (!editing.channels.length) editing.channels = ['inapp']
  if (!editing.channels.includes('email')) editing.channel_targets = undefined
}
function isChannelSelected(channel: ReminderChannel) { return (editing.channels || []).includes(channel) }
function toggleEmailTarget(id: number) {
  const picked = new Set(editing.channel_targets?.email || [])
  if (picked.has(id)) picked.delete(id)
  else picked.add(id)
  editing.channel_targets = picked.size ? { email: [...picked] } : undefined
}

function close() { emit('update:modelValue', false) }

async function save() {
  if (!editing.title?.trim() || saving.value) return
  if (!isCreate.value && !editing.id) return
  saving.value = true
  errorMsg.value = ''
  try {
    const { id, ...payload } = editing
    if (isCreate.value) await createReminder(payload)
    else await updateReminder(id as number, payload)
    emit('update:modelValue', false)
    emit('saved')
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '保存失败'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* btn-primary / btn-secondary / channel-pill / row-action 是全局原子类，见 style.css */
.editor-panel { @apply relative z-10 flex h-full w-full max-w-[510px] flex-col border-l border-border bg-background/95 shadow-2xl backdrop-blur-2xl; }
.editor-field { @apply block text-xs font-bold text-muted-foreground; }
.editor-field input, .editor-field textarea, .editor-field select { @apply mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-brand-500/45 focus:ring-4 focus:ring-brand-500/10 sm:mt-2 sm:rounded-2xl sm:px-4 sm:py-3; }
/* 「过期提醒频率」是子组件（RepeatNotifySelect），scoped 样式穿不进它内部，
   上面那条选择器管不到它的控件，所以用 :deep() 把它对齐成同一套字段样式 ——
   否则这一格比旁边「重复 / 按农历循环」矮一截、字号也小一号。 */
.editor-field :deep(.repeat-notify) { @apply mt-1.5 sm:mt-2; }
.editor-field :deep(.repeat-notify select), .editor-field :deep(.repeat-notify input) { @apply w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground outline-none transition focus:border-brand-500/45 focus:ring-4 focus:ring-brand-500/10 sm:rounded-2xl sm:px-4 sm:py-3; }
.editor-field textarea { @apply resize-none leading-6; }
.channel-option { @apply flex items-center gap-3 rounded-2xl border border-border bg-surface p-2.5 text-muted-foreground transition disabled:opacity-35 sm:p-3; }
.channel-option.selected { @apply border-brand-500/30 bg-brand-500/10 text-brand-600 dark:text-brand-300; }
.channel-option strong { @apply block text-xs; }
.channel-option small { @apply mt-0.5 block text-[10px] opacity-70; }
.channel-check { @apply flex h-5 w-5 items-center justify-center rounded-full border border-current; }
.drawer-enter-active, .drawer-leave-active { transition: opacity .22s ease; }
.drawer-enter-active .editor-panel, .drawer-leave-active .editor-panel { transition: transform .28s cubic-bezier(.2,.8,.2,1); }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .editor-panel, .drawer-leave-to .editor-panel { transform: translateX(100%); }
</style>
