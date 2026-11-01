import request from './request'

// 验证码会发到「通知方式 → 邮件」里已绑定的所有接收邮箱。
export function sendPasswordResetCode(username: string) {
  return request.post('/api/security/forgot/send-code', { username })
}

export function resetPasswordByEmail(username: string, code: string, newPassword: string) {
  return request.post('/api/security/forgot/email-reset', {
    username,
    code,
    new_password: newPassword,
  })
}
