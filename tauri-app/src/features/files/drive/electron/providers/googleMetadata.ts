import {googleDriveRequest} from '../../providerTransport'
const GOOGLE_FILE_FIELDS = 'nextPageToken,files(id,name,mimeType,size,parents,createdTime,modifiedTime,thumbnailLink,webContentLink,md5Checksum,resourceKey,trashed,shortcutDetails)'

export type GoogleDriveFile = {
  id: string
  name: string
  mimeType?: string
  size?: string
  parents?: string[]
  createdTime?: string
  modifiedTime?: string
  thumbnailLink?: string
  webContentLink?: string
  md5Checksum?: string
  resourceKey?: string
  trashed?: boolean
  shortcutDetails?: { targetId?: string; targetMimeType?: string }
}

export const buildGoogleFileDetailPath = (fileId: string) => `/files/${encodeURIComponent(fileId)}?${new URLSearchParams({ fields: GOOGLE_FILE_FIELDS.replace('nextPageToken,files(', '').replace(/\)$/, ''), supportsAllDrives: 'true' }).toString()}`

export const apiGoogleFileDetail = async (userId: string, fileId: string) => await googleDriveRequest<GoogleDriveFile>(userId, buildGoogleFileDetailPath(fileId), { method: 'GET' }, '获取 Google Drive 文件详情失败')

export const buildGoogleTrashListPath = (pageToken = '') => {
  const params = new URLSearchParams({ q: 'trashed = true', pageSize: '1000', orderBy: 'modifiedTime desc', fields: GOOGLE_FILE_FIELDS, spaces: 'drive', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
  if (pageToken) params.set('pageToken', pageToken)
  return `/files?${params.toString()}`
}
