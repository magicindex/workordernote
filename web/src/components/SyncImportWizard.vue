<template>
  <!-- 新设备导入：新装的机器上把老机器的清单与内容一次性搬过来。
       三步：连对端 → 选账号（本机没有就顺便建）→ 导入并配好定时同步。 -->
  <div class="surface rounded-2xl p-4 sm:p-6" data-sync-import>
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 class="text-sm font-bold text-foreground">从另一台设备导入（新设备初始化）</h3>
        <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
          新机器刚装好、还是空的？填上老机器的地址与同步令牌，选要搬过来的账号，
          一键把清单、提醒、记事与完成记录拉过来（本机没有同名账号会顺便建一个），并配好定时同步。
        </p>
      </div>
      <button v-if="step === 'done'" class="btn-secondary !h-8 !px-3 !text-xs" data-import-again @click="reset">再导一次</button>
    </div>

    <!-- 步骤 1：连接对端 -->
    <div v-if="step === 'connect'" class="mt-4 space-y-3">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="text-xs font-bold text-foreground">老设备的地址</span>
          <input v-model="peerURL" class="input-field mt-1.5 !py-2" placeholder="http://192.168.1.10:8906" data-import-peer />
        </label>
        <label class="block">
          <span class="text-xs font-bold text-foreground">同步令牌</span>
          <input v-model="token" class="input-field mt-1.5 !py-2" placeholder="在老设备的「双机同步」里复制" data-import-token />
        </label>
      </div>
      <button class="btn-primary !h-9 !px-4 !text-xs" :disabled="busy" data-import-connect @click="connect">
        {{ busy ? '连接中…' : '连接对端' }}
      </button>
      <p class="text-[11px] leading-4 text-muted-foreground">
        令牌在两台机器上是同一个：到老设备的「系统配置 → 双机同步」里点「显示令牌」复制过来即可。
      </p>
    </div>

    <!-- 步骤 2：选账号 -->
    <div v-else-if="step === 'pick'" class="mt-4">
      <div class="rounded-xl bg-muted/60 px-3 py-2 text-[12px] font-medium text-muted-foreground" data-import-peer-info>
        已连上：{{ profiles?.app_name }} {{ profiles?.version }}
        <span class="text-muted-foreground/80">（实例 {{ (profiles?.instance_id || '').slice(0, 8) }}）</span>
      </div>

      <div class="mt-3 space-y-2">
        <label
          v-for="u in profiles?.users || []"
          :key="u.username"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/70 px-3 py-2.5"
          :data-import-user="u.username"
        >
          <input v-model="picked" type="checkbox" :value="u.username" class="h-4 w-4 rounded border-border" data-import-check />
          <span class="min-w-0 flex-1">
            <span class="flex flex-wrap items-baseline gap-2">
              <b class="text-sm">{{ u.username }}</b>
              <span class="rounded-full bg-muted px-1.5 text-[11px] font-bold text-muted-foreground">{{ u.role === 'admin' ? '管理员' : '普通用户' }}</span>
              <span v-if="u.exists_local" class="rounded-full bg-emerald-500/12 px-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400" data-import-exists>本机已有</span>
              <span v-else class="rounded-full bg-amber-500/12 px-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">本机没有，将一并创建</span>
            </span>
            <span class="mt-0.5 block text-[11px] font-medium text-muted-foreground">
              {{ u.lists }} 个清单 · {{ u.reminders }} 条内容 · {{ u.completions }} 条完成记录
            </span>
          </span>
          <input
            v-if="!u.exists_local"
            v-model="passwords[u.username]"
            type="text"
            class="compact-input !w-40"
            :placeholder="'初始密码（留空自动生成）'"
            :data-import-password="u.username"
          />
        </label>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-2 text-xs font-semibold text-foreground">
          同步方向
          <select v-model="direction" class="compact-input !w-auto" data-import-direction>
            <option value="both">双向（两台互相同步）</option>
            <option value="pull">只从对端拉取</option>
            <option value="push">只推送到对端</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-xs font-semibold text-foreground">
          自动同步间隔
          <select v-model.number="interval" class="compact-input !w-auto" data-import-interval>
            <option :value="0">关闭（只手动）</option>
            <option :value="5">每 5 分钟</option>
            <option :value="15">每 15 分钟</option>
            <option :value="60">每小时</option>
          </select>
        </label>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button class="btn-secondary !h-9 !px-4 !text-xs" @click="reset">返回</button>
        <button class="btn-primary !h-9 !px-4 !text-xs" :disabled="busy || !picked.length" data-import-run @click="run">
          {{ busy ? '导入中…' : `导入 ${picked.length} 个账号` }}
        </button>
        <span class="text-[11px] text-muted-foreground">导入会立刻同步一次，数据量大时可能要几十秒。</span>
      </div>
    </div>

    <!-- 步骤 3：结果 -->
    <div v-else class="mt-4 space-y-3">
      <div class="rounded-xl bg-emerald-500/10 px-3 py-2 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400" data-import-done>
        导入完成：{{ result?.imported_users?.join('、') }}
      </div>

      <div v-if="result?.created_accounts?.length" class="rounded-xl border border-amber-500/30 bg-amber-500/8 p-3" data-import-created>
        <p class="text-xs font-bold text-amber-700 dark:text-amber-400">新创建的账号（初始密码只显示这一次）</p>
        <ul class="mt-1.5 space-y-1 text-[12px]">
          <li v-for="a in result.created_accounts" :key="a.username" class="flex flex-wrap items-center gap-2" :data-import-created-user="a.username">
            <b>{{ a.username }}</b>
            <span v-if="a.password" class="rounded-md bg-surface px-2 py-0.5 font-mono" data-import-password-shown>{{ a.password }}</span>
            <span v-else class="text-muted-foreground">（使用你填写的密码）</span>
            <span class="text-muted-foreground">· {{ a.role === 'admin' ? '管理员' : '普通用户' }}</span>
          </li>
        </ul>
        <p class="mt-1.5 text-[11px] leading-4 text-muted-foreground">
          让本人用这个密码登录（登录后可在「个人资料」里改），或者你在「用户管理」里重置。
        </p>
      </div>

      <div class="rounded-xl bg-muted/60 px-3 py-2 text-[12px] font-medium text-muted-foreground" data-import-stats>
        同步结果：{{ result?.sync?.message || '—' }}
      </div>

      <button class="btn-primary !h-9 !px-4 !text-xs" @click="emit('imported')">完成，刷新同步面板</button>
    </div>

    <p v-if="error" class="mt-3 text-xs font-semibold text-rose-500" data-import-error>{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { previewSyncImport, runSyncImport, type SyncProfiles } from '../api/reminder'

const emit = defineEmits<{ (e: 'imported'): void }>()

type Step = 'connect' | 'pick' | 'done'
const step = ref<Step>('connect')
const peerURL = ref('')
const token = ref('')
const profiles = ref<SyncProfiles | null>(null)
const picked = ref<string[]>([])
const passwords = ref<Record<string, string>>({})
const direction = ref('both')
const interval = ref(5)
const busy = ref(false)
const error = ref('')
const result = ref<{
  created_accounts: { username: string; password?: string; role: string; generated: boolean }[]
  imported_users: string[]
  sync: { message?: string }
} | null>(null)

function reset() {
  step.value = 'connect'
  profiles.value = null
  picked.value = []
  passwords.value = {}
  result.value = null
  error.value = ''
}

async function connect() {
  error.value = ''
  if (!peerURL.value.trim() || !token.value.trim()) {
    error.value = '请填写对端地址与同步令牌'
    return
  }
  busy.value = true
  try {
    const res = await previewSyncImport({ peer_url: peerURL.value.trim(), token: token.value.trim() })
    profiles.value = res.data?.data || null
    // 默认勾选「本机还没有」的账号——那正是新设备最需要搬过来的
    picked.value = (profiles.value?.users || []).filter((u) => !u.exists_local).map((u) => u.username)
    if (!picked.value.length) picked.value = (profiles.value?.users || []).map((u) => u.username)
    step.value = 'pick'
  } catch (err: any) {
    error.value = err.response?.data?.message || '连接对端失败'
  } finally {
    busy.value = false
  }
}

async function run() {
  error.value = ''
  busy.value = true
  try {
    const res = await runSyncImport({
      peer_url: peerURL.value.trim(),
      token: token.value.trim(),
      usernames: picked.value,
      passwords: passwords.value,
      create_missing: true,
      direction: direction.value,
      interval_minutes: interval.value,
    })
    result.value = res.data?.data || null
    step.value = 'done'
  } catch (err: any) {
    error.value = err.response?.data?.message || '导入失败'
  } finally {
    busy.value = false
  }
}
</script>
