<template>
  <h4 class="mt-5 text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">手机日历</h4>
  <div class="mt-2 rounded-2xl border border-border/70 p-3.5" data-calendar-sync>
    <div class="flex items-start gap-3">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/12 text-brand-600 dark:text-brand-300">
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2.5" stroke-width="1.8"/>
          <path d="M8 3v4m8-4v4M3 10h18" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M8 14h3v3H8z" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-bold">订阅到手机日历（只读）</p>
        <p class="mt-0.5 text-[11px] font-medium leading-4 text-muted-foreground">
          工作序记里的任务会自动出现在手机自带日历里；手机日历上的修改不会写回应用。
          刷新频率由手机系统决定。
        </p>
      </div>
    </div>

    <div v-if="loading" class="mt-3 h-16 animate-pulse rounded-xl bg-muted"></div>

    <div v-else-if="loadError" class="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground">
      <span>{{ loadError }}</span>
      <button class="text-xs font-bold text-brand-600 hover:underline dark:text-brand-300" @click="loadSubscription">重试</button>
    </div>

    <template v-else>
      <div class="mt-3 flex gap-2">
        <input
          ref="urlInput"
          :value="url"
          readonly
          class="compact-input min-w-0 flex-1 font-mono !text-[11px]"
          aria-label="日历订阅地址"
          data-calendar-url
          @focus="($event.target as HTMLInputElement).select()"
        />
        <button class="btn-secondary !h-10 shrink-0 !px-3 !text-xs" data-calendar-copy @click="copyUrl">
          {{ copied ? '已复制' : '复制' }}
        </button>
      </div>

      <details class="mt-3 rounded-xl bg-muted/45 px-3 py-2">
        <summary class="cursor-pointer text-[12px] font-bold text-foreground">怎么添加到手机日历</summary>
        <ol class="mt-2 space-y-1.5 text-[12px] leading-5 text-muted-foreground">
          <li><span class="font-semibold text-foreground">iPhone：</span>设置 → 日历 → 账户 → 添加账户 → 其他 → 添加已订阅的日历，粘贴上面的地址。</li>
          <li><span class="font-semibold text-foreground">安卓：</span>用系统日历的「添加日历 → 通过网址订阅」，或先用浏览器打开地址下载 .ics 再导入。</li>
          <li>手机要能访问这个地址；外网使用时请用 HTTPS 域名（部分安卓日历不接受 http）。</li>
          <li>订阅地址相当于密码，别发给别人；怀疑泄露时点下面的「重置订阅地址」。</li>
        </ol>
      </details>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button class="btn-secondary !h-9 !px-3 !text-xs" :disabled="rotating" data-calendar-rotate @click="rotate">
          {{ rotating ? '重置中…' : '重置订阅地址' }}
        </button>
        <span v-if="rotateMsg" class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{{ rotateMsg }}</span>
      </div>

      <div class="mt-4 border-t border-border/60 pt-3">
        <p class="text-sm font-bold">从手机日历导入</p>
        <p class="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          选一个日历导出的 .ics 文件，导成提醒。重复导入会跳过已有项；复杂的重复规则只导入最近一次。
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <select v-model.number="targetList" class="compact-input !h-9 !w-auto min-w-[8.5rem] !text-xs" aria-label="导入到清单" data-calendar-list>
            <option :value="0">默认清单</option>
            <option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option>
          </select>
          <label class="btn-secondary inline-flex !h-9 cursor-pointer items-center !px-3 !text-xs" :class="{ 'pointer-events-none opacity-60': importing }">
            {{ importing ? '导入中…' : '选择 .ics 文件' }}
            <input
              ref="fileInput"
              type="file"
              accept=".ics,text/calendar"
              class="sr-only"
              data-calendar-import
              @change="onFileChange"
            />
          </label>
        </div>
        <p v-if="importMsg" class="mt-2 text-[12px] leading-5" :class="importOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'" data-calendar-import-msg>
          {{ importMsg }}
        </p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getCalendarSubscription, importCalendarFile, rotateCalendarSubscription, type ReminderList } from '../api/reminder'

defineProps<{ lists: ReminderList[] }>()

const url = ref('')
const loading = ref(true)
const loadError = ref('')
const copied = ref(false)
const rotating = ref(false)
const rotateMsg = ref('')
const importing = ref(false)
const importMsg = ref('')
const importOk = ref(false)
const targetList = ref(0)
const urlInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function loadSubscription() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await getCalendarSubscription()
    const data = res.data?.data || {}
    url.value = data.url || (data.path ? window.location.origin + data.path : '')
    if (!url.value) loadError.value = '没有拿到订阅地址，请稍后重试'
  } catch (err: any) {
    loadError.value = err.response?.data?.message || '订阅地址读取失败'
  } finally {
    loading.value = false
  }
}

async function copyUrl() {
  if (!url.value) return
  try {
    await navigator.clipboard.writeText(url.value)
  } catch {
    // 内网 http 或旧浏览器没有 Clipboard API：退回选中输入框，让用户自己复制。
    urlInput.value?.focus()
    urlInput.value?.select()
    document.execCommand?.('copy')
  }
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => { copied.value = false }, 1800)
}

async function rotate() {
  if (rotating.value) return
  if (!window.confirm('重置后，旧订阅地址会立即失效，手机日历里的旧订阅需要重新添加。继续？')) return
  rotating.value = true
  rotateMsg.value = ''
  try {
    const res = await rotateCalendarSubscription()
    const data = res.data?.data || {}
    url.value = data.url || (data.path ? window.location.origin + data.path : url.value)
    rotateMsg.value = '已重置，请重新订阅'
    setTimeout(() => { rotateMsg.value = '' }, 3000)
  } catch (err: any) {
    loadError.value = err.response?.data?.message || '重置失败，请稍后重试'
  } finally {
    rotating.value = false
  }
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  importMsg.value = ''
  try {
    const res = await importCalendarFile(file, targetList.value)
    const data = res.data?.data || {}
    const created = Number(data.created || 0)
    const skipped = Number(data.skipped || 0)
    importOk.value = true
    importMsg.value = skipped > 0
      ? `已导入 ${created} 条，跳过 ${skipped} 条重复项`
      : `已导入 ${created} 条`
  } catch (err: any) {
    importOk.value = false
    importMsg.value = err.response?.data?.message || '导入失败，请确认文件是日历导出的 .ics'
  } finally {
    importing.value = false
    input.value = ''
  }
}

onMounted(loadSubscription)
</script>
