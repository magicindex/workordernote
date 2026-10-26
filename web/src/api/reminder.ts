import request from './request'

export type ReminderChannel = 'inapp' | 'email' | 'sms' | 'feishu' | 'qq' | 'dingtalk'

// A row is either a task (needs confirming completion) or a note (记事: a plain
// record that counts as completed the moment it is created).
export type ReminderKind = 'task' | 'note'

// 「已完成」记录有两个来源：
//   history  —— completions 历史表，重复提醒的每一次完成（提醒删掉后记录仍在）
//   reminder —— reminders.completed_at，非重复提醒的完成，以及全部记事
export type CompletedSource = 'history' | 'reminder'

export type CompletedRangeOption = 'all' | 'today' | 'yesterday' | 'week' | 'lastweek' | 'month' | 'lastmonth' | 'year' | 'custom'

export interface CompletedItem {
  id: number
  source: CompletedSource
  reminder_id: number
  title: string
  completed_at: string
  /** 底层提醒的录入时间：用来显示「完成时段（录入 → 完成）· 共多久」 */
  created_at?: string | null
  scheduled_for?: string | null
  list_id: number
  list_name: string
  kind: ReminderKind
  repeat_rule: string
  /** 底层提醒是否还在；历史记录本身没有可删的东西，前端据此决定是否给操作按钮 */
  reminder_exists: boolean
}

export interface ReminderList {
  id: number
  name: string
  color: string
  icon: string
  position: number
  is_default: boolean
  open_count: number
  /** 这一栏的 AI 提示词：小秘分析这一栏的数据时一起交给模型（空串 = 不加要求） */
  ai_prompt?: string
  template?: 'general' | 'credit_card' | 'notebook' | 'ceremony'
  /** 信用卡账单栏目才有：这一栏里有几张卡（侧栏角标用） */
  card_count?: number
  card_name?: string
  card_bank?: string
  card_no?: string
  card_statement_day?: number
  card_due_day?: number
  card_notes?: string
  card_auto_repeat?: boolean
}

export interface ReminderItem {
  id: number
  list_id: number
  list_name: string
  /** 所属清单的色名（blue/violet/rose/amber/emerald），列表页用它给标题上色 */
  list_color: string
  /** 「这是第几次」：循环项目已完成过 N 次，这一次就是第 N+1 次；非循环项目为 0 */
  cycle_index?: number
  title: string
  notes: string
  /** 仪式感卡片底部自定义文案（空＝自动显示次数） */
  bottom_text?: string
  kind: ReminderKind
  priority: number
  due_at: string | null
  all_day: boolean
  /** 时间段任务的起止（计划页专用）；都为空表示普通的单点时间任务 */
  start_at?: string | null
  end_at?: string | null
  repeat_rule: string
  calendar: string
  lunar_anchor?: string
  completed_at: string | null
  snoozed_until: string | null
  version: number
  channels: ReminderChannel[]
  channel_targets?: Record<string, number[]>
  repeat_notify_minutes: number
  /** 仪式感卡片的过渡色色名（空/缺省＝默认色） */
  accent?: string
  /** 仪式感卡片的背景图：`preset:<key>`（内置主题图）或 `/uploads/...`（自己上传的图片） */
  background?: string
  /** 当前用户能不能删这条（只有创建者可以；服务端按 user_id 判定） */
  can_delete?: boolean
  /** 背景图蒙板：虚化像素数（0–24，0 = 不虚化） */
  bg_blur?: number
  /** 背景图蒙板：透明度百分比（0–100，越大越清透；默认 45） */
  bg_mask?: number
  /** 整卡背景透明度：100 = 不透明，0 = 只剩文字（见 server/reminder/models.go） */
  bg_alpha?: number
  created_at: string
  updated_at: string
}

export interface SaveReminderInput {
  title: string
  notes?: string
  kind?: ReminderKind
  channel_targets?: Record<string, number[]>
  repeat_notify_minutes?: number
  list_id?: number
  priority?: number
  due_at?: string | null
  all_day?: boolean
  /** 时间段：只给 start_at 等同单点时间；两个都给表示「开始—结束」 */
  start_at?: string | null
  end_at?: string | null
  repeat_rule?: string
  calendar?: string
  lunar_anchor?: string
  channels?: ReminderChannel[]
  /** 仪式感卡片的过渡色色名（见 utils/card-accents.ts）；不传＝不改，空串＝用默认色 */
  accent?: string
  /** 仪式感卡片的背景图（见 utils/ceremony-backgrounds.ts）；不传＝不改，空串＝清掉背景 */
  background?: string
  /** 背景图蒙板：虚化像素数（0–24）/ 透明度百分比（0–100）；不传＝不改 */
  bg_blur?: number
  bg_mask?: number
  /** 整卡背景透明度：100 = 不透明，0 = 只剩文字（见 server/reminder/models.go） */
  bg_alpha?: number
  /** 仪式感卡片底部自定义文案；传空串恢复自动次数文案 */
  bottom_text?: string
  version?: number
}

export interface ChannelBindingItem {
  id: number
  target_masked: string
  status: string
}

export interface LunarDayInfo {
  year: number
  month: number
  day: number
  lunar: string
  lunar_month: number
  lunar_day: number
  lunar_year_name?: string
  term?: string
  festival?: string
  in_month: boolean
}

export interface LunarCalendarMonth {
  year: number
  month: number
  days: LunarDayInfo[]
}

// 日历视图里的一个到期提醒。含已完成项——日历要能看到「这天有哪些安排、
// 哪些已经做完」。记事没有到期日，不会出现在这里。
export interface CalendarItem {
  id: number
  title: string
  list_id: number
  list_name: string
  /** 色名（blue/violet/rose/amber/emerald），沿用侧栏那套映射上色 */
  list_color: string
  /** 清单图标的 key（见 utils/list-icons.ts）：日历格子用图标代替圆点 */
  list_icon: string
  due_at: string
  /** 时间段任务的起止（计划页的「开始—结束」）；没有区间时为空 */
  start_at?: string | null
  end_at?: string | null
  /** 到期日在上海时区下的 YYYY-MM-DD，日历按它归格，避免浏览器时区导致跨天错位 */
  due_date: string
  all_day: boolean
  completed: boolean
  kind: ReminderKind
  priority: number
  repeat_rule: string
  /** 备注原文（日历界面不展示，导出「本月」时带上） */
  notes?: string
  /** 信用卡还款计划生成的项：statement=账单日、due=还款日（日历里两色标记） */
  card_role?: '' | 'statement' | 'due' | 'advance'
  /**
   * 完成时间。任务用它填导出表格的「完成时间」列；记事没有到期时间，
   * 它的**记录时间**放在 due_at 里（后端取 completed_at），导出时写进完成时间列。
   */
  completed_at?: string | null
}

export interface LunarConvertResult {
  lunar_year: number
  lunar_month: number
  lunar_day: number
  lunar_year_name: string
  year: number
  month: number
  day: number
}

export const getLunarCalendar = (year: number, month: number) =>
  request.get('/api/reminder/lunar', { params: { year, month } })

// 日历网格数据。from/to 为 YYYY-MM-DD（上海时区），左闭右开。
export const getCalendarItems = (params: { from: string; to: string; list_ids?: string }) =>
  request.get('/api/reminder/calendar', { params })

export const convertLunarDate = (params:
  | { year: number; month: number; day: number }
  | { lunar_year: number; lunar_month: number; lunar_day: number }
) => request.get<LunarConvertResult, { data: { data: LunarConvertResult } }>('/api/reminder/lunar/convert', { params })

export interface ChannelStatus {
  channel: ReminderChannel
  label: string
  configured: boolean
  bound: boolean
  status: string
  target_masked?: string
  bot_link?: string
  description: string
  bindings?: ChannelBindingItem[]
}

export const getSummary = () => request.get('/api/reminder/summary')
export const getLists = () => request.get('/api/reminder/lists')
export const createList = (data: { name: string; color?: string; icon?: string; template?: 'general' | 'credit_card'; ai_prompt?: string }) =>
  request.post('/api/reminder/lists', data)
export const updateList = (id: number, data: Partial<ReminderList>) =>
  request.patch(`/api/reminder/lists/${id}`, data)
export const deleteList = (id: number) => request.delete(`/api/reminder/lists/${id}`)
/** 清单顺序（用户 2026-10-10 要求）：一次提交整串 id，服务端按顺序写 position（1..N）。 */
export const reorderLists = (ids: number[]) =>
  request.put('/api/reminder/lists/order', { ids })


/**
 * status='all' 表示连已完成的也返回（列表页「未完成 / 全部」开关的「全部」）。
 * 记事创建即完成，所以「我的清单」想看见记事就得打开这个开关。
 *
 * 时间窗口二选一：
 *   month=YYYY-MM      旧的按月翻页（兼容保留）
 *   from/to=YYYY-MM-DD 泛化区间（含起不含止）；记事本页不带时间窗口
 * sort=created_desc 用于记事本页（按创建/记录时间倒序）
 */
export const getReminders = (params: { view?: string; list_id?: number; q?: string; status?: 'all'; month?: string; from?: string; to?: string; sort?: string }) =>
  request.get('/api/reminder/items', { params })

/** 有数据的月份范围（首/末月）：给「全部」页底部左右翻月用，只在两端之间可翻。 */
export const getReminderMonths = () =>
  request.get('/api/reminder/items/months')

/** 多清单筛选参数：把 id 数组拼成后端认的 list_ids=1,2,3。 */
export function listIdsParam(ids: number[]): string | undefined {
  return ids.length ? ids.join(',') : undefined
}
// 「已完成」走独立接口：数据源是 completions 历史 ∪ reminders 的完成，支持时间段筛选。
// 返回 { items, span }：span 是后端算出来的实际区间（含当天），给界面显示「当前区间」用。
export const getCompletedHistory = (params: {
  range?: CompletedRangeOption
  from?: string
  to?: string
  list_ids?: string
  list_id?: number
  q?: string
}) => request.get('/api/reminder/completed', { params })

/** 导出当前筛选结果成表格（CSV）。接口要带鉴权头，所以按 blob 取再前端落盘。 */
export function exportReminders(params: {
  /**
   * active   = 列表页（按 view/q/list_ids/status）
   * completed= 已完成页（按 range/from/to）
   * calendar = 日历页（按 month=YYYY-MM + list_ids，内容与日历上看到的一致）
   */
  scope?: 'active' | 'completed' | 'calendar'
  view?: string
  range?: CompletedRangeOption
  from?: string
  to?: string
  list_ids?: string
  list_id?: number
  q?: string
  /** status='all' 时连已完成的也导出（与列表页「未完成 / 全部」开关一致） */
  status?: 'all'
  /** 日历导出用：YYYY-MM，缺省当月 */
  month?: string
  /**
   * 导出对话框的清单多选：`1,2,3`（缺省＝全部清单，含信用卡/记事本系统栏目）。
   * 与旧的 list_ids/list_id 等价，新参数优先。
   */
  lists?: string
  /** 导出对话框的列多选：`title,due,...`（缺省＝全部列，与旧版一致） */
  columns?: string
}) {
  return request.get('/api/reminder/export', { params, responseType: 'blob' })
}
export const getReminder = (id: number) => request.get(`/api/reminder/items/${id}`)
export const createReminder = (data: SaveReminderInput) => request.post('/api/reminder/items', data)
export const updateReminder = (id: number, data: SaveReminderInput) =>
  request.put(`/api/reminder/items/${id}`, data)
export const deleteReminder = (id: number) => request.delete(`/api/reminder/items/${id}`)
export const completeReminder = (id: number) => request.post(`/api/reminder/items/${id}/complete`)
export const restoreReminder = (id: number) => request.post(`/api/reminder/items/${id}/restore`)
export const snoozeReminder = (id: number, until: string) =>
  request.post(`/api/reminder/items/${id}/snooze`, { until })

// 「提醒@他」：多人之间互相推提醒（后端见 server/reminder/nudge.go）。
// 三个时间点就是全部状态：created_at 发出 → read_at 对方已收到 → done_at 对方已完成。
export interface Nudge {
  id: number
  from_user_id: number
  to_user_id: number
  from_username: string
  to_username: string
  /** 这条显示在哪一列：sent=我提醒他人 / received=别人提醒我 */
  direction: 'sent' | 'received'
  content: string
  note: string
  due_at?: string | null
  read_at?: string | null
  done_at?: string | null
  created_at: string
  can_delete: boolean
  /** 「保存到清单」：存到哪个清单、以及那条任务是不是已完成（卡片状态与清单同步） */
  reminder_id?: number | null
  list_id?: number
  list_name?: string
  saved_done?: boolean
}

export interface NudgeBox {
  sent: Nudge[]
  received: Nudge[]
  counts: {
    received_pending: number
    received_unread: number
    sent_pending: number
    sent_done: number
  }
}

export interface NudgeUser {
  id: number
  username: string
}

export const listNudges = () => request.get('/api/reminder/nudges')
export const listNudgeUsers = () => request.get('/api/reminder/nudges/users')
export const createNudge = (data: { to_user_id: number; content: string; note?: string; due_at?: string | null }) =>
  request.post('/api/reminder/nudges', data)
export const readNudge = (id: number) => request.post(`/api/reminder/nudges/${id}/read`)
/** 「保存到清单」：把别人推来的提醒变成自己某个清单里的待办任务。 */
export const saveNudgeToList = (id: number, listId: number) =>
  request.post(`/api/reminder/nudges/${id}/save`, { list_id: listId })
/** 「提醒一下」：再即时推一次给对方（对方立刻收到站内通知/弹窗）。 */
export const remindNudgeAgain = (id: number) => request.post(`/api/reminder/nudges/${id}/remind`)
export const doneNudge = (id: number) => request.post(`/api/reminder/nudges/${id}/done`)
export const deleteNudge = (id: number) => request.delete(`/api/reminder/nudges/${id}`)

export const getNotifications = () => request.get('/api/reminder/notifications')
export const markNotificationRead = (id: number) => request.post(`/api/reminder/notifications/${id}/read`)
export const markAllNotificationsRead = () => request.post('/api/reminder/notifications/read-all')
// 跨设备同步的轻量探针：只回一个单调递增的修订号。SSE 万一被中间代理缓冲，前端
// 靠定时比对它也能发现「另一台设备改过数据」并刷新（见 MainLayout 的 pollRevision）。
export const getRevision = () => request.get('/api/reminder/revision')

/**
 * 免打扰（用户 2026-10-16）：首行铃铛旁边那个喇叭/静音按钮。
 * 状态的权威在服务端 —— manual 是用户自己点出来的开关（dnd_manual），
 * window_* 是后台「系统配置 → 免打扰」的时间段，active = 两者任一成立。
 */
export interface DNDState {
  manual: boolean
  window_enabled: boolean
  window_start: string
  window_end: string
  in_window: boolean
  active: boolean
  reason: string
}

export const getDNDState = () => request.get('/api/reminder/dnd')
export const setDNDManual = (manual: boolean) => request.put('/api/reminder/dnd', { manual })

export const getChannelStatuses = () => request.get('/api/reminder/channels')
export const bindChannel = (channel: ReminderChannel, target: string) =>
  request.put(`/api/reminder/channels/${channel}`, { target })
export const toggleChannel = (channel: ReminderChannel, enabled: boolean) =>
  request.patch(`/api/reminder/channels/${channel}`, { enabled })
export const unbindChannel = (channel: ReminderChannel) =>
  request.delete(`/api/reminder/channels/${channel}`)
export const unbindChannelTarget = (channel: ReminderChannel, id: number) =>
  request.delete(`/api/reminder/channels/${channel}/bindings/${id}`)
export const testChannel = (channel: ReminderChannel) =>
  request.post(`/api/reminder/channels/${channel}/test`)
export const getProviderStatuses = () => request.get('/api/reminder/admin/providers')
export const getNotificationBrand = () => request.get('/api/reminder/admin/notification-brand')
export const saveNotificationBrand = (name: string) => request.put('/api/reminder/admin/notification-brand', { name })
export const saveFeishuProvider = (data: { app_id: string; app_secret: string }) =>
  request.put('/api/reminder/admin/providers/feishu', data)
export const saveProvider = (provider: 'email' | 'sms' | 'qq', data: Record<string, string>) =>
  request.put(`/api/reminder/admin/providers/${provider}`, data)
export const createQQBindCode = () => request.post('/api/reminder/channels/qq/bind-code')

// ---- 安卓客户端（WebView 壳子）的发布信息 ----
export interface AndroidClient {
  version: string
  notes: string
  file_name: string
  file_size: number
  sha256: string
  uploaded_at: string
  has_apk: boolean
  lan_url: string
  wan_url: string
  min_sdk: number
}

/**
 * 上传一张图片（仪式感卡片的背景图用），返回服务端存下来的路径 `/uploads/...`。
 *
 * 服务端（server/upload/upload.go）只接受 JPEG/PNG/GIF/WebP、最大 20MB，
 * 扩展名按探测到的内容定、文件名是 UUID，不采信客户端的文件名。
 */
export const uploadImage = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return request.post('/api/upload', fd, { timeout: 120000 })
}

export const getAndroidClient = () => request.get('/api/reminder/android')

/** 管理员上传/替换安装包（顺带把版本号写进配置）。 */
export const uploadAndroidApk = (file: File, version: string) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('version', version)
  // 上传大文件别用默认的 30s 超时
  return request.post('/api/reminder/admin/android/apk', fd, { timeout: 300000 })
}

/** 管理员下架安装包。 */
export const deleteAndroidApk = () => request.delete('/api/reminder/admin/android/apk')

// ---- 新设备导入（从另一台设备搬清单与内容） ----
export interface SyncProfileUser {
  username: string
  role: string
  lists: number
  reminders: number
  completions: number
  exists_local: boolean
}

export interface SyncProfiles {
  instance_id: string
  app_name: string
  version: string
  users: SyncProfileUser[]
}

/** 用对端地址 + 同步令牌看对端有哪些账号、各有多少数据。 */
export const previewSyncImport = (data: { peer_url: string; token: string }) =>
  request.post('/api/reminder/admin/sync/import/preview', data, { timeout: 60000 })

/** 执行导入：按需建同名账号 + 写同步设置 + 立刻拉一次全量。 */
export const runSyncImport = (data: {
  peer_url: string
  token: string
  usernames: string[]
  passwords?: Record<string, string>
  create_missing?: boolean
  direction?: string
  interval_minutes?: number
}) => request.post('/api/reminder/admin/sync/import', data, { timeout: 300000 })


// ---- 信用卡（一个清单可以放多张卡） ----
export interface CardSummary {
  statement_date: string
  due_date: string
  days_to_statement: number
  days_to_due: number
  grace_days: number
  advance_date?: string
  advance_days: number
}

export interface CardStatement {
  id?: number
  card_id: number
  period: string
  statement_date: string
  due_date: string
  amount_cents: number
  minimum_cents: number
  paid_at?: string | null
  paid_amount_cents: number
  note: string
}

export interface CreditCard {
  id: number
  list_id: number
  name: string
  bank: string
  no: string
  holder: string
  limit_cents: number
  statement_day: number
  due_day: number
  advance_days: number
  auto_repeat: boolean
  notes: string
  color: string
  position: number
  summary: CardSummary | null
  current: CardStatement | null
  /** 最近一次已还款的那一期：当期推进到下一期后，卡片仍要能显示并撤销它 */
  last_paid?: CardStatement | null
  unpaid_total_cents: number
  unpaid_count: number
  /** 开卡时间：算「第几期」用（后端 GORM 自带字段） */
  created_at?: string
}

export interface CardPeriod {
  period: string
  statement_date: string
  due_date: string
  amount_cents: number
  minimum_cents: number
  paid: boolean
  paid_at?: string
  paid_amount_cents: number
  overdue: boolean
  current: boolean
  note?: string
}

export type CardInput = {
  list_id?: number
  name?: string
  bank?: string
  no?: string
  holder?: string
  limit_cents?: number
  statement_day?: number
  due_day?: number
  advance_days?: number
  auto_repeat?: boolean
  notes?: string
  color?: string
  regenerate_plan?: boolean
}

export const getCards = (listId?: number) =>
  request.get('/api/reminder/cards' + (listId ? `?list_id=${listId}` : ''))
export const createCard = (data: CardInput) => request.post('/api/reminder/cards', data)
export const updateCard = (id: number, data: CardInput) => request.patch(`/api/reminder/cards/${id}`, data)
export const deleteCard = (id: number) => request.delete(`/api/reminder/cards/${id}`)

// 「账单已出、当期未还」的卡：信用卡页头部那条时间卡片右半边用的数据。
// 口径见后端 card_billing.go：账单日过了且这一期没还的卡才进来，逾期与「还款日前 3 天」
// 的（红色）排最前，其余按账单日由早到晚。
export interface BillingCard {
  card_id: number
  bank: string
  name: string
  color: string
  tail: string
  period: string
  statement_date: string
  due_date: string
  days_left: number
  overdue: boolean
  /** 逾期或离还款日 ≤3 天：卡面是红色 */
  urgent: boolean
  amount_cents: number
  minimum_cents: number
}

export interface Billing {
  today: string
  weekday: string
  count: number
  overdue: number
  urgent: number
  total_cents: number
  cards: BillingCard[]
}

export const getBillingCards = () => request.get('/api/reminder/cards/billing')
export const getCardSchedule = (id: number, months = 12) =>
  request.get(`/api/reminder/cards/${id}/schedule?months=${months}`)
export const saveCardStatement = (id: number, period: string, data: { amount_cents: number; minimum_cents?: number; note?: string }) =>
  request.put(`/api/reminder/cards/${id}/statements/${period}`, data)
export const payCardStatement = (id: number, period: string, amountCents?: number) =>
  request.post(`/api/reminder/cards/${id}/statements/${period}/pay`, { amount_cents: amountCents || 0 })
export const unpayCardStatement = (id: number, period: string) =>
  request.post(`/api/reminder/cards/${id}/statements/${period}/unpay`)
