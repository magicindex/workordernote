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

    <div v-else class="space-y-4 p-4 sm:p-6">
      <p class="text-xs leading-5 text-muted-foreground">
        <strong class="text-foreground">服务商只是预设</strong>：底层一律按 OpenAI 兼容协议调用
        （<code class="font-mono">POST {地址}/chat/completions</code>），所以换模型、换厂家、接内网网关都只改这里的几个输入框，不用更新版本。
        API Key <strong class="text-foreground">只存在服务端</strong>：保存后这里只显示掩码，浏览器与前端代码都拿不到明文。
      </p>

      <!-- 当前模型：一行看完「现在用的是哪个」（用户 2026-10-16 要求） -->
      <div
        class="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-border bg-surface/60 px-3 py-2.5"
        data-ai-current-model
      >
        <span class="text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground">当前模型</span>
        <span class="break-all font-mono text-sm font-bold text-foreground" data-ai-current-model-name>
          {{ settings?.model || '还没选模型' }}
        </span>
        <span class="text-xs text-muted-foreground">
          {{ providerLabel(settings?.provider) }} ·
          {{ settings?.active ? '已接入，面板会真的调用它' : settings?.reason || '未接入' }}
        </span>
        <span
          v-if="pendingModelChange"
          class="w-full text-[11px] font-semibold text-amber-600 dark:text-amber-300"
          data-ai-model-pending
        >
          未保存：点「保存设置」后会换成 {{ form.model || '（留空＝用服务商默认）' }}
        </span>
      </div>

      <label class="flex flex-wrap items-center gap-2">
        <input v-model="form.enabled" type="checkbox" class="h-4 w-4 rounded border-border" data-ai-enabled />
        <span class="text-xs font-bold text-foreground">启用 AI 助手</span>
        <span class="text-[11px] text-muted-foreground">关闭时「呼叫小秘」面板走本地占位回复，不产生任何调用费用</span>
      </label>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="text-xs font-bold text-foreground">模型服务商</span>
          <select
            v-model="form.provider"
            class="input-field !py-0 h-10 mt-1.5 text-[13px]"
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

        <div class="block">
          <div class="flex items-center justify-between gap-2">
            <label for="ai-model-input" class="text-xs font-bold text-foreground">模型名称</label>
            <!-- 拉列表挪到模型名这一行：跟它要填的东西挨着，少占一行按钮（用户 2026-10-17 要求精简） -->
            <div class="flex shrink-0 items-center gap-2">
              <button
                v-if="!modelsOpen && modelChoices.length"
                type="button"
                class="text-[11px] font-semibold text-brand-600 underline hover:text-brand-700 dark:text-brand-300"
                data-ai-model-expand
                @click="modelsOpen = true"
              >
                列表（{{ modelChoices.length }}）
              </button>
              <button
                type="button"
                class="text-[11px] font-semibold text-brand-600 underline hover:text-brand-700 disabled:opacity-40 dark:text-brand-300"
                :disabled="busy || !canTest"
                data-ai-pull-models
                @click="pullModels"
              >
                {{ pulling ? '拉取中…' : '拉取服务器列表' }}
              </button>
            </div>
          </div>
          <input
            id="ai-model-input"
            v-model.trim="form.model"
            type="text"
            class="input-field !py-0 h-10 mt-1.5 font-mono text-[13px]"
            placeholder="deepseek-chat"
            :disabled="busy"
            data-ai-model
          />
          <!-- 拉回来的模型**横着排**（用户 2026-10-17：「重起一行横向显示模型列表，以减少空间占用」）：
               原来是竖着一列带滚动条的清单，十几个模型就顶掉半屏。点一条即填入上面的输入框，仍可手填。 -->
          <div v-if="modelsOpen && modelChoices.length" class="mt-2 rounded-xl border border-border bg-surface/60 px-2.5 py-2" data-ai-model-list>
            <div class="flex items-center justify-between gap-2">
              <p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground">
                {{ modelListTitle }}
              </p>
              <button
                type="button"
                class="shrink-0 text-[10px] font-semibold text-muted-foreground underline hover:text-foreground"
                data-ai-model-collapse
                @click="modelsOpen = false"
              >收起</button>
            </div>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <button
                v-for="name in modelChoices"
                :key="name"
                type="button"
                class="max-w-full break-all rounded-full border px-2 py-0.5 text-left font-mono text-[11px] leading-4 transition-colors disabled:opacity-60"
                :class="name === form.model
                  ? 'border-brand-400 bg-brand-50 font-bold text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/15 dark:text-brand-200'
                  : 'border-border bg-surface text-foreground hover:border-brand-300 hover:bg-muted'"
                :title="name"
                :data-ai-model-option="name"
                :disabled="busy"
                @click="pickModel(name)"
              >
                {{ name }}<span v-if="name === form.model"> · 已选</span><span v-else-if="name === settings?.model"> · 在用</span>
              </button>
            </div>
            <p
              v-if="presetOnlyNames.length"
              class="mt-1.5 border-t border-border pt-1.5 text-[10px] leading-4 text-muted-foreground"
              data-ai-model-preset-hint
            >
              预设常见名字（服务器上没拉到，填了不一定能用，可以直接手填）：
              {{ presetOnlyNames.slice(0, 8).join('、') }}{{ presetOnlyNames.length > 8 ? ' …' : '' }}
            </p>
          </div>
          <span v-else-if="modelChoices.length" class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            已拉到 {{ modelChoices.length }} 个模型，当前用「{{ form.model || '（未填）' }}」；点右上「列表（{{ modelChoices.length }}）」可换。
          </span>
          <span v-else class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            还没拉到模型列表：点上面「拉取服务器列表」按当前服务商列一遍再选；也可以直接填名字（服务商上线新模型时不用改代码）。
          </span>
        </div>

        <label class="block">
          <span class="text-xs font-bold text-foreground">接口地址</span>
          <input
            v-model.trim="form.base_url"
            type="text"
            inputmode="url"
            class="input-field !py-0 h-10 mt-1.5 font-mono text-[13px]"
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
            class="input-field !py-0 h-10 mt-1.5 font-mono text-[13px]"
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
          <span class="text-xs font-bold text-foreground">对话里显示思考过程</span>
          <select
            v-model="form.thinking_mode"
            class="input-field !py-0 h-10 mt-1.5 text-[13px]"
            :disabled="busy"
            data-ai-thinking-mode
          >
            <option v-for="mode in thinkingChoices" :key="mode.value" :value="mode.value">
              {{ mode.label }}
            </option>
          </select>
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            {{ thinkingNote }}
          </span>
        </label>

        <label class="block">
          <span class="text-xs font-bold text-foreground">请求超时（秒）</span>
          <input
            v-model.number="form.timeout_seconds"
            type="number"
            min="5"
            max="600"
            class="input-field !py-0 h-10 mt-1.5 text-[13px]"
            :disabled="busy"
            data-ai-timeout
          />
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            等模型回答的最长时间，5–600 秒；本地小模型或长回答可以调大。
          </span>
        </label>

      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-brand !h-10" :disabled="!dirty || busy" data-ai-save @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
        <button
          type="button"
          class="btn-secondary !h-10 !rounded-xl"
          :disabled="busy || !canTest"
          data-ai-test
          @click="testConnection"
        >
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button
          v-if="form.provider === 'ollama'"
          type="button"
          class="btn-secondary !h-10 !rounded-xl"
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

      <p class="text-[11px] leading-4 text-muted-foreground">
        当前状态：<span class="font-semibold text-foreground">{{ settings?.active ? '已接入，面板会真的调用模型' : '未接入，面板走本地占位回复' }}</span>
        · 实际请求地址 <code class="font-mono">{{ settings?.effective_base_url || '—' }}</code>
        · 密钥 <span class="font-semibold text-foreground">{{ settings?.api_key_set ? settings.api_key : '未设置' }}</span>（只进不出）
      </p>

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
 * 「系统配置 → AI 助手」：把模型参数（服务商 / 地址 / API Key / 模型名 / 思考口径）
 * 做成后台可填的通用样式。提示词是个人偏好，放在「偏好设置 → AI 提示词」。
 *
 * 为什么不并进 ConfigGroupList（那边是「一个键一个值」的通用渲染）：这里要
 * 服务商预设联动、密钥掩码回显、连通性测试与结果明细，跟 SyncPanel 的理由一样
 * ——不是一维的键值能表达的。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import {
  detectLocalOllama,
  getAssistantSettings,
  normalizeThinkingMode,
  saveAssistantSettings,
  testAssistantSettings,
  THINKING_MODES,
  type AssistantOllamaDetection,
  type AssistantProviderPreset,
  type AssistantSettings,
  type AssistantSettingsInput,
  type AssistantTestResult,
  type AssistantThinkingMode,
} from '../api/assistant'

const settings = ref<AssistantSettings | null>(null)
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const pulling = ref(false)
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
  timeout_seconds: 60,
  thinking_mode: 'brief' as AssistantThinkingMode,
})

/** 三个档位的中文名（与对话面板共用一份，见 api/assistant.ts）。 */
const thinkingChoices = THINKING_MODES

/** 保存时的表单快照（序列化比较），用来判断「有未保存的改动」。 */
const snapshot = ref('')

const presets = computed<AssistantProviderPreset[]>(() => settings.value?.providers || [])
const preset = computed(() => presets.value.find((item) => item.id === form.provider) || null)
const presetBaseURL = computed(() => preset.value?.base_url || '')
/** 服务商 id → 界面上的名字（「当前模型」块里显示用）。 */
function providerLabel(id?: string): string {
  if (!id) return '未选服务商'
  return presets.value.find((item) => item.id === id)?.label || id
}
/**
 * 真从服务器拉到的模型（「测试连接」/「拉取模型列表」返回的 + 本机 Ollama 检测到的）。
 * 和「预设常见名字」必须分开：预设只是各家文档里的常见名字，服务器上不一定有——
 * 混在一起会让人以为「列表里有就一定能用」，选完却是 404 model not found。
 */
const pulledModels = computed(() => [...new Set([...(testResult.value?.models || []), ...detectedModels.value])])
/** 所选服务商的预设常见名字。 */
const presetModels = computed(() => [...new Set(preset.value?.models || [])])
/**
 * 预设里那些**没**在实到列表中的名字。本机 Ollama（provider=ollama）以实到列表为准，
 * 预设名字全收起来，免得多出一堆装都没装的模型名。
 */
const presetOnlyNames = computed(() =>
  form.provider === 'ollama' ? [] : presetModels.value.filter((name) => !pulledModels.value.includes(name)))
/**
 * 模型候选 = 实到的排在前面 + 预设里剩下的；只渲染成可点的清单，
 * 不再用 input 的 datalist —— datalist 在手机上弹不出来，就成了「列表看得见、名字选不上」。
 */
const modelChoices = computed(() => [...pulledModels.value, ...presetOnlyNames.value].slice(0, 200))
const modelListTitle = computed(() => (pulledModels.value.length
  ? `服务器上可用（${pulledModels.value.length}）· 点一个选用`
  : `预设常见名字（${modelChoices.value.length}）· 还没从服务器拉到列表`))
/** 保存后才会生效的模型：和已保存的不一样时在「当前模型」块里提醒一句。 */
const pendingModelChange = computed(() => !!settings.value && (form.model || '') !== (settings.value.model || ''))
/**
 * 拉回来的列表默认收起：选完一条就自动隐藏，只在上面的「模型名称」里显示当前值
 * （用户 2026-10-17 要求）。需要再换时点「列表（N）」展开，或重新拉一遍。
 */
const modelsOpen = ref(false)
/** 选中的档位说明：写清「它只影响显示、模型仍然会想」，免得被理解成省钱的开关。 */
const thinkingNote = computed(() => {
  const mode = thinkingChoices.find((item) => item.value === form.thinking_mode)
  return `${mode?.note || ''}。这是每个人的默认值：用户也可以在「呼叫小秘」面板里当场换（他自己的选择只影响他）；模型本身仍然会先想，这一项不改变上游用量。`
})
const busy = computed(() => loading.value || saving.value || testing.value || pulling.value || detecting.value)
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
    // 系统提示词已搬到「偏好设置」，这里不再显示；保存时原样带回，避免把
    // 管理员设的默认值清空（后端把空串当成「改成默认」）。
    system_prompt: settings.value?.system_prompt || '',
    timeout_seconds: Number(form.timeout_seconds) || 60,
    thinking_mode: form.thinking_mode,
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
  form.timeout_seconds = data.timeout_seconds
  form.thinking_mode = normalizeThinkingMode(data.thinking_mode)
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
/** 点列表里的一条 = 填进输入框（仍要「保存设置」才生效）。 */
function pickModel(name: string) {
  form.model = name
  modelsOpen.value = false
  notice.value = `已选用 ${name}，点「保存设置」后生效。`
}

/**
 * 只拉模型列表：复用「测试连接」的接口（它会 GET /models，服务端没实现列表时
 * 退一步用一次最小对话），拿到名字后渲染成可点的清单。
 */
async function pullModels() {
  pulling.value = true
  errorMsg.value = ''
  notice.value = ''
  statusText.value = ''
  try {
    const result = await testAssistantSettings(payload())
    testResult.value = result
    if (result.ok) {
      const names = result.models || []
      if (!names.length) {
        notice.value = '连接正常，但这个服务没有返回模型列表，直接填模型名即可'
      } else {
        modelsOpen.value = true
        // 当前填的名字不在服务器上时，顺手回填一个真能用的，省得选完还报 404
        const stale = !form.model || !names.includes(form.model)
        if (stale) {
          const suggested = form.provider === 'ollama' ? suggestLocalModel(names) : names[0]
          if (suggested) form.model = suggested
        }
        notice.value = stale && form.model
          ? `已拉取 ${names.length} 个模型，并回填了「${form.model}」（点列表里任意一条可换，保存后生效）`
          : `已拉取 ${names.length} 个模型，点列表里的一条选用`
      }
    }
  } catch (err: any) {
    testResult.value = null
    errorMsg.value = err?.message || '拉取模型列表失败'
  } finally {
    pulling.value = false
  }
}

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
