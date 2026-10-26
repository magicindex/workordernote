import request from './request'

export type TimetableKind = 'course' | 'activity'
export type TimetablePermission = 'owner' | 'read' | 'write'

export interface TimetableSummary {
  id: number
  name: string
  // 表级默认「班级 / 地点」：条目没填地点时卡片显示它（用户 2026-10-19）。
  location?: string
  position: number
  entry_count: number
  // 排课节奏（详情接口才一定带上；列表接口可能没有）
  lesson_minutes?: number
  break_minutes?: number
  period_count?: number
  periods?: CoursePeriod[]
  // 共享：owner = 自己的表；read/write = 别人共享给我的表。
  permission?: TimetablePermission
  is_shared?: boolean
  owner_name?: string
}

// 一节课的骨架：属于哪一段 + 起止时间（用户 2026-10-19：每节次时间段可自己设）。
export interface CoursePeriod {
  section: 'early' | 'morning' | 'afternoon' | 'evening'
  start: string
  end: string
}

export interface TimetableEntry {
  id: number
  timetable_id: number
  title: string
  kind: TimetableKind
  weekday: number // 1=周一 … 7=周日
  start_time: string
  end_time: string
  location: string
  teacher: string
  note: string
  color: string
}

export interface EntryInput {
  title: string
  kind: TimetableKind
  weekday: number
  start_time: string
  end_time: string
  location: string
  teacher: string
  note: string
  color: string
}

export const getTimetables = () => request.get('/api/timetable/tables')

// copyFrom：新建时沿用这张表的节次与课时（用户 2026-10-19：「节次按当前时间设置成默认」）。
export const createTimetable = (name: string, copyFrom?: number, location = '') =>
  request.post('/api/timetable/tables', { name, location, ...(copyFrom ? { copy_from: copyFrom } : {}) })

export const getTimetable = (id: number) => request.get(`/api/timetable/tables/${id}`)

export const updateTimetable = (
  id: number,
  payload: {
    name?: string
    location?: string
    position?: number
    lesson_minutes?: number
    break_minutes?: number
    period_count?: number
    periods?: CoursePeriod[]
  },
) => request.patch(`/api/timetable/tables/${id}`, payload)

export const deleteTimetable = (id: number) => request.delete(`/api/timetable/tables/${id}`)

export const createEntry = (tableId: number, payload: EntryInput) =>
  request.post(`/api/timetable/tables/${tableId}/entries`, payload)

export const updateEntry = (id: number, payload: Partial<EntryInput>) =>
  request.patch(`/api/timetable/entries/${id}`, payload)

export const deleteEntry = (id: number) => request.delete(`/api/timetable/entries/${id}`)

export interface TimetableShare {
  id: number
  user_id: number
  username: string
  permission: 'read' | 'write'
  created_at?: string
}

export const getTimetableShares = (tableId: number) =>
  request.get(`/api/timetable/tables/${tableId}/shares`)

export const addTimetableShare = (tableId: number, username: string, permission: 'read' | 'write') =>
  request.post(`/api/timetable/tables/${tableId}/shares`, { username, permission })

export const updateTimetableShare = (shareId: number, permission: 'read' | 'write') =>
  request.patch(`/api/timetable/shares/${shareId}`, { permission })

export const removeTimetableShare = (shareId: number) =>
  request.delete(`/api/timetable/shares/${shareId}`)
