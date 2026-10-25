// 农历日期的中文写法：给仪式感卡片第二行用，与服务端 lunar 包保持一致。
// 月：正月…腊月，闰月加「闰」；日：初一…三十；年：二〇二六年。
const MONTH_NAMES = ['', '正月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '冬月', '腊月']
const DAY_NAMES = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十']
const YEAR_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']

export function lunarMonthName(month: number) {
  const abs = Math.abs(month)
  return `${month < 0 ? '闰' : ''}${MONTH_NAMES[abs] || ''}`
}

export function lunarDayName(day: number) {
  return DAY_NAMES[day] || ''
}

export function lunarYearName(year: number) {
  return `${String(year).split('').map((d) => YEAR_DIGITS[Number(d)] || d).join('')}年`
}

export function formatLunarDate(year: number, month: number, day: number) {
  return `${lunarYearName(year)}${lunarMonthName(month)}${lunarDayName(day)}`
}
