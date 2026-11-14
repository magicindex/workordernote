<template>
  <Transition :name="isModal ? 'sheet' : 'drawer'">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-[70] flex"
      :class="isModal ? 'items-center justify-center p-3 sm:p-6' : side === 'left' ? 'justify-start' : 'justify-end'"
    >
      <div class="absolute inset-0 bg-slate-950/25 backdrop-blur-sm" @click="close"></div>
      <aside
        ref="panelRef"
        class="editor-panel"
        :class="[isModal ? 'editor-panel-modal' : '', side === 'left' ? 'editor-panel-left' : '']"
        :style="editorPanelStyle"
      >
        <div class="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 sm:py-5">
          <div>
            <p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground">{{ isCreate ? '新建' : editing.kind === 'note' ? '记事详情' : '提醒详情' }}</p>
            <h2 class="mt-0.5 text-base font-extrabold sm:mt-1 sm:text-lg">
              {{ (isCreate ? '新建' : '编辑') + (editing.kind === 'note' ? '记事' : '提醒') }}
            </h2>
          </div>
          <div class="flex items-center gap-1.5">
            <!-- 删除（用户 2026-10-13：编辑弹窗「在同行右侧增加删除按钮」）：
                 只有**创建这条提醒的用户**能删 —— can_delete 由服务端按 user_id 判定，
                 不是创建者就置灰并说明原因（服务端那条路本来也只认创建者，删别人的 404）。 -->
            <button
              v-if="!isCreate && editing.id"
              type="button"
              class="row-action !opacity-100 hover:!text-rose-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-inherit"
              :disabled="!canDelete"
              :title="canDelete ? '删除这条提醒' : '只有创建这条提醒的用户可以删除'"
              :aria-label="canDelete ? '删除提醒' : '只有创建者可以删除'"
              data-editor-delete
              @click="confirmOpen = true"
            >
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="row-action !opacity-100" aria-label="关闭" @click="close">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>

        <p v-if="errorMsg" class="mx-4 mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive sm:mx-6">{{ errorMsg }}</p>

        <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="save">
          <div
            class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"
            :class="isModal ? 'space-y-3 sm:space-y-4 sm:p-5' : 'space-y-4 sm:space-y-6 sm:p-6'"
          >
            <label class="editor-field"><span>标题</span><input v-model="editing.title" autofocus maxlength="200" :placeholder="editing.kind === 'note' ? '记点什么…' : '要提醒什么？'" /></label>
            <div class="editor-field">
              <span>类型</span>
              <div class="mt-1.5 flex gap-2">
                <button type="button" class="channel-pill flex-1" :class="{ selected: editing.kind !== 'note' }" @click="setKind('task')">任务（需确认完成）</button>
                <button type="button" class="channel-pill flex-1" :class="{ selected: editing.kind === 'note' }" @click="setKind('note')">记事（仅作记录）</button>
              </div>
            </div>
            <label class="editor-field" :class="editing.kind === 'note' ? 'editor-notes-grow' : ''"><span>备注</span><textarea v-model="editing.notes" rows="4" maxlength="5000" placeholder="补充一些细节…"></textarea></label>
            <!-- 备注是一段可编辑的合并文本（用户 2026-11-13）：新建备注与历次完成备注
                 按时间戳排在一起、一起改。保存时再拆回 reminders.notes 与各次完成备注。 -->

            <div
              v-if="editing.kind !== 'note'"
              class="grid gap-3"
              :class="isModal ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'"
            >
              <div class="editor-field relative">
                <span>日期时间</span>
                <div class="mt-1.5 flex items-stretch gap-1.5 sm:mt-2">
                  <button ref="dateAnchor" type="button" class="flex min-w-0 flex-1 items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-medium sm:rounded-2xl sm:px-4 sm:py-3" :class="dateOpen ? 'border-brand-500/45 ring-4 ring-brand-500/10' : 'border-border'" @click="dateOpen = !dateOpen">
                    <span class="truncate" :class="{ 'text-muted-foreground/55': !editing.due_at }">{{ editing.due_at ? formatFullDue(editing.due_at) : '选择日期' }}</span>
                    <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.8"/><path d="M8 3v4m8-4v4M3 10h18" stroke-width="1.8" stroke-linecap="round"/></svg>
                  </button>
                  <!-- 时间段入口做成同行的小按钮，**不占额外高度**：编辑弹窗（日历里那种居中卡片）
                       原来刚好占满一屏，多一行字段就会溢出到要内滚（verify-070 会红）。 -->
                  <button
                    v-if="!editing.end_at"
                    type="button"
                    class="shrink-0 whitespace-nowrap rounded-xl border border-dashed border-border px-2 text-[11px] font-semibold text-muted-foreground transition hover:border-brand-500/45 hover:text-brand-600"
                    title="加一个结束时间，这条就变成「开始—结束」的时间段"
                    data-add-end
                    @click="enableEnd"
                  >
                    +结束
                  </button>
                </div>
                <LunarDatePicker v-if="dateOpen" v-model="datePicked" with-time :anchor-el="dateAnchor" @commit="dateOpen = false" />
                <div v-if="editing.end_at" class="mt-1.5">
                  <button ref="endAnchor" type="button" class="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-medium sm:rounded-2xl sm:px-4 sm:py-3" :class="endOpen ? 'border-brand-500/45 ring-4 ring-brand-500/10' : 'border-border'" @click="endOpen = !endOpen">
                    <span class="truncate">至 {{ formatFullDue(editing.end_at) }}</span>
                    <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="16" rx="2" stroke-width="1.8"/><path d="M8 3v4m8-4v4M3 10h18" stroke-width="1.8" stroke-linecap="round"/></svg>
                  </button>
                  <LunarDatePicker v-if="endOpen" v-model="endPicked" with-time :anchor-el="endAnchor" @commit="endOpen = false" />
                  <button type="button" class="mt-1 text-[11px] font-semibold text-muted-foreground hover:text-rose-500" @click="editing.end_at = null">清除结束时间</button>
                </div>
              </div>
              <label class="editor-field"><span>清单</span><select v-model.number="editing.list_id"><option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option></select></label>
              <div v-if="!isNoteEditing" class="editor-field" :class="isModal ? 'col-span-2 sm:col-span-3' : 'col-span-2'">
                <span>颜色</span>
                <div class="flex flex-wrap items-center gap-1.5">
                  <button type="button" data-editor-color="" class="h-6 rounded-md border px-2 text-[11px] font-semibold" :class="!editing.color ? 'border-brand-500/45 bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'border-border text-muted-foreground'" @click="editing.color = ''">自动配色</button>
                  <button v-for="c in LIST_COLOR_NAMES" :key="c" type="button" :data-editor-color="c" class="h-6 w-6 rounded-full border-2 transition" :class="editing.color === c ? 'border-foreground' : 'border-transparent'" :style="{ background: listColorHex(c) }" :aria-label="listColorLabel(c)" :title="listColorLabel(c)" @click="editing.color = c" />
                </div>
              </div>
              <label class="editor-field"><span>优先级</span><select v-model.number="editing.priority"><option :value="0">无</option><option :value="1">低</option><option :value="2">中</option><option :value="3">高</option></select></label>
              <label class="editor-field"><span>重复</span><select v-model="editing.repeat_rule"><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label>
              <label class="editor-field"><span>按农历循环</span><select v-model="editing.calendar" @change="upgradeCalendarToYearly"><option value="solar">公历</option><option value="lunar">农历</option></select></label>
              <label class="editor-field"><span>过期提醒频率</span><RepeatNotifySelect :model-value="editing.repeat_notify_minutes ?? 0" @update:model-value="editing.repeat_notify_minutes = $event" /></label>
              <p class="mt-1 text-[10px] leading-4 text-muted-foreground" :class="isModal ? 'col-span-2 sm:col-span-3' : 'col-span-2'">“过期提醒频率”在到点未完成时按所选间隔重复通知，点击完成后停止；配合“每天”等重复规则可实现固定时间的每日催办。</p>
              <p v-if="editing.calendar === 'lunar'" class="text-[10px] leading-4 text-muted-foreground" :class="isModal ? 'col-span-2 -mt-2 sm:col-span-3' : 'col-span-2 -mt-3'">“按农历循环”按所选日期对应的农历月/日重复，适合农历生日等纪念日期；腊月三十遇小年自动改为除夕当天，闰月日期遇无闰月年份自动用对应平月。</p>
            </div>
            <p v-else class="rounded-2xl bg-muted/65 p-3 text-xs leading-5 text-muted-foreground">记事只作记录：不需要日期、重复和通知，保存后直接归入「已完成」。</p>

            <!-- 弹窗（日历里的新建/编辑）不摆渠道选择：六个渠道格子就占掉两百多像素，
                 卡片再也装不下整张表单。渠道沿用默认设置（编辑时沿用这条提醒原有的），
                 要逐条指定就去列表视图的抽屉里改。 -->
            <p v-if="isModal && editing.kind !== 'note'" class="rounded-xl bg-muted/60 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
              通知方式沿用{{ isCreate ? '默认设置' : '原有设置' }}，需要逐条调整时请在列表视图里打开这条提醒。
            </p>

            <div v-if="editing.kind !== 'note' && !isModal">
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

          <div
            class="editor-footer flex items-center gap-3 border-t border-border bg-surface/80 p-3.5 backdrop-blur sm:p-5"
            :class="isModal ? 'editor-footer-modal' : ''"
          >
            <button type="button" class="btn-secondary flex-1" @click="close">取消</button>
            <button class="btn-primary flex-1" :disabled="saving || loading || !editing.title.trim()">
              {{ saving ? '保存中…' : editing.kind === 'note' ? '保存记事' : '保存提醒' }}
            </button>
          </div>
        </form>

        <!-- 详情面板：右下角手柄可拖宽高；松手后按用户 + 类型记住尺寸，下次打开还是这个大小。 -->
        <span
          v-if="desktop"
          class="editor-resize-handle"
          role="separator"
          aria-label="拖拽调整编辑面板大小"
          title="拖拽调整大小（自动记住）"
          data-note-resize-handle
          @pointerdown="startResize"
          @click.stop
        >
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M14 3 3 14M14 8 8 14M14 13l-1 1" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </span>
      </aside>

      <ConfirmDialog
        :model-value="confirmOpen"
        danger
        title="删除提醒"
        :message="`确定删除「${editing.title || '这条提醒'}」吗？删除后这条不再提醒，也无法恢复。`"
        confirm-text="删除"
        :busy="deleting"
        @update:model-value="(v: boolean) => { if (!v) confirmOpen = false }"
        @confirm="doDelete"
      />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import NoteTimeline from './NoteTimeline.vue'
import { RouterLink } from 'vue-router'
import LunarDatePicker from './LunarDatePicker.vue'
import RepeatNotifySelect from './RepeatNotifySelect.vue'
import { LIST_COLOR_NAMES, listColorHex, listColorLabel } from '../utils/list-colors'
import { buildMergedNoteText, buildNoteTimeline, parseMergedNoteText } from '../utils/note-timeline'
import { SK } from '../utils/storage-keys'
import { useAuthStore } from '../stores/auth'
import {
  createReminder, deleteReminder, getReminder, updateReminder,
  updateCompletionNote,
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
  /**
   * 呈现方式：抽屉（默认，从右侧划出）或居中悬浮弹窗。
   * 日历视图用弹窗——日历本身已经铺满一屏，再从右边划出一整条会把人从「这天」里拽走；
   * 列表视图仍是抽屉，来回切换时位置一致、滚动列表也没被遮住。
   */
  presentation?: 'drawer' | 'modal'
  /**
   * 抽屉贴在屏幕哪一侧。记事本页从**左边**划出：那一页的条目本来就是「时间—标题—正文」
   * 一路往下读，右侧抽屉会盖住刚点的那一条；从左边出来，列表留在原位不动。
   */
  side?: 'right' | 'left'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 保存成功。父组件据此刷新自己的列表/日历 */
  saved: []
  /** 删除成功（用户在编辑弹窗里点了删除并确认）。父组件据此刷新并提示 */
  deleted: []
}>()

const isCreate = computed(() => props.preset != null)
const isNoteEditing = computed(() => (editing.kind as string) === 'note')
const isModal = computed(() => props.presentation === 'modal')
const authStore = useAuthStore()
const panelRef = ref<HTMLElement | null>(null)
// 桌面端才允许拖拽（手机是整屏抽屉，拖了反而难用）；<768px 隐藏手柄，也不套记住的尺寸。
const desktop = ref(typeof window !== 'undefined' && window.innerWidth >= 768)
const editorSize = reactive<{ width: number | null; height: number | null }>({ width: null, height: null })
const editorPanelStyle = computed(() => {
  if (!desktop.value) return undefined
  const style: Record<string, string> = {}
  if (editorSize.width) {
    style.width = `${editorSize.width}px`
    style.maxWidth = '95vw'
  }
  if (editorSize.height) {
    style.height = `${editorSize.height}px`
    style.maxHeight = isModal.value ? '92vh' : '100vh'
  }
  return style
})
function editorSizeKey() {
  const base = editing.kind === 'note' ? SK.noteEditorSize : SK.reminderEditorSize
  return `${base}.${authStore.user?.id || 'anon'}`
}
function loadEditorSize() {
  editorSize.width = null
  editorSize.height = null
  if (!desktop.value) return
  try {
    const raw = localStorage.getItem(editorSizeKey())
    if (!raw) return
    const parsed = JSON.parse(raw) as { w?: unknown; h?: unknown }
    const w = Number(parsed?.w)
    const h = Number(parsed?.h)
    if (Number.isFinite(w) && w >= 360 && w <= 1200) editorSize.width = Math.round(w)
    if (Number.isFinite(h) && h >= 280 && h <= 1400) editorSize.height = Math.round(h)
  } catch { /* 尺寸读不到就用默认 */ }
}
function persistEditorSize() {
  if (!editorSize.width || !editorSize.height) return
  try {
    localStorage.setItem(editorSizeKey(), JSON.stringify({ w: Math.round(editorSize.width), h: Math.round(editorSize.height) }))
  } catch { /* 隐私模式/localStorage 不可用时只是不记忆 */ }
}
let resizing = false
let resizeStartX = 0
let resizeStartY = 0
let resizeStartW = 0
let resizeStartH = 0
function onViewportResize() {
  desktop.value = window.innerWidth >= 768
  if (!desktop.value) {
    editorSize.width = null
    editorSize.height = null
  }
}
function startResize(event: PointerEvent) {
  if (!desktop.value || !panelRef.value) return
  event.preventDefault()
  event.stopPropagation()
  const rect = panelRef.value.getBoundingClientRect()
  resizing = true
  resizeStartX = event.clientX
  resizeStartY = event.clientY
  resizeStartW = rect.width
  resizeStartH = rect.height
  editorSize.width = Math.round(rect.width)
  editorSize.height = Math.round(rect.height)
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize, { once: true })
}
function onResizeMove(event: PointerEvent) {
  if (!resizing) return
  const maxW = Math.min(1200, Math.round(window.innerWidth * 0.95))
  const maxH = Math.round(window.innerHeight * (isModal.value ? 0.92 : 1))
  editorSize.width = Math.max(360, Math.min(maxW, Math.round(resizeStartW + event.clientX - resizeStartX)))
  editorSize.height = Math.max(280, Math.min(maxH, Math.round(resizeStartH + event.clientY - resizeStartY)))
}
function stopResize() {
  if (!resizing) return
  resizing = false
  window.removeEventListener('pointermove', onResizeMove)
  document.body.style.userSelect = ''
  persistEditorSize()
}
onMounted(() => {
  loadEditorSize()
  window.addEventListener('resize', onViewportResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportResize)
  window.removeEventListener('pointermove', onResizeMove)
  if (resizing) {
    resizing = false
    document.body.style.userSelect = ''
  }
})
watch(() => props.modelValue, (open) => {
  if (open) loadEditorSize()
  else if (resizing) stopResize()
})

const blankInput = (): SaveReminderInput & { id?: number } => ({
  title: '', notes: '', color: '', kind: 'task', list_id: 0, priority: 0, due_at: null,
  start_at: null, end_at: null,
  all_day: false, repeat_rule: 'none', calendar: 'solar', repeat_notify_minutes: 0, channels: ['inapp'],
})

const editing = reactive<SaveReminderInput & { id?: number }>(blankInput())
watch(() => editing.kind, () => {
  loadEditorSize()
})
// 打开时拉回来的完整条目：备注文本框里是「新建备注 + 历次完成备注」拼起来的合并文本，
// 保存时要拆回去（并逐条写回完成备注），所以原样留一份做对照。
const detail = ref<ReminderItem | null>(null)
const saving = ref(false)
const loading = ref(false)
// 删除确认框与进行中状态（用户 2026-10-13 要求编辑弹窗里能直接删）
const confirmOpen = ref(false)
const deleting = ref(false)
/** 能不能删：服务端按 user_id 判定（只有创建这条的用户可以）。 */
const canDelete = ref(true)
const errorMsg = ref('')
const dateOpen = ref(false)
const dateAnchor = ref<HTMLElement | null>(null)
// 时间段：结束时间（可选）。留空就是单点时间；两个都填＝「开始—结束」。
const endOpen = ref(false)
const endAnchor = ref<HTMLElement | null>(null)
const endPicked = computed({
  get: () => (editing.end_at ? new Date(editing.end_at) : null),
  set: value => { editing.end_at = value ? toLocalIso(value) : null },
})

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

// 点「+结束」：默认结束 = 开始 + 1 小时（没开始时间就先给一个今天 20:00），
// 并直接把选择器展开，少一次点击。
function enableEnd() {
  const base = editing.due_at ? new Date(editing.due_at) : new Date()
  const end = new Date(base.getTime() + 60 * 60 * 1000)
  editing.end_at = toLocalIso(end)
  endOpen.value = true
}

function applyItem(item: ReminderItem) {
  detail.value = item
  canDelete.value = item.can_delete !== false
  Object.assign(editing, {
    id: item.id, title: item.title, notes: buildMergedNoteText(item), color: item.color || '', kind: item.kind || 'task', list_id: item.list_id,
    priority: item.priority, due_at: item.due_at, all_day: item.all_day,
    start_at: item.start_at || null, end_at: item.end_at || null,
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
  if (!open) { dateOpen.value = false; endOpen.value = false; return }
  errorMsg.value = ''
  dateOpen.value = false
  endOpen.value = false
  if (props.preset) {
    detail.value = null
    Object.assign(editing, blankInput(), props.preset)
    return
  }
  detail.value = null
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
    editing.start_at = null
    editing.end_at = null
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

/**
 * 删除这条提醒（编辑弹窗头部那个按钮）。
 *
 * 权限：**只有创建这条提醒的用户能删**。界面按服务端给的 can_delete 显示/置灰按钮；
 * 服务端删除接口自己也按 user_id 过滤 —— 删别人的条目一律 404，绕不过去。
 */
async function doDelete() {
  if (!editing.id || deleting.value) return
  deleting.value = true
  errorMsg.value = ''
  try {
    await deleteReminder(editing.id)
    confirmOpen.value = false
    emit('update:modelValue', false)
    emit('deleted')
  } catch (error: any) {
    confirmOpen.value = false
    const status = error?.response?.status
    errorMsg.value = status === 404
      ? '这条提醒不存在，或者不属于当前账号（只有创建者可以删除）'
      : (error?.response?.data?.message || '删除失败，请重试')
  } finally {
    deleting.value = false
  }
}

/**
 * 编辑面板里改过的「完成备注」写回各自那条完成记录：
 *   · 一次性任务 → reminders.completed_note（completion_id 省略）；
 *   · 循环任务的某一次 → completions.note（带 completion_id）。
 * 按合并文本里的出现顺序与原有条目一一对应 —— 顺序来自 buildNoteTimeline（按时间升序），
 * 这里用同样的规则排一遍，保证「第 N 段对应第 N 条」。
 */
async function persistCompletionNoteEdits(parsed: { timeLabel: string; note: string }[]) {
  const item = detail.value
  if (!item || !editing.id) return
  const originals: { id?: number; at: string; note: string }[] = []
  if ((item.completed_note || '').trim()) {
    originals.push({ id: undefined, at: item.completed_at || '', note: (item.completed_note || '').trim() })
  }
  for (const row of item.completion_notes || []) {
    if (!(row.note || '').trim()) continue
    originals.push({ id: row.id, at: row.completed_at || '', note: row.note.trim() })
  }
  originals.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  const count = Math.min(originals.length, parsed.length)
  for (let i = 0; i < count; i += 1) {
    const before = originals[i]
    const after = parsed[i]
    if (before.note === after.note.trim()) continue
    try {
      await updateCompletionNote(editing.id, { note: after.note, completion_id: before.id })
    } catch (err: any) {
      // 单条失败不挡整次保存：主字段已经存好了，提示一下让用户知道哪条没写回
      errorMsg.value = err.response?.data?.message || '完成备注没能保存'
    }
  }
}

async function save() {
  if (!editing.title?.trim() || saving.value) return
  // 打开编辑面板后还没把条目读回来就保存（回车提交不会看按钮的 disabled 状态），
  // 会把空表单盖到原条目上 —— 2026-11-13 真丢过一条新建备注。没加载完一律不保存。
  if (!isCreate.value && (loading.value || !detail.value)) return
  if (!isCreate.value && !editing.id) return
  // 时间段：结束时间填了就必须有开始时间（这里用界面上的日期时间作为开始），
  // 且结束必须晚于开始 —— 后端也会校验，这里先拦一次给出更直接的中文提示。
  if (editing.kind !== 'note' && editing.end_at) {
    if (!editing.due_at) {
      errorMsg.value = '请先选择开始时间'
      return
    }
    if (new Date(editing.end_at).getTime() <= new Date(editing.due_at).getTime()) {
      errorMsg.value = '结束时间要晚于开始时间'
      return
    }
    editing.start_at = editing.due_at
  } else if (editing.kind !== 'note') {
    editing.start_at = null
    editing.end_at = null
  }
  saving.value = true
  errorMsg.value = ''
  try {
    const { id, ...payload } = editing
    // 备注框里是合并文本：新建备注写回 notes，各段完成备注按原顺序写回那条完成记录。
    // 新建模式没有完成备注，整段就是新建备注。
    const parsed = isCreate.value
      ? { notes: editing.notes || '', completions: [] as { timeLabel: string; note: string }[] }
      : parseMergedNoteText(editing.notes || '')
    payload.notes = parsed.notes
    if (isCreate.value) {
      await createReminder(payload)
    } else {
      await updateReminder(id as number, payload)
      await persistCompletionNoteEdits(parsed.completions)
    }
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
/* 居中弹窗：宽度与抽屉同量级（510px 起，宽屏放到 640px），高度最多 88vh，
   内部滚动区自己滚（表单区已经是 min-h-0 flex-1 overflow-y-auto）。 */
.editor-panel-modal {
  @apply h-auto max-h-[88vh] w-full max-w-[680px] rounded-2xl border border-border shadow-2xl;
}
/* 面板变宽时，底部两个操作按钮不再跟着无限变宽：封顶后居中，只有面板本身在变。
   默认宽度下按钮尺寸与原来基本一致（510 抽屉约 224、680 弹窗约 288）。 */
.editor-footer { @apply justify-center; }
.editor-footer .btn-secondary, .editor-footer .btn-primary { flex: 1 1 0; max-width: 14rem; }
.editor-footer-modal .btn-secondary, .editor-footer-modal .btn-primary { max-width: 18rem; }
@media (max-width: 767px) {
  .editor-footer .btn-secondary, .editor-footer .btn-primary,
  .editor-footer-modal .btn-secondary, .editor-footer-modal .btn-primary { max-width: none; }
}

/* 编辑面板右下角手柄：只负责拖拽，视觉上像三道斜线的小握把。 */
.editor-resize-handle {
  @apply absolute z-30 flex h-5 w-5 cursor-nwse-resize touch-none items-center justify-center rounded-md text-muted-foreground/60 transition hover:bg-brand-500/10 hover:text-brand-600 dark:hover:text-brand-300;
  right: 2px;
  bottom: 2px;
}
@media (max-width: 767px) {
  .editor-resize-handle { display: none; }
}
.sheet-enter-active, .sheet-leave-active { transition: opacity .18s ease; }
.sheet-enter-active .editor-panel, .sheet-leave-active .editor-panel { transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .18s ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .editor-panel, .sheet-leave-to .editor-panel { transform: translateY(10px) scale(.97); opacity: 0; }

.drawer-enter-active, .drawer-leave-active { transition: opacity .22s ease; }
.drawer-enter-active .editor-panel, .drawer-leave-active .editor-panel { transition: transform .28s cubic-bezier(.2,.8,.2,1); }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .editor-panel, .drawer-leave-to .editor-panel { transform: translateX(100%); }
/* 左侧抽屉：从左边划入，边框换到右侧，几何仍是贴边全高。 */
.editor-panel-left { border-left: 0; @apply border-r border-r-border; }
.drawer-enter-from .editor-panel-left, .drawer-leave-to .editor-panel-left { transform: translateX(-100%); }
/* 记事本页的备注吃掉表单的下方剩余空间，编辑窗口多高它就多高；内容长了在框内滚动。 */
.editor-notes-grow { @apply flex min-h-[9rem] flex-1 flex-col; }
.editor-notes-grow textarea { @apply min-h-[7rem] flex-1 resize-none; }
</style>
