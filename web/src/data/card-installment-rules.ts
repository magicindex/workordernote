// 信用卡「账单分期」的银行规则表。
//
// 为什么单独一张表：各银行的期数、费率、手续费收取方式、提前结清规则都不一样，
// 而且费率会随用卡情况浮动。把这些差异收在一份数据里，界面只负责取值和算数，
// 以后调费率 / 补银行只改这个文件，不用动组件。
//
// 口径说明（重要）：
//   · perPeriod 是**每期费率**（小数）。值是数组时表示银行给的区间，界面按区间上下限算。
//   · upfrontTotal 是**一次性收取的总费率**（浦发、工行这类“总费率”口径）。
//   · feeMode：
//       per_period —— 每期收手续费（农行/中行/中信大额/平安/浦发默认）
//       upfront    —— 首期一次性收（工行、浦发可选方式）
//       auto       —— 看本金分界：低于 upfrontBelowYuan 一次性收，达到则分期收（中信 20001 元）
//   · 费率只写到“基准/参考”这一层：实际以账单为准，界面必须展示这句话。
//
// 数据来源（2026-11 核对）：
//   中行 https://www.bankofchina.com/bcservice/bc5/bc53/201008/t20100823_1418105.html
//   农行 https://www.abchina.com.cn/cn/CreditCard/WealthManagement/Consumption/
//   浦发 https://www.spdbccc.com.cn/zh/product_zdfqf_tk.html
//   中信 https://creditcard.ecitic.com/fenqi/zhangdanxigui.shtml
//   平安 https://xyk-cdn.pingan.com/fenqilicai/xiangqing.shtml
//   工行 https://big5.icbc-ltd.com/ICBC/牡丹卡/贴心服务/信用卡汇总分期.htm

export interface RateRange {
  min: number
  max: number
}

export type FeeMode = 'per_period' | 'upfront' | 'auto'

export type EarlySettle =
  | 'waive_remaining' // 已收不退，剩余未收的手续费不再收
  | 'charge_remaining' // 提前结清要把剩余手续费一起付掉
  | 'penalty' // 收提前结清违约金（另有罚息口径）
  | 'unknown' // 资料里没写明，界面只提醒“以银行审核为准”

export interface InstallmentRule {
  code: string
  name: string
  /** 匹配卡片上的银行名用（包含即算） */
  aliases: string[]
  /** 费率是否已按银行官网核对过 */
  verified: boolean
  updatedAt: string
  source?: string
  /** 可分期的最低本金（元） */
  minAmountYuan?: number
  periods: number[]
  /** 每期费率；数组 = 银行给的区间 */
  perPeriod: Record<number, number | [number, number]>
  /** 一次性收取的总费率（有值时优先于 perPeriod × 期数） */
  upfrontTotal?: Record<number, number>
  feeMode: FeeMode
  /** auto 模式的分界（元）：本金低于它按一次性收 */
  upfrontBelowYuan?: number
  earlySettle: EarlySettle
  earlySettleNote: string
  note?: string
}

export const INSTALLMENT_RULES: InstallmentRule[] = [
  {
    code: 'boc',
    name: '中国银行',
    aliases: ['中国银行', '中行', 'BOC'],
    verified: true,
    updatedAt: '2026-11-11',
    source: 'https://www.bankofchina.com/bcservice/bc5/bc53/201008/t20100823_1418105.html',
    minAmountYuan: 300,
    periods: [3, 6, 9, 12, 18, 24],
    // 官网给的是「分期基准利率」（总费率）：3 期 1.95%、6 期 3.60%、9 期 5.40%、
    // 12 期 7.20%、18 期 11.70%、24 期 15.00%，利息分期收取 → 折算成每期费率。
    perPeriod: { 3: 0.0065, 6: 0.006, 9: 0.006, 12: 0.006, 18: 0.0065, 24: 0.00625 },
    feeMode: 'per_period',
    earlySettle: 'unknown',
    earlySettleNote: '提前结清需致电客服申请、以银行审核为准；已收取的利息不退。',
    note: '官网口径「每期基准利率最高 0.65%」，上表按总费率折算。',
  },
  {
    code: 'abc',
    name: '中国农业银行',
    aliases: ['农业银行', '农行', 'ABC'],
    verified: true,
    updatedAt: '2026-11-11',
    source: 'https://www.abchina.com.cn/cn/CreditCard/WealthManagement/Consumption/',
    // 消费分期 500 元起；账单分期门槛以银行页面为准
    minAmountYuan: 500,
    periods: [3, 6, 9, 12, 15, 18, 24],
    perPeriod: { 3: 0.006, 6: 0.006, 9: 0.006, 12: 0.006, 15: 0.006, 18: 0.006, 24: 0.006 },
    feeMode: 'per_period',
    earlySettle: 'unknown',
    earlySettleNote: '提前结清规则以银行审核为准。',
    note: '基准每期 0.60%，按月收取；活动费率另计。',
  },
  {
    code: 'spdb',
    name: '浦发银行',
    aliases: ['浦发银行', '浦发', 'SPDB'],
    verified: true,
    updatedAt: '2026-11-11',
    source: 'https://www.spdbccc.com.cn/zh/product_zdfqf_tk.html',
    periods: [3, 6, 12, 15, 18, 24],
    perPeriod: { 3: 0.009, 6: 0.0078, 12: 0.0074, 15: 0.0075, 18: 0.0076, 24: 0.0076 },
    // 官网另给「一次性收取」总费率：3 期 2.64% / 6 期 4.44% / 12 期 8.16% /
    // 15 期 10.35% / 18 期 12.60% / 24 期 16.80%。
    upfrontTotal: { 3: 0.0264, 6: 0.0444, 12: 0.0816, 15: 0.1035, 18: 0.126, 24: 0.168 },
    feeMode: 'per_period',
    earlySettle: 'charge_remaining',
    earlySettleNote: '提前终止需一次性支付剩余本金与剩余手续费，已收部分不退。',
    note: '支持「分期收取 / 一次性收取」两种方式；这里默认按分期收取测算。',
  },
  {
    code: 'citic',
    name: '中信银行',
    aliases: ['中信银行', '中信', 'CITIC'],
    verified: true,
    updatedAt: '2026-11-11',
    source: 'https://creditcard.ecitic.com/fenqi/zhangdanxigui.shtml',
    minAmountYuan: 200,
    periods: [3, 6, 9, 12, 18, 24, 36],
    perPeriod: { 3: 0.008, 6: 0.008, 9: 0.0076, 12: 0.0073, 18: 0.0075, 24: 0.0075, 36: 0.0075 },
    feeMode: 'auto',
    // 单笔分期总额 20001 元以下：手续费一次性收取；20001 元及以上：分期收取。
    upfrontBelowYuan: 20001,
    earlySettle: 'waive_remaining',
    earlySettleNote: '提前结清：已收取的手续费不退（含一次性收取的），剩余未收的不再收取。',
  },
  {
    code: 'pingan',
    name: '平安银行',
    aliases: ['平安银行', '平安', 'PINGAN'],
    verified: true,
    updatedAt: '2026-11-11',
    source: 'https://xyk-cdn.pingan.com/fenqilicai/xiangqing.shtml',
    periods: [3, 6, 9, 12, 18, 24, 36],
    // 已出账单分期：银行按用卡情况在区间内定价
    perPeriod: {
      3: [0.0070, 0.0100],
      6: [0.0068, 0.0090],
      9: [0.0066, 0.0087],
      12: [0.0064, 0.0085],
      18: [0.0062, 0.0084],
      24: [0.0060, 0.0084],
      36: [0.0060, 0.0084],
    },
    feeMode: 'per_period',
    earlySettle: 'penalty',
    earlySettleNote: '提前结清：剩余本金按 3% 收提前结清罚息，已入账利息不退。',
    note: '官网只给区间（实际利率按用卡情况浮动），这里按区间上下限测算。',
  },
  {
    code: 'icbc',
    name: '中国工商银行',
    aliases: ['工商银行', '工行', 'ICBC'],
    verified: true,
    updatedAt: '2026-11-11',
    source: 'https://big5.icbc-ltd.com/ICBC/牡丹卡/贴心服务/信用卡汇总分期.htm',
    minAmountYuan: 100,
    // 官网只写明了 12 期基准：7.2%（近似折算年化 13.03%）。其它期数没有可靠口径，
    // 不硬编一个数字进去，界面上只让选 12 期。
    periods: [12],
    perPeriod: { 12: 0.006 },
    upfrontTotal: { 12: 0.072 },
    feeMode: 'upfront',
    earlySettle: 'unknown',
    earlySettleNote: '提前还款规则以银行口径为准。',
    note: '仅收录 12 期基准（总费率 7.2%），其它期数以账单为准。',
  },
]

/**
 * 没收录的银行用这一份：只做量级参考，不能当成真实费率。
 * 界面必须同时显示“该银行未收录”。
 */
export const FALLBACK_RULE: InstallmentRule = {
  code: 'generic',
  name: '通用参考',
  aliases: [],
  verified: false,
  updatedAt: '2026-11-11',
  periods: [3, 6, 12, 24],
  perPeriod: { 3: 0.0075, 6: 0.0075, 12: 0.0075, 24: 0.0075 },
  feeMode: 'per_period',
  earlySettle: 'unknown',
  earlySettleNote: '未收录该银行的提前结清规则，请以账单/客服为准。',
  note: '该银行未收录，按通用参考费率（每期 0.75%）测算，仅作量级参考。',
}

/** 按卡片上的银行名找规则；找不到返回通用参考。 */
export function findInstallmentRule(bank: string): InstallmentRule {
  const name = (bank || '').replace(/\s+/g, '').toUpperCase()
  if (!name) return FALLBACK_RULE
  const hit = INSTALLMENT_RULES.find((rule) =>
    rule.aliases.some((alias) => name.includes(alias.replace(/\s+/g, '').toUpperCase())),
  )
  return hit || FALLBACK_RULE
}

function toRange(value: number | [number, number] | undefined): RateRange | null {
  if (value === undefined) return null
  if (Array.isArray(value)) return { min: value[0], max: value[1] }
  return { min: value, max: value }
}

export interface InstallmentEstimate {
  rule: InstallmentRule
  periods: number
  paid: number
  remaining: number
  principalCents: number
  perPeriodRate: RateRange | null
  /** 每期手续费（分） */
  perPeriodFee: RateRange
  /** 全部手续费（分） */
  totalFee: RateRange
  /** 剩余未出的手续费（分）；一次性收取时为 0 */
  remainingFee: RateRange
  /** 是否按一次性收取算 */
  upfront: boolean
  /** 剩余未还本金（分） */
  remainingPrincipal: RateRange
  earlyNote: string
  warning?: string
}

/**
 * 估算分期：给定本金、期数、已还期数，算出剩余期数、剩余本金与手续费。
 * 金额一律用「分」算，避免浮点误差；区间费率返回上下限。
 */
export function estimateInstallment(
  rule: InstallmentRule,
  principalCents: number,
  periods: number,
  paid: number,
  /** 手工改过的每期费率（小数）；给值就覆盖银行表里的官方费率（用户 2026-11-13） */
  overrideRate?: number | null,
): InstallmentEstimate {
  const safePeriods = Math.max(1, periods)
  const safePaid = Math.min(Math.max(0, paid), safePeriods)
  const remaining = safePeriods - safePaid
  const perPeriodRate = overrideRate && overrideRate > 0
    ? { min: overrideRate, max: overrideRate }
    : toRange(rule.perPeriod[safePeriods])
  const zero: RateRange = { min: 0, max: 0 }
  const principal = Math.max(0, principalCents)

  let upfront = rule.feeMode === 'upfront'
  if (rule.feeMode === 'auto') {
    upfront = rule.upfrontBelowYuan !== undefined && principal < rule.upfrontBelowYuan * 100
  }

  const totalRate = (() => {
    // 手工费率优先：用户自己填的每期费率 × 期数，就是这次分期的总费率
    if (overrideRate && overrideRate > 0) return { min: overrideRate * safePeriods, max: overrideRate * safePeriods }
    const total = rule.upfrontTotal?.[safePeriods]
    if (total !== undefined) return { min: total, max: total }
    if (!perPeriodRate) return null
    return { min: perPeriodRate.min * safePeriods, max: perPeriodRate.max * safePeriods }
  })()

  const perPeriodFee = perPeriodRate
    ? { min: principal * perPeriodRate.min, max: principal * perPeriodRate.max }
    : zero

  let totalFee = zero
  let remainingFee = zero
  if (upfront) {
    if (totalRate) totalFee = { min: principal * totalRate.min, max: principal * totalRate.max }
    // 已还过一期＝首期已经把总手续费收掉了，剩余未出的手续费为 0
    remainingFee = safePaid > 0 ? zero : totalFee
  } else if (perPeriodRate) {
    totalFee = { min: perPeriodFee.min * safePeriods, max: perPeriodFee.max * safePeriods }
    remainingFee = { min: perPeriodFee.min * remaining, max: perPeriodFee.max * remaining }
  }

  const principalRatio = remaining / safePeriods
  const remainingPrincipal = {
    min: Math.round(principal * principalRatio * 100) / 100,
    max: Math.round(principal * principalRatio * 100) / 100,
  }

  let warning: string | undefined
  if (rule.minAmountYuan !== undefined && principal > 0 && principal < rule.minAmountYuan * 100) {
    warning = `低于该行最低分期金额 ¥${rule.minAmountYuan}`
  }
  if (!perPeriodRate) warning = warning || '该期数的费率未收录'

  return {
    rule,
    periods: safePeriods,
    paid: safePaid,
    remaining,
    principalCents: principal,
    perPeriodRate,
    perPeriodFee,
    totalFee,
    remainingFee,
    upfront,
    remainingPrincipal,
    earlyNote: rule.earlySettleNote,
    warning,
  }
}
