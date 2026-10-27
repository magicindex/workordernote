// 清单图标库：侧栏、清单筛选、日历格子与清单编辑弹窗共用这一份。
//
// 以前清单在侧栏/日历里只用一颗「颜色圆点」表示，颜色多了就分不清；
// 现在每个清单可以挑一个图标（+ 原有颜色），识别度靠形状。
//
// 图标都是 24×24 的描边路径（stroke=currentColor），颜色继承文字色，
// 所以同一份数据在侧栏（清单色）与日历（清单色）里都能直接用。
//
// 后端 `server/reminder/list_icons.go` 里有一份**同样的 key 白名单**：改这里
// 必须同步改那边（与「日出日落城市」同一套规矩），否则用户选了会存不进去。

export interface ListIcon {
  key: string
  label: string
  /** svg 内层内容（不含 <svg> 外壳） */
  body: string
}

export const LIST_ICONS: ListIcon[] = [
  { key: 'list', label: '清单', body: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" stroke-width="2"/>' },
  { key: 'card', label: '银行卡', body: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6 13.5h4"/>' },
  { key: 'notebook', label: '记事本', body: '<rect x="6" y="3.5" width="13.5" height="17" rx="2.5"/><path d="M6 8h2.2M6 12h2.2M6 16h2.2"/><path d="M12.5 3.5v6.4l2.4-1.5 2.4 1.5V3.5"/>' },
  // 仪式感：礼花筒 + 星点（「人生要有仪式感」栏目用它）
  { key: 'ceremony', label: '仪式感', body: '<path d="M3.6 20.4 8.2 8.6l7.2 7.2-11.8 4.6Z"/><path d="M9.6 7.2c.5-1.6.4-3.1-.3-4.4M13.4 9.6c1.4-.6 2.4-1.7 2.9-3.2"/><path d="M17.4 12.6l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>' },
  // 生日/纪念日：蛋糕 + 蜡烛
  { key: 'cake', label: '生日', body: '<path d="M4.5 12.5h15v6.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-6.5Z"/><path d="M4.5 16c1.6 1.2 3 1.2 4.5 0s2.9-1.2 4.5 0 3 1.2 4.5 0"/><path d="M12 12.5V9.4"/><path d="M12 7.6c.8-.9 1.2-1.4 1.2-2A1.2 1.2 0 0 0 12 4.4a1.2 1.2 0 0 0-1.2 1.2c0 .6.4 1.1 1.2 2Z"/>' },
  { key: 'check', label: '待办', body: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.4 2.4 4.6-5"/>' },
  { key: 'star', label: '重要', body: '<path d="m12 4.4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 10l5.4-.8L12 4.4Z"/>' },
  { key: 'flag', label: '标记', body: '<path d="M6 21V4m0 1h10.5l-1.7 3.5L16.5 12H6"/>' },
  { key: 'work', label: '工作', body: '<rect x="3" y="7.5" width="18" height="12" rx="2.5"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12.5h18"/>' },
  { key: 'meet', label: '会议', body: '<path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 5 17.5V19"/><circle cx="10.5" cy="8" r="3.2"/><path d="M19 19v-1.6a3.4 3.4 0 0 0-2.6-3.3M15.6 5.2a3.2 3.2 0 0 1 0 6"/>' },
  { key: 'study', label: '学习', body: '<path d="m3 9.5 9-4.5 9 4.5-9 4.5-9-4.5Z"/><path d="M7 11.6V16c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.4M20 10.5V15"/>' },
  { key: 'book', label: '阅读', body: '<path d="M12 6.5C10.5 5.3 8.3 4.8 5 4.8v12.4c3.3 0 5.5.5 7 1.7 1.5-1.2 3.7-1.7 7-1.7V4.8c-3.3 0-5.5.5-7 1.7Z"/><path d="M12 6.5v12.4"/>' },
  { key: 'idea', label: '灵感', body: '<path d="M9 17.5h6M10 21h4"/><path d="M12 3.5a5.5 5.5 0 0 0-3.2 9.9c.5.4.8 1 1 1.6h4.4c.2-.6.5-1.2 1-1.6A5.5 5.5 0 0 0 12 3.5Z"/>' },
  { key: 'home', label: '家庭', body: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5Z"/><path d="M9.5 20.5v-6h5v6"/>' },
  { key: 'money', label: '财务', body: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18M16.5 15h1.5"/>' },
  { key: 'cart', label: '购物', body: '<path d="M3 5h2.2l2.3 10.2h10.8L20.5 8H6"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>' },
  { key: 'health', label: '健康', body: '<path d="M12 19.5S4.5 15.4 4.5 10.4A4 4 0 0 1 12 8a4 4 0 0 1 7.5 2.4c0 5-7.5 9.1-7.5 9.1Z"/>' },
  { key: 'sport', label: '运动', body: '<path d="M6.5 8v8M17.5 8v8M4 10.5h2.5M4 13.5h2.5M17.5 10.5H20M17.5 13.5H20M6.5 12h11"/>' },
  { key: 'travel', label: '出行', body: '<path d="M10.5 20.5l1.6-4.6 3.4 1.3 1.2-2-2.6-2.2 2.2-5.6a1.6 1.6 0 0 0-2.9-1.3l-2.9 5-3-1.1-1 2.2 3.2 1.6-.5 5.4"/>' },
  { key: 'car', label: '车辆', body: '<path d="M5 16v-3.2L6.6 8h10.8L19 12.8V16"/><path d="M3.5 16h17v2.5H17V16H7v2.5H3.5V16Z"/><path d="M6.5 12.8h11"/>' },
  { key: 'phone', label: '电话', body: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11.5 11.5 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z"/>' },
  { key: 'mail', label: '邮件', body: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>' },
  { key: 'repair', label: '维修', body: '<path d="M14.5 6.5a4 4 0 0 0 5.2 5.2L11 20.4a2.3 2.3 0 0 1-3.3-3.3l8.7-8.7a4 4 0 0 0-1.9-1.9Z"/><path d="M6.5 4.5 9 7 7.5 8.5 5 6"/>' },
  { key: 'camera', label: '影像', body: '<path d="M4 8.5h3l1.5-2h7L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5Z"/><circle cx="12" cy="13.8" r="3.2"/>' },
  { key: 'music', label: '音乐', body: '<path d="M9 18V6.5l10-2v11"/><circle cx="6.8" cy="18" r="2.3"/><circle cx="16.8" cy="15.5" r="2.3"/>' },
  { key: 'gift', label: '礼物', body: '<rect x="3.5" y="9" width="17" height="11" rx="2"/><path d="M3.5 13h17M12 9v11"/><path d="M12 9S10.5 4.5 8.3 4.5A2 2 0 0 0 8 8.6M12 9s1.5-4.5 3.7-4.5A2 2 0 0 1 16 8.6"/>' },
  { key: 'pet', label: '宠物', body: '<circle cx="7" cy="9.5" r="1.6"/><circle cx="11" cy="6.8" r="1.6"/><circle cx="15.6" cy="8.2" r="1.6"/><path d="M11.6 12.2c2.2 0 4.4 1.7 4.4 3.8 0 1.7-1.5 2.6-3.2 2.6-1 0-1.4-.3-2.2-.3s-1.2.3-2.2.3c-1.7 0-3.2-.9-3.2-2.6 0-2.1 2.2-3.8 4.4-3.8Z"/>' },
  { key: 'clock', label: '定时', body: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>' },
  { key: 'calendar', label: '日程', body: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4m8-4v4M3.5 10h17"/><path d="M8 14h3"/>' },
  { key: 'timetable', label: '课程表', body: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3.5v3M15 3.5v3M8.5 14h2M13.5 14h2M8.5 17h2"/>' },
  { key: 'fire', label: '紧急', body: '<path d="M12 21c3.6 0 6-2.3 6-5.4 0-3.9-3.3-5.4-4.3-9.6-2 1.2-3 3.2-3 5.2 0 1.2-.7 1.9-1.5 1.9S7.8 12.3 7.8 11c-1.2 1.4-1.8 3-1.8 4.6C6 18.7 8.4 21 12 21Z"/>' },
  // 仪式感／节日图标：灯笼、烟花、月亮、粽子、爱心、圣诞树、对戒、花、学士帽、宝宝。
  { key: 'lantern', label: '灯笼', body: '<path d="M9 3.5h6M10 3.5v2M14 3.5v2"/><rect x="6.5" y="6" width="11" height="12" rx="4"/><path d="M9 6v12M15 6v12M9 18v2h6v-2"/>' },
  { key: 'firework', label: '烟花', body: '<circle cx="12" cy="12" r="2.4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>' },
  { key: 'moon', label: '月亮', body: '<path d="M19 15.5A7.5 7.5 0 0 1 8.5 5a7.5 7.5 0 1 0 10.5 10.5Z"/><path d="m17.5 5.5.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5Z"/>' },
  { key: 'zongzi', label: '粽子', body: '<path d="M12 3.5 20 18a2 2 0 0 1-1.8 3H5.8A2 2 0 0 1 4 18L12 3.5Z"/><path d="M8 14c2.5 1.5 5.5 1.5 8 0M12 7v5"/>' },
  { key: 'heart', label: '爱心', body: '<path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9Z"/>' },
  { key: 'tree', label: '圣诞树', body: '<path d="M12 3 7 11h3l-4 6h12l-4-6h3L12 3Z"/><path d="M12 17v4M9 21h6"/>' },
  { key: 'rings', label: '对戒', body: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="10" r="5"/>' },
  { key: 'flower', label: '花', body: '<circle cx="12" cy="8" r="2.4"/><circle cx="8" cy="12" r="2.4"/><circle cx="16" cy="12" r="2.4"/><circle cx="12" cy="16" r="2.4"/><circle cx="12" cy="12" r="1.4"/>' },
  { key: 'grad', label: '毕业', body: '<path d="m3 9 9-4 9 4-9 4-9-4Z"/><path d="M7 11v4c0 1.7 2.2 3 5 3s5-1.3 5-3v-4M21 9v5"/>' },
  { key: 'baby', label: '宝宝', body: '<circle cx="12" cy="12" r="8"/><path d="M9 10h.01M15 10h.01M9.5 15c1.5 1 3.5 1 5 0M12 4c0-1 .7-1.5 1.5-1.5"/>' },
  { key: 'party', label: '派对', body: '<path d="M4 20l4-10 6 6-10 4Z"/><path d="M13 4v3M18 6l-2 2M20 12h-3M16 18l-2-2"/>' },
]

const ICON_MAP = new Map(LIST_ICONS.map((icon) => [icon.key, icon]))

/** 取图标定义；未知 key 回退到默认清单图标（老数据里的 icon 可能不是这一套）。 */
export function listIcon(key: string): ListIcon {
  return ICON_MAP.get(String(key || '').trim()) || LIST_ICONS[0]
}
