<template>
  <!-- 「鎏金」咖啡杯：颜色取自仪式感色板里的 gold（#f9e79f → #b8860b），
       用金属渐变 + 杯口高光画出鎏金质感；顶栏入口与打赏页首屏共用这一颗。 -->
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    class="coffee-cup-gold"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="`${uid}-metal`" x1="4.2" y1="3.2" x2="19.4" y2="20.6" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fff8d6" />
        <stop offset="0.26" stop-color="#f9e79f" />
        <stop offset="0.54" stop-color="#e9c455" />
        <stop offset="0.8" stop-color="#c9971b" />
        <stop offset="1" stop-color="#b8860b" />
      </linearGradient>
      <linearGradient :id="`${uid}-rim`" x1="4.6" y1="9.2" x2="16.6" y2="9.2" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fffdf0" />
        <stop offset="0.5" stop-color="#f7df8e" />
        <stop offset="1" stop-color="#b8860b" />
      </linearGradient>
      <linearGradient :id="`${uid}-steam`" x1="7" y1="3" x2="12" y2="6.4" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fff6cf" />
        <stop offset="1" stop-color="#d9a520" />
      </linearGradient>
    </defs>

    <!-- 热气 -->
    <path
      d="M7 3c0 1 1 1 1 2M11 3c0 1 1 1 1 2"
      :stroke="`url(#${uid}-steam)`"
      stroke-width="1.7"
      stroke-linecap="round"
      opacity="0.9"
    />

    <!-- 杯把 -->
    <path
      d="M16 10h2a3 3 0 0 1 0 6h-2"
      :stroke="`url(#${uid}-metal)`"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- 杯身：金属渐变填充 + 深金描边 -->
    <path
      d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"
      :fill="`url(#${uid}-metal)`"
      stroke="#8a6508"
      stroke-width="1.1"
      stroke-linejoin="round"
    />

    <!-- 杯口与左侧高光：让平面图标有鎏金的立体反光 -->
    <path d="M4.7 9.45h10.6" :stroke="`url(#${uid}-rim)`" stroke-width="1" stroke-linecap="round" />
    <path
      d="M5.35 10.9v2.7a3.7 3.7 0 0 0 1.15 2.5"
      stroke="#fffbe8"
      stroke-width="0.95"
      stroke-linecap="round"
      opacity="0.62"
    />
    <path d="M6 14.9h2.4" stroke="#7a5206" stroke-width="0.8" stroke-linecap="round" opacity="0.28" />
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue'

withDefaults(defineProps<{ size?: number }>(), { size: 24 })

// 同一页可能出现两颗鎏金杯（顶栏 + 打赏页首屏），渐变 id 必须唯一。
const uid = `gold-cup-${useId().replace(/[:]/g, '')}`
</script>

<style scoped>
.coffee-cup-gold {
  filter: drop-shadow(0 1px 1.5px rgba(120, 80, 0, 0.32));
}
</style>
