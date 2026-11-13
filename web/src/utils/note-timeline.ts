// 「备注」的两种来源（用户 2026-11-13 明确：它们不是同一条备注）：
//   · 新建备注 —— 条目创建时写的 notes，时间取 created_at；
//   · 完成备注 —— 勾完成时弹窗里写的那句话：一次性任务在 completed_note（时间 completed_at），
//     循环任务每次完成各记一条（completion_notes）。
//
// 展示口径：**按时间戳拼在一起**，每条先给时间与类型，再给正文，方便一眼看出
// 「什么时候写的、是哪种备注」。编辑面板与列表/已完成页共用这一套。

export interface NoteTimelineEntry {
  /** ISO 时间 */
  at: string
  /** 11-13 09:10（同年不写年份，跨年才写全） */
  timeLabel: string
  /** 新建备注 / 完成备注 */
  label: '新建备注' | '完成备注'
  text: string
}

export interface NoteTimelineSource {
  notes?: string | null
  created_at?: string | null
  completed_at?: string | null
  completed_note?: string | null
  completion_notes?: { note: string; completed_at: string }[] | null
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const date = sameYear ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 把新建备注与所有完成备注按时间升序拼成一条时间线（空的自动跳过）。 */
export function buildNoteTimeline(src: NoteTimelineSource | null | undefined): NoteTimelineEntry[] {
  if (!src) return []
  const entries: NoteTimelineEntry[] = []
  const notes = (src.notes || '').trim()
  if (notes) {
    const at = src.created_at || ''
    entries.push({ at, timeLabel: at ? fmtTime(at) : '', label: '新建备注', text: notes })
  }
  const completedNote = (src.completed_note || '').trim()
  if (completedNote) {
    const at = src.completed_at || ''
    entries.push({ at, timeLabel: at ? fmtTime(at) : '', label: '完成备注', text: completedNote })
  }
  for (const row of src.completion_notes || []) {
    const text = (row?.note || '').trim()
    if (!text) continue
    entries.push({ at: row.completed_at, timeLabel: row.completed_at ? fmtTime(row.completed_at) : '', label: '完成备注', text })
  }
  // 时间升序；没有时间的排最后（正常情况下不会出现）
  return entries.sort((a, b) => {
    if (!a.at && !b.at) return 0
    if (!a.at) return 1
    if (!b.at) return -1
    return a.at < b.at ? -1 : a.at > b.at ? 1 : 0
  })
}
