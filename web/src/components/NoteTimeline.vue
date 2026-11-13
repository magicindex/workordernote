<template>
  <div v-if="entries.length" class="note-timeline" data-note-timeline>
    <p
      v-for="(entry, index) in entries"
      :key="`${entry.at}-${entry.label}-${index}`"
      class="note-timeline-row"
    >
      <span class="note-timeline-head">
        <span v-if="entry.timeLabel" class="note-timeline-time" data-note-time>{{ entry.timeLabel }}</span>
        <span class="note-timeline-tag" :class="entry.label === '完成备注' ? 'is-done' : 'is-created'" data-note-label>{{ entry.label }}</span>
      </span>
      <span class="note-timeline-text" data-note-text>{{ entry.text }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
// 备注时间线（用户 2026-11-13）：「新建备注」和「完成备注」不是同一条，
// 放在一起时用时间戳分开。列表行、已完成页、编辑面板共用这一个组件。
import type { NoteTimelineEntry } from '../utils/note-timeline'

defineProps<{ entries: NoteTimelineEntry[] }>()
</script>

<style scoped>
.note-timeline { @apply space-y-1.5; }
.note-timeline-row { @apply text-xs leading-4 text-muted-foreground; }
.note-timeline-head { @apply mr-1.5 inline-flex items-center gap-1 align-baseline; }
.note-timeline-time { @apply font-mono text-[10px] font-semibold tabular-nums opacity-75; }
.note-timeline-tag { @apply rounded-md px-1.5 py-0.5 text-[10px] font-bold; }
.note-timeline-tag.is-created { @apply bg-muted text-muted-foreground; }
.note-timeline-tag.is-done { @apply bg-emerald-500/10 text-emerald-600 dark:text-emerald-300; }
.note-timeline-text { @apply break-words; }
</style>
