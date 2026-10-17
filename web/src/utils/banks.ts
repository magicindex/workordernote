// 国内银行预设：新建卡片时从下拉里选，卡面用银行标志区分。
//
// 图标来源：`@icongo/bl`（Bank Logos Icons，MIT）里的官方配色 SVG，已抽取并按
// `assets/banks/<code>.svg` 存放，构建时由 Vite 输出成独立静态文件（`?url`），
// 所以**不需要**在服务端静态白名单里再加一条。
//
// 标志是各银行的商标，这里只用于在用户自己的应用里标识「这是哪家银行的卡」。
//
// 注意：`Card.Bank` 存的是**名字**（老数据是用户手填的自由文本），所以识别标志时
// 用「包含」匹配（含全称与常见简称），匹配不上就不显示标志、退回纯文字卡面。

import icbc from '../assets/banks/icbc.svg?url'
import ccb from '../assets/banks/ccb.svg?url'
import abchina from '../assets/banks/abchina.svg?url'
import boc from '../assets/banks/boc.svg?url'
import bankcomm from '../assets/banks/bankcomm.svg?url'
import cmbchina from '../assets/banks/cmbchina.svg?url'
import citicbank from '../assets/banks/citicbank.svg?url'
import spdb from '../assets/banks/spdb.svg?url'
import cib from '../assets/banks/cib.svg?url'
import cebbank from '../assets/banks/cebbank.svg?url'
import cmbc from '../assets/banks/cmbc.svg?url'
import hxb from '../assets/banks/hxb.svg?url'
import cgbchina from '../assets/banks/cgbchina.svg?url'
import pingan from '../assets/banks/pingan.svg?url'
import psbc from '../assets/banks/psbc.svg?url'
import bankofbeijing from '../assets/banks/bankofbeijing.svg?url'
import bosc from '../assets/banks/bosc.svg?url'
import nbcb from '../assets/banks/nbcb.svg?url'
import jsbchina from '../assets/banks/jsbchina.svg?url'
import njcb from '../assets/banks/njcb.svg?url'
import czbank from '../assets/banks/czbank.svg?url'
import hfbank from '../assets/banks/hfbank.svg?url'
import alipay from '../assets/banks/alipay.svg?url'
import wechat from '../assets/banks/wechat.svg?url'
import jdfinance from '../assets/banks/jdfinance.svg?url'

export interface BankPreset {
  /** 图标文件名（assets/banks/<code>.svg） */
  code: string
  /** 存进 Card.Bank 的规范名字 */
  name: string
  /** 识别用的别名（简称 / 全称 / 拼音首字母常见写法） */
  aliases: string[]
  logo: string
  /**
   * 非银行的消费/信用付平台（支付宝 / 微信 / 京东金融）。
   * 卡面上银行的标志本身能认出来，而这类平台的标志往往是「一只动物 / 一个符号」，
   * 单看图标认不出是哪家（用户 2026-10-17：「京东金融只有京东图标没有文字」），
   * 所以卡面在标志旁边**再写一篇名字**。
   */
  nonBank?: boolean
}

export const BANK_PRESETS: BankPreset[] = [
  { code: 'icbc', name: '工商银行', aliases: ['工商', '工行', 'icbc'], logo: icbc },
  { code: 'ccb', name: '建设银行', aliases: ['建设', '建行', 'ccb'], logo: ccb },
  { code: 'abchina', name: '农业银行', aliases: ['农业', '农行', 'abchina'], logo: abchina },
  { code: 'boc', name: '中国银行', aliases: ['中行', 'boc'], logo: boc },
  { code: 'bankcomm', name: '交通银行', aliases: ['交通', '交行', 'bankcomm'], logo: bankcomm },
  { code: 'cmbchina', name: '招商银行', aliases: ['招商', '招行', 'cmb'], logo: cmbchina },
  { code: 'citicbank', name: '中信银行', aliases: ['中信', 'citic'], logo: citicbank },
  { code: 'spdb', name: '浦发银行', aliases: ['浦发', '上海浦东发展', 'spdb'], logo: spdb },
  { code: 'cib', name: '兴业银行', aliases: ['兴业', 'cib'], logo: cib },
  { code: 'cebbank', name: '光大银行', aliases: ['光大', 'ceb'], logo: cebbank },
  { code: 'cmbc', name: '民生银行', aliases: ['民生', 'cmbc'], logo: cmbc },
  { code: 'hxb', name: '华夏银行', aliases: ['华夏', 'hxb'], logo: hxb },
  { code: 'cgbchina', name: '广发银行', aliases: ['广发', '广东发展', 'cgb'], logo: cgbchina },
  { code: 'pingan', name: '平安银行', aliases: ['平安', '深发展', 'pab'], logo: pingan },
  { code: 'psbc', name: '邮储银行', aliases: ['邮政储蓄', '邮储', 'psbc'], logo: psbc },
  { code: 'bankofbeijing', name: '北京银行', aliases: ['北京银行', 'bob'], logo: bankofbeijing },
  { code: 'bosc', name: '上海银行', aliases: ['上海银行', 'bosc'], logo: bosc },
  { code: 'nbcb', name: '宁波银行', aliases: ['宁波', 'nbcb'], logo: nbcb },
  { code: 'jsbchina', name: '江苏银行', aliases: ['江苏银行', 'jsbank'], logo: jsbchina },
  { code: 'njcb', name: '南京银行', aliases: ['南京', 'njcb'], logo: njcb },
  { code: 'czbank', name: '浙商银行', aliases: ['浙商', 'czbank'], logo: czbank },
  { code: 'hfbank', name: '恒丰银行', aliases: ['恒丰', 'hfbank'], logo: hfbank },
  // 「类银行卡」的消费/信用付平台（用户 2026-10-10 要求：支付宝、微信、京东金融）：
  // 花呗 / 分付 / 白条这些也有账单日与还款日，卡面同样需要标志来区分。
  // 图标来源：支付宝、微信用 Simple Icons（CC0，官方标志的单色版，这里按品牌色填充：
  // 支付宝 #1677ff、微信 #07c160）；京东金融在可用的开源图标集里没有完整彩色标志，
  // 用 Arcticons 的 `jd-finance`（CC BY-SA 4.0，作者 Donnnno / Arcticons Team）
  // 线性图标、按品牌红 #e1251b 描边 —— 若拿到官方 SVG，直接替换
  // `assets/banks/jdfinance.svg` 即可，代码不用动。
  { code: 'alipay', name: '支付宝', aliases: ['支付宝', 'alipay', '花呗', '借呗'], logo: alipay, nonBank: true },
  { code: 'wechat', name: '微信', aliases: ['微信', 'wechat', 'weixin', '分付', '零钱通'], logo: wechat, nonBank: true },
  { code: 'jdfinance', name: '京东金融', aliases: ['京东金融', '京东', 'jdfinance', 'jd', '白条', '京东白条'], logo: jdfinance, nonBank: true },
]

/** 按卡上存的名字找银行预设；找不到（老数据里的自由文本）返回 null。 */
export function bankPresetOf(bank: string): BankPreset | null {
  const name = String(bank || '').trim().toLowerCase()
  if (!name) return null
  for (const preset of BANK_PRESETS) {
    if (name.includes(preset.name)) return preset
    for (const alias of preset.aliases) {
      if (alias.length >= 2 && name.includes(alias.toLowerCase())) return preset
    }
  }
  return null
}

/** 按卡上存的名字找银行标志；找不到（老数据里的自由文本）返回 null。 */
export function bankLogoOf(bank: string): string | null {
  return bankPresetOf(bank)?.logo || null
}

/**
 * 卡面上标志旁边要写出来的名字：只有**非银行**的消费/信用付平台才返回名字，
 * 银行仍然只靠标志识别（用户此前明确要求「图标后边不再加 XX银行字样」）。
 */
export function bankFaceLabelOf(bank: string): string {
  const preset = bankPresetOf(bank)
  return preset?.nonBank ? preset.name : ''
}
