import { boxApiRequest, mapBoxItemToAliModel, toBoxId } from './dirfilelist'

export type BoxItemType = 'file' | 'folder'

export const getBoxSelectedTypes = (fileIds: string[], items: Array<{ file_id: string; isDir: boolean }>): Record<string, BoxItemType | undefined> => {
  return Object.fromEntries(items.filter(item => fileIds.includes(item.file_id)).map(item => [item.file_id, item.isDir ? 'folder' : 'file']))
}

const getBoxItemType = async (user_id: string, fileId: string): Promise<BoxItemType | undefined> => {
  const file = await boxApiRequest<any>(user_id, `/files/${encodeURIComponent(fileId)}?fields=id,type`, { method: 'GET' }, '', true)
  if (file?.type === 'file') return 'file'
  const folder = await boxApiRequest<any>(user_id, `/folders/${encodeURIComponent(fileId)}?fields=id,type`, { method: 'GET' }, '', true)
  return folder?.type === 'folder' ? 'folder' : undefined
}

const resolveBoxItemType = async (user_id: string, fileId: string, knownType?: BoxItemType): Promise<BoxItemType | undefined> => {
  return knownType || await getBoxItemType(user_id, fileId)
}

export const toBoxFolderId = toBoxId

export const buildBoxMkdirBody = (name: string, parentId: string) => ({
  name,
  parent: { id: toBoxFolderId(parentId) }
})

export const buildBoxRenameBody = (name: string) => ({ name })

export const buildBoxMoveBody = (parentId: string) => ({
  parent: { id: toBoxFolderId(parentId) }
})

export const buildBoxCopyBody = (parentId: string, name?: string) => ({
  parent: { id: toBoxFolderId(parentId) },
  ...(name ? { name } : {})
})

export const buildBoxTrashListPath = (marker = '') => {
  const query = new URLSearchParams({ limit: '1000', usemarker: 'true', fields: 'id,type,name,size,sha1,parent,path_collection,created_at,modified_at,extension,item_status' })
  if (marker) query.set('marker', marker)
  return `/folders/trash/items?${query.toString()}`
}

export const apiBoxTrashListPage = async (user_id: string, marker = ''): Promise<{ items: any[]; nextMarker: string }> => {
  const data = await boxApiRequest<any>(user_id, buildBoxTrashListPath(marker), { method: 'GET' }, '获取 Box 回收站失败')
  return { items: Array.isArray(data?.entries) ? data.entries : [], nextMarker: data?.next_marker || '' }
}

export const apiBoxTrashRestore = async (user_id: string, fileId: string, type: BoxItemType): Promise<boolean> => {
  const data = await boxApiRequest<any>(user_id, `/${type === 'folder' ? 'folders' : 'files'}/${encodeURIComponent(fileId)}`, { method: 'POST' }, '恢复 Box 回收站文件失败')
  return !!data?.id
}

export const apiBoxTrashPurge = async (user_id: string, fileId: string, type: BoxItemType): Promise<boolean> => {
  const data = await boxApiRequest<any>(user_id, `/${type === 'folder' ? 'folders' : 'files'}/${encodeURIComponent(fileId)}/trash`, { method: 'DELETE' }, '彻底删除 Box 回收站文件失败')
  return data !== null
}

export const apiBoxMkdir = async (user_id: string, parentId: string, name: string): Promise<{ file_id: string; error: string }> => {
  const data = await boxApiRequest<any>(user_id, '/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBoxMkdirBody(name, parentId))
  }, '创建 Box 文件夹失败')
  return { file_id: data?.id || '', error: data?.id ? '' : '创建 Box 文件夹失败' }
}

export const apiBoxDeleteBatch = async (user_id: string, fileIdList: string[], knownTypes: Record<string, BoxItemType | undefined> = {}): Promise<string[]> => {
  const errors: string[] = []
  for (const fileId of fileIdList) {
    const type = await resolveBoxItemType(user_id, fileId, knownTypes[fileId])
    if (!type) {
      errors.push(fileId)
      continue
    }
    const path = `/${type === 'folder' ? 'folders' : 'files'}/${encodeURIComponent(fileId)}${type === 'folder' ? '?recursive=true' : ''}`
    const data = await boxApiRequest<any>(user_id, path, { method: 'DELETE' }, '删除 Box 文件失败')
    if (data === null) errors.push(fileId)
  }
  return errors
}

export const apiBoxRename = async (user_id: string, fileId: string, name: string, itemType?: BoxItemType) => {
  const type = await resolveBoxItemType(user_id, fileId, itemType)
  if (!type) return undefined
  const data = await boxApiRequest<any>(user_id, `/${type === 'folder' ? 'folders' : 'files'}/${encodeURIComponent(fileId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBoxRenameBody(name))
  }, '重命名 Box 文件失败')
  return data ? mapBoxItemToAliModel(data, 'box', data.parent?.id || 'box_root') : undefined
}

export const apiBoxMoveBatch = async (user_id: string, fileIdList: string[], parentId: string, knownTypes: Record<string, BoxItemType | undefined> = {}): Promise<string[]> => {
  const success: string[] = []
  for (const fileId of fileIdList) {
    const type = await resolveBoxItemType(user_id, fileId, knownTypes[fileId])
    if (!type) continue
    const data = await boxApiRequest<any>(user_id, `/${type === 'folder' ? 'folders' : 'files'}/${encodeURIComponent(fileId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBoxMoveBody(parentId))
    }, '移动 Box 文件失败')
    if (data) success.push(fileId)
  }
  return success
}

export const apiBoxCopyBatch = async (user_id: string, fileIdList: string[], parentId: string, knownTypes: Record<string, BoxItemType | undefined> = {}): Promise<string[]> => {
  const success: string[] = []
  for (const fileId of fileIdList) {
    const type = await resolveBoxItemType(user_id, fileId, knownTypes[fileId])
    if (!type) continue
    const data = await boxApiRequest<any>(user_id, `/${type === 'folder' ? 'folders' : 'files'}/${encodeURIComponent(fileId)}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBoxCopyBody(parentId))
    }, '复制 Box 文件失败')
    if (data) success.push(fileId)
  }
  return success
}
