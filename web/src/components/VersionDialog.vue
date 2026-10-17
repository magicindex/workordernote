<template>
  <Modal :model-value="modelValue" size="lg" title="版本信息与迭代说明" @update:model-value="emit('update:modelValue', $event)">
    <!-- 当前版本 -->
    <div class="flex flex-wrap items-center gap-3 rounded-2xl bg-muted/60 p-4" data-about-pinned>
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
          项目名 {{ PROJECT.name }}<span v-if="buildTime"> · 由 {{ PROJECT.builder }} 构建于 {{ formatBuildTime(buildTime) }}</span>
        </p>
        <!-- 原项目信息（用户 2026-10-15：原来单独一块放在最下面，现在并进这个置顶块，
             跟着版本号一起第一眼就看到；衍生开发必须保留的出处与许可仍然完整保留）。 -->
        <p class="mt-1.5 text-[11px] leading-5 text-muted-foreground">
          上游项目
          <a class="font-semibold text-brand-600 hover:underline dark:text-brand-300" :href="UPSTREAM.url" target="_blank" rel="noreferrer">{{ UPSTREAM.project }}</a>
          ，许可 <span class="font-semibold text-foreground">{{ UPSTREAM.license }}</span>
        </p>
        <p class="mt-1 text-[11px] leading-5 text-muted-foreground/90">{{ UPSTREAM.note }}</p>
      </div>
    </div>

    <!-- 安卓客户端：软件信息卡片（版本/更新说明/下载地址与二维码） -->
    <AndroidClientCard :open="modelValue" />

    <!-- 浏览器安装（PWA）：手机/电脑把网页装成独立应用 -->
    <InstallAppCard />

    <!-- 迭代主线：先给一条主线，再往下才是逐版明细（用户 2026-10-17：精简、合并、更好读） -->
    <div class="mt-5 rounded-2xl border border-border/70 bg-muted/30 p-3.5" data-version-themes>
      <p class="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">迭代主线</p>
      <ol class="mt-2 space-y-1.5">
        <li v-for="theme in iterationThemes" :key="theme.title" class="flex gap-2 text-[13px] leading-5" data-version-theme>
          <span class="mt-0.5 shrink-0 rounded-full bg-brand-500/12 px-1.5 text-[11px] font-bold leading-5 text-brand-600 dark:text-brand-300">{{ theme.title }}</span>
          <span class="text-muted-foreground">{{ theme.text }}</span>
        </li>
      </ol>
    </div>

    <!-- 迭代说明 -->
    <div class="mt-5 flex items-baseline gap-2">
      <h4 class="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">迭代说明</h4>
      <span class="text-[11px] font-medium text-muted-foreground">按小版本合并 · 点标题展开</span>
    </div>
    <ol class="mt-2 space-y-2">
      <li
        v-for="(note, index) in releaseNotes"
        :key="note.version"
        class="relative overflow-hidden rounded-2xl border border-border/70"
        data-release-note
        :data-release-version="note.version"
      >
        <button
          type="button"
          class="flex w-full flex-col gap-1 px-3.5 py-2.5 text-left transition hover:bg-muted/40 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-2"
          :aria-expanded="openCards.has(index)"
          data-release-toggle
          @click="toggleCard(index)"
        >
          <!-- 手机上第一行放版本 / 条数 / 日期 / 箭头，标题单独一行（窄屏挤在一行会把标题压成一列字）；
               桌面上这几项退回标题后面，排成一行。 -->
          <span class="flex w-full items-center gap-2 sm:contents">
            <span class="shrink-0 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-bold leading-none text-emerald-600 dark:text-emerald-400">{{ note.version }}</span>
            <span v-if="note.items.length" class="shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-medium leading-5 text-muted-foreground sm:order-2">{{ note.items.length }} 条</span>
            <span v-if="note.date" class="ml-auto shrink-0 text-[11px] font-medium text-muted-foreground sm:order-2 sm:ml-0">{{ note.date }}</span>
            <svg
              viewBox="0 0 24 24" class="h-4 w-4 shrink-0 text-muted-foreground transition-transform sm:order-3"
              :class="openCards.has(index) ? 'rotate-180' : ''" fill="none" stroke="currentColor"
            >
              <path d="m6 9 6 6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="w-full text-sm font-bold sm:w-auto sm:flex-1 sm:order-1">{{ note.title }}</span>
        </button>
        <div v-if="openCards.has(index)" class="px-3.5 pb-3" data-release-body>
          <ul class="space-y-1.5">
            <li v-for="(item, i) in visibleItems(note, index)" :key="i" class="flex gap-2 text-[13px] leading-5 text-muted-foreground">
              <span class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500/60"></span>
              <span v-html="renderItem(item)"></span>
            </li>
          </ul>
          <button
            v-if="note.items.length > shortItemCount"
            type="button"
            class="mt-2 text-[11px] font-bold text-brand-600 hover:underline dark:text-brand-300"
            data-release-more
            @click="toggleItems(index)"
          >
            {{ expandedCards.has(index) ? '收起' : `展开全部 ${note.items.length} 条` }}
          </button>
        </div>
      </li>
    </ol>
  </Modal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Modal from './Modal.vue'
import AndroidClientCard from './AndroidClientCard.vue'
import InstallAppCard from './InstallAppCard.vue'
import { PROJECT, UPSTREAM, iterationThemes, releaseNotes } from '../data/release-notes'

defineProps<{
  modelValue: boolean
  version?: string
  buildTime?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

// 默认只展开最近两三版；其余点标题再展开（版本多了以后整页都是字，用户看不清主线）。
const openCards = ref(new Set<number>([0, 1, 2]))
const expandedCards = ref(new Set<number>())
const shortItemCount = 3

function toggleCard(index: number) {
  const next = new Set(openCards.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  openCards.value = next
}

function toggleItems(index: number) {
  const next = new Set(expandedCards.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  expandedCards.value = next
}

// 条目里用 `**重点**` 标关键信息；原来直接把星号显示出来，读起来很吵。
// 内容全是本地静态数据，仍然先转义再替换，避免把任何尖括号当成标签。
function renderItem(text: string) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-foreground">$1</strong>')
}

function visibleItems(note: { items: string[] }, index: number) {
  return expandedCards.value.has(index) ? note.items : note.items.slice(0, shortItemCount)
}

// 后端返回的是 "2026-10-04T15:20:50" 这种本地时间串，直接换成更好读的写法。
function formatBuildTime(value: string) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return value
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
}
</script>
