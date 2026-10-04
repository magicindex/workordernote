import request from './request'

export type ReminderChannel = 'inapp' | 'email' | 'sms' | 'feishu' | 'qq' | 'dingtalk'

// A row is either a task (needs confirming completion) or a note (记事: a plain
// record that counts as completed the moment it is created).
export type ReminderKind = 'task' | 'note'

// 「已完成」记录有两个来源：
//   history  —— completions 历史表，重复提醒的每一次完成（提醒删掉后记录仍在）
//   reminder —— reminders.completed_at，非重复提醒的完成，以及全部记事
export type CompletedSource = 'history' | 'reminder'

export type CompletedRangeOption = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom'

export interface CompletedItem {
  id: number
  source: CompletedSource
  reminder_id: number
  title: string
  completed_at: string
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
}

export interface ReminderItem {
  id: number
  list_id: number
  list_name: string
  title: string
  notes: string
  kind: ReminderKind
  priority: number
  due_at: string | null
  all_day: boolean
  repeat_rule: string
  calendar: string
  lunar_anchor?: string
  completed_at: string | null
  snoozed_until: string | null
  version: number
  channels: ReminderChannel[]
  channel_targets?: Record<string, number[]>
  repeat_notify_minutes: number
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
  repeat_rule?: string
  calendar?: string
  lunar_anchor?: string
  channels?: ReminderChannel[]
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
  due_at: string
  /** 到期日在上海时区下的 YYYY-MM-DD，日历按它归格，避免浏览器时区导致跨天错位 */
  due_date: string
  all_day: boolean
  completed: boolean
  kind: ReminderKind
  priority: number
  repeat_rule: string
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
export const createList = (data: { name: string; color?: string; icon?: string }) =>
  request.post('/api/reminder/lists', data)
export const updateList = (id: number, data: Partial<ReminderList>) =>
  request.patch(`/api/reminder/lists/${id}`, data)
export const deleteList = (id: number) => request.delete(`/api/reminder/lists/${id}`)

export const getReminders = (params: { view?: string; list_id?: number; q?: string }) =>
  request.get('/api/reminder/items', { params })

/** 多清单筛选参数：把 id 数组拼成后端认的 list_ids=1,2,3。 */
export function listIdsParam(ids: number[]): string | undefined {
  return ids.length ? ids.join(',') : undefined
}
// 「已完成」走独立接口：数据源是 completions 历史 ∪ reminders 的完成，支持时间段筛选。
export const getCompletedHistory = (params: {
  range?: CompletedRangeOption
  from?: string
  to?: string
  list_ids?: string
  list_id?: number
  q?: string
}) => request.get('/api/reminder/completed', { params })
export const getReminder = (id: number) => request.get(`/api/reminder/items/${id}`)
export const createReminder = (data: SaveReminderInput) => request.post('/api/reminder/items', data)
export const updateReminder = (id: number, data: SaveReminderInput) =>
  request.put(`/api/reminder/items/${id}`, data)
export const deleteReminder = (id: number) => request.delete(`/api/reminder/items/${id}`)
export const completeReminder = (id: number) => request.post(`/api/reminder/items/${id}/complete`)
export const restoreReminder = (id: number) => request.post(`/api/reminder/items/${id}/restore`)
export const snoozeReminder = (id: number, until: string) =>
  request.post(`/api/reminder/items/${id}/snooze`, { until })

export const getNotifications = () => request.get('/api/reminder/notifications')
export const getUnreadCount = () => request.get('/api/reminder/notifications/unread-count')
export const markNotificationRead = (id: number) => request.post(`/api/reminder/notifications/${id}/read`)
export const markAllNotificationsRead = () => request.post('/api/reminder/notifications/read-all')
// 跨设备同步的轻量探针：只回一个单调递增的修订号。SSE 万一被中间代理缓冲，前端
// 靠定时比对它也能发现「另一台设备改过数据」并刷新（见 MainLayout 的 pollRevision）。
export const getRevision = () => request.get('/api/reminder/revision')

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
