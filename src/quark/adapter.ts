import type { IDownloadUrl, IVideoPreviewUrl } from '../aliapi/models'
import { GetExpiresTime } from '../utils/utils'
import { apiQuarkDownloadUrl, apiQuarkFileDetail, apiQuarkFileList, apiQuarkSearch, apiQuarkTrashList, apiQuarkVideoPreviewUrl, mapQuarkFileToAliModel } from './dirfilelist'
import { apiQuarkShareCreate, apiQuarkShareList } from './share'
import { apiQuarkMkdir, apiQuarkMoveBatch, apiQuarkRename, apiQuarkTrashBatch } from './filecmd'

export const listQuarkItems = async (userId: string, driveId: string, dirId: string, includeFiles: boolean, page = 1, strict = false) => {
  const isSearch = dirId.startsWith('search')
  const isTrash = dirId === 'trash'
  const parentId = dirId === 'quark_root' || isTrash ? '0' : dirId
  const result = isSearch
    ? { items: await apiQuarkSearch(userId, dirId.substring('search'.length).trim(), 200), total: 0 }
    : isTrash
      ? await apiQuarkTrashList(userId, 200, page, strict)
      : await apiQuarkFileList(userId, parentId, 200, page, strict)
  const mappedItems = result.items.map(item => mapQuarkFileToAliModel(item, driveId, isSearch ? 'quark_root' : isTrash ? 'trash' : dirId))
  const visibleItems = includeFiles ? mappedItems : mappedItems.filter(item => item.isDir)
  return { items: visibleItems, total: result.total || visibleItems.length, nextCursor: includeFiles && page * 200 < result.total ? String(page + 1) : '' }
}

export const getQuarkDownloadUrl = async (userId: string, driveId: string, fileId: string): Promise<IDownloadUrl | string> => {
  const result = await apiQuarkDownloadUrl(userId, fileId)
  return result.error || { drive_id: driveId, file_id: fileId, expire_time: GetExpiresTime(result.url), url: result.url, size: Number(result.size || 0), headers: result.headers }
}

export const getQuarkFileInfo = async (userId: string, driveId: string, fileId: string) => {
  if (fileId === 'quark_root' || fileId === '0') return { drive_id: driveId, file_id: 'quark_root', parent_file_id: '', name: '根目录', type: 'folder', isDir: true }
  const detail = await apiQuarkFileDetail(userId, fileId)
  if (!detail) return undefined
  const mapped = mapQuarkFileToAliModel(detail, driveId, detail.pdir_fid || 'quark_root') as any
  mapped.type = mapped.isDir ? 'folder' : 'file'
  return mapped
}

export const getQuarkVideoPreview = (userId: string, fileId: string): Promise<IVideoPreviewUrl | string> => apiQuarkVideoPreviewUrl(userId, fileId)

export const createQuarkShare = (userId: string, expiration: string, sharePwd: string, shareName: string, fileIds: string[]) => apiQuarkShareCreate(userId, expiration, sharePwd, shareName, fileIds)
export const listQuarkShares = (userId: string) => apiQuarkShareList(userId)
export const createQuarkFolder = (userId: string, parentFileId: string, name: string) => apiQuarkMkdir(userId, parentFileId.includes('root') ? 'quark_root' : parentFileId, name)
export const trashQuarkFiles = (userId: string, fileIds: string[]) => apiQuarkTrashBatch(userId, fileIds)
export const moveQuarkFiles = (userId: string, fileIds: string[], parentFileId: string) => apiQuarkMoveBatch(userId, fileIds, parentFileId.includes('root') ? 'quark_root' : parentFileId)
export const renameQuarkFiles = async (userId: string, fileIds: string[], names: string[]) => {
  const results: { file_id: string; parent_file_id: string; name: string; isDir: boolean }[] = []
  for (let index = 0; index < fileIds.length; index++) {
    const fileId = fileIds[index]
    const name = names[index] || ''
    if (!fileId || !name) continue
    const result = await apiQuarkRename(userId, fileId, name)
    if (result.success) results.push({ file_id: fileId, parent_file_id: result.parent_file_id, name: result.name, isDir: result.isDir })
  }
  return results
}
