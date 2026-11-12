<template>
  <Teleport to="body">
    <Transition name="confirm">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4"
        @click.self="handleCancel"
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label="完成提醒"
          class="surface-modal w-full max-w-md rounded-2xl p-5 sm:p-6"
          data-complete-dialog
        >
          <div class="flex items-start gap-3.5">
            <span class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9" d="m6 12 4 4 8-9"/></svg>
            </span>
            <div class="min-w-0 flex-1">
              <h3 class="text-base font-bold text-foreground">完成这条提醒</h3>
              <p v-if="title" class="mt-1 break-words text-[13px] leading-5 text-muted-foreground" data-complete-title>{{ title }}</p>
            </div>
          </div>

          <label class="mt-4 block">
            <span class="text-[11px] font-bold text-muted-foreground">备注（可选）</span>
            <textarea
              ref="noteRef"
              v-model="note"
              rows="3"
              maxlength="500"
              data-complete-note
              class="compact-input !h-auto w-full resize-y !py-2 text-sm leading-5"
              placeholder="这次做了什么？留空直接确定即可"
              @keydown.enter="onEnter"
            ></textarea>
          </label>
          <p class="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            回车确定 · Shift + 回车换行 · Esc 取消。备注会记在「已完成」这条记录上。
          </p>

          <div class="mt-5 flex gap-2.5">
            <button type="button" class="btn-ghost flex-1" :disabled="loading" data-complete-cancel @click="handleCancel">
              取消
            </button>
            <button type="button" class="btn-brand flex-1" :disabled="loading" data-complete-confirm @click="handleConfirm">
              <svg v-if="loading" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              {{ loading ? '完成中…' : '确定' }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// 完成备注弹窗（用户 2026-11-12：「点击任务前边按钮完成任务的时候 弹窗添加备注框，
// 确定，取消，不要直接完成。弹窗默认聚焦备注框，回车确定，Esc 取消，空备注也允许直接完成」）。
//
// 只看交互：点前边的圆扣不再立刻完成，而是先弹这个框；确定才发完成的请求，
// 取消什么都不做。备注可留空 —— 「确定」从来不因为空备注而禁用。
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  loading?: boolean
}>(), {
  title: '',
  loading: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [note: string]
  cancel: []
}>()

const note = ref('')
const noteRef = ref<HTMLTextAreaElement | null>(null)

function handleConfirm() {
  if (props.loading) return
  emit('confirm', note.value.trim())
}

function handleCancel() {
  if (props.loading) return
  emit('update:modelValue', false)
  emit('cancel')
}

// 回车 = 确定，Shift + 回车 = 换行。输入法组词时的回车（isComposing）必须放过去，
// 否则中文打一半按回车确认候选词就直接把提醒完成了。
function onEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.shiftKey) return
  event.preventDefault()
  handleConfirm()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  handleCancel()
}

watch(() => props.modelValue, async (open) => {
  if (open) {
    // 每次打开都是干净的输入框：上一条的备注不能被带进来
    note.value = ''
    window.addEventListener('keydown', onKeydown)
    await nextTick()
    noteRef.value?.focus()
    return
  }
  window.removeEventListener('keydown', onKeydown)
}, { immediate: true })

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.confirm-enter-active,
.confirm-leave-active {
  transition: opacity 0.18s ease;
}
.confirm-enter-from,
.confirm-leave-to {
  opacity: 0;
}
.confirm-enter-active section,
.confirm-leave-active section {
  transition: transform 0.18s ease;
}
.confirm-enter-from section,
.confirm-leave-to section {
  transform: scale(0.96);
}
</style>
