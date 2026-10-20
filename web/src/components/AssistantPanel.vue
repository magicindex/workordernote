<template>
  <Teleport to="body">
    <Transition name="assistant">
      <div v-if="modelValue" class="fixed inset-0 z-[60] flex justify-end" data-assistant-panel>
        <div class="absolute inset-0 bg-black/45" data-assistant-backdrop @click="close"></div>

        <aside class="relative flex h-full w-full flex-col bg-surface text-foreground shadow-2xl sm:w-[420px]">
          <!-- 头部：小秘身份 + 模型接入状态 + 清空 / 关闭 -->
          <header class="flex items-center gap-3 border-b border-border px-4 py-3">
            <span class="assistant-avatar">{{ assistant.avatarText }}</span>
            <div class="min-w-0 flex-1">
              <!-- 接上模型叫「AI 小秘」是绿的，没配置是红的（用户 2026-10-17）；
                   状态还在查时保持正文色，不先闪一下红。 -->
              <p
                class="flex items-center gap-1.5 font-display text-base font-extrabold tracking-tight"
                :class="connState === 'live' ? 'text-emerald-600 dark:text-emerald-400' : connState === 'off' ? 'text-red-500 dark:text-red-400' : ''"
                data-assistant-title
              >
                AI {{ assistant.displayName }}
                <span
                  class="assistant-conn"
                  :data-assistant-conn-state="connState"
                  data-assistant-conn
                  aria-hidden="true"
                ></span>
              </p>
              <p class="truncate text-[11px] text-muted-foreground" data-assistant-status :title="statusText">
                {{ statusText }}
              </p>
            </div>
            <button
              type="button"
              class="assistant-icon-btn"
              title="清空对话"
              aria-label="清空对话"
              data-assistant-clear
              @click="clearAll"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor">
                <path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button
              type="button"
              class="assistant-icon-btn"
              title="关闭（Esc）"
              aria-label="关闭"
              data-assistant-close
              @click="close"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor">
                <path d="m6 6 12 12M18 6 6 18" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </header>

          <!-- 后台没接模型时，在对话窗口最上边用醒目颜色说明（用户 2026-10-17：
               「如果没有模型被加载给出提示，可以在聊天窗口最上边用醒目颜色文字说明」）。
               放在头部下面、对话区上面：不进滚动区，翻历史也一直看得见。 -->
          <p v-if="!live && !statusLoading" class="assistant-offline" data-assistant-offline>
            <svg viewBox="0 0 24 24" class="mt-[2px] h-4 w-4 shrink-0" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M12 4.5 3.2 19.5h17.6L12 4.5Z" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="M12 10v4.2M12 17.2v.2" stroke-width="1.9" stroke-linecap="round"/>
            </svg>
            <span>
              <strong>没有可用模型</strong>：现在这些回答是按你自己的记录现场拼的草稿，不调用任何模型。
              <span class="assistant-offline-hint" data-assistant-offline-reason>{{ offlineReason }}</span>
            </span>
          </p>

          <!-- 对话区 -->
          <div ref="listEl" class="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-assistant-scroll>
            <div v-if="!messages.length" class="assistant-empty">
              <p class="font-display text-sm font-extrabold">你好，我是{{ assistant.displayName }}</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                写周报、把一句话变成待办、理清今天该先做什么——说一句就行。
              </p>
            </div>

            <!-- 常用问法：开箱卡片与自己存的查询放在同一处（用户 2026-10-17：
                 「本周周报…与对话框中卡片项合并，保存内容放在此处，不再放在下面」）。
                 存完立刻在这排出现，不再放到底部「数据口径」栏。 -->
            <div class="flex flex-wrap items-center gap-1.5" :class="messages.length ? '' : 'mt-3'" data-assistant-quick>
              <template v-for="chip in visibleChips" :key="chip.label">
                <button
                  v-if="!quickEditing"
                  type="button"
                  class="assistant-chip"
                  :data-assistant-chip="chip.label"
                  @click="send(chip.label, chip.option)"
                >
                  {{ chip.label }}
                </button>
                <span v-else class="assistant-saved-tag">
                  {{ chip.label }}
                  <button
                    type="button"
                    class="assistant-saved-remove"
                    :data-assistant-chip-remove="chip.label"
                    title="从常用提示词里删掉，可在「管理」里恢复"
                    @click="hideChip(chip.label)"
                  >✕</button>
                </span>
              </template>
              <button
                type="button"
                class="assistant-link"
                data-assistant-manage
                @click="quickEditing = !quickEditing"
              >{{ quickEditing ? '完成' : '管理' }}</button>
            </div>
            <div
              v-if="savedQueries.length"
              class="mt-2 flex flex-wrap items-center gap-1.5"
              data-assistant-my-queries
            >
              <span class="text-[10px] font-bold text-muted-foreground" data-assistant-saved-label>我的</span>
              <template v-for="item in savedQueries" :key="item.name">
                <button
                  v-if="!quickEditing"
                  type="button"
                  class="assistant-chip"
                  :data-assistant-saved="item.name"
                  :title="describeQuery(item)"
                  @click="runSaved(item)"
                >
                  {{ item.name }}
                </button>
                <span v-else class="assistant-saved-tag">
                  {{ item.name }}
                  <button
                    type="button"
                    class="assistant-saved-remove"
                    :data-assistant-saved-remove="item.name"
                    title="删掉这条常用查询"
                    @click="removeSaved(item.name)"
                  >✕</button>
                </span>
              </template>
            </div>

            <template v-for="(msg, i) in messages" :key="i">
              <div
                class="flex"
                :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
                :data-assistant-role="msg.role"
              >
                <div
                  class="assistant-bubble"
                  :class="[msg.role === 'user' ? 'assistant-bubble-user' : 'assistant-bubble-bot', msg.failed ? 'assistant-bubble-fail' : '']"
                >{{ msg.content }}</div>
              </div>
              <!-- 「这一轮附上了哪些数据」：写周报最怕答得漂亮却查的是空区间，
                   把区间与条数摆在下面，用户一眼能核对。 -->
              <p
                v-if="msg.digest"
                class="assistant-meta"
                data-assistant-digest
                :data-assistant-digest-option="msg.digest.option"
              >
                已附上数据：{{ msg.digest.label }} · 完成 {{ msg.digest.completed }} · 未完成
                {{ msg.digest.open }}{{ msg.digest.overdue ? `（逾期 ${msg.digest.overdue}）` : '' }} · 记事
                {{ msg.digest.notes }}{{ msg.digest.courses ? ` · 课程 ${msg.digest.courses} 节` : '' }}{{ msg.digest.keyword ? ` · 关键词「${msg.digest.keyword}」` : '' }}{{
                  msg.digest.list_name ? ` · 只看清单「${msg.digest.list_name}」` : ''
                }}
              </p>
              <p v-if="msg.draft" class="assistant-meta" data-assistant-draft-note>
                这是按你的记录直接生成的草稿（模型接入后同样的问题会由模型润色改写）。
              </p>
              <!-- 简洁思考：一小行，像脚注；详细思考过程：折叠起来，不抢回答的位置 -->
              <p
                v-if="msg.thinking && msg.thinkingMode === 'brief'"
                class="assistant-meta assistant-thinking-brief"
                data-assistant-thinking-brief
              >思考：{{ msg.thinking }}{{ msg.thinkingTruncated ? '…' : '' }}</p>
              <!-- 详细模式默认展开：折叠着只露出一行「思考过程」，用户会以为没显示
                   （2026-10-17 反馈）。展开后仍可点标题收起。 -->
              <details
                v-else-if="msg.thinking && msg.thinkingMode === 'full'"
                class="assistant-thinking-full"
                data-assistant-thinking-full
                open
              >
                <summary class="assistant-thinking-summary">思考过程（点标题收起）</summary>
                <p class="assistant-thinking-body">{{ msg.thinking }}</p>
              </details>
              <p
                v-else-if="msg.thinkingMode === 'full'"
                class="assistant-meta"
                data-assistant-thinking-empty
              >这个模型没有返回思考过程（qwen2.5 这类非思考模型不产生思维链）；换成 qwen3 / r1 这类思考模型就能看到。</p>
              <!-- 一键存进记事本：标题与标签由服务端按内容自动生成，用户不用手打。
                   失败的回复不给存（那是错误提示，不是小秘的回答）。 -->
              <div
                v-if="msg.role === 'assistant' && !msg.failed && !msg.placeholder"
                class="assistant-note-actions"
                data-assistant-note-actions
              >
                <button
                  v-if="!msg.savedNote"
                  type="button"
                  class="assistant-note-save"
                  data-assistant-save-note
                  :disabled="msg.saving"
                  :title="msg.saving ? '正在保存…' : '把这条回答存成一条记事（标题和标签自动生成）'"
                  @click="saveNote(i)"
                >{{ msg.saving ? '正在存…' : '保存到记事本' }}</button>
                <template v-else>
                  <span class="assistant-note-done" data-assistant-note-saved>已存进记事本</span>
                  <button
                    type="button"
                    class="assistant-note-link"
                    data-assistant-open-note
                    title="打开记事本看这一条"
                    @click="openSavedNote(msg.savedNote)"
                  >去看 ›</button>
                </template>
                <span
                  v-if="msg.saveError"
                  class="assistant-note-error"
                  data-assistant-note-error
                >{{ msg.saveError }}</span>
              </div>
            </template>

            <div v-if="pending" class="flex justify-start">
              <div class="assistant-bubble assistant-bubble-bot assistant-typing" data-assistant-typing>
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>

          <!-- 管理面板：范围/关键词/存为常用，只在点「管理」时展开 -->
          <section v-if="quickEditing" class="border-t border-border px-3 pt-3" data-assistant-scope>
            <p class="text-[11px] leading-4 text-muted-foreground">
              先选时间范围、填关键词，再问我；存成常用后就在上面那排。点提示词上的 ✕ 可删掉不用的。
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <select v-model="scope.option" class="assistant-select" data-assistant-range aria-label="时间范围">
                <option value="">自动识别（按我说的时间词）</option>
                <option v-for="opt in rangeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
              <template v-if="scope.option === 'custom'">
                <input v-model="scope.from" type="date" class="assistant-select" data-assistant-from aria-label="开始日期" />
                <input v-model="scope.to" type="date" class="assistant-select" data-assistant-to aria-label="结束日期" />
              </template>
              <input
                v-model="scope.keyword"
                type="text"
                class="assistant-select min-w-[7rem] flex-1"
                placeholder="关键词（可选）"
                data-assistant-keyword
              />
              <button
                type="button"
                class="assistant-link"
                data-assistant-save
                :disabled="!canSaveQuery"
                @click="beginSave"
              >存为常用</button>
            </div>

            <div v-if="savingName !== null" class="mt-2 flex items-center gap-1.5">
              <input
                v-model="savingName"
                type="text"
                class="assistant-select min-w-[7rem] flex-1"
                placeholder="给这条查询起个名字，例如「本月 5G」"
                data-assistant-save-name
                @keydown.enter.exact.prevent="confirmSave"
              />
              <button type="button" class="assistant-link" data-assistant-save-confirm @click="confirmSave">保存</button>
              <button type="button" class="assistant-link" data-assistant-save-cancel @click="savingName = null">取消</button>
            </div>
            <div class="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <p v-if="scopeError" class="text-[11px] text-destructive" data-assistant-scope-error>{{ scopeError }}</p>
              <button
                v-if="hiddenChips.length"
                type="button"
                class="assistant-link"
                data-assistant-restore-chips
                @click="restoreChips"
              >恢复默认提示词</button>
            </div>
          </section>

          <!-- 输入区 -->
          <footer class="relative border-t border-border px-3 py-3">
            <!-- 打 @ 弹出来的清单选择器：选一个就把「@清单名」补进输入框，
                 服务端认这句话里的 @名称，数据就只看那一栏。 -->
            <div
              v-if="mention.open && mentionOptions.length"
              class="assistant-mention"
              data-assistant-mention
            >
              <p class="assistant-mention-title">把数据范围收到某一栏（@ 清单名）</p>
              <button
                v-for="(item, index) in mentionOptions"
                :key="item.id"
                type="button"
                class="assistant-mention-item"
                :class="index === mention.index ? 'assistant-mention-item-on' : ''"
                :data-assistant-mention-item="item.name"
                @mousedown.prevent="insertMention(item.name)"
              >
                <span class="assistant-mention-dot" :style="{ background: listColorHex(item.color) }"></span>
                <span class="flex-1 truncate text-left">{{ item.name }}</span>
                <span class="text-[10px] text-muted-foreground">{{ item.open_count }} 项未完成</span>
              </button>
              <p class="assistant-mention-hint">↑↓ 选，Enter 补进输入框，Esc 关掉</p>
            </div>
            <textarea
              ref="inputEl"
              v-model="draft"
              rows="2"
              class="assistant-input"
              :placeholder="`跟${assistant.displayName}说点什么…（打 @ 选清单，Enter 发送，Shift + Enter 换行）`"
              data-assistant-input
              @input="syncMention"
              @click="syncMention"
              @keydown.enter.exact.prevent="onEnterKey"
              @keydown.down.exact.prevent="moveMention(1)"
              @keydown.up.exact.prevent="moveMention(-1)"
              @keydown.esc="mention.open && closeMention()"
              @blur="closeMention()"
            ></textarea>
            <!-- 思考过程口径：后台偏好定默认值，这里可以临时换（换完记住，下次打开还是它） -->
            <div v-if="live" class="mt-2 flex flex-wrap items-center gap-1.5" data-assistant-thinking>
              <span class="text-[11px] font-bold text-muted-foreground">思考过程</span>
              <button
                v-for="mode in thinkingChoices"
                :key="mode.value"
                type="button"
                class="assistant-chip"
                :class="thinkingMode === mode.value ? 'assistant-chip-on' : ''"
                :data-assistant-thinking-option="mode.value"
                :data-assistant-thinking-active="thinkingMode === mode.value ? '1' : undefined"
                :title="mode.note"
                @click="pickThinkingMode(mode.value)"
              >{{ mode.label }}</button>
            </div>
            <div class="mt-2 flex items-center justify-between gap-2">
              <span class="text-[11px] text-muted-foreground">{{ live ? (thinkingMode === 'off' ? '回答由后台配置的模型生成（不显示思考过程）' : '回答由后台配置的模型生成') : '没接模型：会按你的记录生成草稿' }}</span>
              <button
                type="button"
                class="assistant-send"
                :disabled="!canSend"
                data-assistant-send
                @click="send()"
              >
                发送
              </button>
            </div>
          </footer>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  chatWithAssistant,
  getAssistantStatus,
  normalizeThinkingMode,
  saveAssistantNote,
  THINKING_MODES,
  type AssistantDigestInput,
  type AssistantDigestView,
  type AssistantMessage,
  type AssistantStatus,
  type AssistantThinkingMode,
} from '../api/assistant'
import { getAllConfigs, updateConfig } from '../api/config'
import { getLists, type ReminderList } from '../api/reminder'
import { listColorHex } from '../utils/list-colors'
import { useRouter } from 'vue-router'
import { useAssistantStore } from '../stores/assistant'

/**
 * 气泡在 AssistantMessage 上多两个本地标记：
 * - `failed`：模型调用失败时把原因直接贴进对话，比静默回落到占位文案有用——
 *   「API Key 无效」「模型名不存在」都是用户能自己去改的（系统配置 → AI 助手）；
 * - `digest` / `draft`：这一轮附了什么数据、是不是未接模型的草稿。
 */
interface Bubble extends AssistantMessage {
  failed?: boolean
  digest?: AssistantDigestView | null
  draft?: boolean
  /** 这一轮的思维链与当时的档位：档位跟着消息存，之后换档不会改写旧回复的展示。 */
  thinking?: string
  thinkingTruncated?: boolean
  thinkingMode?: AssistantThinkingMode
  /** 这一轮用户问的那句话与数据口径：存记事本时用来认「周报 / 账单」这类主题。 */
  question?: string
  hint?: string
  /** 本地占位回复（后台没接模型时的兜底文案）：不是小秘的回答，不给存记事本。 */
  placeholder?: boolean
  /** 「保存到记事本」的三态：存过之后按钮换成「已存进记事本 + 去看」。 */
  saving?: boolean
  savedNote?: { id: number; listId: number; title: string }
  saveError?: string
}

/** 一条常用查询（存用户配置 assistant_saved_queries）。 */
interface SavedQuery extends AssistantDigestInput {
  name: string
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
/** 「去看」要跳到记事本那一栏，需要路由器。 */
const router = useRouter()
/** 小秘的名字（每个人可自定义，见偏好设置 → AI 提示词）。 */
const assistant = useAssistantStore()
assistant.loadName()

/**
 * 预置问法。带 `option` 的会**先选好时间范围再发**——写周报这类问题必须附数据，
 * 让模型去猜「这周」是哪一周，答出来的是漂亮但查不到东西的空话。
 */
const quickChips: { label: string; option?: string }[] = [
  { label: '写这周的周报', option: 'week' },
  { label: '写这个月的月报', option: 'month' },
  { label: '写今年的年报', option: 'year' },
  { label: '手上还有哪些没做完', option: 'open' },
  { label: '这周的工作清单', option: 'week' },
]

/** 「时间范围」下拉：与「已完成」页的筛选同名，另加「当前未完成」与自定义。 */
const rangeOptions = [
  { value: 'week', label: '本周' },
  { value: 'lastweek', label: '上周' },
  { value: 'month', label: '本月' },
  { value: 'lastmonth', label: '上月' },
  { value: 'year', label: '今年' },
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: 'open', label: '当前未完成' },
  { value: 'custom', label: '自定义…' },
]

/** 思考过程：三个档位，默认跟后台偏好走，用户换了记在用户配置里。 */
const thinkingChoices = THINKING_MODES
const thinkingMode = ref<AssistantThinkingMode>('brief')

const scope = ref({ option: '', from: '', to: '', keyword: '' })
const scopeError = ref('')
const savedQueries = ref<SavedQuery[]>([])
const hiddenChips = ref<string[]>([])
const quickEditing = ref(false)
const visibleChips = computed(() => quickChips.filter((chip) => !hiddenChips.value.includes(chip.label)))
const savingName = ref<string | null>(null)

/** 对话只存在内存里：关掉面板再打开还在，刷新页面就清空（要落库再说）。 */
const messages = ref<Bubble[]>([])
const draft = ref('')

// 「@清单名」：打 @ 列出用户的清单，选一个补进输入框（用户 2026-10-17：
// 「使用@清单名称 来指定数据源，输入@自动显示列表通过选择补充到对话框中」）。
// 补进去的是**纯文本**，服务端在那句话里认 @名称，所以手打也一样管用。
const lists = ref<{ id: number; name: string; color: string; open_count: number }[]>([])
const mention = ref({ open: false, start: 0, end: 0, query: '', index: 0 })
const mentionOptions = computed(() => {
  const query = mention.value.query.trim()
  return lists.value.filter((item) => (query ? item.name.includes(query) : true)).slice(0, 6)
})

async function loadLists() {
  try {
    const { data } = await getLists()
    lists.value = (data?.data || []).map((item: ReminderList) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      open_count: item.open_count || 0,
    }))
  } catch {
    lists.value = [] // 拿不到清单只是少了 @ 选择器，不影响正常问话
  }
}

// 光标前最后一个 @ 到光标之间没有空白，才算「正在打一个 @清单名」。
function syncMention() {
  const el = inputEl.value
  if (!el) return
  const caret = el.selectionStart ?? draft.value.length
  const before = draft.value.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0 || /\s/.test(before.slice(at + 1))) {
    mention.value.open = false
    return
  }
  mention.value = {
    open: true,
    start: at,
    end: caret,
    query: before.slice(at + 1),
    index: 0,
  }
}

function closeMention() {
  mention.value = { ...mention.value, open: false }
}

function insertMention(name: string) {
  const el = inputEl.value
  if (!el) return
  const { start, end } = mention.value
  const rest = draft.value.slice(end)
  draft.value = `${draft.value.slice(0, start)}@${name} ${rest}`
  closeMention()
  void nextTick(() => {
    const caret = start + name.length + 2 // @ + 名字 + 一个空格
    el.focus()
    el.setSelectionRange(caret, caret)
  })
}

function moveMention(step: number) {
  if (!mention.value.open || !mentionOptions.value.length) return
  const total = mentionOptions.value.length
  mention.value.index = (mention.value.index + step + total) % total
}

// Enter：@ 列表开着就先补全，没开才发送。
function onEnterKey() {
  if (mention.value.open && mentionOptions.value.length) {
    insertMention(mentionOptions.value[mention.value.index]?.name || '')
    return
  }
  void send()
}
const pending = ref(false)
const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)

const canSend = computed(() => !!draft.value.trim() && !pending.value)
const canSaveQuery = computed(() => !!scope.value.option || !!scope.value.keyword.trim())

/**
 * 后端接入状态：由 /api/assistant/status 决定，**不再由前端常量决定**。
 * 一次页面内只查一次、每次打开面板再查一次（管理员在后台改完开关，用户不用
 * 刷新页面就能看到「模型已接入」）。
 */
const status = ref<AssistantStatus | null>(null)
const statusLoading = ref(false)
const live = computed(() => !!status.value?.active)
/** 面板标题旁的小圆点：已接入=绿，未配置=红，检查中=灰。 */
const connState = computed(() => (statusLoading.value ? 'checking' : live.value ? 'live' : 'off'))
/**
 * 等模型回答的上限：跟着后端配置走（系统配置 → AI 助手 → 请求超时），
 * 再留 20 秒余量。本地模型（Ollama）第一次说话要等它把模型读进内存，
 * 用全局那 30 秒的默认超时会掐成一个看不懂的「网络错误」。
 */
const chatTimeoutMs = computed(() => ((status.value?.timeout_seconds || 60) + 20) * 1000)
const statusText = computed(() => {
  if (statusLoading.value) return '正在检查模型接入状态…'
  const current = status.value
  if (!current) return '模型未接入 · 后台状态未知（仍可按记录出草稿）'
  if (current.active) {
    return ['模型已接入', current.provider_label || current.provider, current.model].filter(Boolean).join(' · ')
  }
  return `模型未接入 · ${current.reason || '后台未启用 AI 助手'}（仍可按记录出草稿）`
})
/**
 * 顶部横幅的第二句：把「为什么没有模型」和「怎么接上」说清楚。
 * 用后端给的 reason（比如「未启用 AI 助手」「模型名还没填」），管理员一看就知道缺什么。
 */
const offlineReason = computed(() => {
  const why = status.value?.reason || '后台还没启用 AI 助手'
  return `${why}。管理员到「设置 → 系统配置 → AI 助手」填好服务商、接口地址与模型名并启用，这里会自动换成模型回答。`
})

async function refreshStatus() {
  statusLoading.value = true
  try {
    status.value = await getAssistantStatus()
  } catch {
    // 拿不到状态（未登录 / 网络不通）就按「未接入」处理：面板照旧能用。
    status.value = null
  } finally {
    statusLoading.value = false
  }
}

/** 用户自己选过的档位优先，没选过就用后台偏好（status.thinking_mode）。 */
async function loadThinkingMode() {
  let mine = ''
  try {
    const res = await getAllConfigs()
    mine = String(res.data?.data?.assistant_thinking_mode ?? '').trim()
  } catch {
    // 读不到就按后台偏好走。
  }
  thinkingMode.value = mine
    ? normalizeThinkingMode(mine)
    : normalizeThinkingMode(status.value?.thinking_mode)
}

async function pickThinkingMode(mode: AssistantThinkingMode) {
  thinkingMode.value = mode
  try {
    await updateConfig('assistant_thinking_mode', mode)
  } catch (err: any) {
    scopeError.value = `思考过程口径没能记住：${err?.message || '保存失败'}`
  }
}

function close() {
  emit('update:modelValue', false)
}

function clearAll() {
  messages.value = []
  draft.value = ''
}

async function scrollToBottom() {
  await nextTick()
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' })
}

/**
 * 兜底回复：**不调用模型**，只是按关键词给一段像样的文案。只在「后台没接模型
 * 且这一轮也没要数据」时用；要了数据的话，服务端会直接按记录出草稿。
 */
function placeholderReply(raw: string): string {
  const text = raw.trim()
  if (/周报|日报|月报|年报|总结|汇报|清单/.test(text)) {
    return [
      '要看数据的话，先在下面选个时间范围（本周 / 本月 / 今年 / 自定义）或「存为常用」的查询，再问我一次。',
      '选了范围我就能把这段时间的完成、未完成、记事摆出来——不管模型接没接上。',
    ].join('\n')
  }
  if (/新建|创建|加个|加一|提醒|待办|任务|安排/.test(text)) {
    return [
      '听懂了，你想让我建一条提醒：',
      '· 标题：（从这句话里提取，例如「开会」）',
      '· 时间：（例如「明天 9 点」）',
      '',
      '「一句话自动建任务」要等模型接上（接线口：web/src/api/assistant.ts）。',
      '现在可以先在「待办」页点「新建提醒」自己建一条。',
    ].join('\n')
  }
  return [
    `我是${assistant.displayName}，现在能帮你：`,
    '· 写周报 / 月报 / 年报——按你选的时间范围，从完成记录里起草',
    '· 看「手上还有哪些没做完」，逾期、金额、清单都列出来',
    '· 按关键词查（例如「5G」「割接」），时间范围随便挑',
    '',
    '模型还没接，所以这类「要数据」的问题会直接给你草稿。',
  ].join('\n')
}

/** 把当前选择翻译成请求里的数据口径；什么都没选就返回 null（后端按话里的时间词认）。 */
function currentDigest(): AssistantDigestInput | null {
  const option = scope.value.option
  const keyword = scope.value.keyword.trim()
  if (!option && !keyword) return null
  const payload: AssistantDigestInput = { option, keyword }
  if (option === 'custom') {
    payload.from = scope.value.from
    payload.to = scope.value.to
  }
  return payload
}

/** 只把 role/content 发给后端：本地那些 failed / digest 标记不该混进提示词。 */
function outgoing(): AssistantMessage[] {
  return messages.value.map(({ role, content }) => ({ role, content }))
}

async function send(text?: string, option?: string) {
  const content = (text ?? draft.value).trim()
  if (!content || pending.value) return
  if (option) scope.value.option = option
  scopeError.value = ''
  const digest = currentDigest()
  if (digest?.option === 'custom' && (!digest.from || !digest.to)) {
    scopeError.value = '自定义时间段要同时给开始与结束日期'
    return
  }
  messages.value.push({ role: 'user', content })
  draft.value = ''
  pending.value = true
  void scrollToBottom()
  try {
    if (!live.value && !digest) {
      // 后台没开 / 没填完，且这一轮也不要数据：回一句本地占位文案，
      // 面板不能因为没接模型就哑掉。（占位文案不给「保存到记事本」：那是
      // 「我没接上模型」的提示，不是小秘的回答，存下来只会添乱。）
      await new Promise((resolve) => setTimeout(resolve, 320))
      messages.value.push({ role: 'assistant', content: placeholderReply(content), placeholder: true })
      return
    }
    const answer = await chatWithAssistant(outgoing(), digest, chatTimeoutMs.value, thinkingMode.value)
    messages.value.push({
      role: 'assistant',
      content: answer.reply,
      digest: answer.digest,
      draft: answer.mode === 'draft',
      thinking: answer.thinking,
      thinkingTruncated: answer.thinking_truncated,
      thinkingMode: answer.thinking_mode,
      question: content,
      hint: digest?.option || '',
    })
  } catch (err: any) {
    const reason = err?.message || '调用失败'
    messages.value.push({
      role: 'assistant',
      content: `这次没答上来：${reason}\n\n可以到「系统配置 → AI 助手」点「测试连接」看具体卡在哪。`,
      failed: true,
    })
  } finally {
    pending.value = false
    void scrollToBottom()
  }
}

/**
 * 把这一条回答存进记事本。标题、标签、备注都由服务端生成，这里只负责把
 * 「回答原文 + 用户问的那句话 + 这一轮的数据口径」递过去，并把结果记在这条
 * 气泡上——存过的气泡不再让点第二次。
 */
async function saveNote(index: number) {
  const msg = messages.value[index]
  if (!msg || msg.role !== 'assistant' || msg.saving || msg.savedNote) return
  msg.saving = true
  msg.saveError = ''
  try {
    const saved = await saveAssistantNote({
      text: msg.content,
      question: msg.question || '',
      hint: msg.hint || '',
    })
    msg.savedNote = { id: saved.id, listId: saved.list_id, title: saved.title }
  } catch (err: any) {
    msg.saveError = err?.message || '保存失败'
  } finally {
    msg.saving = false
  }
}

/** 「去看」：关掉面板并跳到记事本那一栏（列表页就是 /admin/list/:id）。 */
function openSavedNote(note: { listId: number }) {
  emit('update:modelValue', false)
  void router.push(note.listId ? `/admin/list/${note.listId}` : '/admin/all')
}

/** 常用查询存在用户配置里（和侧栏顺序 sidebar_order 一个路子）。 */
function describeQuery(item: SavedQuery): string {
  const label = rangeOptions.find((opt) => opt.value === item.option)?.label || '自动识别'
  const parts = [label]
  if (item.option === 'custom' && item.from && item.to) parts.push(`${item.from} ~ ${item.to}`)
  if (item.keyword) parts.push(`关键词「${item.keyword}」`)
  return parts.join(' · ')
}

async function loadSavedQueries() {
  try {
    const res = await getAllConfigs()
    const hiddenRaw = String(res.data?.data?.assistant_hidden_chips ?? '')
    if (hiddenRaw) {
      const parsedHidden = JSON.parse(hiddenRaw)
      if (Array.isArray(parsedHidden)) {
        hiddenChips.value = parsedHidden
          .filter((row: any) => typeof row === 'string')
          .filter((label: string) => quickChips.some((chip) => chip.label === label))
      }
    }
    const raw = String(res.data?.data?.assistant_saved_queries ?? '')
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    savedQueries.value = parsed
      .filter((row: any) => row && typeof row.name === 'string' && row.name.trim())
      .map((row: any) => ({
        name: String(row.name).trim(),
        option: String(row.option || ''),
        from: row.from ? String(row.from) : undefined,
        to: row.to ? String(row.to) : undefined,
        keyword: row.keyword ? String(row.keyword) : '',
      }))
  } catch {
    // 没配过 / 配置坏了都不影响用：当作没有常用查询。
  }
}

async function persistSavedQueries(next: SavedQuery[]) {
  savedQueries.value = next
  try {
    await updateConfig('assistant_saved_queries', JSON.stringify(next))
  } catch (err: any) {
    scopeError.value = `常用查询没能保存：${err?.message || '保存失败'}`
  }
}

async function persistHiddenChips(next: string[]) {
  hiddenChips.value = next
  try {
    await updateConfig('assistant_hidden_chips', JSON.stringify(next))
  } catch (err: any) {
    scopeError.value = `提示词没能保存：${err?.message || '保存失败'}`
  }
}

function hideChip(label: string) {
  if (hiddenChips.value.includes(label)) return
  void persistHiddenChips([...hiddenChips.value, label])
}

function restoreChips() {
  void persistHiddenChips([])
}

function beginSave() {
  if (!canSaveQuery.value) return
  savingName.value = describeQuery({ name: '', ...(currentDigest() || { option: '', keyword: '' }) })
}

async function confirmSave() {
  const name = (savingName.value || '').trim()
  if (!name) return
  const digest = currentDigest() || { option: '', keyword: '' }
  const next = savedQueries.value.filter((row) => row.name !== name)
  next.push({ name, ...digest })
  savingName.value = null
  await persistSavedQueries(next)
}

async function removeSaved(name: string) {
  await persistSavedQueries(savedQueries.value.filter((row) => row.name !== name))
}

function runSaved(item: SavedQuery) {
  scope.value = {
    option: item.option || '',
    from: item.from || '',
    to: item.to || '',
    keyword: item.keyword || '',
  }
  void send(item.name, item.option || undefined)
}

// Esc 关闭 + 打开时把光标放进输入框
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
watch(() => props.modelValue, (open) => {
  if (open) {
    window.addEventListener('keydown', onKeydown)
    void refreshStatus().then(() => loadThinkingMode())
    void loadSavedQueries()
    void loadLists()
    void loadLists()
    void nextTick(() => inputEl.value?.focus())
  } else {
    window.removeEventListener('keydown', onKeydown)
    closeMention()
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.assistant-enter-active,
.assistant-leave-active {
  transition: opacity 0.25s ease;
}
.assistant-enter-from,
.assistant-leave-to {
  opacity: 0;
}
.assistant-enter-active aside,
.assistant-leave-active aside {
  transition: transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.assistant-enter-from aside,
.assistant-leave-to aside {
  transform: translateX(100%);
}

/* 连接状态点：颜色跟着标题走（绿=接上模型，红=没配置），外面一圈淡淡的同色光晕。 */
.assistant-conn {
  @apply inline-block h-2 w-2 rounded-full;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent);
}
.assistant-avatar {
  @apply flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-black text-white shadow-glow;
}
.assistant-icon-btn {
  @apply flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground;
}
/* 顶部「没有可用模型」横幅：琥珀色（全站警告色沿用 text-amber-600 / dark:text-amber-300），
   左侧加一道 4px 竖条 + 三角警示图标，深浅两套主题下都够显眼。 */
.assistant-offline {
  @apply flex items-start gap-2 border-b border-l-4 border-amber-500/40 border-l-amber-500 bg-amber-500/10 px-4 py-2.5 text-[12px] font-semibold leading-relaxed text-amber-600 dark:border-amber-400/30 dark:border-l-amber-400 dark:bg-amber-500/15 dark:text-amber-300;
}
.assistant-offline-hint {
  @apply mt-0.5 block text-[11px] font-normal leading-relaxed text-amber-600/85 dark:text-amber-300/85;
}
.assistant-empty {
  @apply rounded-2xl border border-dashed border-border px-4 py-4;
}
.assistant-chip {
  @apply rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground transition hover:brightness-95;
}
.assistant-saved-tag {
  @apply inline-flex items-center gap-1 rounded-full border border-brand-300/60 bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-200;
}
.assistant-saved-remove {
  @apply text-[10px] leading-none text-muted-foreground transition hover:text-destructive;
}
.assistant-link {
  @apply rounded-lg px-1.5 py-1 text-[11px] font-semibold text-brand-600 transition hover:bg-muted disabled:opacity-40 dark:text-brand-300;
}
/* 固定高度：这一行里 select 与 input 并排（时间范围 / 起止日期 / 关键词），
   不定高的话原生 select 会比 input 矮一点点（25 与 26 差一像素），一行里就不齐。 */
.assistant-select {
  @apply h-7 rounded-lg border border-border bg-background px-2 py-0 text-[11px] text-foreground outline-none transition focus:border-brand-400;
}
/* 「保存到记事本」那一行：只出现在小秘的回答下面，小小的、不抢回答的位置 */
.assistant-note-actions {
  @apply -mt-1.5 flex items-center gap-2 px-1;
}
.assistant-note-save {
  @apply rounded-lg border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50 dark:hover:border-brand-500/40 dark:hover:text-brand-300;
}
.assistant-note-done {
  @apply text-[11px] font-medium text-emerald-600 dark:text-emerald-400;
}
.assistant-note-link {
  @apply text-[11px] font-semibold text-brand-600 transition hover:underline dark:text-brand-300;
}
.assistant-note-error {
  @apply text-[11px] text-destructive;
}
.assistant-meta {
  @apply -mt-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground;
}
/* 选中的档位：比普通 chip 实一点，一眼看出「现在是哪种」 */
.assistant-chip-on {
  @apply border-brand-400 bg-brand-50 font-bold text-brand-700 dark:border-brand-500/50 dark:bg-brand-500/15 dark:text-brand-200;
}
/* 简洁思考：一行小字，末尾带省略号时表示后端截过 */
.assistant-thinking-brief {
  @apply italic;
}
/* 详细思考过程：默认折叠，展开后是一块浅底，不跟回答抢位置 */
.assistant-thinking-full {
  @apply -mt-1.5 mx-1 rounded-lg border border-border/70 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground;
}
.assistant-thinking-summary {
  @apply cursor-pointer select-none font-semibold text-muted-foreground;
}
.assistant-thinking-body {
  @apply mt-1 whitespace-pre-wrap break-words leading-relaxed;
}
.assistant-bubble {
  @apply max-w-[86%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed;
}
.assistant-bubble-user {
  @apply bg-brand-gradient text-white;
}
.assistant-bubble-bot {
  @apply bg-muted text-foreground;
}
.assistant-bubble-fail {
  @apply border border-destructive/40 bg-destructive/10 text-destructive;
}
.assistant-typing {
  @apply flex items-center gap-1;
}
.assistant-typing span {
  @apply block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground;
}
.assistant-typing span:nth-child(2) {
  animation-delay: 0.12s;
}
.assistant-typing span:nth-child(3) {
  animation-delay: 0.24s;
}
.assistant-input {
  @apply w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition focus:border-brand-400;
}
/* 打 @ 弹出来的清单选择器：浮在输入框上方，不挤走对话区 */
.assistant-mention {
  @apply absolute bottom-full left-3 right-3 z-10 mb-2 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-xl;
}
.assistant-mention-title {
  @apply px-2 py-1 text-[10px] font-bold text-muted-foreground;
}
.assistant-mention-item {
  @apply flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-foreground transition hover:bg-muted;
}
.assistant-mention-item-on {
  @apply bg-muted;
}
.assistant-mention-dot {
  @apply h-2.5 w-2.5 shrink-0 rounded-full;
}
.assistant-mention-hint {
  @apply px-2 pt-1 pb-0.5 text-[10px] text-muted-foreground;
}
.assistant-send {
  @apply shrink-0 rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-bold text-white shadow-glow transition hover:brightness-110 disabled:opacity-50;
}
</style>
