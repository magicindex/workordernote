// 仪式感卡片图标库：按节日 / 纪念 / 日常分组，key 复用 list-icons.ts 的同一套描边图标。
import { listIcon } from './list-icons'

export const CEREMONY_ICON_GROUPS: { label: string; keys: string[] }[] = [
  { label: '节日', keys: ['lantern', 'firework', 'moon', 'zongzi', 'heart', 'tree', 'flag', 'star'] },
  { label: '纪念', keys: ['cake', 'gift', 'rings', 'flower', 'baby', 'party'] },
  { label: '日常', keys: ['ceremony', 'calendar', 'travel', 'book', 'grad', 'home', 'pet'] },
]

export function ceremonyIconLabel(key: string) {
  return listIcon(key).label
}

/** 按标题自动选图标：常用节假日与纪念日不用手动挑。 */
export function autoCeremonyIcon(title: string) {
  if (/春节|元宵|灯会/.test(title)) return 'lantern'
  if (/中秋|月饼/.test(title)) return 'moon'
  if (/端午|粽子/.test(title)) return 'zongzi'
  if (/七夕|情人|恋爱/.test(title)) return 'heart'
  if (/国庆/.test(title)) return 'flag'
  if (/元旦|跨年|新年/.test(title)) return 'firework'
  if (/圣诞/.test(title)) return 'tree'
  if (/高考|中考|考试|毕业/.test(title)) return 'grad'
  if (/结婚|纪念|婚/.test(title)) return 'rings'
  if (/生日|寿/.test(title)) return 'cake'
  return 'ceremony'
}
