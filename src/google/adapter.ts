import type { IDownloadUrl } from '../aliapi/models'
import { apiGoogleFileDetail, apiGoogleFileListPage, apiGoogleSearch, apiGoogleSharedDriveFileList, apiGoogleSharedDrives, apiGoogleSharedWithMeList, apiGoogleTrashList, buildGoogleDownloadUrl, buildGoogleExportUrl, getGoogleSharedDriveIdForFile, getGoogleToken, mapGoogleFileToAliModel, parseGoogleSearchId } from './dirfilelist'
import { apiGoogleResolveDownload } from './download'
import { GOOGLE_DRIVE_RECONNECT_MESSAGE } from './accessPolicy'
import { apiGoogleShareCreate } from './share'
import { apiGoogleUploadBuffer } from './upload'
import { apiGoogleCopyBatch, apiGoogleDeleteBatch, apiGoogleMkdir, apiGoogleMoveBatch, apiGoogleTrashBatch, apiGoogleTrashRestoreBatch } from './filecmd'

export const googleRootVirtualItems = () => [
  { id: 'google_shared', name: '共享云端硬盘', mimeType: 'application/vnd.google-apps.folder' }
]

export const getGoogleDownloadUrl = async (userId: string, driveId: string, fileId: string): Promise<IDownloadUrl | string> => {
  const token = await getGoogleToken(userId)
  if (!token?.access_token) return GOOGLE_DRIVE_RECONNECT_MESSAGE
  const detail = await apiGoogleFileDetail(userId, fileId)
  const headers = { Authorization: `Bearer ${token.access_token}` }
  if (detail?.mimeType === 'application/vnd.google-apps.vid') {
    const url = await apiGoogleResolveDownload(userId, fileId, 'video/mp4', '', detail.resourceKey || '')
    return url ? { drive_id: driveId, file_id: fileId, expire_time: 0, url, size: Number(detail.size || 0), headers } : 'Google Vids 正在准备下载，请稍后重试'
  }
  const url = buildGoogleExportUrl(fileId, detail?.mimeType || '') || buildGoogleDownloadUrl(fileId, detail?.resourceKey || '')
  if ((detail?.mimeType || '').startsWith('application/vnd.google-apps.') && !buildGoogleExportUrl(fileId, detail?.mimeType || '')) return '该 Google Workspace 文件类型暂不支持导出'
  return { drive_id: driveId, file_id: fileId, expire_time: 0, url, size: Number(detail?.size || 0), headers }
}

export const getGoogleFileInfo = async (userId: string, driveId: string, fileId: string) => {
  if (fileId === 'google_root') return { drive_id: driveId, file_id: fileId, parent_file_id: '', name: '根目录', type: 'folder', isDir: true }
  if (fileId === 'google_shared') return { drive_id: driveId, file_id: fileId, parent_file_id: '', name: '共享云端硬盘', type: 'folder', isDir: true }
  const detail = await apiGoogleFileDetail(userId, fileId)
  if (!detail) return undefined
  const mapped = mapGoogleFileToAliModel(detail, driveId, detail.parents?.[0] || 'google_root') as any
  mapped.type = mapped.isDir ? 'folder' : 'file'
  return mapped
}

export const createGoogleShare = async (userId: string, driveId: string, fileIds: string[], shareName: string, expiration: string, sharePwd: string) => {
  const result = await apiGoogleShareCreate(userId, driveId, fileIds, shareName, expiration, sharePwd)
  return result.error || result.item || '创建 Google Drive 分享链接失败'
}

export const uploadGoogleTextFile = async (userId: string, parentFileId: string, fileName: string, content: string): Promise<string> => {
  const result = await apiGoogleUploadBuffer(userId, parentFileId, fileName, Buffer.from(content || '', 'utf-8'))
  return result.error || 'success'
}

export const createGoogleFolder = (userId: string, parentFileId: string, name: string) => apiGoogleMkdir(userId, parentFileId.includes('root') ? 'google_root' : parentFileId, name)
export const trashGoogleFiles = (userId: string, fileIds: string[]) => apiGoogleTrashBatch(userId, fileIds)
export const deleteGoogleFiles = (userId: string, fileIds: string[]) => apiGoogleDeleteBatch(userId, fileIds)
export const restoreGoogleTrashFiles = (userId: string, fileIds: string[]) => apiGoogleTrashRestoreBatch(userId, fileIds)
export const moveGoogleFiles = (userId: string, fileIds: string[], parentFileId: string) => apiGoogleMoveBatch(userId, fileIds, parentFileId.includes('root') ? 'google_root' : parentFileId)
export const copyGoogleFiles = (userId: string, fileIds: string[], parentFileId: string) => apiGoogleCopyBatch(userId, fileIds, parentFileId.includes('root') ? 'google_root' : parentFileId)
export const renameGoogleFiles = async (_userId: string, _fileIds: string[], _names: string[]): Promise<{ file_id: string; parent_file_id: string; name: string; isDir: boolean }[]> => []

export const listGoogleItems = async (userId: string, driveId: string, dirId: string, includeFiles: boolean, pageToken = '', strict = false) => {
  const search = parseGoogleSearchId(dirId)
  if (dirId.startsWith('search') || dirId.startsWith('google_search:')) {
    if (!search.query) return { items: [], total: 0, error: '搜索关键字不能为空' }
    const items = (await apiGoogleSearch(userId, search.query)).map(item => mapGoogleFileToAliModel(item, driveId, item.parents?.[0] || 'google_root'))
    const visible = includeFiles ? items : items.filter(item => item.isDir)
    return { items: visible, total: visible.length }
  }
  const parentId = dirId === 'google_root' ? 'google_root' : dirId
  const sharedDriveId = dirId.startsWith('google_shared_drive:') ? dirId.slice('google_shared_drive:'.length) : getGoogleSharedDriveIdForFile(dirId)
  const result = dirId === 'google_shared_drives'
    ? (await apiGoogleSharedDrives(userId)).map(drive => ({ id: `google_shared_drive:${drive.id}`, name: drive.name, mimeType: 'application/vnd.google-apps.folder' }))
    : dirId === 'trash' ? await apiGoogleTrashList(userId)
      : dirId === 'google_shared' ? await apiGoogleSharedWithMeList(userId)
        : sharedDriveId ? await apiGoogleSharedDriveFileList(userId, sharedDriveId, dirId.startsWith('google_shared_drive:') ? 'root' : dirId)
          : await apiGoogleFileListPage(userId, parentId, pageToken, 1000, strict)
  const list = Array.isArray(result) ? result : result.items
  const items = list.map(item => mapGoogleFileToAliModel(item, driveId, parentId))
  const visible = includeFiles ? items : items.filter(item => item.isDir)
  return { items: visible, total: visible.length, nextCursor: includeFiles && !Array.isArray(result) ? result.nextPageToken : '' }
}
