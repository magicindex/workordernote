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
      v-if="toast"
      class="mb-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/[.06] px-4 py-2.5 text-xs font-bold text-emerald-600 dark:text-emerald-300"
      data-nudge-toast
    >{{ toast }}</div>

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
            class="rounded-2xl border p-3.5"
            :class="isOverdue(item) ? 'border-rose-500/60 bg-rose-500/[.07] ring-1 ring-rose-500/30' : 'border-border/70 bg-surface/70'"
            data-nudge-item
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="whitespace-pre-wrap break-words text-sm font-bold text-foreground">{{ item.content }}</p>
                <p v-if="item.note" class="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{{ item.note }}</p>
                <p class="mt-1.5 text-[11px] font-medium text-muted-foreground/80">
                  发给 <b class="text-foreground/80">{{ item.to_username || '对方' }}</b>
                  · {{ formatTime(item.created_at) }}
                  <template v-if="item.due_at">
                    · <span :class="isOverdue(item) ? 'font-bold text-rose-500' : ''">期望 {{ formatDue(item.due_at) }}</span>
                  </template>
                </p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusClass(item)">
                  {{ statusText(item) }}
                </span>
                <span
                  v-if="isOverdue(item)"
                  class="shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-extrabold leading-none text-white shadow-sm"
                  data-nudge-overdue
                >已逾期{{ overdueDays(item) ? ` ${overdueDays(item)} 天` : '' }}</span>
              </div>
            </div>
            <div class="mt-2.5 flex items-center gap-2">
              <!-- 「提醒一下」（用户 2026-10-13）：再即时推一次，对方那边立刻弹窗 -->
              <button
                v-if="!item.done_at"
                type="button"
                class="rounded-xl bg-sky-500/10 px-3 py-1.5 text-[11px] font-bold text-sky-600 transition hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-300"
                title="立即再提醒对方一次（对方会收到站内弹窗）"
                data-nudge-remind
                :disabled="busyId === item.id"
                @click="remindAgain(item)"
              >{{ busyId === item.id ? '发送中…' : '提醒一下' }}</button>
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
        <p v-if="!receivedRows.length" class="rounded-2xl border border-dashed border-border bg-surface/40 px-4 py-10 text-center text-xs text-muted-foreground">
          现在没有别人提醒你的事情。
        </p>
        <ul v-else class="space-y-2">
          <li
            v-for="item in receivedRows"
            :key="item.id"
            class="rounded-2xl border p-3.5"
            :class="isOverdue(item)
              ? 'border-rose-500/60 bg-rose-500/[.07] ring-1 ring-rose-500/30'
              : { 'border-border/70 bg-surface/70': true, 'border-sky-500/30 bg-sky-500/[.04]': !item.read_at && !item.done_at }"
            data-nudge-item
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="whitespace-pre-wrap break-words text-sm font-bold text-foreground">{{ item.content }}</p>
                <p v-if="item.note" class="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{{ item.note }}</p>
                <p class="mt-1.5 text-[11px] font-medium text-muted-foreground/80">
                  来自 <b class="text-foreground/80">{{ item.from_username || '对方' }}</b>
                  · {{ formatTime(item.created_at) }}
                  <template v-if="item.due_at">
                    · <span :class="isOverdue(item) ? 'font-bold text-rose-500' : ''">期望 {{ formatDue(item.due_at) }}</span>
                  </template>
                </p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" :class="statusClass(item)">
                  {{ statusText(item) }}
                </span>
                <!-- 「已逾期」（用户 2026-10-15）：期望时间过了还没完成就醒目标出来 -->
                <span
                  v-if="isOverdue(item)"
                  class="shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-extrabold leading-none text-white shadow-sm"
                  data-nudge-overdue
                >已逾期{{ overdueDays(item) ? ` ${overdueDays(item)} 天` : '' }}</span>
              </div>
            </div>
            <div class="mt-2.5 flex flex-wrap items-center gap-2">
              <template v-if="!item.done_at && !item.saved_done">
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
                <!-- 「保存到清单」（用户 2026-10-13）：把别人推来的提醒变成自己的待办任务，
                     在清单里勾完这张卡也会跟着变成已完成 -->
                <button
                  v-if="!item.reminder_id"
                  type="button"
                  class="rounded-xl bg-brand-500/10 px-3 py-1.5 text-[11px] font-bold text-brand-600 transition hover:bg-brand-500/20 dark:text-brand-300"
                  data-nudge-save
                  @click="openSave(item)"
                >保存到清单</button>
                <span
                  v-else
                  class="rounded-xl bg-brand-500/10 px-3 py-1.5 text-[11px] font-bold text-brand-600 dark:text-brand-300"
                  data-nudge-saved
                >已存到「{{ item.list_name || '清单' }}」{{ item.saved_done ? '（已完成）' : '' }}</span>
              </template>
              <!-- 完成之后（不管是本页点的「已完成」，还是在清单里勾完同步过来的 done_at）
                   整张卡片从「别人提醒我」里消失（receivedRows 过滤掉），
                   只在通知中心留一条回执 —— 用户 2026-10-26 的口径。 -->
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

    <!-- 保存到清单：选一个自己的清单，把它变成一条待办任务 -->
    <Modal v-model="saveOpen" title="保存到清单" size="md">
      <p class="text-xs leading-5 text-muted-foreground">
        把这条提醒存成自己清单里的待办任务；在清单里勾完，这张卡片也会跟着变成「已完成」，
        对方同样会收到回执。
      </p>
      <p class="mt-3 rounded-2xl bg-muted/50 px-3.5 py-2.5 text-sm font-bold text-foreground">{{ saveTarget?.content }}</p>
      <label class="mt-4 block">
        <span class="text-xs font-bold text-foreground">存到哪个清单</span>
        <select v-model.number="saveListId" class="modal-field mt-2" data-nudge-save-list>
          <option :value="0" disabled>请选择清单</option>
          <option v-for="l in lists" :key="l.id" :value="l.id">{{ l.name }}</option>
        </select>
      </label>
      <p v-if="saveError" class="mt-3 rounded-2xl bg-rose-500/[.07] px-4 py-2.5 text-xs font-bold text-rose-500" data-nudge-save-error>{{ saveError }}</p>
      <div class="mt-5 flex justify-end gap-3">
        <button type="button" class="rounded-xl border border-border bg-surface px-4 py-2 text-xs font-bold text-foreground transition hover:bg-muted" @click="saveOpen = false">取消</button>
        <button
          type="button"
          class="rounded-xl bg-brand-500 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          :disabled="!saveListId || savingNudge"
          data-nudge-save-submit
          @click="submitSave"
        >{{ savingNudge ? '保存中…' : '保存' }}</button>
      </div>
    </Modal>

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
          <p class="mt-1.5 text-[11px] text-muted-foreground">只作为提示显示给对方，不会自动弹窗；过了这个时间还没完成，双方的卡片上都会醒目标出「已逾期」。</p>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '../components/Modal.vue'
import { useAuthStore } from '../stores/auth'
import request from '../api/request'
import {
  createNudge, deleteNudge, doneNudge, listNudges, listNudgeUsers, readNudge, remindNudgeAgain, saveNudgeToList,
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
// 「保存到清单」：选一个自己的清单
const lists = ref<{ id: number; name: string }[]>([])
const saveOpen = ref(false)
const saveTarget = ref<Nudge | null>(null)
const saveListId = ref(0)
const saveError = ref('')
const savingNudge = ref(false)
// 「提醒一下」：正在发送的那条（按 id 显示「发送中…」）
const busyId = ref(0)
const toast = ref('')
// 每分钟对一次表：页面一直开着时，「已逾期」标记到点自己就出来（与首页看板同一做法）
const clockNow = ref(Date.now())
let clockTimer: number | undefined

function describe(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
  return message || fallback
}

/**
 * 「别人提醒我」这一列实际渲染的行（用户 2026-10-26：「别人提醒我的 完成后没有自动删除」）：
 * 只要点了「已完成」（或在清单里勾完同步过来 done_at），这条就从这一列消失 ——
 * 不论有没有保存到清单。它只是别人发来的一条消息，做完就完了；通知中心仍留回执，
 * 接口数据也保留，不会影响对方那一侧的「已完成」状态。
 */
const receivedRows = computed(() => box.value.received.filter((i) => !i.done_at))

/** 「已逾期」：期望完成时间过了、又还没点「已完成」。两列都标，发起人也能一眼看到对方超时了。 */
function isOverdue(item: Nudge): boolean {
  if (item.done_at || !item.due_at) return false
  const stamp = new Date(item.due_at).getTime()
  return !Number.isNaN(stamp) && stamp < clockNow.value
}

/** 逾期天数（不满一天算 0，只写「已逾期」三个字）。 */
function overdueDays(item: Nudge): number {
  if (!item.due_at) return 0
  const stamp = new Date(item.due_at).getTime()
  if (Number.isNaN(stamp)) return 0
  return Math.max(0, Math.floor((clockNow.value - stamp) / 86_400_000))
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

async function loadLists() {
  try {
    const { data } = await request.get('/api/reminder/lists')
    const rows = data?.data?.items || data?.data || []
    lists.value = rows.map((l: { id: number; name: string }) => ({ id: l.id, name: l.name }))
  } catch {
    lists.value = []
  }
}

function openSave(item: Nudge) {
  saveTarget.value = item
  saveListId.value = 0
  saveError.value = ''
  saveOpen.value = true
  void loadLists()
}

async function submitSave() {
  const target = saveTarget.value
  if (!target || !saveListId.value) return
  savingNudge.value = true
  saveError.value = ''
  try {
    await saveNudgeToList(target.id, saveListId.value)
    saveOpen.value = false
    await load()
    toast.value = '已保存到清单'
    window.setTimeout(() => { if (toast.value === '已保存到清单') toast.value = '' }, 4000)
  } catch (error) {
    saveError.value = describe(error, '保存失败，请稍后重试')
  } finally {
    savingNudge.value = false
  }
}

/** 「提醒一下」：再即时推一次给对方。 */
async function remindAgain(item: Nudge) {
  busyId.value = item.id
  try {
    await remindNudgeAgain(item.id)
    toast.value = '已再提醒一次'
    window.setTimeout(() => { if (toast.value === '已再提醒一次') toast.value = '' }, 4000)
  } catch (error) {
    errorMsg.value = describe(error, '提醒失败，请稍后重试')
  } finally {
    busyId.value = 0
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
  clockTimer = window.setInterval(() => { clockNow.value = Date.now() }, 60_000)
  window.addEventListener('reminder-data-changed', onDataChanged)
})
onBeforeUnmount(() => {
  if (clockTimer) window.clearInterval(clockTimer)
  window.removeEventListener('reminder-data-changed', onDataChanged)
})
</script>
