<template>
  <section class="surface mt-4 rounded-2xl p-4 sm:p-6" data-email-sender-settings>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="text-sm font-bold text-foreground">邮箱发件配置</h3>
        <p class="mt-1 text-xs leading-5 text-muted-foreground">
          配置系统发信用的 SMTP 服务器。通知中心只负责绑定接收邮箱；测试邮件会使用这里的配置真实发送。
        </p>
      </div>
      <span class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold" :class="configured ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300' : 'bg-amber-500/12 text-amber-600 dark:text-amber-300'">
        {{ configured ? '已配置' : '未配置' }}
      </span>
    </div>

    <form class="mt-4 grid gap-3 sm:grid-cols-2" @submit.prevent="save">
      <label class="block text-xs font-bold text-muted-foreground">SMTP 服务器
        <input v-model.trim="form.host" class="input-field mt-1.5" data-email-smtp-host placeholder="smtp.example.com" autocomplete="off" />
      </label>
      <label class="block text-xs font-bold text-muted-foreground">端口
        <input v-model.trim="form.port" class="input-field mt-1.5" data-email-smtp-port inputmode="numeric" placeholder="465 或 587" />
      </label>
      <label class="block text-xs font-bold text-muted-foreground">账号
        <input v-model.trim="form.username" class="input-field mt-1.5" data-email-smtp-username placeholder="通常是完整邮箱地址" autocomplete="username" />
      </label>
      <label class="block text-xs font-bold text-muted-foreground">密码 / 授权码
        <input v-model="form.password" type="password" class="input-field mt-1.5" data-email-smtp-password :placeholder="hasPassword ? '已保存，留空不修改' : '请输入邮箱授权码'" autocomplete="new-password" />
      </label>
      <label class="block text-xs font-bold text-muted-foreground">发信人邮箱
        <input v-model.trim="form.from_address" type="email" class="input-field mt-1.5" data-email-smtp-from placeholder="noreply@example.com" autocomplete="off" />
      </label>
      <label class="block text-xs font-bold text-muted-foreground">发信人名称
        <input v-model.trim="form.from_name" class="input-field mt-1.5" data-email-smtp-from-name placeholder="例如：工作序记" autocomplete="off" />
      </label>
      <div class="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button type="submit" class="btn-primary !h-9 !px-4 !text-xs" :disabled="saving || !canSave" data-email-smtp-save>{{ saving ? '保存中…' : '保存发件配置' }}</button>
        <span v-if="notice" class="text-xs font-semibold" :class="noticeOk ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-500'" data-email-smtp-notice>{{ notice }}</span>
      </div>
    </form>

    <div class="mt-5 border-t border-border/70 pt-4">
      <p class="text-xs font-bold text-foreground">发送测试邮件</p>
      <p class="mt-1 text-[11px] leading-4 text-muted-foreground">会立即连接上面的 SMTP 服务器并发送一封真实邮件；失败时会显示服务商返回的原因。</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <input v-model.trim="testTo" type="email" class="input-field h-9 min-w-[12rem] flex-1 !py-1.5 text-xs" data-email-test-to placeholder="测试收件邮箱" autocomplete="off" />
        <button type="button" class="btn-secondary !h-9 !px-4 !text-xs" :disabled="testing || !testTo" data-email-test-send @click="sendTest">{{ testing ? '发送中…' : '发送测试邮件' }}</button>
      </div>
      <p v-if="testNotice" class="mt-2 break-words text-xs font-semibold" :class="testOk ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-500'" data-email-test-notice>{{ testNotice }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { getEmailProvider, saveProvider, testEmailProvider } from '../api/reminder'

const form = reactive({ host: '', port: '587', username: '', password: '', from_address: '', from_name: '工作序记' })
const configured = ref(false)
const hasPassword = ref(false)
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const notice = ref('')
const noticeOk = ref(true)
const testTo = ref('')
const testNotice = ref('')
const testOk = ref(true)
const canSave = computed(() => !!form.host && !!form.from_address)

async function load() {
  loading.value = true
  try {
    const res = await getEmailProvider()
    const data = res.data?.data || {}
    form.host = String(data.host || '')
    form.port = String(data.port || '587')
    form.username = String(data.username || '')
    form.from_address = String(data.from_address || '')
    form.from_name = String(data.from_name || '工作序记')
    configured.value = data.configured === true
    hasPassword.value = data.has_password === true
    if (!testTo.value) testTo.value = String(data.from_address || '')
  } catch (err: any) {
    notice.value = err?.response?.data?.message || '读取发件配置失败'
    noticeOk.value = false
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true
  notice.value = ''
  try {
    const payload: Record<string, string> = {
      host: form.host, port: form.port, username: form.username,
      from_address: form.from_address, from_name: form.from_name,
    }
    if (form.password) payload.password = form.password
    await saveProvider('email', payload)
    notice.value = '发件配置已保存'
    noticeOk.value = true
    form.password = ''
    await load()
  } catch (err: any) {
    notice.value = err?.response?.data?.message || err?.message || '保存失败'
    noticeOk.value = false
  } finally {
    saving.value = false
  }
}

async function sendTest() {
  if (!testTo.value || testing.value) return
  testing.value = true
  testNotice.value = ''
  try {
    const res = await testEmailProvider(testTo.value)
    testOk.value = true
    testNotice.value = `测试邮件已发送到 ${res.data?.data?.to || testTo.value}`
  } catch (err: any) {
    testOk.value = false
    testNotice.value = err?.response?.data?.message || err?.message || '测试邮件发送失败'
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>
