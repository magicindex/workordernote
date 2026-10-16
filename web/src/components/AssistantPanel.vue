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
                  :key="chip"
                  type="button"
                  class="assistant-chip"
                  :data-assistant-chip="chip"
                  @click="send(chip)"
                >
                  {{ chip }}
                </button>
              </div>
            </div>

            <div
              v-for="(msg, i) in messages"
              :key="i"
              class="flex"
              :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
              :data-assistant-role="msg.role"
            >
              <div
                class="assistant-bubble"
                :class="[msg.role === 'user' ? 'assistant-bubble-user' : 'assistant-bubble-bot', msg.failed ? 'assistant-bubble-fail' : '']"
              >{{ msg.content }}</div>
            </div>

            <div v-if="pending" class="flex justify-start">
              <div class="assistant-bubble assistant-bubble-bot assistant-typing" data-assistant-typing>
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>

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
              <span class="text-[11px] text-muted-foreground">{{ live ? '回答由后台配置的模型生成' : '占位阶段不会真的建提醒、也不会写周报' }}</span>
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
import { chatWithAssistant, getAssistantStatus, type AssistantMessage, type AssistantStatus } from '../api/assistant'

/**
 * 气泡在 AssistantMessage 上多一个本地标记：模型调用失败时把原因直接贴进对话，
 * 比静默回落到占位文案有用——「API Key 无效」「模型名不存在」都是用户能自己
 * 去改的（系统配置 → AI 助手）。
 */
interface Bubble extends AssistantMessage {
  failed?: boolean
}

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const quickChips = ['写这周的周报', '今天还剩什么没做', '帮我建一个提醒：明天 9 点开会']

/** 对话只存在内存里：关掉面板再打开还在，刷新页面就清空（要落库再说）。 */
const messages = ref<Bubble[]>([])
const draft = ref('')
const pending = ref(false)
const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)

const canSend = computed(() => !!draft.value.trim() && !pending.value)

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
  if (!current) return '模型未接入 · 后台状态未知（仍可用占位回复）'
  if (current.active) {
    return ['模型已接入', current.provider_label || current.provider, current.model].filter(Boolean).join(' · ')
  }
  return `模型未接入 · ${current.reason || '后台未启用 AI 助手'}`
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
 * 兜底回复：**不调用模型**，只是按关键词给一段像样的文案。
 * 后台「系统配置 → AI 助手」还没接上模型时用它；接上后走 api/assistant.ts 的
 * chatWithAssistant，不再走这里。
 */
function placeholderReply(raw: string): string {
  const text = raw.trim()
  if (/周报|日报|月报|总结|汇报/.test(text)) {
    return [
      '【本周周报 · 草稿】',
      '一、本周完成',
      '· （接上模型后，这里从「已完成」的提醒里自动汇总）',
      '二、进行中 / 卡点',
      '· …',
      '三、下周计划',
      '· …',
      '',
      '—— 以上是占位文本，还没接模型。',
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
    '我是小秘，将来能帮你：',
    '· 写周报 / 日报——从这一周的完成记录里起草',
    '· 一句话变待办——说清「做什么、什么时候」，我来建提醒',
    '· 理清今天——把今天该做的排个先后',
    '',
    '模型还没接，所以你看到的是占位回复。',
  ].join('\n')
}

/** 只把 role/content 发给后端：本地那个 failed 标记不该混进提示词。 */
function outgoing(): AssistantMessage[] {
  return messages.value.map(({ role, content }) => ({ role, content }))
}

async function send(text?: string) {
  const content = (text ?? draft.value).trim()
  if (!content || pending.value) return
  messages.value.push({ role: 'user', content })
  draft.value = ''
  pending.value = true
  void scrollToBottom()
  try {
    if (!live.value) {
      // 后台没开 / 没填完：回一句本地占位文案，面板不能因为没接模型就哑掉。
      await new Promise((resolve) => setTimeout(resolve, 320))
      messages.value.push({ role: 'assistant', content: placeholderReply(content) })
      return
    }
    const reply = await chatWithAssistant(outgoing(), chatTimeoutMs.value)
    messages.value.push({ role: 'assistant', content: reply })
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

// Esc 关闭 + 打开时把光标放进输入框
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
watch(() => props.modelValue, (open) => {
  if (open) {
    window.addEventListener('keydown', onKeydown)
    void refreshStatus()
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
