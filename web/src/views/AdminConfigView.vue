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
      <!-- 双机同步不走 ConfigGroupList：它有密钥、方向、连通性测试与结果明细，
           不是「一个键一个值」能表达的（见 components/SyncPanel.vue）。 -->
      <SyncPanel />

      <ConfigGroupList
        ref="listRef"
        :items="items"
        @save="handleSave"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import ConfigGroupList from '../components/ConfigGroupList.vue'
import SyncPanel from '../components/SyncPanel.vue'
import { getSystemConfigMeta, updateConfig } from '../api/config'
import type { ConfigMeta } from '../api/config'

const items = ref<ConfigMeta[]>([])
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
