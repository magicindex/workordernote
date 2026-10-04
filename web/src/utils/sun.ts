/**
 * 日出日落计算 + 可选城市表。
 *
 * 「日出日落」主题模式用得到：日落之后切深色，日出之后切浅色。
 * 算法用 NOAA / 维基「Sunrise equation」那套常用公式（太阳平近点角 → 黄经 → 赤纬 →
 * 时角），对主题切换来说精度绰绰有余（分钟级），也不需要联网或任何依赖。
 *
 * SUN_CITIES 的 id 必须与后端 server/sysconfig/registry.go 里 sun_location 的
 * Options 完全一致：后端负责校验取值，前端负责把 id 翻译成中文名和经纬度。
 * 新增/删除城市时两个文件要一起改，否则设置里选得到、存不进去（或反过来）。
 */

export interface SunCity {
  name: string
  lat: number
  lon: number
}

export const SUN_CITIES: Record<string, SunCity> = {
  beijing: { name: '北京', lat: 39.90, lon: 116.41 },
  shanghai: { name: '上海', lat: 31.23, lon: 121.47 },
  tianjin: { name: '天津', lat: 39.08, lon: 117.20 },
  chongqing: { name: '重庆', lat: 29.56, lon: 106.55 },
  guangzhou: { name: '广州', lat: 23.13, lon: 113.26 },
  shenzhen: { name: '深圳', lat: 22.54, lon: 114.06 },
  hangzhou: { name: '杭州', lat: 30.27, lon: 120.16 },
  nanjing: { name: '南京', lat: 32.06, lon: 118.80 },
  suzhou: { name: '苏州', lat: 31.30, lon: 120.58 },
  wuxi: { name: '无锡', lat: 31.49, lon: 120.31 },
  changzhou: { name: '常州', lat: 31.81, lon: 119.97 },
  nantong: { name: '南通', lat: 31.98, lon: 120.89 },
  yangzhou: { name: '扬州', lat: 32.39, lon: 119.42 },
  xuzhou: { name: '徐州', lat: 34.26, lon: 117.19 },
  ningbo: { name: '宁波', lat: 29.87, lon: 121.55 },
  wenzhou: { name: '温州', lat: 27.99, lon: 120.70 },
  hefei: { name: '合肥', lat: 31.82, lon: 117.23 },
  fuzhou: { name: '福州', lat: 26.07, lon: 119.30 },
  xiamen: { name: '厦门', lat: 24.48, lon: 118.09 },
  nanchang: { name: '南昌', lat: 28.68, lon: 115.86 },
  jinan: { name: '济南', lat: 36.65, lon: 117.12 },
  qingdao: { name: '青岛', lat: 36.07, lon: 120.38 },
  yantai: { name: '烟台', lat: 37.46, lon: 121.45 },
  zhengzhou: { name: '郑州', lat: 34.75, lon: 113.63 },
  luoyang: { name: '洛阳', lat: 34.62, lon: 112.45 },
  wuhan: { name: '武汉', lat: 30.59, lon: 114.31 },
  changsha: { name: '长沙', lat: 28.23, lon: 112.94 },
  dongguan: { name: '东莞', lat: 23.02, lon: 113.75 },
  foshan: { name: '佛山', lat: 23.02, lon: 113.12 },
  zhuhai: { name: '珠海', lat: 22.27, lon: 113.58 },
  shantou: { name: '汕头', lat: 23.35, lon: 116.68 },
  nanning: { name: '南宁', lat: 22.82, lon: 108.37 },
  haikou: { name: '海口', lat: 20.04, lon: 110.32 },
  chengdu: { name: '成都', lat: 30.57, lon: 104.07 },
  kunming: { name: '昆明', lat: 25.04, lon: 102.72 },
  guiyang: { name: '贵阳', lat: 26.65, lon: 106.63 },
  xian: { name: '西安', lat: 34.34, lon: 108.94 },
  lanzhou: { name: '兰州', lat: 36.06, lon: 103.83 },
  xining: { name: '西宁', lat: 36.62, lon: 101.78 },
  yinchuan: { name: '银川', lat: 38.49, lon: 106.23 },
  urumqi: { name: '乌鲁木齐', lat: 43.83, lon: 87.62 },
  lhasa: { name: '拉萨', lat: 29.65, lon: 91.14 },
  hohhot: { name: '呼和浩特', lat: 40.84, lon: 111.75 },
  taiyuan: { name: '太原', lat: 37.87, lon: 112.55 },
  shijiazhuang: { name: '石家庄', lat: 38.04, lon: 114.51 },
  shenyang: { name: '沈阳', lat: 41.81, lon: 123.43 },
  dalian: { name: '大连', lat: 38.91, lon: 121.61 },
  changchun: { name: '长春', lat: 43.82, lon: 125.32 },
  harbin: { name: '哈尔滨', lat: 45.80, lon: 126.53 },
  kunshan: { name: '昆山', lat: 31.39, lon: 120.98 },
}

export const DEFAULT_SUN_CITY = 'shanghai'

export interface SunTimes {
  sunrise: Date
  sunset: Date
}

const RAD = Math.PI / 180
const DAY_MS = 86400000
const J1970 = 2440588
const J2000 = 2451545
const OBLIQUITY = 23.4397 * RAD
/** 日出/日落的标准定义：日面上边缘与地平线相切，含约 0.833° 的大气折射修正。 */
const SUN_ALTITUDE = -0.833 * RAD
const J0 = 0.0009

const toJulian = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970
const fromJulian = (julian: number) => new Date((julian + 0.5 - J1970) * DAY_MS)
const toDays = (date: Date) => toJulian(date) - J2000

function solarMeanAnomaly(days: number): number {
  return RAD * (357.5291 + 0.98560028 * days)
}

function eclipticLongitude(meanAnomaly: number): number {
  const center = RAD * (1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 0.0003 * Math.sin(3 * meanAnomaly))
  const perihelion = 102.9372 * RAD
  return meanAnomaly + center + Math.PI + perihelion
}

function declination(eclipticLon: number): number {
  return Math.asin(Math.sin(eclipticLon) * Math.sin(OBLIQUITY))
}

function solarTransitJ(days: number, meanAnomaly: number, eclipticLon: number): number {
  return J2000 + days + 0.0053 * Math.sin(meanAnomaly) - 0.0069 * Math.sin(2 * eclipticLon)
}

function hourAngle(latitude: number, dec: number): number {
  const numerator = Math.sin(SUN_ALTITUDE) - Math.sin(latitude) * Math.sin(dec)
  const denominator = Math.cos(latitude) * Math.cos(dec)
  return Math.acos(numerator / denominator)
}

/**
 * 求某一时刻所在那天、某地的日出与日落（返回绝对时刻，可直接和 Date 比较）。
 *
 * 极昼/极夜时太阳整天不升（或不落），时角无解，返回 null —— 调用方自行决定
 * 兜底策略（store 里用的是「早 7 点到晚 7 点算白天」）。
 */
export function sunTimes(date: Date, latitude: number, longitude: number): SunTimes | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const lw = RAD * -longitude
  const phi = RAD * latitude

  const days = toDays(date)
  const n = Math.round(days - J0 - lw / (2 * Math.PI))
  const ds = J0 + lw / (2 * Math.PI) + n

  const meanAnomaly = solarMeanAnomaly(ds)
  const eclipticLon = eclipticLongitude(meanAnomaly)
  const dec = declination(eclipticLon)

  const w = hourAngle(phi, dec)
  if (!Number.isFinite(w)) return null

  const transit = solarTransitJ(ds, meanAnomaly, eclipticLon)
  const jRise = solarTransitJ(J0 + (-w + lw) / (2 * Math.PI) + n, meanAnomaly, eclipticLon)
  const jSet = solarTransitJ(J0 + (w + lw) / (2 * Math.PI) + n, meanAnomaly, eclipticLon)
  if (!Number.isFinite(transit) || !Number.isFinite(jRise) || !Number.isFinite(jSet)) return null

  return { sunrise: fromJulian(jRise), sunset: fromJulian(jSet) }
}

/** 取城市坐标；未知 id（例如后端加了新城市但前端还没发版）时退回默认城市。 */
export function sunCity(id: string | null | undefined): SunCity {
  return SUN_CITIES[id || ''] || SUN_CITIES[DEFAULT_SUN_CITY]
}

/**
 * 当前是否应该用深色：日落之后到次日日出之前算夜间。
 * 极昼极夜没有日出日落，退回「19:00–07:00 算夜间」，至少不会整天同一个颜色。
 */
export function isNightAt(now: Date, cityId: string | null | undefined): boolean {
  const city = sunCity(cityId)
  const times = sunTimes(now, city.lat, city.lon)
  if (!times) {
    const hour = now.getHours()
    return hour < 7 || hour >= 19
  }
  return now < times.sunrise || now >= times.sunset
}
