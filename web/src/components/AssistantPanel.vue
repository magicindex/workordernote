<template>
  <Teleport to="body">
    <Transition name="assistant">
      <div v-if="modelValue" class="fixed inset-0 z-[60] flex justify-end" data-assistant-panel>
        <div class="absolute inset-0 bg-black/45" data-assistant-backdrop @click="close"></div>

        <aside class="relative flex h-full w-full flex-col bg-surface text-foreground shadow-2xl sm:w-[420px]">
          <!-- 头部：小秘身份 + 模型接入状态 + 清空 / 关闭 -->
          <header class="flex items-center gap-3 border-b border-border px-4 py-3">
            <span class="assistant-avatar">秘</span>
            <div class="min-w-0 flex-1">
              <p class="font-display text-base font-extrabold tracking-tight">AI 小秘</p>
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

          <!-- 对话区 -->
          <div ref="listEl" class="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-assistant-scroll>
            <div v-if="!messages.length" class="assistant-empty">
              <p class="font-display text-sm font-extrabold">你好，我是小秘</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                写周报、把一句话变成待办、理清今天该先做什么——说一句就行。
              </p>
              <div class="mt-3 flex flex-wrap gap-1.5">
                <button
                  v-for="chip in quickChips"
                  :key="chip.label"
                  type="button"
                  class="assistant-chip"
                  :data-assistant-chip="chip.label"
                  @click="send(chip.label, chip.option)"
                >
                  {{ chip.label }}
                </button>
              </div>
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
                {{ msg.digest.notes }}{{ msg.digest.keyword ? ` · 关键词「${msg.digest.keyword}」` : '' }}
              </p>
              <p v-if="msg.draft" class="assistant-meta" data-assistant-draft-note>
                这是按你的记录直接生成的草稿（模型接入后同样的问题会由模型润色改写）。
              </p>
            </template>

            <div v-if="pending" class="flex justify-start">
              <div class="assistant-bubble assistant-bubble-bot assistant-typing" data-assistant-typing>
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>

          <!-- 数据口径：周报/月报/工作清单按这里的区间取数 -->
          <section class="border-t border-border px-3 pt-3" data-assistant-scope>
            <div class="flex flex-wrap items-center gap-1.5">
              <!-- 预置的三条：开箱即点，不占用户配置、也不给删（删了下次又回来更奇怪） -->
              <button
                v-for="item in presetQueries"
                :key="'preset-' + item.name"
                type="button"
                class="assistant-chip"
                :data-assistant-preset="item.name"
                :title="'预置常用查询 · ' + describeQuery(item)"
                @click="runSaved(item)"
              >
                {{ item.name }}
              </button>
              <span v-if="savedQueries.length" class="text-[10px] font-bold text-muted-foreground" data-assistant-saved-label>我的</span>
              <template v-for="item in savedQueries" :key="item.name">
                <button
                  v-if="!savedEditing"
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
              <button
                type="button"
                class="assistant-link"
                data-assistant-saved-edit
                @click="savedEditing = !savedEditing"
              >{{ savedEditing ? '完成' : '管理' }}</button>
            </div>

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
            <p v-if="scopeError" class="mt-1.5 text-[11px] text-destructive" data-assistant-scope-error>{{ scopeError }}</p>
          </section>

          <!-- 输入区 -->
          <footer class="border-t border-border px-3 py-3">
            <textarea
              ref="inputEl"
              v-model="draft"
              rows="2"
              class="assistant-input"
              placeholder="跟小秘说点什么…（Enter 发送，Shift + Enter 换行）"
              data-assistant-input
              @keydown.enter.exact.prevent="send()"
            ></textarea>
            <div class="mt-2 flex items-center justify-between gap-2">
              <span class="text-[11px] text-muted-foreground">{{ live ? '回答由后台配置的模型生成' : '没接模型：会按你的记录生成草稿' }}</span>
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
  type AssistantDigestInput,
  type AssistantDigestView,
  type AssistantMessage,
  type AssistantStatus,
} from '../api/assistant'
import { getAllConfigs, updateConfig } from '../api/config'

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
}

/** 一条常用查询（存用户配置 assistant_saved_queries）。 */
interface SavedQuery extends AssistantDigestInput {
  name: string
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

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

/** 预置常用查询：开箱就能点的三条总结（不写进用户配置，用户自己存的排在后面）。 */
const presetQueries: SavedQuery[] = [
  { name: '本周周报', option: 'week' },
  { name: '本月月报', option: 'month' },
  { name: '本年总结', option: 'year' },
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

const scope = ref({ option: '', from: '', to: '', keyword: '' })
const scopeError = ref('')
const savedQueries = ref<SavedQuery[]>([])
const savedEditing = ref(false)
const savingName = ref<string | null>(null)

/** 对话只存在内存里：关掉面板再打开还在，刷新页面就清空（要落库再说）。 */
const messages = ref<Bubble[]>([])
const draft = ref('')
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
    '我是小秘，现在能帮你：',
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
      // 面板不能因为没接模型就哑掉。
      await new Promise((resolve) => setTimeout(resolve, 320))
      messages.value.push({ role: 'assistant', content: placeholderReply(content) })
      return
    }
    const answer = await chatWithAssistant(outgoing(), digest, chatTimeoutMs.value)
    messages.value.push({
      role: 'assistant',
      content: answer.reply,
      digest: answer.digest,
      draft: answer.mode === 'draft',
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
    void refreshStatus()
    void loadSavedQueries()
    void nextTick(() => inputEl.value?.focus())
  } else {
    window.removeEventListener('keydown', onKeydown)
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

.assistant-avatar {
  @apply flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-black text-white shadow-glow;
}
.assistant-icon-btn {
  @apply flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground;
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
.assistant-select {
  @apply rounded-lg border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none transition focus:border-brand-400;
}
.assistant-meta {
  @apply -mt-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground;
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
.assistant-send {
  @apply shrink-0 rounded-xl bg-brand-gradient px-3.5 py-2 text-xs font-bold text-white shadow-glow transition hover:brightness-110 disabled:opacity-50;
}
</style>
