<template>
  <section class="surface mt-4 rounded-2xl p-4 sm:p-6" data-ai-prompt-prefs>
    <h3 class="text-sm font-bold text-foreground">AI 提示词</h3>
    <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
      这些是<strong class="font-semibold text-foreground">你自己的</strong>偏好：只影响你和小秘的对话，
      不会改到别人。以前只有管理员能在系统配置里改，现在搬到这里，每个账号都能自己写。
    </p>

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
        你给助手起的名字，会用在对话面板标题、问候语、输入提示和系统提示词里；最多 {{ nameMax }} 个字，留空就是「{{ nameDefault }}」。
      </p>
    </div>

    <!-- 系统提示词：每轮对话由服务端加在最前面，决定人设与边界 -->
    <div class="mt-4 rounded-xl border border-border bg-surface/60 p-3" data-ai-pref-prompt-block>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs font-bold text-foreground">系统提示词</span>
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
        :placeholder="defaultPrompt || '留空 = 使用默认提示词'"
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
        留空就用默认那份（{{ defaultBrief }}），点「恢复默认」可随时清回。每轮对话都由服务端加在最前面，
        前端传不进来，也不会被对话内容顶掉。
      </p>
    </div>

    <!-- 各栏目的提示词：存在清单自己身上（所以天然是每个人自己的数据） -->
    <div class="mt-4" data-ai-list-prompts>
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-foreground">各栏目的 AI 提示词</span>
        <span v-if="listSavedId" class="text-[11px] font-semibold text-emerald-500" data-ai-list-prompt-saved>已保存</span>
      </div>
      <p class="mt-1 text-[11px] leading-4 text-muted-foreground">
        小秘分析到某一栏的数据时，把这里的要求一起交给模型（只作用于那一栏，不影响别的）。
        「引用其他栏目」会把那段文字复制过来，之后各改各的。
      </p>
      <div class="mt-2 space-y-2">
        <div
          v-for="list in promptLists"
          :key="list.id"
          class="rounded-xl border border-border p-2"
          :data-ai-list-prompt-row="list.name"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="truncate text-xs font-semibold text-foreground" :title="list.name">{{ list.name }}</span>
            <span class="shrink-0 text-[10px] text-muted-foreground">{{ listDirty(list) ? '未保存' : (list.ai_prompt ? '已设置' : '没设置') }}</span>
          </div>
          <textarea
            v-model="listDraft[list.id]"
            rows="2"
            maxlength="600"
            class="input-field mt-1.5 !py-1.5 text-[12px] leading-5"
            :disabled="listSavingId === list.id"
            placeholder="这一栏的分析要求（可选），例如：按基站/线路分组，多说进度"
            :data-ai-list-prompt="list.name"
          ></textarea>
          <div class="mt-1 flex items-center justify-between gap-2">
            <select
              v-model="listRef[list.id]"
              class="input-field !h-7 !w-32 !py-0 text-[11px]"
              :disabled="listSavingId === list.id"
              :aria-label="`引用其他栏目的提示词（${list.name}）`"
              :data-ai-list-prompt-ref="list.name"
              @change="copyPromptRef(list.id)"
            >
              <option value="">引用其他栏目…</option>
              <option v-for="other in listSources(list)" :key="other.id" :value="String(other.id)">{{ other.name }}</option>
            </select>
            <button
              type="button"
              class="btn-secondary !h-7 !rounded-lg !px-2 text-[11px]"
              :disabled="!listDirty(list) || listSavingId === list.id"
              :data-ai-list-prompt-save="list.name"
              @click="saveListPrompt(list)"
            >
              {{ listSavingId === list.id ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
        <p v-if="!promptLists.length" class="text-[11px] text-muted-foreground">还没有清单。</p>
      </div>
    </div>

    <p v-if="errorMsg" class="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive" data-ai-pref-error>
      {{ errorMsg }}
    </p>
  </section>
</template>

<script setup lang="ts">
/**
 * 偏好设置里的「AI 提示词」：系统提示词（个人一份）+ 各栏目提示词（存在清单上）。
 *
 * 为什么不在系统配置页：那边只有管理员进得去，而这两样都是「我自己的偏好」。
 * 系统提示词只写当前登录用户那一行（后端 /api/assistant/prompts 按 userID 落库），
 * 栏目提示词本来就是清单自己的字段（PATCH /api/reminder/lists/:id 的 ai_prompt）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { getLists, updateList, type ReminderList } from '../api/reminder'
import { getPromptPrefs, saveAssistantName, savePromptPrefs } from '../api/assistant'
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

const defaultBrief = computed(() => {
  const text = defaultPrompt.value.trim()
  if (!text) return '内置提示词'
  return text.length > 38 ? `${text.slice(0, 38)}…` : text
})

const promptLists = ref<ReminderList[]>([])
const listDraft = reactive<Record<number, string>>({})
const listRef = reactive<Record<number, string>>({})
const listSavingId = ref(0)
const listSavedId = ref(0)
let listSavedTimer: ReturnType<typeof setTimeout> | undefined

/** 与已保存的值比对（去掉首尾空白，避免「多敲一个空格」也变成未保存）。 */
const promptDirty = computed(() => promptValue.value.trim() !== promptSaved.value.trim())

async function loadPrefs() {
  try {
    const res = await getPromptPrefs()
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

/** 恢复默认 = 清空自己那份，之后由服务端回退到管理员设的默认值。 */
async function resetPrompt() {
  promptValue.value = ''
  await savePrompt()
}

function listDirty(list: ReminderList) {
  return (listDraft[list.id] ?? '').trim() !== (list.ai_prompt || '').trim()
}

function listSources(current: ReminderList) {
  return promptLists.value.filter((item) => item.id !== current.id && (item.ai_prompt || '').trim() !== '')
}

function copyPromptRef(id: number) {
  const picked = promptLists.value.find((item) => String(item.id) === String(listRef[id]))
  if (picked) listDraft[id] = picked.ai_prompt || ''
  listRef[id] = ''
}

async function loadLists() {
  try {
    const res = await getLists()
    const rows: ReminderList[] = res.data?.data || []
    promptLists.value = rows
    for (const list of rows) {
      listDraft[list.id] = list.ai_prompt || ''
      listRef[list.id] = ''
    }
  } catch {
    // 清单取不到不该让整块设置变成错误态：系统提示词还能正常读写。
  }
}

async function saveListPrompt(list: ReminderList) {
  listSavingId.value = list.id
  errorMsg.value = ''
  try {
    const text = (listDraft[list.id] || '').trim()
    await updateList(list.id, { ai_prompt: text })
    list.ai_prompt = text
    listDraft[list.id] = text
    listSavedId.value = list.id
    if (listSavedTimer) clearTimeout(listSavedTimer)
    listSavedTimer = setTimeout(() => { listSavedId.value = 0 }, 2400)
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.message || err?.message || '保存栏目提示词失败'
  } finally {
    listSavingId.value = 0
  }
}

onMounted(() => {
  void loadPrefs()
  void loadLists()
})
</script>
