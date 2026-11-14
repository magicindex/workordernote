<template>
  <div class="divide-y divide-border" data-webdav-settings>
    <!-- 第一行：启用 + 测试连接 + 状态 -->
    <div class="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-3" data-webdav-enable-row>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-foreground">备份到 WebDAV</p>
        <p class="mt-1 text-xs text-muted-foreground">把同一份备份文件再推一份到 WebDAV（坚果云、群晖、Nextcloud 等）</p>
      </div>
      <div class="flex flex-wrap items-center gap-2 sm:shrink-0" data-webdav-test>
        <button
          type="button"
          role="switch"
          :aria-checked="enabled"
          :disabled="saving"
          class="inline-flex h-6 w-11 shrink-0 items-center overflow-hidden rounded-full p-0.5 transition-colors focus:outline-none focus:ring-4 focus:ring-brand-500/20"
          :class="[enabled ? 'bg-brand-500' : 'bg-muted', saving ? 'cursor-not-allowed opacity-60' : 'cursor-pointer']"
          data-webdav-enabled
          aria-label="备份到 WebDAV"
          @click="toggleEnabled"
        >
          <span class="h-5 w-5 shrink-0 rounded-full bg-white shadow transition-transform" :class="enabled ? 'translate-x-5' : 'translate-x-0'"></span>
        </button>
        <button
          class="btn-secondary !px-3 !py-2 text-xs"
          :disabled="!enabled || testing || saving"
          :title="enabled ? '测试当前 WebDAV 配置' : '请先开启「备份到 WebDAV」'"
          data-webdav-test-button
          @click="testConnection"
        >
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <span
          class="inline-flex items-center gap-1.5 text-xs font-semibold"
          :class="!enabled ? 'text-muted-foreground' : result?.ok ? 'text-emerald-600 dark:text-emerald-400' : result ? 'text-destructive' : 'text-muted-foreground'"
          data-webdav-test-status
          :data-state="!enabled ? 'disabled' : testing ? 'testing' : result ? (result.ok ? 'ok' : 'error') : 'idle'"
        >
          <span class="h-2 w-2 rounded-full" :class="!enabled ? 'bg-muted-foreground/40' : testing ? 'bg-amber-400' : result?.ok ? 'bg-emerald-500' : result ? 'bg-rose-500' : 'bg-muted-foreground/50'"></span>
          <span v-if="!enabled">未启用</span>
          <span v-else-if="testing">测试中…</span>
          <span v-else-if="result?.ok">连接正常 · {{ result.latency }} ms</span>
          <span v-else-if="result">连接失败</span>
          <span v-else>未测试</span>
        </span>
      </div>
    </div>

    <!-- 服务器地址 + 路径同一行、分两个模块 -->
    <div class="px-4 py-3" data-webdav-address-row>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block text-xs font-bold text-muted-foreground">
          服务器地址
          <input
            v-model="server"
            class="input-field mt-1.5 !py-2"
            placeholder="http://192.168.3.202:5005"
            data-webdav-server
            @input="touch"
          />
        </label>
        <label class="block text-xs font-bold text-muted-foreground">
          路径
          <div class="mt-1.5 flex items-center gap-2">
            <input
              v-model="path"
              class="input-field min-w-0 flex-1 !py-2 font-mono !text-[12px]"
              placeholder="vol1/1000/备份文件/工作序记备份/workordernote"
              data-webdav-path
              @input="touch"
            />
            <button
              class="btn-secondary shrink-0 !px-3 !py-2 text-xs"
              :disabled="!enabled || browsing || saving"
              data-webdav-browse
              @click="openBrowse"
            >查看远程目录</button>
          </div>
        </label>
      </div>
      <p class="mt-1.5 text-[11px] text-muted-foreground">路径会接在服务器地址后面；可直接填，也可从远程目录里点选。</p>
    </div>

    <!-- 用户名 / 密码 -->
    <div class="px-4 py-3">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block text-xs font-bold text-muted-foreground">
          WebDAV 用户名
          <input v-model="username" class="input-field mt-1.5 !py-2" placeholder="不需要认证时留空" data-webdav-username @input="touch" />
        </label>
        <label class="block text-xs font-bold text-muted-foreground">
          WebDAV 密码
          <input v-model="password" type="password" class="input-field mt-1.5 !py-2" placeholder="Basic 认证密码 / 应用密码" data-webdav-password @input="touch" />
        </label>
      </div>
      <p class="mt-1.5 text-[11px] text-muted-foreground">仅管理员可见；不会同步到另一台设备。</p>
    </div>

    <!-- 证书 + 保存 -->
    <div class="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-foreground">跳过 HTTPS 证书校验</p>
        <p class="mt-1 text-xs text-muted-foreground">自签名证书、或用 IP 访问而证书里没有对应 IP 时打开；只在可信内网开启。</p>
      </div>
      <div class="flex flex-wrap items-center gap-2 sm:shrink-0">
        <button
          type="button"
          role="switch"
          :aria-checked="insecure"
          :disabled="saving"
          class="inline-flex h-6 w-11 shrink-0 items-center overflow-hidden rounded-full p-0.5 transition-colors focus:outline-none focus:ring-4 focus:ring-brand-500/20"
          :class="[insecure ? 'bg-brand-500' : 'bg-muted', saving ? 'cursor-not-allowed opacity-60' : 'cursor-pointer']"
          data-webdav-insecure
          aria-label="跳过 HTTPS 证书校验"
          @click="insecure = !insecure; touch()"
        >
          <span class="h-5 w-5 shrink-0 rounded-full bg-white shadow transition-transform" :class="insecure ? 'translate-x-5' : 'translate-x-0'"></span>
        </button>
        <button class="btn-brand !px-4 !py-2 text-xs" :disabled="saving" data-webdav-save @click="saveConnection(true)">
          {{ saving ? '保存中…' : '保存连接设置' }}
        </button>
      </div>
    </div>

    <p v-if="notice" class="px-4 pb-3 text-xs font-medium" :class="noticeOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'" data-webdav-notice>{{ notice }}</p>

    <!-- 远程目录逐级选择弹窗 -->
    <Teleport to="body">
      <div v-if="browseOpen" class="fixed inset-0 z-[85] flex items-center justify-center p-3 sm:p-6" data-webdav-browse-panel>
        <div class="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" @click="browseOpen = false"></div>
        <div class="surface-modal relative z-10 flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl">
          <div class="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <div class="min-w-0">
              <h3 class="text-sm font-extrabold text-foreground">选择远程目录</h3>
              <p class="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">当前：/{{ browsePath || '（根目录）' }}</p>
            </div>
            <button class="row-action !opacity-100" aria-label="关闭" @click="browseOpen = false">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor"><path d="m6 6 12 12M18 6 6 18" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="min-h-[12rem] flex-1 overflow-y-auto px-4 py-3 sm:px-5">
            <p v-if="browseError" class="break-all text-xs font-medium leading-5 text-destructive">{{ browseError }}</p>
            <div v-else-if="browsing" class="py-8 text-center text-xs text-muted-foreground">读取远程目录…</div>
            <div v-else class="space-y-1">
              <button
                v-for="dir in browseDirs"
                :key="dir.path"
                class="flex w-full items-center gap-2 rounded-xl border border-border/70 px-3 py-2 text-left text-xs font-semibold text-foreground transition hover:border-brand-500/40 hover:bg-brand-500/5"
                data-webdav-browse-dir
                @click="chooseDir(dir)"
              >
                <span class="text-base">📁</span>
                <span class="min-w-0 flex-1 break-all">{{ dir.name }}</span>
                <span class="text-muted-foreground">›</span>
              </button>
              <p v-if="!browseDirs.length" class="py-8 text-center text-xs text-muted-foreground">这个目录下没有可访问的子目录</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-5">
            <button class="btn-secondary !px-3 !py-2 text-xs" :disabled="browsing || !browsePath" data-webdav-parent @click="goParent">
              ← 上一级
            </button>
            <div class="flex flex-wrap gap-2">
              <button class="btn-secondary !px-3 !py-2 text-xs" @click="browseOpen = false">取消</button>
              <button class="btn-brand !px-4 !py-2 text-xs" :disabled="browsing || !!browseError" data-webdav-use-current @click="confirmBrowse">
                确定选择
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getSystemConfigMeta, updateConfig } from '../api/config'
import { browseWebDAV, testWebDAV, type WebDAVDir } from '../api/backup'

const enabled = ref(false)
const server = ref('')
const path = ref('')
const username = ref('')
const password = ref('')
const insecure = ref(false)
const dirty = ref(false)
const saving = ref(false)
const notice = ref('')
const noticeOk = ref(true)
const testing = ref(false)
const result = ref<{ ok: boolean; latency: number; message: string } | null>(null)
const browseOpen = ref(false)
const browsing = ref(false)
const browsePath = ref('')
const browseParent = ref('')
const browseDirs = ref<WebDAVDir[]>([])
const browseError = ref('')

function touch() {
  dirty.value = true
  notice.value = ''
  result.value = null
}

function normalizeServer(raw: string): { server: string; basePath: string } | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return { server: `${u.protocol}//${u.host}`, basePath: u.pathname.replace(/^\/+|\/+$/g, '') }
  } catch {
    return null
  }
}

function normalizePath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+|\/+$/g, '')
}

// URL.pathname 会把中文路径编码成 %E5…；显示/保存前要还原成可读路径，
// 否则再拼一次 URL 会变成二次编码。
function decodePath(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

onMounted(load)

async function load() {
  try {
    const res = await getSystemConfigMeta()
    const items = Array.isArray(res.data?.data) ? res.data.data : []
    const val = (key: string) => String(items.find((it: { key: string }) => it.key === key)?.value ?? '')
    enabled.value = val('backup_webdav_enabled') === 'true'
    username.value = val('backup_webdav_username')
    password.value = val('backup_webdav_password')
    insecure.value = val('backup_webdav_insecure') === 'true'
    const rawUrl = val('backup_webdav_url')
    const rawDir = val('backup_webdav_dir')
    const parsed = normalizeServer(rawUrl)
    if (parsed) {
      server.value = parsed.server
      path.value = normalizePath([decodePath(parsed.basePath), normalizePath(rawDir)].filter(Boolean).join('/'))
    } else {
      server.value = rawUrl
      path.value = normalizePath(rawDir)
    }
    dirty.value = false
  } catch {
    noticeOk.value = false
    notice.value = '读取 WebDAV 配置失败'
  }
}

async function toggleEnabled() {
  if (saving.value) return
  saving.value = true
  notice.value = ''
  try {
    const next = !enabled.value
    const res = await updateConfig('backup_webdav_enabled', String(next))
    if (res.data?.code === 0) {
      enabled.value = next
      result.value = null
      if (!next) browseOpen.value = false
      noticeOk.value = true
      notice.value = next ? '已开启 WebDAV 备份' : '已关闭 WebDAV 备份'
    } else {
      noticeOk.value = false
      notice.value = res.data?.message || '保存失败'
    }
  } catch (err: any) {
    noticeOk.value = false
    notice.value = err.response?.data?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function saveConnection(showNotice: boolean): Promise<boolean> {
  if (saving.value) return false
  const parsed = normalizeServer(server.value)
  if (!parsed) {
    noticeOk.value = false
    notice.value = '服务器地址不合法，请填写 http:// 或 https:// 开头的地址'
    return false
  }
  let nextPath = normalizePath(path.value)
  const basePath = decodePath(parsed.basePath)
  if (basePath && nextPath !== basePath && !nextPath.startsWith(basePath + '/')) nextPath = normalizePath(basePath + '/' + nextPath)
  saving.value = true
  if (showNotice) notice.value = ''
  try {
    const writes = [
      ['backup_webdav_url', parsed.server],
      ['backup_webdav_dir', nextPath],
      ['backup_webdav_username', username.value.trim()],
      ['backup_webdav_password', password.value],
      ['backup_webdav_insecure', String(insecure.value)],
    ] as const
    for (const [key, value] of writes) {
      const res = await updateConfig(key, value)
      if (res.data?.code !== 0) {
        noticeOk.value = false
        notice.value = res.data?.message || '保存失败'
        return false
      }
    }
    server.value = parsed.server
    path.value = nextPath
    dirty.value = false
    noticeOk.value = true
    if (showNotice) notice.value = '已保存 WebDAV 连接设置'
    return true
  } catch (err: any) {
    noticeOk.value = false
    notice.value = err.response?.data?.message || '保存失败'
    return false
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  if (!enabled.value || testing.value) return
  if (dirty.value && !(await saveConnection(false))) return
  testing.value = true
  result.value = null
  try {
    const res = await testWebDAV()
    if (res.data?.code === 0) {
      result.value = { ok: true, latency: Number(res.data.data?.latency_ms || 0), message: '连接正常' }
    } else {
      result.value = { ok: false, latency: 0, message: res.data?.message || '连接失败' }
    }
  } catch (err: any) {
    result.value = { ok: false, latency: 0, message: err.response?.data?.message || '连接失败' }
  } finally {
    testing.value = false
  }
}

async function openBrowse() {
  if (!enabled.value || browsing.value) return
  if (dirty.value && !(await saveConnection(false))) return
  browseOpen.value = true
  browseError.value = ''
  browseDirs.value = []
  browsePath.value = ''
  browseParent.value = ''
  // 从已保存地址/路径的“根”开始，一级一级往下点。
  await loadBrowse('')
}

async function loadBrowse(target: string) {
  browsing.value = true
  browseError.value = ''
  try {
    const res = await browseWebDAV(target)
    if (res.data?.code === 0) {
      browsePath.value = String(res.data.data?.path || '')
      browseParent.value = String(res.data.data?.parent || '')
      browseDirs.value = Array.isArray(res.data.data?.dirs) ? res.data.data.dirs : []
    } else {
      browseError.value = res.data?.message || '读取远程目录失败'
    }
  } catch (err: any) {
    browseError.value = err.response?.data?.message || '读取远程目录失败'
  } finally {
    browsing.value = false
  }
}

async function chooseDir(dir: WebDAVDir) {
  await loadBrowse(dir.path)
}

async function goParent() {
  if (!browsePath.value) return
  await loadBrowse(browseParent.value)
}

function confirmBrowse() {
  if (browseError.value) return
  path.value = normalizePath(browsePath.value)
  dirty.value = true
  browseOpen.value = false
  noticeOk.value = true
  notice.value = `已选择路径：${path.value || '（根目录）'}（记得点「保存连接设置」）`
}

</script>
