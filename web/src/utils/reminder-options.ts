// 提醒相关的**选项文案**：同一份要同时用在两处，必须只有一个来源 ——
//   · 偏好设置里的下拉（ConfigGroupList）
//   · 提醒弹窗上的按钮（MainLayout：「知道了（…）」的内容要跟后台显示的一致）
//
// 用户 2026-10-13 明确要求：「提醒卡片『知道了（内容）』，内容等于后台偏好：点『知道了』
// 后的提醒频率（选择时间）；显示保持与后台一致。」所以两边都从这里取。
//
// 改选项时记得和后端注册表（server/sysconfig/registry.go 的 reminder_ack_minutes /
// reminder_notify_minutes 的 Options）一起改：后端多一个值前端显示不出来，前端多一个值会被后端拒。

/** 「点『知道了』后的提醒频率」的取值（分钟，0 = 第二天）与中文。 */
export const ACK_MINUTES_OPTIONS = ['0', '30', '60', '120', '240'] as const

export const ACK_MINUTES_LABELS: Record<string, string> = {
  '0': '第二天（当天不再提示）',
  '30': '30 分钟后',
  '60': '1 小时后',
  '120': '2 小时后',
  '240': '4 小时后',
}

/** 提醒频率（分钟）的取值与中文。 */
export const NOTIFY_MINUTES_LABELS: Record<string, string> = {
  '5': '每 5 分钟',
  '10': '每 10 分钟',
  '15': '每 15 分钟',
  '30': '每 30 分钟',
  '60': '每小时',
}

/** 取「知道了」之后多久再提醒的中文；缺省（没设置）按 0 = 第二天。 */
export function ackMinutesLabel(minutes: number | string | null | undefined): string {
  const key = String(minutes ?? 0)
  return ACK_MINUTES_LABELS[key] || ACK_MINUTES_LABELS['0']
}
