<template>
  <div
    class="user-avatar"
    :class="shapeClass"
    :style="{ width: `${size}px`, height: `${size}px`, background: palette.bg }"
    role="img"
    :aria-label="`${name || '用户'} 的头像`"
    data-user-avatar
  >
    <svg viewBox="0 0 80 80" class="h-full w-full" aria-hidden="true">
      <circle cx="40" cy="40" r="36" fill="rgba(255,255,255,0.10)" />
      <rect
        v-for="(cell, i) in cells"
        :key="i"
        :x="cell.x"
        :y="cell.y"
        width="12"
        height="12"
        rx="3"
        :fill="palette.fg"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * 按用户名生成一枚固定的几何头像（identicon），不再用首字文字代替。
 * 同一个用户名永远得到同一枚头像；纯前端 SVG，不依赖外部图片/网络。
 */
const props = withDefaults(defineProps<{
  name?: string
  size?: number
  shape?: 'xl' | '2xl' | 'full'
}>(), {
  name: '',
  size: 40,
  shape: 'xl',
})

const palettes = [
  { bg: 'linear-gradient(135deg,#0ea5e9,#4f46e5)', fg: 'rgba(255,255,255,.94)' },
  { bg: 'linear-gradient(135deg,#f97316,#e11d48)', fg: 'rgba(255,255,255,.94)' },
  { bg: 'linear-gradient(135deg,#10b981,#0f766e)', fg: 'rgba(255,255,255,.94)' },
  { bg: 'linear-gradient(135deg,#8b5cf6,#db2777)', fg: 'rgba(255,255,255,.94)' },
  { bg: 'linear-gradient(135deg,#f59e0b,#ea580c)', fg: 'rgba(255,255,255,.94)' },
  { bg: 'linear-gradient(135deg,#06b6d4,#2563eb)', fg: 'rgba(255,255,255,.94)' },
  { bg: 'linear-gradient(135deg,#84cc16,#15803d)', fg: 'rgba(255,255,255,.94)' },
  { bg: 'linear-gradient(135deg,#ec4899,#7c3aed)', fg: 'rgba(255,255,255,.94)' },
]

function hashName(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const seed = computed(() => hashName(String(props.name || 'user')))
const palette = computed(() => palettes[seed.value % palettes.length])
const shapeClass = computed(() => (
  props.shape === 'full' ? 'rounded-full' : props.shape === '2xl' ? 'rounded-2xl' : 'rounded-xl'
))

const cells = computed(() => {
  const h = seed.value
  const out: { x: number; y: number }[] = []
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const bit = ((h >>> ((x * 7 + y * 13) % 31)) ^ (h >>> ((x * 11 + y * 5) % 29))) & 1
      if (!bit) continue
      out.push({ x: 10 + x * 12, y: 10 + y * 12 })
      if (x !== 2) out.push({ x: 10 + (4 - x) * 12, y: 10 + y * 12 })
    }
  }
  // 极少数哈希太稀时补中心，保证总有个像样的图形。
  if (out.length < 4) out.push({ x: 34, y: 34 })
  return out
})
</script>

<style scoped>
.user-avatar {
  @apply relative shrink-0 overflow-hidden shadow-sm ring-1 ring-black/5 dark:ring-white/10;
}
</style>
