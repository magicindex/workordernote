<template>
  <AuthShell title="找回密码" :subtitle="stepSubtitle">
    <!-- step indicator -->
    <div class="flex items-center gap-2 mb-7">
      <template v-for="(s, i) in 2" :key="i">
        <div
          class="h-1.5 flex-1 rounded-full transition-colors duration-500"
          :class="step >= i + 1 ? 'bg-brand-gradient' : 'bg-white/10'"
        ></div>
      </template>
    </div>

    <div v-if="!enabled" class="space-y-5">
      <div class="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3.5 py-2.5">
        管理员已关闭邮箱找回密码，请联系管理员重置密码。
      </div>
    </div>

    <!-- Step 1: username -->
    <form v-else-if="step === 1" @submit.prevent="handleSendCode" class="space-y-5">
      <AuthField v-model="username" label="用户名" required placeholder="请输入用户名" autofocus autocomplete="username">
        <template #icon>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
        </template>
      </AuthField>
      <p class="text-xs leading-5 text-white/45">
        验证码会发送到「通知方式 → 邮件」里已绑定的接收邮箱。还没绑定邮箱，请先登录后在通知方式页面添加。
      </p>
      <div v-if="errorMsg" class="text-sm text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl px-3.5 py-2.5">{{ errorMsg }}</div>
      <button type="submit" :disabled="loading" class="btn-premium">
        <svg v-if="loading" class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
        {{ loading ? '发送中...' : '发送验证码' }}
      </button>
    </form>

    <!-- Step 2: code + new password -->
    <form v-else-if="step === 2" @submit.prevent="handleReset" class="space-y-5">
      <AuthField
        :model-value="code"
        @update:model-value="onCodeInput"
        label="邮箱验证码"
        name="reset-code"
        required
        placeholder="请输入 6 位验证码"
        autocomplete="one-time-code"
        inputmode="numeric"
        :maxlength="6"
        autofocus
      >
        <template #icon>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
        </template>
        <template #labelRight>
          <button
            type="button"
            class="text-xs font-medium transition-colors"
            :class="resendLeft > 0 ? 'text-white/35 cursor-default' : 'text-brand-300 hover:text-brand-200'"
            :disabled="resendLeft > 0 || loading"
            @click="handleSendCode"
          >
            {{ resendLeft > 0 ? `${resendLeft} 秒后可重发` : '重新发送' }}
          </button>
        </template>
      </AuthField>
      <p class="text-xs leading-5 text-white/45">
        验证码 {{ ttlMinutes }} 分钟内有效。如果没收到，请检查垃圾邮件，或确认通知方式里绑定的邮箱是否正确。
      </p>
      <AuthField v-model="newPassword" label="新密码" type="password" autocomplete="new-password" required placeholder="请输入新密码">
        <template #icon>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" stroke-width="2"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V8a4 4 0 118 0v3"/></svg>
        </template>
      </AuthField>
      <AuthField v-model="confirmPassword" label="确认新密码" type="password" autocomplete="new-password" required placeholder="请再次输入新密码">
        <template #icon>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </template>
      </AuthField>
      <div v-if="errorMsg" class="text-sm text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl px-3.5 py-2.5">{{ errorMsg }}</div>
      <button type="submit" :disabled="loading" class="btn-premium">
        <svg v-if="loading" class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
        {{ loading ? '重置中...' : '重置密码' }}
      </button>
    </form>

    <!-- Done -->
    <div v-else class="space-y-5 text-center">
      <div class="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center">
        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      </div>
      <div>
        <p class="text-base font-semibold text-white">密码已重置</p>
        <p class="mt-1 text-sm text-white/55">即将返回登录页，请用新密码登录。</p>
      </div>
      <router-link to="/login" class="inline-flex text-sm font-semibold text-brand-300 hover:text-brand-200 transition-colors">立即登录</router-link>
    </div>

    <template #footer>
      <router-link to="/login" class="font-semibold text-brand-300 hover:text-brand-200 transition-colors">返回登录</router-link>
    </template>
  </AuthShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { sendPasswordResetCode, resetPasswordByEmail } from '../api/security'
import { getPublicConfigs } from '../api/config'
import AuthShell from '../components/auth/AuthShell.vue'
import AuthField from '../components/auth/AuthField.vue'
import { passwordValidationError } from '../utils/password'

const router = useRouter()

const step = ref(1)
const username = ref('')
const code = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const errorMsg = ref('')
const enabled = ref(true)
const ttlMinutes = ref(10)
const resendLeft = ref(0)
let resendTimer: ReturnType<typeof setInterval> | undefined

const stepSubtitle = computed(() => {
  if (step.value === 1) return '输入用户名，验证码会发送到已绑定的接收邮箱'
  if (step.value === 2) return '输入邮箱验证码并设置新的登录密码'
  return '密码重置完成'
})

onMounted(async () => {
  try {
    const res = await getPublicConfigs()
    const configs = res.data?.data || {}
    enabled.value = configs.password_reset_email_enabled !== 'false'
    const ttl = Number(configs.password_reset_code_ttl_minutes)
    if (Number.isFinite(ttl) && ttl >= 1 && ttl <= 60) ttlMinutes.value = ttl
  } catch { /* 读不到就按默认值显示 */ }
})

onBeforeUnmount(() => {
  if (resendTimer) clearInterval(resendTimer)
})

function startResendCooldown() {
  resendLeft.value = 60
  if (resendTimer) clearInterval(resendTimer)
  resendTimer = setInterval(() => {
    resendLeft.value -= 1
    if (resendLeft.value <= 0 && resendTimer) {
      clearInterval(resendTimer)
      resendTimer = undefined
    }
  }, 1000)
}

function onCodeInput(value: string) {
  code.value = value.replace(/\D/g, '').slice(0, 6)
}

async function handleSendCode() {
  if (resendLeft.value > 0 || loading.value) return
  if (!username.value.trim()) {
    errorMsg.value = '请输入用户名'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await sendPasswordResetCode(username.value.trim())
    if (res.data?.code === 0) {
      step.value = 2
      startResendCooldown()
    } else {
      errorMsg.value = res.data?.message || '验证码发送失败'
    }
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '网络错误'
  } finally {
    loading.value = false
  }
}

async function handleReset() {
  if (code.value.length !== 6) {
    errorMsg.value = '请输入 6 位验证码'
    return
  }
  const validationError = passwordValidationError(newPassword.value)
  if (validationError) {
    errorMsg.value = validationError
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMsg.value = '两次密码不一致'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await resetPasswordByEmail(username.value.trim(), code.value, newPassword.value)
    if (res.data?.code === 0) {
      step.value = 3
      setTimeout(() => router.push('/login'), 1500)
    } else {
      errorMsg.value = res.data?.message || '重置失败'
    }
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '网络错误'
  } finally {
    loading.value = false
  }
}
</script>
