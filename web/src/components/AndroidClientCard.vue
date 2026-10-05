<template>
  <!-- 安卓客户端：软件信息卡片。版本号、更新说明、下载地址都来自「系统配置 → 安卓客户端」，
       内网/外网两条地址在这里切换（选哪条存本地，跟着人走）。 -->
  <h4 class="mt-5 text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">安卓客户端</h4>
  <div class="mt-2 rounded-2xl border border-border/70 p-3.5" data-android-card>
    <div class="flex flex-wrap items-center gap-2">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M7 9h10v6a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9Z" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M9.5 9 8.3 6.6m6.2 2.4 1.2-2.4M10 12.5v1m4-1v1M5 10v5m14-5v5" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
      </span>
      <div class="min-w-0 flex-1">
        <p class="flex flex-wrap items-baseline gap-2">
          <span class="text-sm font-bold">工作序记 安卓客户端</span>
          <span class="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold leading-none text-emerald-600 dark:text-emerald-400">
            {{ client?.version || '—' }}
          </span>
          <span v-if="sizeText" class="text-[11px] font-medium text-muted-foreground">{{ sizeText }}</span>
        </p>
        <p class="mt-0.5 text-[11px] font-medium text-muted-foreground">
          Android 7.0 及以上（minSdk {{ client?.min_sdk || 24 }}）
          <span v-if="uploadedText"> · 上传于 {{ uploadedText }}</span>
        </p>
      </div>
    </div>

    <p v-if="client?.notes" class="mt-3 whitespace-pre-line text-[13px] leading-5 text-muted-foreground" data-android-notes>{{ client.notes }}</p>

    <div v-if="!client?.has_apk" class="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-[12px] font-medium text-muted-foreground">
      管理员还没有上传安装包（系统配置 → 安卓客户端里可以上传）。
    </div>

    <div v-else class="mt-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] font-bold text-muted-foreground">下载地址</span>
        <div class="inline-flex rounded-xl border border-border bg-muted/60 p-0.5" role="group" aria-label="选择下载地址">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: addr === 'lan' }"
            data-android-addr="lan"
            :disabled="!client.lan_url"
            @click="setAddr('lan')"
          >内网</button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: addr === 'wan' }"
            data-android-addr="wan"
            :disabled="!client.wan_url"
            :title="client.wan_url ? '' : '还没配置外网地址'"
            @click="setAddr('wan')"
          >外网</button>
        </div>
        <span class="text-[11px] font-medium text-muted-foreground">{{ addrHint }}</span>
      </div>

      <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div class="min-w-0 flex-1">
          <p class="break-all rounded-xl bg-muted/60 px-3 py-2 text-[12px] font-medium text-muted-foreground" data-android-url>{{ activeURL }}</p>
          <a
            class="btn-primary mt-2 inline-flex !h-9 !px-4 !text-xs"
            :href="activeURL"
            data-android-download
            download
          >下载 APK</a>
          <p v-if="client.sha256" class="mt-2 break-all text-[11px] font-medium text-muted-foreground">
            sha256 {{ client.sha256.slice(0, 24) }}…
          </p>
          <p class="mt-2 text-[11px] leading-4 text-muted-foreground">
            手机浏览器扫右边的二维码即可下载安装（首次安装需要在系统里允许「安装未知来源应用」）。
          </p>
        </div>
        <img
          v-if="activeURL"
          :src="qrSrc"
          alt="下载二维码"
          data-android-qr
          class="h-[168px] w-[168px] shrink-0 self-center rounded-xl border border-border bg-white p-1.5 sm:self-start"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getAndroidClient } from '../api/reminder'

const props = defineProps<{ open: boolean }>()

interface AndroidClient {
  version: string
  notes: string
  file_name: string
  file_size: number
  sha256: string
  uploaded_at: string
  has_apk: boolean
  lan_url: string
  wan_url: string
  min_sdk: number
}

const client = ref<AndroidClient | null>(null)
const ADDR_KEY = 'ui_android_addr'
const addr = ref<'lan' | 'wan'>('lan')

const activeURL = computed(() => {
  if (!client.value) return ''
  if (addr.value === 'wan' && client.value.wan_url) return client.value.wan_url
  return client.value.lan_url || client.value.wan_url || ''
})
// 二维码由服务端出图（/api/reminder/android/qrcode）：地址怎么解析由后端统一决定，
// 内外网切换只要换个 addr 参数，前端不自己拼 URL
const qrSrc = computed(() => `/api/reminder/android/qrcode?addr=${addr.value}&size=320`)
const addrHint = computed(() => {
  if (addr.value === 'wan') return '在外面（4G/5G）用这条'
  return client.value?.lan_url ? '同一个局域网时用这条最快' : '还没配置内网地址'
})
const sizeText = computed(() => {
  const n = client.value?.file_size || 0
  if (!n) return ''
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
})
const uploadedText = computed(() => {
  const v = client.value?.uploaded_at || ''
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : ''
})

function setAddr(next: 'lan' | 'wan') {
  addr.value = next
  try { localStorage.setItem(ADDR_KEY, next) } catch { /* 隐私模式忽略 */ }
}

async function load() {
  try {
    const res = await getAndroidClient()
    client.value = res.data?.data || null
    // 没配外网地址时别停在「外网」那一档
    if (addr.value === 'wan' && !client.value?.wan_url) addr.value = 'lan'
  } catch {
    client.value = null
  }
}

try {
  const saved = localStorage.getItem(ADDR_KEY)
  if (saved === 'wan' || saved === 'lan') addr.value = saved
} catch { /* 隐私模式忽略 */ }

watch(() => props.open, (open) => { if (open) void load() }, { immediate: true })
</script>
