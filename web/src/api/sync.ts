import request from './request'

// 双机同步的接口封装。全部是管理员接口（/api/reminder/admin/sync/*），
// 对端之间的 /api/reminder/sync/* 由服务端互调，浏览器不参与。

export type SyncDirection = 'off' | 'push' | 'pull' | 'both'

export interface SyncApplyStats {
  lists_created: number
  lists_updated: number
  lists_deleted: number
  reminders_created: number
  reminders_updated: number
  reminders_deleted: number
  completions_created: number
  completions_deleted: number
  cards_created?: number
  cards_updated?: number
  cards_deleted?: number
  card_statements_created?: number
  card_statements_updated?: number
  card_statements_deleted?: number
  skipped: number
  unmapped_users?: string[]
}

export interface SyncResult {
  at: string
  trigger: 'manual' | 'auto' | string
  direction: SyncDirection | string
  status: 'ok' | 'error' | string
  message?: string
  duration_ms: number
  peer_instance_id?: string
  peer_app_name?: string
  peer_app_version?: string
  peer_site_title?: string
  peer_users?: number
  matched_users?: number
  peer_clock_skew_seconds?: number
  pulled?: SyncApplyStats
  pushed?: SyncApplyStats
}

export interface SyncSettings {
  instance_id: string
  token: string
  direction: SyncDirection
  peer_url: string
  interval_minutes: number
  last_at?: string
  last_status?: string
  last_result?: SyncResult
  peer_instance_id?: string
  peer_summary?: string
  app_version: string
  local_users: string[]
  running: boolean
}

export interface SyncTestResult {
  instance_id: string
  app_name: string
  app_version: string
  site_title: string
  peer_users: string[]
  matched_users: string[]
  missing_users: string[]
  lists: number
  reminders: number
  completions: number
  clock_skew_seconds: number
  checked_at: string
}

export interface SyncSettingsInput {
  direction: SyncDirection
  peer_url: string
  token: string
  interval_minutes: number
}

export function getSyncSettings() {
  return request.get('/api/reminder/admin/sync')
}

export function saveSyncSettings(payload: SyncSettingsInput) {
  return request.put('/api/reminder/admin/sync', payload)
}

export function testSyncPeer() {
  return request.post('/api/reminder/admin/sync/test')
}

// 同步要取对端全量数据，默认 30s 的请求超时不够用（服务端最多等 150s）。
export function runSyncNow() {
  return request.post('/api/reminder/admin/sync/run', null, { timeout: 180000 })
}

export function regenerateSyncToken() {
  return request.post('/api/reminder/admin/sync/token')
}
