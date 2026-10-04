<template>
  <Modal :model-value="modelValue" size="lg" title="版本信息与迭代说明" @update:model-value="emit('update:modelValue', $event)">
    <!-- 当前版本 -->
    <div class="flex flex-wrap items-center gap-3 rounded-2xl bg-muted/60 p-4">
      <span class="logo-mark shrink-0">
        <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor">
          <path d="m7 12 3 3 7-7" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <div class="min-w-0">
        <p class="flex flex-wrap items-baseline gap-2">
          <span class="font-display text-base font-extrabold tracking-tight">{{ PROJECT.displayName }}</span>
          <span class="rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 text-[11px] font-bold leading-none text-brand-600 dark:text-brand-300">{{ version || '—' }}</span>
        </p>
        <p class="mt-0.5 text-xs font-medium text-muted-foreground">
          项目名 {{ PROJECT.name }}<span v-if="buildTime"> · 构建于 {{ formatBuildTime(buildTime) }}</span>
        </p>
      </div>
    </div>

    <!-- 迭代说明 -->
    <h4 class="mt-5 text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">迭代说明</h4>
    <ol class="mt-2 space-y-4">
      <li v-for="note in releaseNotes" :key="note.version" class="relative rounded-2xl border border-border/70 p-3.5">
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-bold leading-none text-emerald-600 dark:text-emerald-400">{{ note.version }}</span>
          <span class="text-sm font-bold">{{ note.title }}</span>
          <span v-if="note.date" class="ml-auto text-[11px] font-medium text-muted-foreground">{{ note.date }}</span>
        </div>
        <ul class="mt-2 space-y-1.5">
          <li v-for="(item, i) in note.items" :key="i" class="flex gap-2 text-[13px] leading-5 text-muted-foreground">
            <span class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500/60"></span>
            <span>{{ item }}</span>
          </li>
        </ul>
      </li>
    </ol>

    <!-- 原项目信息：衍生开发必须保留的出处与许可 -->
    <h4 class="mt-5 text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">原项目信息</h4>
    <div class="mt-2 rounded-2xl border border-border/70 bg-muted/40 p-3.5">
      <p class="text-[13px] leading-5 text-muted-foreground">
        上游项目
        <a class="font-semibold text-brand-600 hover:underline dark:text-brand-300" :href="UPSTREAM.url" target="_blank" rel="noreferrer">{{ UPSTREAM.project }}</a>
        ，许可 <span class="font-semibold text-foreground">{{ UPSTREAM.license }}</span>。
      </p>
      <p class="mt-1.5 text-[13px] leading-5 text-muted-foreground">{{ UPSTREAM.note }}</p>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import Modal from './Modal.vue'
import { PROJECT, UPSTREAM, releaseNotes } from '../data/release-notes'

defineProps<{
  modelValue: boolean
  version?: string
  buildTime?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

// 后端返回的是 "2026-10-04T15:20:50" 这种本地时间串，直接换成更好读的写法。
function formatBuildTime(value: string) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return value
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
}
</script>
