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
        :custom-groups="['backup_remote']"
        @save="handleSave"
      >
        <template #group-body="{ group }">
          <WebDAVSettings v-if="group.key === 'backup_remote'" />
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
import WebDAVSettings from '../components/WebDAVSettings.vue'
import SyncImportWizard from '../components/SyncImportWizard.vue'
import { getSystemConfigMeta, updateConfig } from '../api/config'
import { useAuthStore } from '../stores/auth'
import type { ConfigMeta } from '../api/config'

const authStore = useAuthStore()
const items = ref<ConfigMeta[]>([])
const syncPanelRef = ref<InstanceType<typeof SyncPanel> | null>(null)
const loading = ref(false)
const errorMsg = ref('')
const listRef = ref<InstanceType<typeof ConfigGroupList> | null>(null)

async function reload() {
  await loadMeta()
  syncPanelRef.value?.reload?.()
}

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
// 本机备份已经并进顶部「数据备份」卡片，不再单独显示分组卡。
const visibleGroups = computed(() => {
  const groups = new Set(items.value.map((it) => it.group || 'general'))
  groups.delete('backup_local')
  return [...groups]
})
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
