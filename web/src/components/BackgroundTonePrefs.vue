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
          <option value="diagonal">斜角</option>
        </select>
      </label>
    </div>

    <div class="mt-2.5">
      <div
        ref="stopTrack"
        class="relative h-7 rounded-xl border border-border/80"
        :style="{ background: `linear-gradient(90deg, ${start} 0%, ${start} ${startStop}%, ${end} ${endStop}%, ${end} 100%)` }"
        data-page-bg-stop-track
      >
        <button
          type="button"
          role="slider"
          tabindex="0"
          class="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white shadow-md ring-1 ring-black/20"
          :style="{ left: `${startStop}%`, background: start }"
          :aria-valuenow="startStop"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="起始色位置"
          data-page-bg-stop="start"
          @pointerdown="beginStopDrag('start', $event)"
          @keydown.left.prevent="nudgeStop('start', -1)"
          @keydown.right.prevent="nudgeStop('start', 1)"
        ></button>
        <button
          type="button"
          role="slider"
          tabindex="0"
          class="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white shadow-md ring-1 ring-black/20"
          :style="{ left: `${endStop}%`, background: end }"
          :aria-valuenow="endStop"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="结束色位置"
          data-page-bg-stop="end"
          @pointerdown="beginStopDrag('end', $event)"
          @keydown.left.prevent="nudgeStop('end', -1)"
          @keydown.right.prevent="nudgeStop('end', 1)"
        ></button>
      </div>
      <div class="mt-1 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
        <span>起始色 {{ startStop }}%</span>
        <span>拖动圆点调整颜色占比</span>
        <span>结束色 {{ endStop }}%</span>
      </div>
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
const startStop = ref(0)
const endStop = ref(100)
const stopTrack = ref<HTMLElement | null>(null)
const draggingStop = ref<'start' | 'end' | null>(null)
const tone = computed(() => theme.pageBgTone)
const saving = ref(false)
const notice = ref('')
const errorMsg = ref('')

const toneLabel = computed(() => {
  const themeName = theme.isDark ? '暗色主题' : '亮色主题'
  if (tone.value === 0) return `${themeName} · 默认亮度`
  return tone.value < 0 ? `${themeName} · 偏暗 ${-tone.value}%` : `${themeName} · 偏亮 ${tone.value}%`
})

type TonePreset = { key: string; label: string; start: string; end: string; direction: PageBgDirection }
const presets: TonePreset[] = [
  { key: 'mist', label: '晨雾', start: '#eef2ff', end: '#f8fafc', direction: 'vertical' },
  { key: 'sunset', label: '晚霞', start: '#ffecd2', end: '#fcb69f', direction: 'vertical' },
  { key: 'aurora', label: '极光', start: '#a8edea', end: '#fed6e3', direction: 'diagonal' },
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
  return {
    start: start.value,
    end: end.value,
    direction: direction.value,
    startStop: startStop.value,
    endStop: endStop.value,
  }
}

function touchNotice() {
  notice.value = ''
  errorMsg.value = ''
}

function stopPercent(event: PointerEvent): number {
  const rect = stopTrack.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(((event.clientX - rect.left) / rect.width) * 100)))
}

function applyStopPosition(event: PointerEvent) {
  if (!draggingStop.value) return
  const percent = stopPercent(event)
  if (draggingStop.value === 'start') startStop.value = Math.min(percent, endStop.value - 1)
  else endStop.value = Math.max(percent, startStop.value + 1)
  previewGradient()
}

function beginStopDrag(which: 'start' | 'end', event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  draggingStop.value = which
  applyStopPosition(event)
  window.addEventListener('pointermove', applyStopPosition)
  window.addEventListener('pointerup', finishStopDrag, { once: true })
}

function finishStopDrag() {
  window.removeEventListener('pointermove', applyStopPosition)
  if (!draggingStop.value) return
  draggingStop.value = null
  void saveGradient()
}

function nudgeStop(which: 'start' | 'end', delta: number) {
  if (which === 'start') startStop.value = Math.max(0, Math.min(startStop.value + delta, endStop.value - 1))
  else endStop.value = Math.min(100, Math.max(endStop.value + delta, startStop.value + 1))
  previewGradient()
  void saveGradient()
}

function previewGradient() {
  touchNotice()
  theme.setPageBgGradient(currentGradient())
}

function previewTone(raw: string) {
  const next = Math.max(-100, Math.min(100, Math.round(Number(raw) || 0)))
  touchNotice()
  // 只改当前主题的值；另一个主题的值保留，切主题时自动换成对应值。
  theme.setPageBgTone(next)
}

function applyPreset(preset: TonePreset) {
  start.value = preset.start
  end.value = preset.end
  direction.value = preset.direction
  startStop.value = 0
  endStop.value = 100
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
  if (saving.value) return
  saving.value = true
  errorMsg.value = ''
  notice.value = ''
  const isDark = theme.isDark
  const key = isDark ? 'page_bg_tone_dark' : 'page_bg_tone_light'
  const value = String(tone.value)
  try {
    const res = await updateConfig(key, value)
    if (res.data?.code === 0) {
      notice.value = '已保存'
      window.dispatchEvent(new CustomEvent('config-changed', { detail: { key, value } }))
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
  startStop.value = 0
  endStop.value = 100
  previewGradient()
  theme.resetPageBgTone()
  await saveGradient()
  await saveTone()
}

onMounted(async () => {
  const defaults = themeDefaults()
  start.value = defaults.start
  end.value = defaults.end
  startStop.value = 0
  endStop.value = 100
  try {
    const res = await getAllConfigs()
    const data = res.data?.data || {}
    const legacyTone = String(data.page_bg_tone ?? '')
    const legacyManual = legacyTone !== '' && Number(legacyTone) !== 0
    const lightTone = String(data.page_bg_tone_light ?? '')
    const darkTone = String(data.page_bg_tone_dark ?? '')
    theme.setPageBgToneFor(false, lightTone !== '' ? Number(lightTone) : legacyManual ? Number(legacyTone) : 0)
    theme.setPageBgToneFor(true, darkTone !== '' ? Number(darkTone) : legacyManual ? Number(legacyTone) : -20)
    const gradient = parsePageBgGradient(String(data.page_bg_gradient || ''))
    if (gradient) {
      start.value = gradient.start
      end.value = gradient.end
      direction.value = gradient.direction
      startStop.value = gradient.startStop
      endStop.value = gradient.endStop
      theme.setPageBgGradient(gradient)
    }
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || '读取设置失败'
  }
})
</script>
