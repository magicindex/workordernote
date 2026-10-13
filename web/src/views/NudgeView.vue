<template>
  <!-- 系统偏好 nudge_enabled 关掉时这一页整体不渲染（侧栏入口也一起藏，
       与信用卡/记事本栏目同一个做法：关掉只隐藏，数据保留）。 -->
  <div v-if="authStore.nudgeEnabled" class="mx-auto max-w-6xl" data-nudge-page>
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-7">
      <div class="min-w-0">
        <p class="mb-1 text-xs font-extrabold uppercase tracking-[.18em] text-sky-500 sm:mb-2">多人提醒</p>
        <h1 class="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">提醒@他</h1>
        <p class="mt-0.5 text-[13px] text-muted-foreground sm:mt-2">
          把提醒推给别的用户；别人提醒你的也在这里。对方「已收到 / 已完成」都会回到你的通知中心。
        </p>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-xl bg-brand-500 px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50 sm:rounded-2xl sm:px-5 sm:text-sm"
        data-nudge-new
        @click="openComposer"
      >提醒@他</button>
    </div>

    <div
      v-if="errorMsg"
      class="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/[.06] px-4 py-3 text-xs font-bold text-rose-500"
      data-nudge-error
    >
      <span>{{ errorMsg }}</span>
      <button type="button" class="shrink-0 underline" @click="errorMsg = ''">知道了</button>
    </div>

    <div v-if="loading" class="grid gap-4 lg:grid-cols-2">
      <div v-for="n in 4" :key="n" class="h-28 animate-pulse rounded-[24px] bg-surface"></div>
    </div>

    <div v-else class="grid gap-4 lg:grid-cols-2">
      <!-- 左列：我提醒他人 -->
      <section class="rounded-[24px] border border-border/70 bg-surface/85 p-4 shadow-card backdrop-blur-xl sm:p-5" data-nudge-column="sent">
        <header class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-sm font-extrabold">我提醒他人</h2>
          <span class="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-bold text-sky-600 dark:text-sky-300">
            待完成 {{ box.counts.sent_pending }}
          </span>
        </header>
        <p v-if="!box.sent.length" class="rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-10 text-center text-xs text-muted-foreground">
          还没有提醒过别人。点右上角「提醒@他」推一条。
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="item in box.sent"
            :key="item.id"
            class="rounded-2xl border border-border/70 bg-surface/70 p-3.5"
            data-nudge-item
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="whitespace-pre-wrap break-words text-sm font-bold text-foreground">{{ item.content }}</p>
                <p v-if="item.note" class="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{{ item.note }}</p>
                <p class="mt-1.5 text-[11px] font-medium text-muted-foreground/80">
                  发给 <b class="text-foreground/80">{{ item.to_username || '对方' }}</b>
                  · {{ formatTime(item.created_at) }}
                  <template v-if="item.due_at"> · 期望 {{ formatDue(item.due_at) }}</template>
                </p>
              </div>
              <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusClass(item)">
                {{ statusText(item) }}
              </span>
            </div>
            <div class="mt-2.5 flex items-center gap-2">
              <button
                v-if="item.can_delete"
                type="button"
                class="rounded-xl border border-border bg-surface px-3 py-1.5 text-[11px] font-bold text-muted-foreground transition hover:bg-muted"
                title="撤回后你和他都不再看到这条"
                data-nudge-delete
                @click="remove(item)"
              >撤回</button>
              <span v-else class="text-[11px] text-muted-foreground/70">对方已完成，不能撤回</span>
            </div>
          </li>
        </ul>
      </section>

      <!-- 右列：别人提醒我 -->
      <section class="rounded-[24px] border border-border/70 bg-surface/85 p-4 shadow-card backdrop-blur-xl sm:p-5" data-nudge-column="received">
        <header class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-sm font-extrabold">别人提醒我</h2>
          <span class="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-300">
            待处理 {{ box.counts.received_pending }}
          </span>
        </header>
        <p v-if="!box.received.length" class="rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-10 text-center text-xs text-muted-foreground">
          现在没有别人提醒你的事情。
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="item in box.received"
            :key="item.id"
            class="rounded-2xl border border-border/70 bg-surface/70 p-3.5"
            :class="{ 'border-sky-500/30 bg-sky-500/[.04]': !item.read_at && !item.done_at }"
            data-nudge-item
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="whitespace-pre-wrap break-words text-sm font-bold text-foreground">{{ item.content }}</p>
                <p v-if="item.note" class="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{{ item.note }}</p>
                <p class="mt-1.5 text-[11px] font-medium text-muted-foreground/80">
                  来自 <b class="text-foreground/80">{{ item.from_username || '对方' }}</b>
                  · {{ formatTime(item.created_at) }}
                  <template v-if="item.due_at"> · 期望 {{ formatDue(item.due_at) }}</template>
                </p>
              </div>
              <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusClass(item)">
                {{ statusText(item) }}
              </span>
            </div>
            <div class="mt-2.5 flex items-center gap-2">
              <template v-if="!item.done_at">
                <button
                  v-if="!item.read_at"
                  type="button"
                  class="rounded-xl border border-border bg-surface px-3 py-1.5 text-[11px] font-bold text-foreground transition hover:bg-muted"
                  data-nudge-read
                  @click="markRead(item)"
                >已收到</button>
                <button
                  type="button"
                  class="rounded-xl bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-300"
                  data-nudge-done
                  @click="markDone(item)"
                >已完成</button>
              </template>
              <button
                type="button"
                class="rounded-xl border border-border bg-surface px-3 py-1.5 text-[11px] font-bold text-muted-foreground transition hover:bg-muted"
                title="删除后你和他都不再看到这条"
                data-nudge-delete
                @click="remove(item)"
              >删除</button>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <Modal v-model="composerOpen" title="提醒@他" size="lg">
      <form class="space-y-4" @submit.prevent="submit">
        <label class="block">
          <span class="text-xs font-bold text-foreground">提醒谁 <span class="text-rose-500">*</span></span>
          <select v-model.number="form.toUserId" class="modal-field mt-2" data-nudge-target>
            <option :value="0" disabled>请选择要提醒的用户</option>
            <option v-for="user in users" :key="user.id" :value="user.id">{{ user.username }}</option>
          </select>
          <!-- 只有一个账号时这个页面没法用（不能提醒自己），文案要给出**真实可行**的
               下一步：本应用没有「管理员新建用户」的界面，账号是靠注册页开通的
               （见 server/user/service.go 的 Register），所以要先在「系统配置」里
               打开「允许注册」。 -->
          <span v-if="!users.length" class="mt-2 block text-[11px] leading-5 text-muted-foreground">
            当前只有你一个账号：这个页面是多个人之间互相提醒用的，<b>不能提醒自己</b>。
            先到「系统配置」里打开<b>允许注册</b>，再用注册页添加其他账号，之后就能互相提醒了。
          </span>
        </label>
        <label class="block">
          <span class="text-xs font-bold text-foreground">提醒内容 <span class="text-rose-500">*</span></span>
          <textarea
            v-model.trim="form.content"
            class="modal-field mt-2 min-h-[76px] resize-y"
            maxlength="200"
            placeholder="例如：把本周周报发我"
            data-nudge-content
          ></textarea>
        </label>
        <label class="block">
          <span class="text-xs font-bold text-foreground">备注 <small class="font-medium text-muted-foreground">可选</small></span>
          <input v-model.trim="form.note" class="modal-field mt-2" maxlength="500" placeholder="补充说明，例如：今天下班前" />
        </label>
        <div>
          <span class="text-xs font-bold text-foreground">期望完成时间 <small class="font-medium text-muted-foreground">可选</small></span>
          <div class="mt-2 flex gap-2">
            <input v-model="form.dueDate" type="date" class="modal-field" />
            <input v-model="form.dueTime" type="time" class="modal-field max-w-[140px]" />
          </div>
          <p class="mt-1.5 text-[11px] text-muted-foreground">只作为提示显示给对方，不会自动弹窗，也不算逾期。</p>
        </div>
        <p v-if="formError" class="rounded-2xl bg-rose-500/[.07] px-4 py-2.5 text-xs font-bold text-rose-500" data-nudge-form-error>{{ formError }}</p>
        <div class="flex justify-end gap-3 pt-1">
          <button type="button" class="rounded-xl border border-border bg-surface px-4 py-2 text-xs font-bold text-foreground transition hover:bg-muted" @click="composerOpen = false">取消</button>
          <button
            type="submit"
            class="rounded-xl bg-brand-500 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
            :disabled="busy || !form.toUserId || !form.content"
            data-nudge-submit
          >{{ busy ? '发送中…' : '发送提醒' }}</button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '../components/Modal.vue'
import { useAuthStore } from '../stores/auth'
import {
  createNudge, deleteNudge, doneNudge, listNudges, listNudgeUsers, readNudge,
  type Nudge, type NudgeBox, type NudgeUser,
} from '../api/reminder'

const authStore = useAuthStore()
const router = useRouter()
const box = ref<NudgeBox>({ sent: [], received: [], counts: { received_pending: 0, received_unread: 0, sent_pending: 0, sent_done: 0 } })
const users = ref<NudgeUser[]>([])
const loading = ref(true)
const busy = ref(false)
const errorMsg = ref('')
const formError = ref('')
const composerOpen = ref(false)
const form = reactive({ toUserId: 0, content: '', note: '', dueDate: '', dueTime: '' })

function describe(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
  return message || fallback
}

async function load() {
  try {
    const { data } = await listNudges()
    box.value = data.data
    errorMsg.value = ''
  } catch (error) {
    errorMsg.value = describe(error, '读取「提醒@他」失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

async function loadUsers() {
  try {
    const { data } = await listNudgeUsers()
    users.value = data.data || []
  } catch {
    users.value = []
  }
}

function openComposer() {
  form.toUserId = 0
  form.content = ''
  form.note = ''
  form.dueDate = ''
  form.dueTime = ''
  formError.value = ''
  composerOpen.value = true
  void loadUsers()
}

async function submit() {
  if (!form.toUserId || !form.content) return
  busy.value = true
  formError.value = ''
  try {
    let dueAt: string | null = null
    if (form.dueDate) {
      const stamp = new Date(`${form.dueDate}T${form.dueTime || '23:59'}:00`)
      if (!Number.isNaN(stamp.getTime())) dueAt = stamp.toISOString()
    }
    await createNudge({ to_user_id: form.toUserId, content: form.content, note: form.note, due_at: dueAt })
    composerOpen.value = false
    await load()
    changed()
  } catch (error) {
    formError.value = describe(error, '发送失败，请稍后重试')
  } finally {
    busy.value = false
  }
}

// 本标签页自己改完，服务端广播会跳过发起者（见 realtime.go 的 originClientID），
// 所以侧栏角标得靠这条本地事件自己刷新——与 HomeView、通知中心的做法一致。
function changed() { window.dispatchEvent(new CustomEvent('reminder-data-changed')) }

async function markRead(item: Nudge) {
  try {
    await readNudge(item.id)
    await load()
    changed()
  } catch (error) {
    errorMsg.value = describe(error, '标记「已收到」失败')
  }
}

async function markDone(item: Nudge) {
  try {
    await doneNudge(item.id)
    await load()
    changed()
  } catch (error) {
    errorMsg.value = describe(error, '标记「已完成」失败')
  }
}

async function remove(item: Nudge) {
  try {
    await deleteNudge(item.id)
    await load()
    changed()
  } catch (error) {
    errorMsg.value = describe(error, '删除失败')
  }
}

/** 状态：已完成 > 已收到 > 待接收（发起人视角没有「已收到」这一步之前显示「待查看」）。 */
function statusText(item: Nudge) {
  if (item.done_at) return '已完成'
  if (item.read_at) return item.direction === 'sent' ? '对方已收到' : '已收到'
  return item.direction === 'sent' ? '待查看' : '待处理'
}

function statusClass(item: Nudge) {
  if (item.done_at) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
  if (item.read_at) return 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
  return item.direction === 'sent' ? 'bg-slate-500/10 text-muted-foreground' : 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
}

function formatTime(value: string) {
  const d = new Date(value)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

function formatDue(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

// 别的设备/别的标签页发了提醒、或者对方点了回执：跟着刷新，不用手动重进页面。
function onDataChanged() {
  void load()
}

// 关掉偏好之后直接访问这个地址（旧书签、别人发的链接）不该看到页面：
// 送回首页，和栏目关闭时 HomeView 的处理一致。
watch(() => authStore.nudgeEnabled, (on) => {
  if (!on) void router.replace('/admin')
})

onMounted(() => {
  if (!authStore.nudgeEnabled) {
    void router.replace('/admin')
    return
  }
  void load()
  window.addEventListener('reminder-data-changed', onDataChanged)
})
onBeforeUnmount(() => {
  window.removeEventListener('reminder-data-changed', onDataChanged)
})
</script>
