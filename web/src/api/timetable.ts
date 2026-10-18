import request from './request'

export type TimetableKind = 'course' | 'activity'

export interface TimetableSummary {
  id: number
  name: string
  position: number
  entry_count: number
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

export const createTimetable = (name: string) => request.post('/api/timetable/tables', { name })

export const getTimetable = (id: number) => request.get(`/api/timetable/tables/${id}`)

export const updateTimetable = (id: number, payload: { name?: string; position?: number }) =>
  request.patch(`/api/timetable/tables/${id}`, payload)

export const deleteTimetable = (id: number) => request.delete(`/api/timetable/tables/${id}`)

export const createEntry = (tableId: number, payload: EntryInput) =>
  request.post(`/api/timetable/tables/${tableId}/entries`, payload)

export const updateEntry = (id: number, payload: Partial<EntryInput>) =>
  request.patch(`/api/timetable/entries/${id}`, payload)

export const deleteEntry = (id: number) => request.delete(`/api/timetable/entries/${id}`)
