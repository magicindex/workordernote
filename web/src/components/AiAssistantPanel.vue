<template>
  <div class="surface rounded-2xl overflow-hidden" data-ai-panel>
    <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6 sm:py-5">
      <h2 class="text-sm font-bold text-foreground sm:text-base">AI 助手（呼叫小秘）</h2>
      <span class="badge" :class="stateBadgeClass" data-ai-state>{{ stateLabel }}</span>
    </div>

    <div v-if="loading" class="space-y-3 p-4 sm:p-6">
      <div class="h-20 rounded-xl bg-muted animate-pulse"></div>
      <div class="h-10 rounded-xl bg-muted animate-pulse"></div>
    </div>

    <div v-else class="space-y-5 p-4 sm:p-6">
      <p class="text-xs leading-5 text-muted-foreground">
        侧栏「呼叫小秘」用的模型在这里填。<strong class="text-foreground">服务商只是预设</strong>：
        底层一律按 <strong class="text-foreground">OpenAI 兼容协议</strong>
        （<code class="font-mono">POST {地址}/chat/completions</code>）调用，所以任何兼容服务都能接进来——
        换模型、换厂家、接内网网关都只是改这里的几个输入框，不用更新版本。
        API Key <strong class="text-foreground">只存在服务端</strong>：保存后这里只显示掩码，浏览器与前端代码都拿不到明文。
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="flex items-center gap-2 sm:col-span-2">
          <input v-model="form.enabled" type="checkbox" class="h-4 w-4 rounded border-border" data-ai-enabled />
          <span class="text-xs font-bold text-foreground">启用 AI 助手</span>
          <span class="text-[11px] text-muted-foreground">关闭时「呼叫小秘」面板走本地占位回复，不产生任何调用费用</span>
        </label>

        <label class="block">
          <span class="text-xs font-bold text-foreground">模型服务商</span>
          <select
            v-model="form.provider"
            class="input-field !py-2 mt-1.5"
            :disabled="busy"
            data-ai-provider
            @change="applyPreset"
          >
            <option v-for="item in presets" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            {{ preset?.note || '预设只帮你填好地址与常见模型名，参数仍然可以自己改。' }}
          </span>
        </label>

        <label class="block">
          <span class="text-xs font-bold text-foreground">模型名称</span>
          <input
            v-model.trim="form.model"
            type="text"
            list="ai-model-options"
            class="input-field !py-2 mt-1.5 font-mono text-xs"
            placeholder="deepseek-chat"
            :disabled="busy"
            data-ai-model
          />
          <datalist id="ai-model-options">
            <option v-for="name in modelOptions" :key="name" :value="name" />
          </datalist>
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            服务商上线新模型时直接填名字即可，不用改代码。
          </span>
        </label>

        <label class="block sm:col-span-2">
          <span class="text-xs font-bold text-foreground">接口地址</span>
          <input
            v-model.trim="form.base_url"
            type="text"
            inputmode="url"
            class="input-field !py-2 mt-1.5 font-mono text-xs"
            :placeholder="presetBaseURL || 'https://api.deepseek.com/v1'"
            :disabled="busy"
            data-ai-base-url
          />
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground" data-ai-base-url-hint>
            {{ baseURLHint }}
          </span>
        </label>

        <label class="block">
          <span class="text-xs font-bold text-foreground">API Key</span>
          <input
            v-model.trim="form.api_key"
            type="password"
            autocomplete="off"
            class="input-field !py-2 mt-1.5 font-mono text-xs"
            :placeholder="apiKeyPlaceholder"
            :disabled="busy"
            data-ai-api-key
          />
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground" data-ai-key-hint>
            {{ keyHint }}
            <button
              v-if="settings?.api_key_set && !form.clear_api_key"
              type="button"
              class="ml-1 underline hover:text-foreground"
              :disabled="busy"
              data-ai-clear-key
              @click="markClearKey"
            >
              清除密钥
            </button>
            <button
              v-if="form.clear_api_key"
              type="button"
              class="ml-1 underline hover:text-foreground"
              :disabled="busy"
              @click="form.clear_api_key = false"
            >
              撤销清除
            </button>
          </span>
        </label>

        <label class="block">
          <span class="text-xs font-bold text-foreground">请求超时（秒）</span>
          <input
            v-model.number="form.timeout_seconds"
            type="number"
            min="5"
            max="600"
            class="input-field !py-2 mt-1.5"
            :disabled="busy"
            data-ai-timeout
          />
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            等模型回答的最长时间，5–600 秒；本地小模型或长回答可以调大。
          </span>
        </label>

        <label class="block sm:col-span-2">
          <span class="text-xs font-bold text-foreground">系统提示词</span>
          <textarea
            v-model="form.system_prompt"
            rows="4"
            class="input-field !py-2 mt-1.5 text-xs leading-5"
            :disabled="busy"
            data-ai-prompt
          ></textarea>
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            每轮对话都由服务端加在最前面（前端传不进来，也不会被对话内容顶掉）。
            <button
              type="button"
              class="underline hover:text-foreground"
              :disabled="busy"
              @click="form.system_prompt = settings?.default_system_prompt || ''"
            >
              恢复默认
            </button>
          </span>
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-brand" :disabled="!dirty || busy" data-ai-save @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
        <button
          type="button"
          class="btn-secondary !h-10"
          :disabled="busy || !canTest"
          data-ai-test
          @click="testConnection"
        >
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button
          v-if="form.provider === 'ollama'"
          type="button"
          class="btn-secondary !h-10"
          :disabled="busy"
          data-ai-detect
          @click="detectOllama"
        >
          {{ detecting ? '检测中…' : '检测本机 Ollama' }}
        </button>
        <span v-if="statusText" class="text-xs font-semibold text-emerald-600 dark:text-emerald-300">{{ statusText }}</span>
      </div>

      <p v-if="errorMsg" class="rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive" data-ai-error>{{ errorMsg }}</p>
      <p v-if="notice" class="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs leading-5 text-emerald-600 dark:text-emerald-300" data-ai-notice>{{ notice }}</p>
      <p v-if="dirty" class="text-[11px] font-semibold text-amber-600 dark:text-amber-300">有未保存的改动</p>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-xl border border-border bg-surface/60 p-3">
          <p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground">当前状态</p>
          <p class="mt-1.5 text-xs text-foreground">
            {{ settings?.active ? '已接入：面板会真的调用模型' : '未接入：面板走本地占位回复' }}
          </p>
          <p class="mt-1 break-all text-xs text-muted-foreground">
            实际请求地址：<code class="font-mono">{{ settings?.effective_base_url || '—' }}</code>
          </p>
        </div>
        <div class="rounded-xl border border-border bg-surface/60 p-3">
          <p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground">密钥与模型</p>
          <p class="mt-1.5 text-xs text-foreground">{{ settings?.api_key_set ? settings.api_key : '未设置密钥' }}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ settings?.active ? `当前模型：${settings.model}` : settings?.reason || '—' }}
          </p>
        </div>
      </div>

      <!-- 检测本机 Ollama 结果：找到了是哪条候选，找不到就逐条说明为什么 -->
      <div v-if="detection" class="rounded-xl border border-border bg-surface/60 p-3" data-ai-detect-result>
        <p class="flex flex-wrap items-center gap-2 text-xs font-bold text-foreground">
          <span class="badge" :class="detection.found ? okBadgeClass : failBadgeClass">
            {{ detection.found ? '已找到本机 Ollama' : '没找到本机 Ollama' }}
          </span>
          <span v-if="detection.found && detection.label" class="text-[11px] font-medium text-muted-foreground">{{ detection.label }}</span>
        </p>
        <p v-if="detection.found" class="mt-1.5 break-all text-xs leading-5 text-muted-foreground">
          地址 <code class="font-mono">{{ detection.base_url }}</code>
          {{ detection.models?.length ? `，可用模型 ${detection.models.length} 个` : '，但这个 Ollama 里还没有下载模型（先在宿主机 ollama pull 一个）' }}
        </p>
        <ul class="mt-1.5 space-y-0.5 text-[11px] leading-4 text-muted-foreground">
          <li v-for="item in detection.attempts" :key="item.base_url" class="break-all">
            <span :class="item.ok ? 'text-emerald-600 dark:text-emerald-300' : ''">{{ item.ok ? '✓' : '✗' }}</span>
            <code class="ml-1 font-mono">{{ item.base_url }}</code>
            <span v-if="!item.ok"> — {{ item.detail }}</span>
          </li>
        </ul>
      </div>

      <!-- 测试连接结果 -->
      <div v-if="testResult" class="rounded-xl border border-border bg-surface/60 p-3" data-ai-test-result>        <p class="flex flex-wrap items-center gap-2 text-xs font-bold text-foreground">
          <span class="badge" :class="testResult.ok ? okBadgeClass : failBadgeClass">
            {{ testResult.ok ? '连接正常' : '连接失败' }}
          </span>
          <span class="text-[11px] font-medium text-muted-foreground">{{ testResult.endpoint }}</span>
          <span v-if="testResult.latency_ms" class="text-[11px] font-medium text-muted-foreground">{{ testResult.latency_ms }} ms</span>
          <span v-if="testResult.via === 'chat'" class="text-[11px] font-medium text-muted-foreground">（该服务没有模型列表接口，已用一次真实对话验证）</span>
        </p>
        <p class="mt-1.5 text-xs leading-5" :class="testResult.ok ? 'text-muted-foreground' : 'text-destructive'">
          {{ testResult.detail }}
        </p>
        <p v-if="testResult.models?.length" class="mt-1.5 text-xs text-muted-foreground">
          可用模型（{{ testResult.models.length }}）：{{ testResult.models.slice(0, 12).join('、') }}{{ testResult.models.length > 12 ? ' …' : '' }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 「系统配置 → AI 助手」：把模型参数（服务商 / 地址 / API Key / 模型名 / 提示词）
 * 做成后台可填的通用样式。
 *
 * 为什么不并进 ConfigGroupList（那边是「一个键一个值」的通用渲染）：这里要
 * 服务商预设联动、密钥掩码回显、连通性测试与结果明细，跟 SyncPanel 的理由一样
 * ——不是一维的键值能表达的。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import {
  detectLocalOllama,
  getAssistantSettings,
  saveAssistantSettings,
  testAssistantSettings,
  type AssistantOllamaDetection,
  type AssistantProviderPreset,
  type AssistantSettings,
  type AssistantSettingsInput,
  type AssistantTestResult,
} from '../api/assistant'

const settings = ref<AssistantSettings | null>(null)
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const detecting = ref(false)
const errorMsg = ref('')
const notice = ref('')
const statusText = ref('')
const testResult = ref<AssistantTestResult | null>(null)
const detection = ref<AssistantOllamaDetection | null>(null)
/** 「检测本机 Ollama」带回来的模型列表：它比预设里的名字更贴近这台机器。 */
const detectedModels = ref<string[]>([])

/** 上一次选中的服务商：切换预设时用它判断「地址/模型是不是还是上一个预设的值」。 */
const lastProviderId = ref('')

const form = reactive({
  enabled: false,
  provider: 'deepseek',
  base_url: '',
  api_key: '',
  clear_api_key: false,
  model: '',
  system_prompt: '',
  timeout_seconds: 60,
})

/** 保存时的表单快照（序列化比较），用来判断「有未保存的改动」。 */
const snapshot = ref('')

const presets = computed<AssistantProviderPreset[]>(() => settings.value?.providers || [])
const preset = computed(() => presets.value.find((item) => item.id === form.provider) || null)
const presetBaseURL = computed(() => preset.value?.base_url || '')
/** 模型候选 = 预设常见模型 + 上次「测试连接」拉回来的真实模型列表 + 本机 Ollama 检测到的。 */
const modelOptions = computed(() => {
  const names = [...(preset.value?.models || []), ...(testResult.value?.models || []), ...detectedModels.value]
  return [...new Set(names)].slice(0, 200)
})
const busy = computed(() => loading.value || saving.value || testing.value || detecting.value)
const canTest = computed(() => !!(form.base_url || presetBaseURL.value))

/**
 * 接口地址下面的提示：本地 Ollama 在「后端跑容器里」时最常见的坑是地址写成
 * 127.0.0.1（那是容器自己）。浏览器知道管理端是从哪个地址打开的，用它提示一句，
 * 比让人对着「连接被拒绝」猜要省事。
 */
const baseURLHint = computed(() => {
  const suffix = '留空表示跟随所选服务商（' + (presetBaseURL.value || '—') + '）。根地址一般以 /v1 结尾；整条对话地址粘进来也会自动去掉尾巴。'
  if (form.provider !== 'ollama') return suffix
  // 地址留空时后端用的是预设里的默认值 —— Ollama 预设正好就是 127.0.0.1，
  // 所以这里要看「实际会用哪个地址」，不然最常见的「选 Ollama 直接留空」反而没有提醒。
  const effective = (form.base_url || presetBaseURL.value).trim()
  const loopback = /^https?:\/\/(127\.0\.0\.1|localhost)\b/i.test(effective)
  if (loopback) {
    return `本机 Ollama 的地址填的是 127.0.0.1：后端跑在容器里时这个 127.0.0.1 指的是容器自己（连不上），要填宿主机的局域网地址，或点「检测本机 Ollama」自动填；后端直接装在宿主机上时这样填就是对的。${suffix}`
  }
  return suffix
})

const dirty = computed(() => JSON.stringify(payload()) !== snapshot.value)

const apiKeyPlaceholder = computed(() => {
  if (settings.value?.api_key_set) return '留空表示不改动'
  return preset.value?.key_required ? '粘贴服务商给的密钥' : '这个服务商一般不需要'
})

const keyHint = computed(() => {
  if (form.clear_api_key) return '保存后会清空已存的密钥。'
  if (settings.value?.api_key_set) return `已保存 ${settings.value.api_key}；留空表示不改动，填新值则覆盖。`
  if (preset.value?.key_required) return `必填，在服务商控制台申请${preset.value.key_url ? `（${preset.value.key_url}）` : ''}。`
  return '本地/自建服务通常不需要密钥，留空即可——留空时不会发送鉴权头。'
})

const stateLabel = computed(() => {
  if (!settings.value) return '未接入'
  if (settings.value.active) return '已接入'
  return settings.value.enabled ? '已启用 · 待补全' : '未启用'
})
const stateBadgeClass = computed(() => {
  if (settings.value?.active) return 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300'
  if (settings.value?.enabled) return 'bg-amber-500/12 text-amber-600 dark:text-amber-300'
  return 'bg-muted text-muted-foreground'
})
const okBadgeClass = 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300'
const failBadgeClass = 'bg-destructive/12 text-destructive'

/** 只发会变的东西：密钥留空＝不改动，所以不进 payload（否则每次都会被当成「改成空」）。 */
function payload(): AssistantSettingsInput {
  const out: AssistantSettingsInput = {
    enabled: form.enabled,
    provider: form.provider,
    base_url: form.base_url,
    model: form.model,
    system_prompt: form.system_prompt,
    timeout_seconds: Number(form.timeout_seconds) || 60,
  }
  if (form.api_key) out.api_key = form.api_key
  if (form.clear_api_key) out.clear_api_key = true
  return out
}

function applySettings(data: AssistantSettings) {
  settings.value = data
  form.enabled = data.enabled
  form.provider = data.provider
  form.base_url = data.base_url
  form.api_key = ''
  form.clear_api_key = false
  form.model = data.model
  form.system_prompt = data.system_prompt
  form.timeout_seconds = data.timeout_seconds
  lastProviderId.value = data.provider
  snapshot.value = JSON.stringify(payload())
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    applySettings(await getAssistantSettings())
  } catch (err: any) {
    errorMsg.value = err?.message || '加载 AI 配置失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function markClearKey() {
  form.api_key = ''
  form.clear_api_key = true
}

/**
 * 切换服务商时把地址与模型带到新预设上，但**不覆盖手填过的值**：
 * 地址还是上一个预设的默认值（或本来就是空）才跟着换；模型只在「还是上一个
 * 预设的候选」时才换成新的常见模型。手填的内网网关地址、私有模型名都不会被冲掉。
 */
function applyPreset() {
  const previous = presets.value.find((item) => item.id === lastProviderId.value)
  const next = preset.value
  lastProviderId.value = form.provider
  if (!next) return
  if (!form.base_url || form.base_url === (previous?.base_url || '')) {
    form.base_url = ''
  }
  const modelCameFromPreset = !form.model || (previous?.models.includes(form.model) ?? false)
  if (modelCameFromPreset && next.models.length) {
    form.model = next.models[0]
  }
}

async function save() {
  saving.value = true
  errorMsg.value = ''
  notice.value = ''
  statusText.value = ''
  try {
    applySettings(await saveAssistantSettings(payload()))
    notice.value = '已保存'
    statusText.value = settings.value?.active ? '已生效：面板下次打开就走模型' : '已保存，但还没到「可用」状态'
  } catch (err: any) {
    errorMsg.value = err?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

/** 测的是**当前表单**（可以先试再存）：密钥留空时后端会沿用已保存的那一个。 */
async function testConnection() {
  testing.value = true
  errorMsg.value = ''
  notice.value = ''
  statusText.value = ''
  try {
    const result = await testAssistantSettings(payload())
    testResult.value = result
    if (result.ok) notice.value = '测试通过'
  } catch (err: any) {
    testResult.value = null
    errorMsg.value = err?.message || '测试连接失败'
  } finally {
    testing.value = false
  }
}

/**
 * 检测本机 Ollama：服务端会拿「当前填的地址 / 你访问本服务的地址 / 127.0.0.1 /
 * 网桥网关 / host.docker.internal」挨个试一遍，把能用的那条填进表单。
 *
 * 这一步是「本机 Ollama 接入」的关键：Ollama 装在宿主上，而工作序记多半跑在容器
 * 里，容器里的 127.0.0.1 指的是容器自己——手填很容易踩空。
 */
async function detectOllama() {
  detecting.value = true
  errorMsg.value = ''
  notice.value = ''
  statusText.value = ''
  try {
    const result = await detectLocalOllama()
    detection.value = result
    if (!result.found) {
      errorMsg.value = '没找到本机 Ollama：先确认它在宿主机上跑着（默认 11434 端口），再看下面每条地址各自的原因。'
      return
    }
    form.provider = 'ollama'
    form.base_url = result.base_url || form.base_url
    detectedModels.value = result.models || []
    if (!form.model || !detectedModels.value.includes(form.model)) {
      const suggested = suggestLocalModel(detectedModels.value)
      if (suggested) form.model = suggested
    }
    notice.value = `已找到本机 Ollama（${result.label || result.base_url}），地址与模型已填入，确认后点「保存设置」。`
  } catch (err: any) {
    detection.value = null
    errorMsg.value = err?.message || '检测本机 Ollama 失败'
  } finally {
    detecting.value = false
  }
}

/**
 * 从本机模型里挑一个能直接聊天的：跳过向量化/重排模型；优先 instruct、chat 这类
 * 明确面向对话的名字；再避开 qwen3、deepseek-r1 这些「先想一大段」的模型——它们
 * 会把回答长度耗在思考上，小机器上等得久。
 */
function suggestLocalModel(names: string[]): string {
  const usable = names.filter((name) => !/embed|rerank|bge|minilm/i.test(name))
  const pool = usable.length ? usable : names
  return (
    pool.find((name) => /instruct|chat/i.test(name)) ||
    pool.find((name) => !/qwen3|deepseek-r1|reason|think/i.test(name)) ||
    pool[0] ||
    ''
  )
}
</script>
