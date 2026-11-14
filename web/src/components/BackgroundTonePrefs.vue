<template>
  <div class="border-t border-border px-4 py-3" data-page-bg-tone>
    <div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-semibold text-foreground">背景亮度</span>
          <span class="text-[11px] font-semibold text-muted-foreground" data-page-bg-tone-value>{{ toneLabel }}</span>
          <span v-if="notice" class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-300" data-page-bg-tone-notice>{{ notice }}</span>
        </div>
        <p class="mt-1 text-xs text-muted-foreground">只调整页面背景的明暗；卡片、文字和按钮颜色保持不变。</p>
      </div>
      <div class="flex items-center gap-2 sm:w-64">
        <span class="text-[11px] font-semibold text-muted-foreground">暗</span>
        <input
          type="range"
          min="-100"
          max="100"
          step="5"
          class="h-1.5 flex-1 cursor-pointer accent-brand-500"
          :value="tone"
          :disabled="saving"
          aria-label="页面背景亮度"
          data-page-bg-tone-slider
          @input="preview(($event.target as HTMLInputElement).value)"
          @change="save()"
        />
        <span class="text-[11px] font-semibold text-muted-foreground">亮</span>
      </div>
    </div>
    <div class="mt-1.5 flex flex-wrap items-center justify-between gap-2">
      <p class="text-[11px] text-muted-foreground">往左更暗、往右更亮；松手自动保存。</p>
      <button
        type="button"
        class="btn-ghost !px-2 !py-1 text-[11px]"
        :disabled="saving || tone === 0"
        data-page-bg-tone-reset
        @click="reset"
      >恢复默认</button>
    </div>
    <p v-if="errorMsg" class="mt-1 text-[11px] font-medium text-destructive" data-page-bg-tone-error>{{ errorMsg }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getAllConfigs, updateConfig } from '../api/config'
import { useThemeStore } from '../stores/theme'

const theme = useThemeStore()
const tone = ref(0)
const savedTone = ref(0)
const saving = ref(false)
const notice = ref('')
const errorMsg = ref('')

const toneLabel = computed(() => {
  if (tone.value === 0) return '默认'
  return tone.value < 0 ? `偏暗 ${-tone.value}%` : `偏亮 ${tone.value}%`
})

function clamp(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)))
}

function preview(raw: string) {
  const next = clamp(Number(raw) || 0)
  tone.value = next
  // 拖动过程中只改 CSS 变量，页面立刻预览；松手才写服务端。
  theme.setPageBgTone(next)
  notice.value = ''
}

async function save() {
  if (saving.value || tone.value === savedTone.value) return
  saving.value = true
  errorMsg.value = ''
  notice.value = ''
  try {
    const res = await updateConfig('page_bg_tone', String(tone.value))
    if (res.data?.code === 0) {
      savedTone.value = tone.value
      notice.value = '已保存'
      window.dispatchEvent(new CustomEvent('config-changed', { detail: { key: 'page_bg_tone', value: String(tone.value) } }))
      setTimeout(() => { notice.value = '' }, 2400)
    } else {
      errorMsg.value = res.data?.message || '保存失败'
    }
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function reset() {
  preview('0')
  await save()
}

onMounted(async () => {
  try {
    const res = await getAllConfigs()
    const value = clamp(Number(res.data?.data?.page_bg_tone || 0) || 0)
    savedTone.value = value
    tone.value = value
    theme.setPageBgTone(value)
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || '读取设置失败'
  }
})
</script>
