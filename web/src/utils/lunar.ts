// 农历日期的中文写法：给仪式感卡片第二行用；月日与服务端 lunar 包一致，年份用干支。
// 月：正月…腊月，闰月加「闰」；日：初一…三十；年：干支（丙午年/丁未年）。
const MONTH_NAMES = ['', '正月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '冬月', '腊月']
const DAY_NAMES = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十']
const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']

export function lunarMonthName(month: number) {
  const abs = Math.abs(month)
  return `${month < 0 ? '闰' : ''}${MONTH_NAMES[abs] || ''}`
}

export function lunarDayName(day: number) {
  return DAY_NAMES[day] || ''
}

export function lunarYearName(year: number) {
  const index = ((year - 4) % 60 + 60) % 60
  return `${STEMS[index % 10]}${BRANCHES[index % 12]}年`
}

export function formatLunarDate(year: number, month: number, day: number) {
  return `${lunarYearName(year)} ${lunarMonthName(month)}${lunarDayName(day)}`
}
