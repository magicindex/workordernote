<template>
  <div class="mx-auto max-w-4xl pb-28 lg:pb-0" data-trash-page>
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-7">
      <div class="min-w-0">
        <p class="mb-1 text-xs font-extrabold uppercase tracking-[.18em] text-slate-500 sm:mb-2">智能清单</p>
        <h1 class="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">垃圾箱</h1>
        <p class="mt-0.5 text-[13px] text-muted-foreground sm:mt-2">
          删除的提醒都收在这里，不会出现在「全部」或「已完成」。恢复后会回到原来的清单。
        </p>
      </div>
      <span class="rounded-full bg-slate-500/10 px-3 py-1 text-xs font-bold text-slate-600 dark:text-slate-300" data-trash-count>
        {{ items.length }} 条
      </span>
    </div>

    <div v-if="errorMsg" class="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/[.06] px-4 py-3 text-xs font-bold text-rose-500" data-trash-error>
      <span>{{ errorMsg }}</span>
      <button type="button" class="shrink-0 underline" @click="errorMsg = ''">知道了</button>
    </div>

    <section class="overflow-hidden rounded-[24px] border border-border/70 bg-surface/85 shadow-card backdrop-blur-xl">
      <header class="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-5">
        <div class="flex items-center gap-2 text-sm font-extrabold">
          <svg viewBox="0 0 24 24" class="h-4 w-4 text-slate-500" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V5h6v2M7 7l.8 12.2A2 2 0 0 0 9.8 21h4.4a2 2 0 0 0 2-1.8L17 7M10 11v6M14 11v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          已删除的提醒
        </div>
        <button type="button" class="text-xs font-bold text-brand-500 hover:underline disabled:opacity-50" :disabled="loading" @click="load">刷新</button>
      </header>

      <div v-if="loading" class="space-y-2 p-4 sm:p-5">
        <div v-for="n in 3" :key="n" class="h-20 animate-pulse rounded-2xl bg-surface"></div>
      </div>

      <div v-else-if="!items.length" class="px-5 py-16 text-center" data-trash-empty>
        <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-500/10 text-slate-400">
          <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V5h6v2M7 7l.8 12.2A2 2 0 0 0 9.8 21h4.4a2 2 0 0 0 2-1.8L17 7M10 11v6M14 11v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <p class="text-sm font-bold text-muted-foreground">垃圾箱是空的</p>
        <p class="mt-1 text-xs text-muted-foreground">删除的提醒会出现在这里，随时可以恢复。</p>
      </div>

      <div v-else class="divide-y divide-border/60">
        <article v-for="item in visibleItems" :key="item.id" class="flex items-start gap-3 px-4 py-4 sm:items-center sm:px-5" data-trash-item :data-trash-id="item.id">
          <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-500/10 text-slate-500 sm:mt-0">
            <svg v-if="item.kind === 'note'" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M6 4h9l4 4v12H6z" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 12h6M9 16h4" stroke-width="1.7" stroke-linecap="round"/></svg>
            <svg v-else viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="M4 7h16M9 7V5h6v2M7 7l.8 12.2A2 2 0 0 0 9.8 21h4.4a2 2 0 0 0 2-1.8L17 7M10 11v6M14 11v6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <h2 class="truncate text-sm font-bold text-foreground">{{ item.title }}</h2>
              <span v-if="item.kind === 'note'" class="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-300">记事</span>
              <span v-else-if="item.completed_at" class="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-300">已完成</span>
            </div>
            <p v-if="item.notes" class="mt-0.5 truncate text-xs text-muted-foreground">{{ item.notes }}</p>
            <p class="mt-1 text-[11px] text-muted-foreground">
              <span v-if="item.list_name">{{ item.list_name }}</span>
              <span v-if="item.list_name" class="mx-1 opacity-40">·</span>
              删除于 {{ formatTime(item.deleted_at) }}
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-xl border border-brand-500/30 bg-brand-500/[.07] px-3 py-1.5 text-xs font-bold text-brand-600 transition hover:bg-brand-500/15 disabled:opacity-50 dark:text-brand-300"
            :disabled="restoring === item.id"
            data-trash-restore
            @click="restore(item)"
          >{{ restoring === item.id ? '恢复中…' : '恢复' }}</button>
        </article>
      </div>
      <div v-if="remaining" class="border-t border-border/60 px-4 py-3 text-center sm:px-5">
        <button type="button" class="text-xs font-bold text-brand-500 hover:underline" data-trash-more @click="visibleCount += 100">
          加载更多（还有 {{ remaining }} 条）
        </button>
      </div>
    </section>

    <Transition name="fade">
      <div v-if="toast" class="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-xl sm:bottom-8" data-trash-toast>
        {{ toast }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getTrash, restoreTrash, type TrashItem } from '../api/reminder'

const items = ref<TrashItem[]>([])
const loading = ref(true)
const restoring = ref<number | null>(null)
const visibleCount = ref(100)
const visibleItems = computed(() => items.value.slice(0, visibleCount.value))
const remaining = computed(() => Math.max(0, items.value.length - visibleItems.value.length))
const errorMsg = ref('')
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined

function showToast(message: string) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2600)
}

function formatTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await getTrash()
    items.value = res.data?.data?.items || []
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || '读取垃圾箱失败，请稍后再试'
  } finally {
    loading.value = false
  }
}

async function restore(item: TrashItem) {
  restoring.value = item.id
  errorMsg.value = ''
  try {
    await restoreTrash(item.id)
    items.value = items.value.filter((x) => x.id !== item.id)
    showToast(`已恢复「${item.title}」`)
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || '恢复失败，请稍后再试'
  } finally {
    restoring.value = null
  }
}

onMounted(load)
</script>
