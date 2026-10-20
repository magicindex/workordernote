<template>
  <!-- 管理员的安装包上传/下架。放在「偏好设置」的配置分组下面：
       安卓客户端的版本号/更新说明/下载地址是普通配置项，安装包本身必须是文件，单独一块。 -->
  <div v-if="isAdmin" class="surface mt-4 rounded-2xl p-4 sm:p-6" data-android-uploader>
    <h3 class="text-sm font-bold text-foreground">安卓客户端安装包</h3>
    <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
      上传后，「版本信息 → 安卓客户端」那张卡片上就会出现版本号、大小、下载按钮和二维码。
      文件名会按版本号自动生成，同一版本重复上传即覆盖。
    </p>

    <div v-if="client" class="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-[12px] font-medium text-muted-foreground">
      <template v-if="client.has_apk">
        当前：{{ client.file_name }} · {{ sizeText }}<span v-if="client.uploaded_at"> · 上传于 {{ uploadedText }}</span>
      </template>
      <template v-else>当前还没有安装包。</template>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <label class="text-xs font-bold text-muted-foreground" for="android-version">版本号</label>
      <input
        id="android-version"
        v-model="version"
        class="compact-input !w-28"
        maxlength="20"
        placeholder="0.1.0"
        data-android-version
      />
      <input
        ref="fileInput"
        type="file"
        accept=".apk,application/vnd.android.package-archive"
        class="block w-full max-w-xs text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500/12 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-600 sm:w-auto"
        data-android-file
        @change="onPick"
      />
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button class="btn-primary !h-9 !px-4 !text-xs" :disabled="!file || uploading" data-android-submit @click="submit">
        {{ uploading ? '上传中…' : '上传 / 替换' }}
      </button>
      <button
        v-if="client?.has_apk"
        class="btn-secondary !h-9 !px-4 !text-xs"
        :disabled="uploading"
        data-android-delete
        @click="remove"
      >下架安装包</button>
      <span v-if="msg" class="text-xs font-semibold" :class="ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'">{{ msg }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { deleteAndroidApk, getAndroidClient, uploadAndroidApk } from '../api/reminder'
import { useAuthStore } from '../stores/auth'

interface AndroidClient {
  version: string
  file_name: string
  file_size: number
  uploaded_at: string
  has_apk: boolean
}

const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)

const client = ref<AndroidClient | null>(null)
const version = ref('0.1.0')
const file = ref<File | null>(null)
const uploading = ref(false)
const msg = ref('')
const ok = ref(true)
const fileInput = ref<HTMLInputElement | null>(null)

const sizeText = computed(() => {
  const n = client.value?.file_size || 0
  if (!n) return '—'
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
})
const uploadedText = computed(() => {
  const m = (client.value?.uploaded_at || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : ''
})

async function load() {
  try {
    const res = await getAndroidClient()
    client.value = res.data?.data || null
    if (client.value?.version) version.value = client.value.version
  } catch { /* 读不到就不显示当前状态 */ }
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  file.value = input.files?.[0] || null
  msg.value = ''
}

async function submit() {
  if (!file.value) return
  uploading.value = true
  msg.value = ''
  try {
    const res = await uploadAndroidApk(file.value, version.value.trim() || '0.0.0')
    client.value = res.data?.data || client.value
    ok.value = true
    msg.value = '上传成功'
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
  } catch (err: any) {
    ok.value = false
    msg.value = err.response?.data?.message || '上传失败'
  } finally {
    uploading.value = false
  }
}

async function remove() {
  uploading.value = true
  msg.value = ''
  try {
    const res = await deleteAndroidApk()
    client.value = res.data?.data || null
    ok.value = true
    msg.value = '已下架'
  } catch (err: any) {
    ok.value = false
    msg.value = err.response?.data?.message || '下架失败'
  } finally {
    uploading.value = false
  }
}

onMounted(() => { if (isAdmin.value) void load() })
</script>
