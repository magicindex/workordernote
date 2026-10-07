<template>
  <!-- 清单图标：形状识别清单，颜色仍用清单色（继承 currentColor）。 -->
  <svg
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="body"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { listIcon } from '../utils/list-icons'

const props = withDefaults(defineProps<{ name?: string; size?: number | string }>(), {
  name: 'list',
  size: 16,
})

const body = computed(() => listIcon(props.name).body)
</script>
