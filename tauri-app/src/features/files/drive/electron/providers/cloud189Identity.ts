export type Cloud189FileItem = {
  id?: string
  fileId?: string
  folderId?: string
  name?: string
  fileName?: string
  folderName?: string
  size?: number | string
  parentId?: string
  parentFolderId?: string
  lastOpTime?: string
  createDate?: string
  icon?: { smallUrl?: string; mediumUrl?: string; max600?: string }
  isFolder?: boolean
  familyId?: string
}

export const cloud189FamilyId = (familyId: string, rawId = '') => `cloud189_family:${encodeURIComponent(familyId)}:${encodeURIComponent(rawId)}`

export const cloud189Scope = (id: string | number) => {
  const value = String(id ?? '')
  if (value.startsWith('cloud189_family:')) {
    const parts = value.split(':')
    if (parts.length !== 3 || !parts[1]) throw new Error('无效的天翼家庭空间标识')
    return { familyId: decodeURIComponent(parts[1]), rawId: decodeURIComponent(parts[2]) }
  }
  return { familyId: '', rawId: ['', 'root', 'cloud189_root', '0', '/', '-11'].includes(value) ? '-11' : value }
}

export const cloud189IsRoot = (id: string) => ['', 'root', 'cloud189_root', '0', '/', '-11'].includes(id)

export const preserveCloud189LargeIds = (text: string) => {
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length;) {
    const char = text[index]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      index++
      continue
    }
    if (char === '"') {
      inString = true
      output += char
      index++
      continue
    }
    if (char === '-' || char >= '0' && char <= '9') {
      let end = index + 1
      while (end < text.length && !/[\s,}\]]/.test(text[end])) end++
      const value = text.slice(index, end)
      if (/^-?\d+$/.test(value) && !Number.isSafeInteger(Number(value))) output += `"${value}"`
      else output += value
      index = end
      continue
    }
    output += char
    index++
  }
  return output
}

const details = new Map<string, Cloud189FileItem>()

const detailKey = (userId: string, id: string) => JSON.stringify([userId, id])

export const rememberCloud189File = (userId: string, item: Cloud189FileItem) => {
  const raw = String(item.id || item.fileId || item.folderId || '')
  if (!raw) return
  const id = item.familyId ? cloud189FamilyId(item.familyId, raw) : raw
  details.set(detailKey(userId, id), item)
}

export const forgetCloud189Files = (userId: string) => {
  // Folder operations can invalidate cached descendants as well.
  const prefix = JSON.stringify([userId]).slice(0, -1) + ','
  for (const key of details.keys()) if (key.startsWith(prefix)) details.delete(key)
}
