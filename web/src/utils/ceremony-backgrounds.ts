// 「人生要有仪式感」卡片的**预置主题背景图**（用户 2026-10-13 要求：
// 「针对不同主题预置一些对应的背景图片，可以直接选择，跟随模板不会被删除」）。
//
// 这些图是**内置的 SVG 插画**，随前端产物一起构建：
//   · 离线可用（不联网取图）；
//   · 两端实例都是同一份（不像用户上传的图片只在本机有文件）；
//   · 每个只有 1KB 上下，不占安装包体积；
//   · **永远不会被删除** —— 删卡片只会清掉 `reminders.background` 里那个
//     `preset:<key>` 值，或者（上传的图片才有的）`/uploads/...` 文件，
//     这些内置资源不在清理范围内（见 server/reminder/background.go）。
//
// 后端只校验值的形状（`preset:<slug>`），不校验具体名单：加一张图不用改后端，
// 但**改 key 要小心** —— 老数据里的 key 找不到就回落到配色渐变。
import anniversary from '../assets/ceremony-bg/anniversary.svg'
import birthday from '../assets/ceremony-bg/birthday.svg'
import christmas from '../assets/ceremony-bg/christmas.svg'
import exam from '../assets/ceremony-bg/exam.svg'
import midautumn from '../assets/ceremony-bg/midautumn.svg'
import newyear from '../assets/ceremony-bg/newyear.svg'
import spring from '../assets/ceremony-bg/spring.svg'
import starry from '../assets/ceremony-bg/starry.svg'
import travel from '../assets/ceremony-bg/travel.svg'
import wedding from '../assets/ceremony-bg/wedding.svg'

export interface CeremonyBackgroundPreset {
  key: string
  label: string
  hint: string
  url: string
}

export const CEREMONY_BACKGROUNDS: CeremonyBackgroundPreset[] = [
  { key: 'birthday', label: '生日', hint: '气球与彩带', url: birthday },
  { key: 'anniversary', label: '纪念日', hint: '爱心', url: anniversary },
  { key: 'wedding', label: '婚礼', hint: '对戒', url: wedding },
  { key: 'newyear', label: '新年春节', hint: '红灯笼', url: newyear },
  { key: 'midautumn', label: '中秋', hint: '圆月', url: midautumn },
  { key: 'christmas', label: '圣诞', hint: '圣诞树', url: christmas },
  { key: 'spring', label: '春天', hint: '花开', url: spring },
  { key: 'exam', label: '考试升学', hint: '书本与铅笔', url: exam },
  { key: 'travel', label: '旅行', hint: '山海', url: travel },
  { key: 'starry', label: '星空夜色', hint: '星与月', url: starry },
]

const PRESET_BY_KEY = new Map(CEREMONY_BACKGROUNDS.map((item) => [item.key, item]))

/** 存进去的值是不是内置主题图（删卡片不会删它）。 */
export function isPresetBackground(value?: string | null): boolean {
  return !!value && value.startsWith('preset:')
}

/** 存进去的值是不是用户上传的图片（删卡片会跟着删文件）。 */
export function isUploadedBackground(value?: string | null): boolean {
  return !!value && value.startsWith('/uploads/')
}

/**
 * 把 `reminders.background` 的值换成可直接用的图片地址：
 *   `preset:<key>` → 内置图（构建后带 hash 的资源地址）
 *   `/uploads/...` → 服务端上传目录（**相对应用根**解析，飞牛网关下的子路径部署也不会拼错）
 *   其它/空 → 空串（调用方回落到配色渐变）
 */
export function backgroundImageUrl(value?: string | null): string {
  if (!value) return ''
  if (isPresetBackground(value)) {
    return PRESET_BY_KEY.get(value.slice('preset:'.length))?.url || ''
  }
  if (isUploadedBackground(value)) {
    // 走应用自己的 base（import.meta.env.BASE_URL）：飞牛网关下应用挂在子路径上，
    // 用 document.baseURI 会拼成 "/admin/list/uploads/xxx"（当前路由被当成目录）。
    const base = import.meta.env.BASE_URL || '/'
    return `${base}${value.replace(/^\//, '')}`
  }
  return ''
}
