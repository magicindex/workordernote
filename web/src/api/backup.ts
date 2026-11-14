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

/** 测一次 WebDAV 目录连通性（PROPFIND），返回耗时；失败时后端给出原因。 */
export function testWebDAV() {
  return request.post('/api/backup/webdav/test')
}

export interface LocalBackupDir {
  name: string
  path: string
}

export interface LocalBackupBrowseResult {
  path: string
  parent: string
  dirs: LocalBackupDir[]
}

/** 列出本机目录（空路径从数据目录开始），用于选择备份保存目录。 */
export function browseLocalBackup(path?: string) {
  return request.post('/api/backup/local/browse', path === undefined ? undefined : { path })
}

export interface WebDAVDir {
  name: string
  path: string
}

export interface WebDAVBrowseResult {
  path: string
  parent: string
  dirs: WebDAVDir[]
}

/** 列出远程指定路径（不传 = 当前配置路径）下一层目录，用于逐级选择备份路径。 */
export function browseWebDAV(path?: string) {
  return request.post('/api/backup/webdav/browse', path === undefined ? undefined : { path })
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
