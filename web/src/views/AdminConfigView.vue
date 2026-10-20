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
        @save="handleSave"
      />

      <!-- 安卓客户端安装包：版本号/说明/下载地址是上面那个配置分组里的普通配置项，
           安装包本身必须是文件，单独一块（上传后卡片上就会出现下载按钮与二维码）。 -->
      <AndroidApkUploader />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import ConfigGroupList from '../components/ConfigGroupList.vue'
import SyncPanel from '../components/SyncPanel.vue'
import AiAssistantPanel from '../components/AiAssistantPanel.vue'
import BackupPanel from '../components/BackupPanel.vue'
import SyncImportWizard from '../components/SyncImportWizard.vue'
import AndroidApkUploader from '../components/AndroidApkUploader.vue'
import { getSystemConfigMeta, updateConfig } from '../api/config'
import { useAuthStore } from '../stores/auth'
import type { ConfigMeta } from '../api/config'

const authStore = useAuthStore()
const items = ref<ConfigMeta[]>([])
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
