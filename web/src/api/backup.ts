import request from './request'

export interface BackupStatus {
  last_at: string
  last_status: string
  last_detail: string
  local_dir: string
}

export function getBackupStatus() {
  return request.get('/api/backup/status')
}

export function runBackup() {
  return request.post('/api/backup/run')
}
