<template>
  <section class="surface mt-4 rounded-2xl p-4 sm:p-6" data-system-placement-prefs>
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="text-sm font-bold text-foreground">系统栏目放在哪里</h3>
        <p class="mt-1 text-xs leading-5 text-muted-foreground">
          选择折叠进「系统清单」，还是拿到「我的清单」里独立显示；只影响你自己的侧栏。
        </p>
      </div>
      <span v-if="notice" class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-300" data-system-placement-notice>{{ notice }}</span>
    </div>

    <div class="mt-3 space-y-1.5">
      <div
        v-for="item in items"
        :key="item.key"
        class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface/50 px-3 py-2"
        :data-system-placement-row="item.key"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="nav-symbol h-5 w-5" :class="item.tone" v-html="item.icon"></span>
          <div class="min-w-0">
            <p class="text-xs font-bold text-foreground">{{ item.label }}</p>
            <p class="text-[11px] text-muted-foreground">{{ enabled(item.key) ? '选择显示位置' : '栏目已关闭，先在下面打开' }}</p>
          </div>
        </div>
        <select
          class="input-field !h-8 !w-[9.5rem] !py-1 text-xs"
          :value="placement[item.key]"
          :disabled="!enabled(item.key) || savingKey === item.key"
          :data-system-placement-select="item.key"
          @change="setPlacement(item.key, ($event.target as HTMLSelectElement).value)"
        >
          <option value="system">折叠到系统清单</option>
          <option value="my">放到我的清单</option>
        </select>
      </div>
    </div>

    <p v-if="errorMsg" class="mt-2 text-[11px] font-medium text-destructive" data-system-placement-error>{{ errorMsg }}</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getAllConfigs, updateConfig } from '../api/config'
import { useAuthStore } from '../stores/auth'

type SystemItemKey = 'timetable' | 'cards' | 'notebook' | 'ceremony' | 'nudges'
const authStore = useAuthStore()
const placement = ref<Record<SystemItemKey, 'system' | 'my'>>({
  timetable: 'system', cards: 'system', notebook: 'system', ceremony: 'system', nudges: 'system',
})
const savingKey = ref<SystemItemKey | ''>('')
const notice = ref('')
const errorMsg = ref('')

const icons = {
  timetable: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="5" width="16" height="15" rx="2.5" stroke-width="1.7"/><path d="M4 10h16M9 3.5v3M15 3.5v3M8.5 14h2M13.5 14h2M8.5 17h2" stroke-width="1.7" stroke-linecap="round"/></svg>',
  cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="6" width="18" height="12" rx="2.5" stroke-width="1.7"/><path d="M3 10h18M6.5 14h4" stroke-width="1.7" stroke-linecap="round"/></svg>',
  notebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="5" y="4" width="14" height="16" rx="2" stroke-width="1.7"/><path d="M8 4v16M11 8h5M11 12h5M11 16h3" stroke-width="1.7" stroke-linecap="round"/></svg>',
  ceremony: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3l2.4 5.2 5.6.7-4.1 3.9 1.1 5.6-5-2.8-5 2.8 1.1-5.6L4 8.9l5.6-.7L12 3Z" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  nudges: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15.5 8.5a3.5 3.5 0 1 0-7 0c0 4-2 4-2 5.5h11c0-1.5-2-1.5-2-5.5Z" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 17a1.6 1.6 0 0 0 3 0" stroke-width="1.7" stroke-linecap="round"/><circle cx="18.5" cy="6.5" r="3.2" fill="currentColor" stroke="none"/></svg>',
}
const items: { key: SystemItemKey; label: string; tone: string; icon: string }[] = [
  { key: 'timetable', label: '课程表', tone: 'bg-violet-500/12 text-violet-500', icon: icons.timetable },
  { key: 'cards', label: '信用卡账单', tone: 'bg-brand-500/12 text-brand-500', icon: icons.cards },
  { key: 'notebook', label: '随手记事本', tone: 'bg-emerald-500/12 text-emerald-500', icon: icons.notebook },
  { key: 'ceremony', label: '人生要有仪式感', tone: 'bg-rose-500/10 text-rose-500', icon: icons.ceremony },
  { key: 'nudges', label: '提醒@他', tone: 'bg-sky-500/12 text-sky-500', icon: icons.nudges },
]

function enabled(key: SystemItemKey): boolean {
  if (key === 'timetable') return authStore.timetableEnabled
  if (key === 'cards') return authStore.creditCardEnabled
  if (key === 'notebook') return authStore.notebookEnabled
  if (key === 'ceremony') return authStore.ceremonyEnabled
  return authStore.nudgeEnabled
}

function parse(raw: string): Record<SystemItemKey, 'system' | 'my'> {
  const next: Record<SystemItemKey, 'system' | 'my'> = {
    timetable: 'system', cards: 'system', notebook: 'system', ceremony: 'system', nudges: 'system',
  }
  try {
    const data = raw ? JSON.parse(raw) : null
    if (data && typeof data === 'object') {
      for (const key of Object.keys(next) as SystemItemKey[]) {
        if (data[key] === 'my') next[key] = 'my'
      }
    }
  } catch { /* 按默认折叠 */ }
  return next
}

async function load() {
  try {
    const res = await getAllConfigs()
    placement.value = parse(String(res.data?.data?.system_list_placement || ''))
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || '读取设置失败'
  }
}

async function setPlacement(key: SystemItemKey, value: string) {
  const next = { ...placement.value, [key]: value === 'my' ? 'my' : 'system' } as Record<SystemItemKey, 'system' | 'my'>
  savingKey.value = key
  errorMsg.value = ''
  notice.value = ''
  try {
    const res = await updateConfig('system_list_placement', JSON.stringify(next))
    if (res.data?.code === 0) {
      placement.value = next
      notice.value = '已保存'
      window.dispatchEvent(new CustomEvent('config-changed', { detail: { key: 'system_list_placement', value: JSON.stringify(next) } }))
      setTimeout(() => { notice.value = '' }, 2400)
    } else {
      errorMsg.value = res.data?.message || '保存失败'
    }
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || '保存失败'
  } finally {
    savingKey.value = ''
  }
}

onMounted(() => { void load() })
</script>
