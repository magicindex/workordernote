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
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getBackupStatus, runBackup } from '../api/backup'
import type { BackupStatus } from '../api/backup'

const status = ref<BackupStatus>({ last_at: '', last_status: '', last_detail: '', local_dir: '' })
const running = ref(false)
const notice = ref('')
const noticeOk = ref(true)

onMounted(load)
async function load() {
  try {
    const res = await getBackupStatus()
    if (res.data?.code === 0 && res.data.data) status.value = res.data.data
  } catch {
    // 状态读不到不影响配置项，面板保持「还没有执行过」。
  }
}

function formatTime(raw: string): string {
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return raw
  return at.toLocaleString('zh-CN', { hour12: false })
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
      await load()
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
</script>
