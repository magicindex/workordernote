import request from './request'

export interface BackupStatus {
  last_at: string
  last_status: string
  last_detail: string
  local_dir: string
}

export interface BackupFile {
  name: string
  size: number
  modified_at: string
}

export interface RestoreResult {
  file: string
  safety_file?: string
  version?: string
  created_at?: string
  users: number
  uploads: number
}

export function getBackupStatus() {
  return request.get('/api/backup/status')
}

export function runBackup() {
  return request.post('/api/backup/run')
}

export function listBackupFiles() {
  return request.get('/api/backup/files')
}

export function restoreBackup(file: string) {
  return request.post('/api/backup/restore', { file })
}

export function uploadRestore(file: File) {
  const form = new FormData()
  form.append('file', file)
  return request.post('/api/backup/upload-restore', form)
}
