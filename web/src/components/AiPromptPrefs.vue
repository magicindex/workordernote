<template>
  <section class="surface mt-4 rounded-2xl p-4 sm:p-6" data-ai-prompt-prefs>
    <h3 class="text-sm font-bold text-foreground">AI 提示词</h3>
    <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
      这些是<strong class="font-semibold text-foreground">你自己的</strong>偏好：一个账号一份统一提示词，
      所有栏目、所有对话都用这一份，不会改到别人。以前按管理员全局 / 各栏目分开保存，
      现在统一到每个人自己的设置里；没写过的人继续继承旧的全局默认值。
    </p>

    <!-- AI 入口样式：从「外观」搬到 AI 部分（用户 2026-11-14）；桌面端左标签、右下拉同一行。 -->
    <div class="mt-4 rounded-xl border border-border bg-surface/60 p-3" data-ai-entry-style>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-bold text-foreground">AI 入口样式</span>
            <span class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-300" data-ai-entry-style-state>
              {{ entrySaving ? '保存中…' : (entryNotice || '已保存') }}
            </span>
          </div>
          <p class="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            桌面端生效；手机端始终使用顶栏 AI 图标。切换后立刻生效，不用刷新。
          </p>
        </div>
        <select
          class="input-field !h-9 w-full !py-1.5 text-[13px] sm:w-[16rem] sm:shrink-0"
          :value="entryStyle"
          :disabled="entrySaving"
          data-ai-entry-style-select
          @change="saveEntryStyle(($event.target as HTMLSelectElement).value, $event)"
        >
          <option value="topbar">顶栏图标（铃铛旁 AI 按钮）</option>
          <option value="floating">悬浮球（右下角可拖动）</option>
        </select>
      </div>
    </div>

    <!-- 小秘名称（用户 2026-10-20）：每个人给自己的助手起名，面板与对话里都用它 -->
    <div class="mt-4 rounded-xl border border-border bg-surface/60 p-3" data-ai-name-block>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs font-bold text-foreground">小秘名称</span>
        <span
          class="text-[11px] font-semibold"
          :class="nameDirty ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'"
          data-ai-name-state
        >{{ nameDirty ? '未保存' : (nameValue.trim() ? '已保存' : '默认「小秘」') }}</span>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <input
          v-model="nameValue"
          type="text"
          :maxlength="nameMax"
          class="input-field !h-9 w-full max-w-[14rem] !py-1.5 text-[13px]"
          :placeholder="nameDefault"
          data-ai-name-input
        />
        <button
          type="button"
          class="btn-primary !h-8 !px-3 !text-xs"
          :disabled="!nameDirty || nameSaving"
          data-ai-name-save
          @click="saveName"
        >
          {{ nameSaving ? '保存中…' : '保存' }}
        </button>
        <button
          type="button"
          class="btn-secondary !h-8 !px-3 !text-xs"
          :disabled="nameSaving || !nameValue"
          data-ai-name-reset
          @click="resetName"
        >
          恢复默认
        </button>
        <span v-if="nameNotice" class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-300" data-ai-name-notice>
          {{ nameNotice }}
        </span>
      </div>
      <p class="mt-1.5 text-[11px] leading-4 text-muted-foreground">
        你给助手起的名字，会用在对话面板标题、问候语、输入提示和提示词里；最多 {{ nameMax }} 个字，留空就是「{{ nameDefault }}」。
      </p>
    </div>

    <!-- 统一提示词：一个账号一份，所有栏目共用；每轮对话由服务端加在最前面 -->
    <div class="mt-4 rounded-xl border border-border bg-surface/60 p-3" data-ai-pref-prompt-block>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs font-bold text-foreground">我的统一提示词</span>
        <span
          class="text-[11px] font-semibold"
          :class="promptDirty ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'"
          data-ai-pref-prompt-state
        >{{ promptDirty ? '未保存' : promptValue ? '已保存' : '用默认' }}</span>
      </div>
      <textarea
        v-model="promptValue"
        rows="5"
        :maxlength="maxLength"
        class="input-field mt-2 !py-2 text-[13px] leading-5"
        :placeholder="defaultPrompt || '留空 = 继承旧全局默认提示词'"
        data-ai-pref-prompt
      ></textarea>
      <div class="mt-1.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn-primary !h-8 !px-3 !text-xs"
          :disabled="!promptDirty || promptSaving"
          data-ai-pref-prompt-save
          @click="savePrompt"
        >
          {{ promptSaving ? '保存中…' : '保存' }}
        </button>
        <button
          type="button"
          class="btn-secondary !h-8 !px-3 !text-xs"
          :disabled="promptSaving || !promptValue"
          data-ai-pref-prompt-reset
          @click="resetPrompt"
        >
          恢复默认
        </button>
        <span v-if="promptNotice" class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-300" data-ai-pref-prompt-notice>
          {{ promptNotice }}
        </span>
      </div>
      <p class="mt-1.5 text-[11px] leading-4 text-muted-foreground" :title="defaultPrompt">
        所有栏目、所有对话都只用这一份（不再按栏目单独配置）。留空就用旧全局默认值（{{ defaultBrief }}），
        点「恢复默认」可随时清回。每轮对话都由服务端加在最前面，前端传不进来，也不会被对话内容顶掉。
      </p>
    </div>

    <p v-if="errorMsg" class="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive" data-ai-pref-error>
      {{ errorMsg }}
    </p>
  </section>
</template>

<script setup lang="ts">
/**
 * 偏好设置里的「AI 提示词」：小秘名称 + 我的统一提示词。
 *
 * 一个账号一份，按 userID 落在 sysconfig（/api/assistant/prompts），互不覆盖。
 * 以前还按清单存「各栏目的提示词」，2026-11-14 按用户要求取消：所有栏目统一用
 * 这个人自己写的提示词；没写过的人继承旧的全局默认值（服务端 default_system_prompt）。
 */
import { computed, onMounted, ref } from 'vue'
import { getPromptPrefs, saveAssistantName, savePromptPrefs } from '../api/assistant'
import { getAllConfigs, updateConfig } from '../api/config'
import { useAssistantStore } from '../stores/assistant'

const assistant = useAssistantStore()
const errorMsg = ref('')
const maxLength = ref(2000)
const nameValue = ref('')
const nameSaved = ref('')
const nameSaving = ref(false)
const nameNotice = ref('')
const nameMax = ref(12)
const nameDefault = ref('小秘')
const nameDirty = computed(() => nameValue.value.trim() !== nameSaved.value.trim())
const defaultPrompt = ref('')
const promptValue = ref('')
const promptSaved = ref('')
const promptSaving = ref(false)
const promptNotice = ref('')
const entryStyle = ref<'topbar' | 'floating'>('topbar')
const entrySaving = ref(false)
const entryNotice = ref('')

const defaultBrief = computed(() => {
  const text = defaultPrompt.value.trim()
  if (!text) return '内置提示词'
  return text.length > 38 ? `${text.slice(0, 38)}…` : text
})

/** 与已保存的值比对（去掉首尾空白，避免「多敲一个空格」也变成未保存）。 */
const promptDirty = computed(() => promptValue.value.trim() !== promptSaved.value.trim())

async function loadPrefs() {
  try {
    const [res, cfgRes] = await Promise.all([getPromptPrefs(), getAllConfigs()])
    const cfg = (cfgRes.data?.data || {}) as Record<string, unknown>
    entryStyle.value = String(cfg.assistant_entry_style || 'topbar') === 'floating' ? 'floating' : 'topbar'
    if (res.data?.code === 0) {
      const data = res.data.data || {}
      promptValue.value = data.system_prompt || ''
      promptSaved.value = data.system_prompt || ''
      defaultPrompt.value = data.default_system_prompt || ''
      maxLength.value = Number(data.max_length) || 2000
      nameValue.value = data.assistant_name || ''
      nameSaved.value = data.assistant_name || ''
      nameMax.value = Number(data.max_name_length) || 12
      nameDefault.value = data.default_assistant_name || '小秘'
      assistant.setName(nameSaved.value)
    }
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || err?.message || '加载提示词失败'
  }
}

async function saveEntryStyle(value: string, event?: Event) {
  const next = value === 'floating' ? 'floating' : 'topbar'
  entrySaving.value = true
  errorMsg.value = ''
  entryNotice.value = ''
  try {
    const res = await updateConfig('assistant_entry_style', next)
    if (res.data?.code === 0) {
      entryStyle.value = next
      entryNotice.value = '已保存'
      window.dispatchEvent(new CustomEvent('config-changed', { detail: { key: 'assistant_entry_style', value: next } }))
      setTimeout(() => { entryNotice.value = '' }, 2400)
    } else {
      errorMsg.value = res.data?.message || '保存失败'
      if (event?.target) (event.target as HTMLSelectElement).value = entryStyle.value
    }
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || err?.message || '保存失败'
    if (event?.target) (event.target as HTMLSelectElement).value = entryStyle.value
  } finally {
    entrySaving.value = false
  }
}

async function saveName() {
  nameSaving.value = true
  errorMsg.value = ''
  nameNotice.value = ''
  try {
    const res = await saveAssistantName(nameValue.value)
    if (res.data?.code === 0) {
      nameSaved.value = res.data.data?.assistant_name ?? nameValue.value.trim()
      nameValue.value = nameSaved.value
      assistant.setName(nameSaved.value)
      nameNotice.value = '已保存'
      setTimeout(() => { nameNotice.value = '' }, 2400)
    } else {
      errorMsg.value = res.data?.message || '保存失败'
    }
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || err?.message || '保存失败'
  } finally {
    nameSaving.value = false
  }
}

/** 恢复默认 = 清空名字，面板回到「小秘」。 */
async function resetName() {
  nameValue.value = ''
  await saveName()
}

async function savePrompt() {
  promptSaving.value = true
  errorMsg.value = ''
  promptNotice.value = ''
  try {
    const res = await savePromptPrefs(promptValue.value)
    if (res.data?.code === 0) {
      promptSaved.value = res.data.data?.system_prompt ?? promptValue.value.trim()
      promptValue.value = promptSaved.value
      promptNotice.value = '已保存'
      setTimeout(() => { promptNotice.value = '' }, 2400)
    } else {
      errorMsg.value = res.data?.message || '保存失败'
    }
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || err?.message || '保存失败'
  } finally {
    promptSaving.value = false
  }
}

/** 恢复默认 = 清空自己那份，之后由服务端继承旧全局默认值。 */
async function resetPrompt() {
  promptValue.value = ''
  await savePrompt()
}

onMounted(() => {
  void loadPrefs()
})
</script>
