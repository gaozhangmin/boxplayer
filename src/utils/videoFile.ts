const videoExtensions = new Set(['3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'rmvb', 'ts', 'vob', 'webm', 'wmv'])

export function isVideoFile(file: { name?: string, file_name?: string, html?: string, ext?: string, category?: string, isDir?: boolean } | undefined | null): boolean {
  if (!file || file.isDir) return false
  if (String(file.category || '').startsWith('video')) return true
  const name = String(file.name || file.file_name || file.html || '')
  const extension = String(file.ext || (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '')).replace(/^\./, '').toLowerCase()
  return videoExtensions.has(extension)
}

/** Immediate children of a local folder as file-browser rows: subfolders first, then files, by natural name order. */
export async function listLocalDirectory(folderPath: string): Promise<any[]> {
  const fs = window.require?.('fs')
  const path = window.require?.('path')
  if (!fs || !path) throw new Error('Local folders are unavailable in this environment')
  const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
  const items: any[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(folderPath, entry.name)
    const stat = await fs.promises.stat(fullPath).catch(() => null)
    if (!stat) continue
    const isDir = stat.isDirectory()
    const ext = isDir ? '' : path.extname(entry.name).replace('.', '').toLowerCase()
    items.push({ name: entry.name, file_id: fullPath, path: fullPath, isDir, ext, size: stat.size || 0, time: stat.mtimeMs || 0, category: isDir ? 'folder' : isVideoFile({ name: entry.name, ext }) ? 'video' : 'others', description: '', drive_id: 'local', parent_file_id: folderPath })
  }
  return items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true }))
}
