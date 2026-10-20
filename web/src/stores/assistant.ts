/**
 * 小秘的名字：每个人在「偏好设置 → AI 提示词」里起，空串 = 默认的「小秘」。
 *
 * 面板标题、头像上的字、问候语、输入框提示和侧栏入口都用这里的一份，
 * 避免各组件各拉一次接口、名字还不一致。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getPromptPrefs } from '../api/assistant'

export const useAssistantStore = defineStore('assistant', () => {
  const customName = ref('')
  const loaded = ref(false)

  const displayName = computed(() => customName.value.trim() || '小秘')
  const avatarText = computed(() => displayName.value.slice(0, 1))

  /** force=true 用于登录后重新挂载布局：同一次会话里换账号时不能沿用上一个人的名字。 */
  async function loadName(force = false) {
    if (loaded.value && !force) return
    try {
      const res = await getPromptPrefs()
      if (res.data?.code === 0) {
        customName.value = (res.data.data?.assistant_name || '').trim()
      }
    } catch {
      // 名字读不到就用默认的「小秘」，不影响对话本身。
    } finally {
      loaded.value = true
    }
  }

  function setName(name: string) {
    customName.value = (name || '').trim()
    loaded.value = true
  }

  return { customName, displayName, avatarText, loadName, setName }
})
