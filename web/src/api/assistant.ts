/**
 * 「呼叫小秘」的接线层。
 *
 * 后端在 server/assistant：模型参数（服务商 / 接口地址 / API Key / 模型名）由
 * 管理员在「系统配置 → AI 助手」里填，浏览器只拿得到掩码——对话请求由后端
 * 转发，前端从头到尾接触不到 API Key。
 *
 * 「通用样式」：服务端一律按 OpenAI 兼容协议说话（POST {地址}/chat/completions），
 * 所以换服务商、换模型、接自建网关都只是后台改几个输入框的事，这个文件不用动。
 */
import request from './request'

/** 小秘对话里的一条消息（role 口径与 OpenAI 兼容接口一致，可直接转发给后端）。 */
export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 后端给出的接入状态（不含接口地址与密钥：这个接口人人可读）。
 * - `enabled`：管理员开了开关；
 * - `ready`：地址/模型/密钥齐了；
 * - `active`：两者都成立，说话时真的会走模型；
 * - `reason`：还不能用的一句话原因，直接显示给用户。
 */
export interface AssistantStatus {
  enabled: boolean
  ready: boolean
  active: boolean
  provider: string
  provider_label: string
  model: string
  reason: string
  /** 后端等模型回答的超时（秒）。前端按它放宽自己的请求超时。 */
  timeout_seconds?: number
  /** 后台偏好里的「思考过程」默认档位（off/brief/full），面板据此初始化选择器。 */
  thinking_mode?: AssistantThinkingMode
}

/**
 * 对话里「思考过程」的显示口径（与 server/assistant/thinking.go 一一对应）：
 * - `off`   只有对话：思维链不返回给浏览器；
 * - `brief` 简洁思考：一小行，附在回答下面；
 * - `full`  详细思考过程：整段折叠展示。
 *
 * 三种档位只影响「显不显示模型先想的那一段」，模型本身仍然会想——面板上的
 * 文案照实说，免得用户以为「只有对话」是让它别想。
 */
export type AssistantThinkingMode = 'off' | 'brief' | 'full'

/** 读一次接入状态；后端异常时返回 null（面板按「未接入」处理）。 */
export async function getAssistantStatus(): Promise<AssistantStatus | null> {
  const res = await request.get('/api/assistant/status')
  if (res.data?.code === 0 && res.data.data) {
    return res.data.data as AssistantStatus
  }
  return null
}

/**
 * 面板上选定的「要附上的工作数据」口径。
 *
 * 不传（或 option/keyword 都空）时，后端会看一眼用户这句话里有没有「上周」
 * 「近 7 天」这类时间词，认得出来就自动附数据、认不出来就按普通聊天走。
 * option 与「已完成」页的筛选同名，另有 `open` 表示「当前还没做完」。
 */
export interface AssistantDigestInput {
  option: string
  from?: string
  to?: string
  keyword?: string
}

/** 后端回报的「这一轮附上了什么数据」，面板据此显示一行摘要。 */
export interface AssistantDigestView {
  option: string
  label: string
  start?: string
  end?: string
  keyword?: string
  /** 用户用 `@清单名` 点名了哪一栏（没点名时是空）。 */
  list_name?: string
  completed: number
  open: number
  overdue: number
  notes: number
  lists: number
  courses?: number
  truncated: boolean
}

/** 存进记事本后回给面板的东西：新记事的 id 与服务端自动生成的标题、标签。 */
export interface AssistantSavedNote {
  id: number
  title: string
  tags: string[]
  list_id: number
  list_name: string
}

/**
 * 把小秘的一段回答存进记事本（用户 2026-10-17：「ai聊天输出内容增加 保存到
 * 记事本功能，自动生成标签」）。
 *
 * 标题、标签、备注全由服务端按内容生成，前端只管把三样东西递过去：回答原文、
 * 用户问的那句话（用来认「周报/账单」这类主题）、这一轮的数据口径。不需要模型，
 * 后台没接模型的机器上照样能存。
 */
export async function saveAssistantNote(input: {
  text: string
  question?: string
  hint?: string
}): Promise<AssistantSavedNote> {
  const res = await request.post('/api/assistant/notes', {
    text: input.text,
    question: input.question || '',
    hint: input.hint || '',
  })
  if (res.data?.code !== 0) {
    throw new Error(res.data?.message || '保存失败')
  }
  const data = res.data?.data || {}
  return {
    id: Number(data.id || 0),
    title: String(data.title || ''),
    tags: Array.isArray(data.tags) ? data.tags.map((tag: unknown) => String(tag)) : [],
    list_id: Number(data.list_id || 0),
    list_name: String(data.list_name || ''),
  }
}

/** 一轮回复：`mode='draft'` 表示后台还没接模型，内容是服务端按记录生成的草稿。 */
export interface AssistantReply {
  reply: string
  mode: 'model' | 'draft'
  model: string
  reason: string
  digest: AssistantDigestView | null
  /** 这一轮的思维链（`thinking_mode='off'` 或上游没给时是空串）。 */
  thinking: string
  /** 思维链被后端截断过（简洁思考的口径），面板据此加省略号。 */
  thinking_truncated: boolean
  /** 后端实际用的档位（请求里没带时就是后台偏好）。 */
  thinking_mode: AssistantThinkingMode
}

/**
 * 把整段对话发给后端模型，取回这一轮的回复；`digest` 非空时会把工作数据一起
 * 附上（周报 / 月报 / 工作清单这些问法必须带数据，否则模型只能凭空编）。
 *
 * 超时单独放宽：模型回答常常要十几秒到一分钟，全局那 30 秒会把它掐断，
 * 而用户看到的是「网络错误」——排查方向完全被带偏。默认 180 秒只是兜底，
 * 面板会按后端配置（系统配置 → AI 助手 → 请求超时）传更合适的值：
 * 本地模型（Ollama）首次说话要等模型加载，可能好几分钟。
 */
export async function chatWithAssistant(
  messages: AssistantMessage[],
  digest?: AssistantDigestInput | null,
  timeoutMs = 180000,
  thinking?: AssistantThinkingMode,
): Promise<AssistantReply> {
  const res = await request.post(
    '/api/assistant/chat',
    { messages, ...(digest ? { digest } : {}), ...(thinking ? { thinking } : {}) },
    { timeout: timeoutMs },
  )
  if (res.data?.code !== 0) {
    throw new Error(res.data?.message || '对话失败')
  }
  const data = res.data?.data || {}
  const reply = String(data.reply || '').trim()
  if (!reply) {
    throw new Error('模型没有返回内容')
  }
  return {
    reply,
    mode: data.mode === 'draft' ? 'draft' : 'model',
    model: String(data.model || ''),
    reason: String(data.reason || ''),
    digest: (data.digest as AssistantDigestView | null) ?? null,
    thinking: String(data.thinking || '').trim(),
    thinking_truncated: data.thinking_truncated === true,
    thinking_mode: normalizeThinkingMode(data.thinking_mode),
  }
}

/** 认不出的档位一律按「简洁思考」：前端不该因为后端多给一个值就崩掉。 */
export function normalizeThinkingMode(value: unknown): AssistantThinkingMode {
  return value === 'off' || value === 'full' || value === 'brief' ? value : 'brief'
}

/** 三个档位的中文名与说明，后台下拉与对话面板共用一份，避免两处写法不一致。 */
export const THINKING_MODES: { value: AssistantThinkingMode; label: string; note: string }[] = [
  { value: 'off', label: '只有对话', note: '不显示思考过程（模型仍然会先想）' },
  { value: 'brief', label: '简洁思考', note: '回答下面附一小行思考要点' },
  { value: 'full', label: '详细思考过程', note: '整段思维链，折叠在「思考过程」里' },
]

/** 一个服务商预设：只给默认地址、常见模型名与密钥申请入口，控件本身是通用的。 */
export interface AssistantProviderPreset {
  id: string
  label: string
  base_url: string
  models: string[]
  key_required?: boolean
  key_url?: string
  note?: string
}

/** 「系统配置 → AI 助手」面板的数据。`api_key` 是掩码（例如 `sk-a…3456`）。 */
export interface AssistantSettings {
  enabled: boolean
  provider: string
  base_url: string
  api_key: string
  api_key_set: boolean
  model: string
  system_prompt: string
  timeout_seconds: number
  /** 「对话里显示思考过程」的后台偏好。 */
  thinking_mode: AssistantThinkingMode
  /** 后端给出的可选项（与 THINKING_MODES 同序），下拉直接用它。 */
  thinking_options: string[]
  effective_base_url: string
  ready: boolean
  active: boolean
  reason: string
  default_system_prompt: string
  providers: AssistantProviderPreset[]
}

/** 保存入参（不传 api_key 表示「不改密钥」，要清空用 clear_api_key）。 */
export interface AssistantSettingsInput {
  enabled: boolean
  provider: string
  base_url: string
  api_key?: string
  clear_api_key?: boolean
  model: string
  system_prompt: string
  timeout_seconds: number
  thinking_mode: AssistantThinkingMode
}

/** 连通性测试结果：`ok` 表达成败（HTTP 仍是 200，失败原因在 `detail` 里）。 */
export interface AssistantTestResult {
  ok: boolean
  detail: string
  models?: string[]
  endpoint?: string
  latency_ms?: number
  via?: 'models' | 'chat'
}

/**
 * 把 axios 的报错变成一句人话。
 *
 * 先看服务端 envelope（`{ code, message }`）里的 message——那才是「为什么失败」
 * （例如「启用 AI 助手前请先补全：还没有填写模型名称」）；其次是 Error 自带
 * 的消息；最后才用兜底文案。不能反过来判断 `err instanceof Error`：axios 的
 * 「Request failed with status code 400」同样是 Error，会把服务端说明盖掉。
 */
function unwrapError(err: any, fallback: string): never {
  throw new Error(err?.response?.data?.message || err?.message || fallback)
}

/** 管理面板：读完整设置（密钥是掩码）。 */
export async function getAssistantSettings(): Promise<AssistantSettings> {
  try {
    const res = await request.get('/api/assistant/admin/settings')
    if (res.data?.code !== 0) {
      throw new Error(res.data?.message || '加载 AI 配置失败')
    }
    return res.data.data as AssistantSettings
  } catch (err: any) {
    unwrapError(err, '加载 AI 配置失败')
  }
}

/** 管理面板：保存（任何一项不合法都会被整体拒绝，不会留下半套配置）。 */
export async function saveAssistantSettings(input: AssistantSettingsInput): Promise<AssistantSettings> {
  try {
    const res = await request.put('/api/assistant/admin/settings', input)
    if (res.data?.code !== 0) {
      throw new Error(res.data?.message || '保存失败')
    }
    return res.data.data as AssistantSettings
  } catch (err: any) {
    unwrapError(err, '保存失败')
  }
}

/** 「检测本机 Ollama」里单条候选地址的探测结果。 */
export interface AssistantOllamaAttempt {
  base_url: string
  label: string
  ok: boolean
  detail?: string
  models?: string[]
}

/** 「检测本机 Ollama」的结果：`found` 为真时 `base_url` / `models` 可以直接填进表单。 */
export interface AssistantOllamaDetection {
  found: boolean
  base_url?: string
  label?: string
  models?: string[]
  attempts: AssistantOllamaAttempt[]
}

/**
 * 管理面板：检测本机 Ollama。
 *
 * 为什么需要它：服务端跑在容器里时 127.0.0.1 指的是容器自己，Ollama 却装在
 * 宿主上；这个接口拿「管理员访问本服务的地址」等几条候选挨个试一遍，把真能用
 * 的那条带回来，顺带返回它上面的模型列表（可当模型输入框的候选）。
 */
export async function detectLocalOllama(): Promise<AssistantOllamaDetection> {
  try {
    const res = await request.post('/api/assistant/admin/detect-ollama', {}, { timeout: 60000 })
    if (res.data?.code !== 0) {
      throw new Error(res.data?.message || '检测本机 Ollama 失败')
    }
    return res.data.data as AssistantOllamaDetection
  } catch (err: any) {
    unwrapError(err, '检测本机 Ollama 失败')
  }
}

/**
 * 管理面板：测试连接。传 `input` 可以测**还没保存**的草稿（密钥留空即沿用
 * 已保存的那个）；不传则测当前已保存的设置。
 *
 * 会真的打一次上游：先拉模型列表，服务商没有这个接口时退一步发一次最小对话。
 */
export async function testAssistantSettings(input?: AssistantSettingsInput): Promise<AssistantTestResult> {
  try {
    const res = await request.post('/api/assistant/admin/test', input ?? {}, { timeout: 180000 })
    if (res.data?.code !== 0) {
      throw new Error(res.data?.message || '测试连接失败')
    }
    return res.data.data as AssistantTestResult
  } catch (err: any) {
    unwrapError(err, '测试连接失败')
  }
}

/** 「我的系统提示词」：空串表示还没写，会回退到 default_system_prompt。 */
export interface AssistantPromptPrefs {
  system_prompt: string
  default_system_prompt: string
  max_length: number
}

/** 读自己的系统提示词（登录用户即可，不需要管理员）。 */
export function getPromptPrefs() {
  return request.get('/api/assistant/prompts')
}

/** 写自己的系统提示词；传空串 = 恢复默认（管理员设的那份）。 */
export function savePromptPrefs(system_prompt: string) {
  return request.put('/api/assistant/prompts', { system_prompt })
}

/** 写自己给小秘起的名字；传空串 = 回到「小秘」。 */
export function saveAssistantName(assistant_name: string) {
  return request.put('/api/assistant/prompts', { assistant_name })
}
