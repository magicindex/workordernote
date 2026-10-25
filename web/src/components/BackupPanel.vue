<template>
  <div class="surface rounded-2xl overflow-hidden" data-backup-panel>
    <div class="border-b border-border px-4 py-3 sm:p-5 sm:px-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-bold text-foreground sm:text-base">数据备份</h2>
          <p class="mt-1 text-xs text-muted-foreground">
            整库 + 上传文件（所有账号、清单、提醒、完成记录、课程表、配置与图片）；不含日志。
          </p>
        </div>
        <button class="btn-brand !px-4 !py-2 text-xs" :disabled="running" data-backup-run @click="runNow">
          {{ running ? '备份中…' : '立即备份' }}
        </button>
      </div>
    </div>
    <div class="space-y-2 px-4 py-4 text-xs sm:px-6">
      <p class="text-muted-foreground" data-backup-status>
        <span v-if="status.last_at">上次：{{ formatTime(status.last_at) }} ·
          <span :class="status.last_status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'">
            {{ status.last_status === 'ok' ? '成功' : '失败' }}
          </span>
          <span v-if="status.last_detail" class="block mt-1 break-all">{{ status.last_detail }}</span>
        </span>
        <span v-else>还没有执行过备份。</span>
      </p>
      <p class="text-muted-foreground">本机目录：<code class="text-[11px]">{{ status.local_dir || '—' }}</code></p>
      <p v-if="notice" class="font-medium" :class="noticeOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'" data-backup-notice>{{ notice }}</p>
      <p class="text-muted-foreground">WebDAV 与本机保留份数在下面「数据备份」分组里设置；手动备份两个都已开启的位置各落一份。</p>
    </div>

    <div class="border-t border-border px-4 py-4 sm:px-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-bold text-foreground">数据恢复</h3>
          <p class="mt-1 text-xs text-muted-foreground">
            从本机备份选择一份，或上传别处保存的备份文件。恢复会覆盖当前整库与上传文件。
          </p>
        </div>
        <button class="btn-ghost !px-3 !py-2 text-xs" :disabled="restoring" data-backup-upload @click="pickUpload">
          上传并恢复
        </button>
        <input ref="fileInput" type="file" accept=".tar.gz,.tgz,application/gzip,application/x-gzip" class="hidden" @change="onPickFile" />
      </div>

      <div class="mt-3 overflow-hidden rounded-xl border border-border" data-backup-restore-list>
        <div v-if="filesLoading" class="px-3 py-4 text-xs text-muted-foreground">正在读取备份目录…</div>
        <div v-else-if="!files.length" class="px-3 py-4 text-xs text-muted-foreground">
          本机目录里还没有备份。先点「立即备份」，或上传一份备份文件。
        </div>
        <div
          v-for="file in files"
          :key="file.name"
          class="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
          data-backup-file
        >
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 7a2 2 0 0 1 2-2h3.2l1.6 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"/></svg>
          </span>
          <div class="min-w-0 flex-1">
            <p class="break-all text-xs font-medium text-foreground" :title="file.name">{{ file.name }}</p>
            <p class="mt-0.5 text-[11px] text-muted-foreground">{{ formatTime(file.modified_at) }} · {{ formatSize(file.size) }}</p>
          </div>
          <button
            class="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-rose-400/60 hover:text-rose-500 disabled:opacity-50"
            :disabled="restoring"
            data-backup-restore
            @click="askRestore(file.name)"
          >恢复</button>
        </div>
      </div>

      <p class="mt-2.5 text-[11px] leading-5 text-muted-foreground">
        只列出本机备份；WebDAV 上的备份可先下载，再用「上传并恢复」。恢复前会自动在本机目录生成一份安全备份；
        恢复后如提示未登录，请用备份里的账号重新登录。
      </p>
      <p v-if="restoreNotice" class="mt-2 font-medium" :class="restoreNoticeOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'" data-backup-restore-notice>
        {{ restoreNotice }}
      </p>
    </div>

    <ConfirmDialog
      v-model="confirmOpen"
      title="从备份恢复？"
      :message="restoreMessage"
      confirm-text="恢复"
      :loading="restoring"
      loading-text="恢复中…"
      danger
      @confirm="doRestore"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getBackupStatus, listBackupFiles, restoreBackup, runBackup, uploadRestore } from '../api/backup'
import type { BackupFile, BackupStatus } from '../api/backup'
import ConfirmDialog from './ConfirmDialog.vue'

const status = ref<BackupStatus>({ last_at: '', last_status: '', last_detail: '', local_dir: '' })
const running = ref(false)
const notice = ref('')
const noticeOk = ref(true)

const files = ref<BackupFile[]>([])
const filesLoading = ref(false)
const restoreNotice = ref('')
const restoreNoticeOk = ref(true)
const restoring = ref(false)
const confirmOpen = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
type RestoreTarget = { kind: 'local'; name: string } | { kind: 'upload'; file: File }
const restoreTarget = ref<RestoreTarget | null>(null)

const restoreMessage = computed(() => {
  const target = restoreTarget.value
  const name = target?.kind === 'local' ? target.name : target?.kind === 'upload' ? target.file.name : ''
  return `将用「${name}」覆盖当前所有账号、清单、提醒、完成记录、课程表、配置与上传图片。恢复前会自动生成一份本机安全备份。`
})

onMounted(() => {
  load()
  loadFiles()
})

async function load() {
  try {
    const res = await getBackupStatus()
    if (res.data?.code === 0 && res.data.data) status.value = res.data.data
  } catch {
    // 状态读不到不影响配置项，面板保持「还没有执行过」。
  }
}

async function loadFiles() {
  filesLoading.value = true
  try {
    const res = await listBackupFiles()
    if (res.data?.code === 0) files.value = Array.isArray(res.data.data) ? res.data.data : []
  } catch {
    files.value = []
  } finally {
    filesLoading.value = false
  }
}

function formatTime(raw: string): string {
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return raw
  return at.toLocaleString('zh-CN', { hour12: false })
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function runNow() {
  running.value = true
  notice.value = ''
  try {
    const res = await runBackup()
    if (res.data?.code === 0) {
      const data = res.data.data || {}
      noticeOk.value = true
      notice.value = `已备份 ${data.file || ''}${data.size ? `（${(data.size / 1024 / 1024).toFixed(1)} MB）` : ''}`
      await Promise.all([load(), loadFiles()])
    } else {
      noticeOk.value = false
      notice.value = res.data?.message || '备份失败'
    }
  } catch (err: any) {
    noticeOk.value = false
    notice.value = err.response?.data?.message || '备份失败，请检查目录与 WebDAV 设置'
  } finally {
    running.value = false
  }
}

function askRestore(name: string) {
  restoreTarget.value = { kind: 'local', name }
  restoreNotice.value = ''
  confirmOpen.value = true
}

function pickUpload() {
  restoreNotice.value = ''
  fileInput.value?.click()
}

function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/\.(tar\.gz|tgz)$/i.test(file.name)) {
    restoreNoticeOk.value = false
    restoreNotice.value = '请选择 .tar.gz 格式的备份文件'
    return
  }
  restoreTarget.value = { kind: 'upload', file }
  confirmOpen.value = true
}

async function doRestore() {
  const target = restoreTarget.value
  if (!target) return
  restoring.value = true
  restoreNotice.value = ''
  try {
    const res = target.kind === 'local' ? await restoreBackup(target.name) : await uploadRestore(target.file)
    if (res.data?.code === 0) {
      const data = res.data.data || {}
      restoreNoticeOk.value = true
      restoreNotice.value = `已从「${data.file || ''}」恢复：账号 ${data.users ?? 0} 个、上传文件 ${data.uploads ?? 0} 个。恢复前已备份为 ${data.safety_file || '本机安全备份'}。`
      confirmOpen.value = false
      await Promise.all([load(), loadFiles()])
    } else {
      restoreNoticeOk.value = false
      restoreNotice.value = res.data?.message || '恢复失败'
      confirmOpen.value = false
    }
  } catch (err: any) {
    restoreNoticeOk.value = false
    restoreNotice.value = err.response?.data?.message || '恢复失败，请检查备份文件与数据目录'
    confirmOpen.value = false
  } finally {
    restoring.value = false
    restoreTarget.value = null
  }
}
</script>
