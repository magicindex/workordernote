<template>
  <div class="border-t border-border px-4 py-3" data-page-bg-tone>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-semibold text-foreground">页面背景</span>
        <span class="text-[11px] font-semibold text-muted-foreground" data-page-bg-tone-value>{{ toneLabel }}</span>
        <span v-if="notice" class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-300" data-page-bg-tone-notice>{{ notice }}</span>
      </div>
      <button
        type="button"
        class="btn-ghost !px-2 !py-1 text-[11px]"
        :disabled="saving"
        data-page-bg-tone-reset
        @click="reset"
      >恢复默认</button>
    </div>
    <p class="mt-1 text-xs text-muted-foreground">选两种颜色做页面背景渐变，再调亮度；只影响页面背景，卡片和文字不变。</p>

    <div class="mt-2.5 flex flex-wrap items-center gap-1.5" data-page-bg-presets>
      <span class="text-[11px] font-semibold text-muted-foreground">预设</span>
      <button
        v-for="preset in presets"
        :key="preset.key"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-[11px] font-semibold text-foreground transition hover:border-brand-400 hover:bg-brand-500/5 disabled:opacity-60"
        :disabled="saving"
        :data-page-bg-preset="preset.key"
        :title="`一键套用「${preset.label}」`"
        @click="applyPreset(preset)"
      >
        <span class="h-3 w-3 rounded-full border border-black/10" :style="{ background: `linear-gradient(135deg, ${preset.start}, ${preset.end})` }"></span>
        {{ preset.label }}
      </button>
    </div>

    <div class="mt-2.5 flex flex-wrap items-end gap-2.5">
      <label class="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        起始色
        <input
          v-model="start"
          type="color"
          class="h-8 w-10 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
          data-page-bg-color-start
          @input="previewGradient"
          @change="saveGradient"
        />
      </label>
      <label class="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        结束色
        <input
          v-model="end"
          type="color"
          class="h-8 w-10 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
          data-page-bg-color-end
          @input="previewGradient"
          @change="saveGradient"
        />
      </label>
      <label class="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        方向
        <select
          v-model="direction"
          class="input-field !h-8 !w-[5.5rem] !py-1 text-xs"
          data-page-bg-direction
          @change="onDirectionChange"
        >
          <option value="vertical">上下</option>
          <option value="horizontal">左右</option>
        </select>
      </label>
    </div>

    <div class="mt-2.5 flex items-center gap-2">
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
        @input="previewTone(($event.target as HTMLInputElement).value)"
        @change="saveTone()"
      />
      <span class="text-[11px] font-semibold text-muted-foreground">亮</span>
    </div>
    <p class="mt-1.5 text-[11px] text-muted-foreground">拖动/选色时实时预览；松手自动保存到当前用户。</p>
    <p v-if="errorMsg" class="mt-1 text-[11px] font-medium text-destructive" data-page-bg-tone-error>{{ errorMsg }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getAllConfigs, updateConfig } from '../api/config'
import { parsePageBgGradient, useThemeStore, type PageBgDirection, type PageBgGradient } from '../stores/theme'

const theme = useThemeStore()
const start = ref('#f7f8fa')
const end = ref('#ffffff')
const direction = ref<PageBgDirection>('vertical')
const tone = ref(0)
const savedTone = ref(0)
const saving = ref(false)
const notice = ref('')
const errorMsg = ref('')

const toneLabel = computed(() => {
  if (tone.value === 0) return '默认亮度'
  return tone.value < 0 ? `偏暗 ${-tone.value}%` : `偏亮 ${tone.value}%`
})

type TonePreset = { key: string; label: string; start: string; end: string; direction: PageBgDirection }
const presets: TonePreset[] = [
  { key: 'mist', label: '晨雾', start: '#eef2ff', end: '#f8fafc', direction: 'vertical' },
  { key: 'sunset', label: '晚霞', start: '#ffecd2', end: '#fcb69f', direction: 'vertical' },
  { key: 'aurora', label: '极光', start: '#a8edea', end: '#fed6e3', direction: 'horizontal' },
  { key: 'mint', label: '薄荷', start: '#d9f99d', end: '#a7f3d0', direction: 'vertical' },
  { key: 'ocean', label: '深海', start: '#1e3a8a', end: '#0f172a', direction: 'vertical' },
  { key: 'violet', label: '紫夜', start: '#312e81', end: '#111827', direction: 'horizontal' },
]

function themeDefaults(): { start: string; end: string } {
  return theme.isDark
    ? { start: '#0b0f1a', end: '#111827' }
    : { start: '#f7f8fa', end: '#ffffff' }
}

function currentGradient(): PageBgGradient {
  return { start: start.value, end: end.value, direction: direction.value }
}

function touchNotice() {
  notice.value = ''
  errorMsg.value = ''
}

function previewGradient() {
  touchNotice()
  theme.setPageBgGradient(currentGradient())
}

function previewTone(raw: string) {
  const next = Math.max(-100, Math.min(100, Math.round(Number(raw) || 0)))
  tone.value = next
  touchNotice()
  theme.setPageBgTone(next)
}

function applyPreset(preset: TonePreset) {
  start.value = preset.start
  end.value = preset.end
  direction.value = preset.direction
  previewGradient()
  void saveGradient()
}

function onDirectionChange() {
  previewGradient()
  saveGradient()
}

async function saveGradient() {
  if (saving.value) return
  saving.value = true
  errorMsg.value = ''
  notice.value = ''
  try {
    const value = JSON.stringify(currentGradient())
    const res = await updateConfig('page_bg_gradient', value)
    if (res.data?.code === 0) {
      notice.value = '已保存'
      window.dispatchEvent(new CustomEvent('config-changed', { detail: { key: 'page_bg_gradient', value } }))
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

async function saveTone() {
  if (saving.value || tone.value === savedTone.value) return
  saving.value = true
  errorMsg.value = ''
  notice.value = ''
  try {
    const value = String(tone.value)
    const res = await updateConfig('page_bg_tone', value)
    if (res.data?.code === 0) {
      savedTone.value = tone.value
      notice.value = '已保存'
      window.dispatchEvent(new CustomEvent('config-changed', { detail: { key: 'page_bg_tone', value } }))
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
  const defaults = themeDefaults()
  start.value = defaults.start
  end.value = defaults.end
  direction.value = 'vertical'
  tone.value = 0
  previewGradient()
  previewTone('0')
  await saveGradient()
  await saveTone()
}

onMounted(async () => {
  const defaults = themeDefaults()
  start.value = defaults.start
  end.value = defaults.end
  try {
    const res = await getAllConfigs()
    const rawTone = Number(res.data?.data?.page_bg_tone || 0) || 0
    tone.value = Math.max(-100, Math.min(100, rawTone))
    savedTone.value = tone.value
    theme.setPageBgTone(tone.value)
    const gradient = parsePageBgGradient(String(res.data?.data?.page_bg_gradient || ''))
    if (gradient) {
      start.value = gradient.start
      end.value = gradient.end
      direction.value = gradient.direction
      theme.setPageBgGradient(gradient)
    }
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || '读取设置失败'
  }
})
</script>
