<template>
  <div class="page-container animate-fade-in">
    <PageHeader title="系统配置" description="管理全局系统级配置，仅管理员可见" />

    <div v-if="errorMsg" class="surface rounded-2xl px-5 py-3 text-sm text-destructive">
      {{ errorMsg }}
    </div>

    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-20 rounded-xl bg-muted animate-pulse"></div>
    </div>

    <div v-else class="space-y-4 sm:space-y-6">
      <!-- 新设备初始化：连上老设备 → 选账号 → 一键把清单与内容搬过来 -->
      <SyncImportWizard @imported="reload" />

      <!-- 双机同步不走 ConfigGroupList：它有密钥、方向、连通性测试与结果明细，
           不是「一个键一个值」能表达的（见 components/SyncPanel.vue）。 -->
      <SyncPanel ref="syncPanelRef" />

      <!-- AI 助手同理不走 ConfigGroupList：它有服务商预设、密钥掩码、连通性测试
           与结果明细，「一个键一个值」表达不了（见 components/AiAssistantPanel.vue）。
           模型参数在这里填完即生效，前端不用跟着改版本。 -->
      <AiAssistantPanel />

      <!-- 数据备份：整库 + 上传文件。分组里的键负责「备份到哪、几点、留几份」，
           这块负责展示上次结果与「立即备份」。 -->
      <BackupPanel />

      <ConfigGroupList
        ref="listRef"
        :items="items"
        :visible-groups="visibleGroups"
        @save="handleSave"
      >
        <template #group-footer="{ group }">
          <div v-if="group.key === 'backup_remote' && webdavEnabled" class="border-t border-border px-4 py-3" data-webdav-test>
            <div class="flex flex-wrap items-center gap-3">
              <button class="btn-secondary !px-3 !py-2 text-xs" :disabled="webdavTesting" data-webdav-test-button @click="testWebDAVConnection">
                {{ webdavTesting ? '测试中…' : '测试连接' }}
              </button>
              <span
                class="inline-flex items-center gap-1.5 text-xs font-semibold"
                :class="webdavResult?.ok ? 'text-emerald-600 dark:text-emerald-400' : webdavResult ? 'text-destructive' : 'text-muted-foreground'"
                data-webdav-test-status
                :data-state="webdavTesting ? 'testing' : webdavResult ? (webdavResult.ok ? 'ok' : 'error') : 'idle'"
              >
                <span class="h-2 w-2 rounded-full" :class="webdavTesting ? 'bg-amber-400' : webdavResult?.ok ? 'bg-emerald-500' : webdavResult ? 'bg-rose-500' : 'bg-muted-foreground/50'"></span>
                <span v-if="webdavTesting">测试中…</span>
                <span v-else-if="webdavResult?.ok">连接正常 · {{ webdavResult.latency }} ms</span>
                <span v-else-if="webdavResult">连接失败</span>
                <span v-else>未测试</span>
              </span>
            </div>
            <p v-if="webdavResult && !webdavResult.ok" class="mt-1 break-all text-[11px] leading-4 text-destructive">{{ webdavResult.message }}</p>
          </div>
        </template>
      </ConfigGroupList>

    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import ConfigGroupList from '../components/ConfigGroupList.vue'
import SyncPanel from '../components/SyncPanel.vue'
import AiAssistantPanel from '../components/AiAssistantPanel.vue'
import BackupPanel from '../components/BackupPanel.vue'
import SyncImportWizard from '../components/SyncImportWizard.vue'
import { getSystemConfigMeta, updateConfig } from '../api/config'
import { testWebDAV } from '../api/backup'
import { useAuthStore } from '../stores/auth'
import type { ConfigMeta } from '../api/config'

const authStore = useAuthStore()
const items = ref<ConfigMeta[]>([])
// 本机备份已经并进顶部「数据备份」卡片，不再单独显示分组卡。
const visibleGroups = computed(() => {
  const groups = new Set(items.value.map((it) => it.group || 'general'))
  groups.delete('backup_local')
  return [...groups]
})
const webdavEnabled = computed(() => items.value.find((it) => it.key === 'backup_webdav_enabled')?.value === 'true')
const webdavTesting = ref(false)
const webdavResult = ref<{ ok: boolean; latency: number; message: string } | null>(null)
async function testWebDAVConnection() {
  if (webdavTesting.value) return
  webdavTesting.value = true
  webdavResult.value = null
  try {
    const res = await testWebDAV()
    if (res.data?.code === 0) {
      webdavResult.value = { ok: true, latency: Number(res.data.data?.latency_ms || 0), message: '连接正常' }
    } else {
      webdavResult.value = { ok: false, latency: 0, message: res.data?.message || '连接失败' }
    }
  } catch (err: any) {
    webdavResult.value = { ok: false, latency: 0, message: err.response?.data?.message || '连接失败' }
  } finally {
    webdavTesting.value = false
  }
}
const syncPanelRef = ref<InstanceType<typeof SyncPanel> | null>(null)

// 导入向导完成后：同步设置刚被改写，刷新面板显示最新状态
async function reload() {
  await loadMeta()
  syncPanelRef.value?.reload?.()
}
const loading = ref(false)
const errorMsg = ref('')
const listRef = ref<InstanceType<typeof ConfigGroupList> | null>(null)

onMounted(loadMeta)

async function loadMeta() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await getSystemConfigMeta()
    if (res.data?.code === 0) {
      items.value = Array.isArray(res.data.data) ? res.data.data : []
    } else {
      errorMsg.value = res.data?.message || '加载配置失败'
    }
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '网络错误'
  } finally {
    loading.value = false
  }
}

async function handleSave(key: string, value: string) {
  errorMsg.value = ''
  try {
    const res = await updateConfig(key, value)
    if (res.data?.code === 0) {
      const idx = items.value.findIndex((it) => it.key === key)
      if (idx >= 0) {
        items.value[idx] = { ...items.value[idx], value }
      }
      // 「信用卡账单」栏目开关：侧栏那个固定栏目要立刻跟着变，不用重进页面。
      if (key === 'credit_card_enabled') {
        authStore.setCreditCardEnabled(value !== 'false')
      }
      if (key === 'ceremony_enabled') {
        authStore.setCeremonyEnabled(value !== 'false')
      }
      // URL / 账号 / 子目录 / 证书开关一变，上一次测试结果就不作数了。
      if (key.startsWith('backup_webdav_')) webdavResult.value = null
      listRef.value?.markSaved(key)
    } else {
      errorMsg.value = res.data?.message || '保存失败'
      listRef.value?.markFailed(key)
    }
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '网络错误'
    listRef.value?.markFailed(key)
  }
}
</script>
