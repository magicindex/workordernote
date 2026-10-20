<template>
  <div class="surface rounded-2xl overflow-hidden">
    <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6 sm:py-5">
      <h2 class="text-sm font-bold text-foreground sm:text-base">双机同步</h2>
      <span class="badge" :class="directionBadgeClass">{{ directionLabel }}</span>
      <span v-if="settings?.running" class="badge bg-blue-500/12 text-blue-600 dark:text-blue-300">同步中…</span>
    </div>

    <div v-if="loading" class="space-y-3 p-4 sm:p-6">
      <div class="h-20 rounded-xl bg-muted animate-pulse"></div>
      <div class="h-10 rounded-xl bg-muted animate-pulse"></div>
    </div>

    <div v-else class="space-y-5 p-4 sm:p-6">
      <p class="text-xs leading-5 text-muted-foreground">
        在另一台装了「工作序记」的机器之间同步<strong class="text-foreground">清单、任务、记事、完成记录、信用卡账单、课程表、个人偏好与站点设置</strong>。
        账号按<strong class="text-foreground">用户名</strong>配对：本机有、对端没有的账号，其数据会被跳过并在结果里列出（不会在对端自动建账号）。
        两台机器的<strong class="text-foreground">通信令牌必须填成同一个值</strong>，否则会以 401 拒绝。
        <strong class="text-foreground">不同步的只有凭据</strong>：账号密码、API Key、同步令牌、JWT 密钥，
        以及通知渠道绑定（邮箱/短信/机器人凭据）和投递记录——它们属于这台机器的运行环境。
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="text-xs font-bold text-foreground">同步方向</span>
          <select v-model="form.direction" class="input-field !py-2 mt-1.5" :disabled="busy">
            <option value="off">关闭同步</option>
            <option value="push">单向：本机 → 对端</option>
            <option value="pull">单向：对端 → 本机</option>
            <option value="both">双向同步</option>
          </select>
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground">{{ directionHint }}</span>
        </label>

        <label class="block">
          <span class="text-xs font-bold text-foreground">自动同步</span>
          <select v-model.number="form.interval_minutes" class="input-field !py-2 mt-1.5" :disabled="busy">
            <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            定时同步按本机时钟计时；也可以随时点「立即同步」。
          </span>
        </label>

        <label class="block sm:col-span-2">
          <span class="text-xs font-bold text-foreground">对端地址</span>
          <input
            v-model.trim="form.peer_url"
            type="text"
            data-sync-peer-url
            inputmode="url"
            class="input-field !py-2 mt-1.5 font-mono text-xs"
            placeholder="http://192.168.1.10:8906"
            :disabled="busy || !syncOn"
          />
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            对端「工作序记」的访问地址（含端口）；不写 http:// 时会自动补上。
          </span>
        </label>

        <div class="sm:col-span-2">
          <span class="text-xs font-bold text-foreground">通信令牌</span>
          <div class="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              v-model.trim="form.token"
              :type="tokenVisible ? 'text' : 'password'"
              class="input-field !py-2 min-w-[12rem] flex-1 font-mono text-xs"
              autocomplete="off"
              spellcheck="false"
              placeholder="两台机器填同一个值"
              :disabled="busy || !syncOn"
            />
            <button type="button" class="btn-secondary !h-10 !px-3" @click="tokenVisible = !tokenVisible">
              {{ tokenVisible ? '隐藏' : '显示' }}
            </button>
            <button type="button" class="btn-secondary !h-10 !px-3" @click="copyToken">复制</button>
            <button type="button" class="btn-secondary !h-10 !px-3" :disabled="busy" @click="regenerateToken">重新生成</button>
          </div>
          <span class="mt-1 block text-[11px] leading-4 text-muted-foreground">
            两台机器必须填同一个值：点「复制」把本机的粘到对端即可。
            本机实例标识 <code class="font-mono">{{ settings?.instance_id || '—' }}</code>；
            「重新生成」后必须把新令牌填到对端，否则两边会互相拒绝。
          </span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-brand" :disabled="!dirty || busy" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
        <button
          type="button"
          class="btn-secondary !h-10"
          :disabled="busy || !settings || !settings.peer_url"
          @click="testConnection"
        >
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button
          type="button"
          class="btn-secondary !h-10"
          :disabled="busy || !syncOn"
          @click="syncNow"
        >
          {{ syncing ? '同步中…' : '立即同步' }}
        </button>
        <span v-if="statusText" class="text-xs font-semibold text-emerald-600 dark:text-emerald-300">{{ statusText }}</span>
      </div>

      <p v-if="errorMsg" class="rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">{{ errorMsg }}</p>
      <p v-if="notice" class="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs leading-5 text-emerald-600 dark:text-emerald-300">{{ notice }}</p>
      <p v-if="dirty" class="text-[11px] font-semibold text-amber-600 dark:text-amber-300">有未保存的改动</p>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-xl border border-border bg-surface/60 p-3">
          <p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground">本机</p>
          <p class="mt-1.5 text-xs text-foreground">版本 {{ settings?.app_version || '—' }}</p>
          <p class="mt-1 text-xs text-muted-foreground">账号：{{ localUsers.length ? localUsers.join('、') : '—' }}</p>
        </div>
        <div class="rounded-xl border border-border bg-surface/60 p-3">
          <p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-muted-foreground">对端</p>
          <p class="mt-1.5 text-xs text-foreground">{{ settings?.peer_summary || '尚未通信' }}</p>
          <p class="mt-1 break-all text-xs text-muted-foreground">
            实例标识：<code class="font-mono">{{ settings?.peer_instance_id || '—' }}</code>
          </p>
        </div>
      </div>

      <!-- 测试连接结果 -->
      <div v-if="testResult" class="rounded-xl border border-border bg-surface/60 p-3">
        <p class="text-xs font-bold text-foreground">
          连接正常：{{ testResult.app_name }} {{ testResult.app_version }}
          <span v-if="testResult.site_title" class="text-muted-foreground">（{{ testResult.site_title }}）</span>
        </p>
        <p class="mt-1.5 text-xs text-muted-foreground">
          对端数据：清单 {{ testResult.lists }} / 提醒 {{ testResult.reminders }} / 完成记录 {{ testResult.completions }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          对端账号：{{ peerUsers.length ? peerUsers.join('、') : '—' }}
        </p>
        <p class="mt-1 text-xs" :class="missingUsers.length ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'">
          能配上的账号：{{ matchedUsers.length ? matchedUsers.join('、') : '无' }}
          <template v-if="missingUsers.length">
            ；对端有、本机没有：{{ missingUsers.join('、') }}（这些账号的数据会被跳过）
          </template>
        </p>
        <p class="mt-1 text-xs" :class="skewWarning ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground'">
          两端时钟差：{{ testResult.clock_skew_seconds }} 秒{{ skewWarning ? '（超过 60 秒，双向同步可能误判新旧，请校准时间）' : '' }}
        </p>
      </div>

      <!-- 上次同步 -->
      <div v-if="last" class="rounded-xl border border-border bg-surface/60 p-3">
        <p class="flex flex-wrap items-center gap-2 text-xs font-bold text-foreground">
          上次同步 {{ formatTime(last.at) }}
          <span class="badge" :class="last.status === 'ok' ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300' : 'bg-destructive/12 text-destructive'">
            {{ last.status === 'ok' ? '成功' : '失败' }}
          </span>
          <span class="text-[11px] font-medium text-muted-foreground">{{ last.trigger === 'auto' ? '自动' : '手动' }}</span>
        </p>
        <p v-if="last.message" class="mt-1.5 text-xs leading-5" :class="last.status === 'ok' ? 'text-muted-foreground' : 'text-destructive'">
          {{ last.message }}
        </p>
        <div v-if="last.pulled" class="mt-1.5 text-xs text-muted-foreground">从对端拉取：{{ describeStats(last.pulled) }}</div>
        <div v-if="last.pushed" class="mt-1.5 text-xs text-muted-foreground">推送到对端：{{ describeStats(last.pushed) }}</div>
        <p v-if="unmapped.length" class="mt-1.5 text-xs text-amber-600 dark:text-amber-300">
          对端有、本机没有的账号：{{ unmapped.join('、') }}（这些数据被跳过）
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  getSyncSettings,
  regenerateSyncToken,
  runSyncNow,
  saveSyncSettings,
  testSyncPeer,
} from '../api/sync'
import type { SyncApplyStats, SyncDirection, SyncResult, SyncSettings, SyncTestResult } from '../api/sync'

const settings = ref<SyncSettings | null>(null)
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const syncing = ref(false)
const errorMsg = ref('')
const notice = ref('')
const statusText = ref('')
const tokenVisible = ref(false)
const testResult = ref<SyncTestResult | null>(null)

const form = reactive({
  direction: 'off' as SyncDirection,
  peer_url: '',
  token: '',
  interval_minutes: 0,
})

const intervalOptions = [
  { value: 0, label: '仅手动同步' },
  { value: 5, label: '每 5 分钟' },
  { value: 15, label: '每 15 分钟' },
  { value: 30, label: '每 30 分钟' },
  { value: 60, label: '每小时' },
  { value: 180, label: '每 3 小时' },
  { value: 720, label: '每 12 小时' },
  { value: 1440, label: '每天' },
]

// 服务端可能把空列表序列化成 null（Go 的 nil 切片），模板里直接取 .length 会
// 抛异常并让整块面板白掉——统一在这里兜底。
function asList(value?: string[] | null): string[] {
  return Array.isArray(value) ? value : []
}

const syncOn = computed(() => form.direction !== 'off')
const busy = computed(() => saving.value || testing.value || syncing.value)
const dirty = computed(() => {
  const current = settings.value
  if (!current) return false
  return (
    form.direction !== current.direction ||
    form.peer_url !== current.peer_url ||
    // 令牌留空表示「不改」，所以空值不算改动。
    (form.token !== '' && form.token !== current.token) ||
    form.interval_minutes !== current.interval_minutes
  )
})

const directionLabel = computed(() => {
  switch (form.direction) {
    case 'push':
      return '本机 → 对端'
    case 'pull':
      return '对端 → 本机'
    case 'both':
      return '双向同步'
    default:
      return '已关闭'
  }
})

const directionBadgeClass = computed(() =>
  form.direction === 'off'
    ? 'bg-muted text-muted-foreground'
    : 'bg-brand-500/12 text-brand-600 dark:text-brand-300',
)

const directionHint = computed(() => {
  switch (form.direction) {
    case 'push':
      return '把本机的清单、任务、记事与完成记录推给对端；对端的改动不会回到本机。'
    case 'pull':
      return '把对端的数据拉回本机；本机的改动不会推给对端。适合把对端当主库。'
    case 'both':
      return '两边互相合并：同一条数据以修改时间较新的一方为准，删除会同步过去。'
    default:
      return '关闭后既不同步，也不接受对端发来的同步请求。'
  }
})

const skewWarning = computed(() => Math.abs(testResult.value?.clock_skew_seconds ?? 0) > 60)

// 列表字段统一在 computed 里兜底一次：服务端可能把空列表序列化成 null，
// 模板里任何一处直接取 .length 都会让整块面板在渲染时报错、当场消失。
const localUsers = computed(() => asList(settings.value?.local_users))
const peerUsers = computed(() => asList(testResult.value?.peer_users))
const matchedUsers = computed(() => asList(testResult.value?.matched_users))
const missingUsers = computed(() => asList(testResult.value?.missing_users))

const last = computed<SyncResult | null>(() => settings.value?.last_result ?? null)

const unmapped = computed(() => {
  const result = last.value
  if (!result) return []
  const seen = new Set<string>()
  for (const stats of [result.pulled, result.pushed]) {
    for (const name of stats?.unmapped_users ?? []) seen.add(name)
  }
  return Array.from(seen)
})

onMounted(load)

async function load(keepForm = false) {
  loading.value = true
  try {
    const res = await getSyncSettings()
    if (res.data?.code === 0) {
      applySettings(res.data.data as SyncSettings, keepForm)
    } else {
      errorMsg.value = res.data?.message || '加载同步设置失败'
    }
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '网络错误'
  } finally {
    loading.value = false
  }
}

function applySettings(data: SyncSettings, keepForm = false) {
  settings.value = data
  if (keepForm && dirty.value) return
  form.direction = data.direction
  form.peer_url = data.peer_url
  // 令牌按密码框回显（能看到长度、能点「显示」核对、能一键复制到对端）：
  // 这是管理员页面，而用户必须把本机令牌填到对端才能配对成功，藏起来只会
  // 让人不知道怎么配置。页面上另有「隐藏/显示」开关。
  form.token = data.token
  form.interval_minutes = data.interval_minutes ?? 0
}

function formatTime(raw?: string) {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('zh-CN', { hour12: false })
}

function describeStats(stats: SyncApplyStats) {
  const created = stats.lists_created + stats.reminders_created + stats.completions_created
  const updated = stats.lists_updated + stats.reminders_updated
  const removed = stats.lists_deleted + stats.reminders_deleted
  return `新增 ${created} / 更新 ${updated} / 删除 ${removed} / 跳过 ${stats.skipped}`
}

async function save() {
  saving.value = true
  errorMsg.value = ''
  notice.value = ''
  try {
    const res = await saveSyncSettings({
      direction: form.direction,
      peer_url: form.peer_url,
      token: form.token,
      interval_minutes: form.interval_minutes,
    })
    if (res.data?.code === 0) {
      applySettings(res.data.data as SyncSettings)
      notice.value = '设置已保存'
      setTimeout(() => { if (notice.value === '设置已保存') notice.value = '' }, 2500)
    } else {
      errorMsg.value = res.data?.message || '保存失败'
    }
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '网络错误'
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  errorMsg.value = ''
  notice.value = ''
  statusText.value = ''
  testResult.value = null
  try {
    const res = await testSyncPeer()
    if (res.data?.code === 0) {
      testResult.value = res.data.data as SyncTestResult
      statusText.value = '连接成功'
    } else {
      // 测试连接用已保存的设置，未保存的改动不会参与，先提醒用户。
      errorMsg.value = (res.data?.message || '连接失败') + (dirty.value ? '（请先保存设置）' : '')
    }
  } catch (err: any) {
    errorMsg.value = (err.response?.data?.message || '连接失败') + (dirty.value ? '（请先保存设置）' : '')
  } finally {
    testing.value = false
  }
}

async function syncNow() {
  syncing.value = true
  errorMsg.value = ''
  notice.value = ''
  statusText.value = ''
  try {
    const res = await runSyncNow()
    const result = res.data?.data as SyncResult | undefined
    if (result) {
      if (result.status === 'ok') {
        statusText.value = '同步完成'
      } else {
        errorMsg.value = result.message || '同步失败'
      }
    }
    // 同步会更新「对端概况 / 上次结果」，回读一次；表单里有未保存改动时不动输入框。
    await load(true)
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '同步失败'
  } finally {
    syncing.value = false
  }
}

async function regenerateToken() {
  if (!window.confirm('重新生成令牌后，必须把新令牌填到对端，否则两端会互相拒绝。确定继续？')) return
  saving.value = true
  errorMsg.value = ''
  notice.value = ''
  try {
    const res = await regenerateSyncToken()
    if (res.data?.code === 0) {
      applySettings(res.data.data as SyncSettings)
      tokenVisible.value = true
      notice.value = '已生成新令牌，请复制到对端'
    } else {
      errorMsg.value = res.data?.message || '生成失败'
    }
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '网络错误'
  } finally {
    saving.value = false
  }
}

// 局域网里应用跑在 http:// 上，navigator.clipboard 需要安全上下文（https 或
// localhost）才存在，所以必须有 execCommand 这条退路，否则「复制」在用户实际
// 使用的环境里点了没反应。
async function copyToken() {
  const value = form.token || settings.value?.token || ''
  if (!value) {
    errorMsg.value = '还没有令牌可复制'
    return
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
    } else {
      const area = document.createElement('textarea')
      area.value = value
      area.setAttribute('readonly', 'readonly')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
    }
    notice.value = '令牌已复制'
    setTimeout(() => { if (notice.value === '令牌已复制') notice.value = '' }, 2500)
  } catch {
    errorMsg.value = '复制失败，请手动选中输入框里的内容复制'
  }
}

defineExpose({ reload: () => load(true) })
</script>
