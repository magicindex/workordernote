// 「剩余 / 已过 多少时间」的统一格式化（快速新建的芯片、首页看板的倒计时都用这一份）。
//
// 分钟级实时：调用方把自己的 clock 传进来（页面里一般每分钟跳一次）。
// 超过一天先写天数，后面仍然是「时:分」——用户明确要的时:分不被天数吃掉。
export function remainingText(target: number | string | null | undefined, now: number): string {
  if (target === null || target === undefined || target === '') return ''
  const t = typeof target === 'number' ? target : new Date(target).getTime()
  if (Number.isNaN(t)) return ''
  const diff = t - now
  const total = Math.abs(diff)
  const days = Math.floor(total / 86400000)
  const hours = Math.floor((total % 86400000) / 3600000)
  const minutes = Math.floor((total % 3600000) / 60000)
  const hm = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  const body = days > 0 ? `${days} 天 ${hm}` : hm
  return diff < 0 ? `已过 ${body}` : `剩余 ${body}`
}
