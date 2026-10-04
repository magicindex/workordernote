<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center">
        <!-- 遮罩上直接挂关闭：它是一层独立子元素，父层的 @click.self 永远收不到
             （点它时 event.target 是这层，不是父层），所以必须挂在这里。 -->
        <div class="absolute inset-0 bg-black bg-opacity-50" @click="handleClose"></div>
        <div
          class="relative bg-surface text-foreground rounded-2xl shadow-xl p-6 w-full mx-4 max-h-[90vh] overflow-auto"
          :class="size === 'lg' ? 'max-w-2xl' : 'max-w-lg'"
        >
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold text-foreground">{{ title }}</h3>
            <button @click="handleClose" class="text-muted-foreground hover:text-foreground transition-colors">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div>
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  /**
   * 是否允许关闭。必须给默认值 true：Boolean 类型的 prop 在父组件没传时，
   * Vue 会把它设成 false（不是 undefined），于是 `props.closable !== false`
   * 永远为假，关闭按钮和遮罩点击都会失效。
   */
  closable?: boolean
  /** 弹窗宽度：md = max-w-lg（默认），lg = max-w-2xl（迭代说明这类长内容用） */
  size?: 'md' | 'lg'
}>(), {
  closable: true,
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

function handleClose() {
  if (props.closable !== false) {
    emit('update:modelValue', false)
  }
}
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .relative,
.modal-leave-to .relative {
  transform: scale(0.95);
}
</style>
