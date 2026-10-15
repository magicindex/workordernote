<template>
  <div class="page-container animate-fade-in">
    <PageHeader title="偏好设置" description="管理你的个人功能配置" />

    <div v-if="errorMsg" class="surface rounded-2xl px-5 py-3 text-sm text-destructive">
      {{ errorMsg }}
    </div>

    <div v-if="loading" class="space-y-3">
      <div v-for="i in 4" :key="i" class="h-20 rounded-xl bg-muted animate-pulse"></div>
    </div>

    <ConfigGroupList
      v-else
      ref="listRef"
      :items="items"
      @save="handleSave"
    />

    <!-- 默认清单：新建提醒不带清单时落在这里，删除清单后其提醒也归到这里 -->
    <div class="surface mt-4 rounded-2xl p-4 sm:p-6">
      <h3 class="text-sm font-bold text-foreground">默认清单</h3>
      <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
        新建提醒没有指定清单时会放进默认清单；删除某个清单后，里面的提醒也会归到这里。
        默认清单不能删除，想换一个直接在这里选。
      </p>
      <div v-if="lists.length" class="mt-3 flex flex-wrap items-center gap-3">
        <select
          v-model.number="defaultListId"
          class="compact-input !w-auto min-w-[9rem]"
          :disabled="savingDefault"
          aria-label="默认清单"
          @change="applyDefaultList"
        >
          <option v-for="list in navLists" :key="list.id" :value="list.id">{{ list.name }}</option>
        </select>
        <span v-if="savingDefault" class="text-xs font-semibold text-muted-foreground">保存中…</span>
        <span v-else-if="defaultSaved" class="text-xs font-semibold text-emerald-500">已设为默认</span>
      </div>
      <p v-else class="mt-3 text-xs text-muted-foreground">还没有清单。</p>
    </div>

    <!-- 清单顺序（用户 2026-10-10 要求）：↑/↓ 调整，改完立刻按新顺序显示 -->
    <div class="surface mt-4 rounded-2xl p-4 sm:p-6" data-list-order>
      <h3 class="text-sm font-bold text-foreground">清单顺序</h3>
      <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
        侧栏「我的清单」里的先后顺序。用 ↑ / ↓ 调，改完立刻生效并同步到另一台设备
        （信用卡账单、随手记事本、人生要有仪式感是固定栏目，不在这里排）。
      </p>
      <ul v-if="sortableLists.length" class="mt-3 space-y-1.5">
        <li
          v-for="(list, index) in sortableLists"
          :key="list.id"
          class="flex items-center gap-2.5 rounded-xl border border-border/70 bg-surface/60 px-3 py-2"
          :data-list-order-row="list.id"
        >
          <span class="w-5 shrink-0 text-center text-[11px] font-bold text-muted-foreground" data-list-order-index>{{ index + 1 }}</span>
          <i class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: listInk(list.color) }"></i>
          <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ list.name }}</span>
          <button
            type="button"
            class="row-action !opacity-100 disabled:!opacity-30"
            :disabled="index === 0 || savingOrder"
            :aria-label="`把「${list.name}」上移`"
            :data-list-order-up="list.id"
            @click="moveList(index, -1)"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 14 6-6 6 6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button
            type="button"
            class="row-action !opacity-100 disabled:!opacity-30"
            :disabled="index === sortableLists.length - 1 || savingOrder"
            :aria-label="`把「${list.name}」下移`"
            :data-list-order-down="list.id"
            @click="moveList(index, 1)"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor"><path d="m6 10 6 6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </li>
      </ul>
      <p v-else class="mt-3 text-xs text-muted-foreground">还没有可排序的清单。</p>
      <p v-if="orderSaved" class="mt-2 text-xs font-semibold text-emerald-500" data-list-order-saved>清单顺序已保存</p>
    </div>

    <!-- 原项目信息：本应用是上游开源作品的衍生作品，按 MIT 许可保留出处与著作权 -->
    <div class="surface mt-4 rounded-2xl p-4 sm:p-6">
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-500/12 text-slate-500">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 3 3 7.5 12 12l9-4.5L12 3ZM3 16.5 12 21l9-4.5M3 12l9 4.5 9-4.5" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="min-w-0">
          <h3 class="text-sm font-bold text-foreground">原项目信息</h3>
          <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
            本应用（工作序记 / WorkOrderNote）基于开源项目
            <a class="font-semibold text-brand-600 hover:underline dark:text-brand-300" href="https://github.com/TechFunWay/reminders" target="_blank" rel="noreferrer">TechFunWay/reminders</a>
            衍生开发，遵循其 MIT 许可，原项目的著作权与出处均予保留。
          </p>
          <p class="mt-2 text-xs text-muted-foreground">
            上游项目：TechFunWay/reminders &nbsp;·&nbsp; 许可：MIT &nbsp;·&nbsp; 本项目：WorkOrderNote（工作序记）
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import ConfigGroupList from '../components/ConfigGroupList.vue'
import { getAllConfigs, getUserConfigMeta, updateConfig } from '../api/config'
import type { ConfigMeta } from '../api/config'
import { getLists, reorderLists, updateList, type ReminderList } from '../api/reminder'
import { listColorHex } from '../utils/list-colors'
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'

const items = ref<ConfigMeta[]>([])
const loading = ref(false)
const errorMsg = ref('')
const authStore = useAuthStore()
const listRef = ref<InstanceType<typeof ConfigGroupList> | null>(null)
const lists = ref<ReminderList[]>([])
// 默认清单只能从普通清单里选：信用卡账单是固定栏目，不适合当默认清单。
const navLists = computed(() => lists.value.filter((l) => l.template !== 'credit_card'))
const defaultListId = ref(0)
const savingDefault = ref(false)
const defaultSaved = ref(false)

// 清单顺序（用户 2026-10-10 要求）：只排**普通清单** —— 信用卡/随手记事本/人生要有仪式感
// 在侧栏是固定那几行，顺序由代码定，不参与排序。
const listInk = listColorHex
// 系统固定栏目的 template 是 credit_card / notebook / ceremony；普通清单是 general
// （老数据可能没有 template 字段，也当普通清单）。第一版写成 `!l.template` 把 general
// 也排掉了，结果列表空着 —— 探针里一眼就看出来了。
const SYSTEM_TEMPLATES = ['credit_card', 'notebook', 'ceremony']
const sortableLists = computed(() => lists.value.filter((l) => !SYSTEM_TEMPLATES.includes(String(l.template || ''))))
const savingOrder = ref(false)
const orderSaved = ref(false)

/** ↑/↓：先在本地换位（界面立刻响应），再整串 id 提交给服务端；失败就回滚。 */
async function moveList(index: number, delta: number) {
  const target = index + delta
  if (savingOrder.value || target < 0 || target >= sortableLists.value.length) return
  const before = lists.value.slice()
  const normal = sortableLists.value.slice()
  const [moved] = normal.splice(index, 1)
  normal.splice(target, 0, moved)
  // 系统栏目保持原位：只把普通清单按新顺序填回它们占的槽位，
  // 然后**整串 id**（含系统栏目）提交 —— 这样服务端写出来的 1..N 与界面完全一致。
  let cursor = 0
  const nextAll = lists.value.map((l) => (SYSTEM_TEMPLATES.includes(String(l.template || '')) ? l : normal[cursor++]))
  lists.value = nextAll
  savingOrder.value = true
  orderSaved.value = false
  errorMsg.value = ''
  try {
    await reorderLists(nextAll.map((l) => l.id))
    await syncSidebarOrder(nextAll)
    await loadLists()
    orderSaved.value = true
    setTimeout(() => { orderSaved.value = false }, 2500)
  } catch (err: any) {
    lists.value = before
    errorMsg.value = err.response?.data?.message || '保存清单顺序失败'
  } finally {
    savingOrder.value = false
  }
}

/**
 * 侧栏如果已经存过自己的顺序（用户配置 sidebar_order，见 MainLayout 的「我的清单」排序模式），
 * 就把它里面的清单 token 按这次的新顺序重排 —— 否则会出现「在偏好设置里排完、侧栏还是老样子」。
 * 「全部 / 提醒@他」这类非清单行留在原来的槽位不动。没存过 sidebar_order 就不用管：
 * 那种情况下侧栏按 position 排，本来就跟着这里一起变。
 */
async function syncSidebarOrder(nextAll: ReminderList[]) {
  try {
    const res = await getAllConfigs()
    const raw = String(res.data?.data?.sidebar_order ?? '')
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const keys = nextAll.map((l) => `list:${l.id}`)
    let cursor = 0
    const merged = parsed.map((k: string) => (k.startsWith('list:') && cursor < keys.length ? keys[cursor++] : k))
    await updateConfig('sidebar_order', JSON.stringify(merged))
  } catch {
    /* 同步侧栏顺序失败不该挡住清单顺序本身，静默即可 */
  }
}

onMounted(() => {
  loadMeta()
  loadLists()
})

// 默认清单是清单数据而不是配置项，所以走清单接口，不放进 ConfigGroupList。
async function loadLists() {
  try {
    const res = await getLists()
    lists.value = res.data?.data || []
    defaultListId.value = navLists.value.find(l => l.is_default)?.id || navLists.value[0]?.id || 0
  } catch {
    /* 清单读不到不影响其它偏好设置的加载 */
  }
}

async function applyDefaultList() {
  if (!defaultListId.value || savingDefault.value) return
  const previous = navLists.value.find(l => l.is_default)?.id
  if (previous === defaultListId.value) return
  savingDefault.value = true
  defaultSaved.value = false
  errorMsg.value = ''
  try {
    await updateList(defaultListId.value, { is_default: true })
    lists.value = lists.value.map(l => ({ ...l, is_default: l.id === defaultListId.value }))
    defaultSaved.value = true
    setTimeout(() => { defaultSaved.value = false }, 2500)
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '设置默认清单失败'
    // 失败了就把下拉框拨回原来的默认清单，避免界面显示成已经改好
    defaultListId.value = previous || defaultListId.value
  } finally {
    savingDefault.value = false
  }
}

async function loadMeta() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await getUserConfigMeta()
    if (res.data?.code === 0) {
      items.value = Array.isArray(res.data.data) ? res.data.data : []
    } else {
      errorMsg.value = res.data?.message || '加载配置失败'
    }
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '网络错误'
  } finally {
    loading.value = false
  }
}

async function handleSave(key: string, value: string) {
  errorMsg.value = ''
  try {
    const res = await updateConfig(key, value)
    if (res.data?.code === 0) {
      const idx = items.value.findIndex((it) => it.key === key)
      if (idx >= 0) {
        items.value[idx] = { ...items.value[idx], value }
      }
      // 「信用卡账单 / 记事本栏目」是个人开关：侧栏那两行要立刻跟着变，不用重进页面。
      if (key === 'credit_card_enabled') {
        authStore.setCreditCardEnabled(value !== 'false')
      }
      if (key === 'notebook_enabled') {
        authStore.setNotebookEnabled(value !== 'false')
      }
      listRef.value?.markSaved(key)
      if (key === 'theme_mode') {
        const themeStore = useThemeStore()
        if (themeStore.mode !== value) {
          themeStore.setMode(value as 'light' | 'dark' | 'system' | 'sun')
        }
      } else if (key === 'sun_location') {
        // 位置改了就立刻重算：否则要点一下别的设置、或者刷新页面才生效。
        useThemeStore().setSunCity(value)
      }
    } else {
      errorMsg.value = res.data?.message || '保存失败'
      listRef.value?.markFailed(key)
    }
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '网络错误'
    listRef.value?.markFailed(key)
  }
}
</script>
