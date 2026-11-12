import type { IAliGetFileModel } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import { humanDateTimeDateStr, humanSize } from '../utils/format'
import { HanToPin } from '../utils/utils'
import message from '../utils/message'

const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3'
const GOOGLE_FILE_FIELDS = 'nextPageToken,files(id,name,mimeType,size,parents,createdTime,modifiedTime,thumbnailLink,webContentLink,md5Checksum,resourceKey,trashed,shortcutDetails)'
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'
const sharedDriveByFileId = new Map<string, string>()

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

type GoogleListResponse = { files?: GoogleDriveFile[]; nextPageToken?: string }
type GoogleDrivesResponse = { drives?: Array<{ id: string; name: string }>; nextPageToken?: string }

type GoogleTokenReader = {
  getUserToken: (userId: string) => any
  getUserTokenFromDB: (userId: string) => Promise<any>
}

const isGoogleToken = (token: any) => token?.tokenfrom === 'google' && !!token.access_token
const isGoogleTokenForUser = (token: any, userId: string) => isGoogleToken(token) && token.user_id === userId

export const resolveGoogleTokenForRequest = async (userId: string, reader: GoogleTokenReader) => {
  let token = reader.getUserToken(userId)
  if (!isGoogleTokenForUser(token, userId)) token = await reader.getUserTokenFromDB(userId)
  return isGoogleTokenForUser(token, userId) ? token : undefined
}

export const getGoogleToken = async (userId: string) => {
  const { default: UserDAL } = await import('../user/userdal')
  const readyToken = await UserDAL.EnsureUserTokenReady(userId)
  if (isGoogleToken(readyToken)) return readyToken
  const token = await resolveGoogleTokenForRequest(userId, {
    getUserToken: UserDAL.GetUserToken.bind(UserDAL),
    getUserTokenFromDB: UserDAL.GetUserTokenFromDB.bind(UserDAL)
  })
  return token?.user_id ? await UserDAL.EnsureUserTokenReady(token.user_id) : token
}

export const googleDriveRequest = async <T>(userId: string, path: string, init: RequestInit, fallback: string, silent = false, strict = false): Promise<T | null> => {
  const token = await getGoogleToken(userId)
  if (!token?.access_token) {
    if (!silent) message.error('未登录 Google Drive')
    if (strict) throw new Error('未登录 Google Drive')
    return null
  }
  const response = await fetch(path.startsWith('https://') ? path : `${GOOGLE_DRIVE_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token.access_token}`, ...(init.headers as Record<string, string> || {}) } })
  const data = await response.json().catch(() => undefined)
  if (!response.ok || data?.error) {
    const errorText = data?.error?.message || fallback
    if (!silent) message.error(errorText)
    if (strict) throw new Error(errorText)
    return null
  }
  return data as T
}

export const toGoogleFolderId = (fileId: string) => !fileId || fileId === 'google_root' ? 'root' : fileId

export const buildGoogleFilesListPath = (parentId: string, pageToken = '', pageSize = 1000) => {
  const params = new URLSearchParams({
    q: `'${toGoogleFolderId(parentId).replace(/'/g, "\\'")}' in parents and trashed = false`,
    pageSize: String(Math.min(1000, Math.max(1, pageSize))),
    pageToken,
    orderBy: 'folder,name_natural',
    fields: GOOGLE_FILE_FIELDS,
    spaces: 'drive',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  })
  if (!pageToken) params.delete('pageToken')
  return `/files?${params.toString()}`
}

export const buildGoogleSharedWithMeListPath = (pageToken = '', pageSize = 1000) => {
  const params = new URLSearchParams({ q: 'sharedWithMe = true and trashed = false', pageSize: String(Math.min(1000, Math.max(1, pageSize))), orderBy: 'sharedWithMeTime desc', fields: GOOGLE_FILE_FIELDS, spaces: 'drive', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
  if (pageToken) params.set('pageToken', pageToken)
  return `/files?${params.toString()}`
}

export const apiGoogleFileListPage = async (userId: string, parentId: string, pageToken = '', pageSize = 1000, strict = false) => {
  const data = await googleDriveRequest<GoogleListResponse>(userId, buildGoogleFilesListPath(parentId, pageToken, pageSize), { method: 'GET' }, '获取 Google Drive 文件列表失败', false, strict)
  return { items: data?.files || [], nextPageToken: data?.nextPageToken || '' }
}

export const apiGoogleFileList = async (userId: string, parentId: string, pageSize = 1000) => {
  const items: GoogleDriveFile[] = []
  let pageToken = ''
  do {
    const page = await apiGoogleFileListPage(userId, parentId, pageToken, pageSize)
    items.push(...page.items)
    pageToken = page.nextPageToken
  } while (pageToken)
  return items
}

export const apiGoogleSharedWithMeList = async (userId: string, pageSize = 1000) => {
  const items: GoogleDriveFile[] = []
  let pageToken = ''
  do {
    const data = await googleDriveRequest<GoogleListResponse>(userId, buildGoogleSharedWithMeListPath(pageToken, pageSize), { method: 'GET' }, '获取 Google Drive 共享文件失败')
    items.push(...(data?.files || []))
    pageToken = data?.nextPageToken || ''
  } while (pageToken)
  return items
}

export const apiGoogleSharedDrives = async (userId: string) => {
  const drives: Array<{ id: string; name: string }> = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ pageSize: '100', fields: 'nextPageToken,drives(id,name)' })
    if (pageToken) params.set('pageToken', pageToken)
    const data = await googleDriveRequest<GoogleDrivesResponse>(userId, `/drives?${params.toString()}`, { method: 'GET' }, '获取 Google 共享云端硬盘失败')
    drives.push(...(data?.drives || []))
    pageToken = data?.nextPageToken || ''
  } while (pageToken)
  return drives
}

export const buildGoogleSharedDriveFilesListPath = (driveId: string, parentId = 'root', pageToken = '') => {
  const params = new URLSearchParams({ q: `'${parentId.replace(/'/g, "\\'")}' in parents and trashed = false`, corpora: 'drive', driveId, pageSize: '1000', orderBy: 'folder,name_natural', fields: GOOGLE_FILE_FIELDS, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
  if (pageToken) params.set('pageToken', pageToken)
  return `/files?${params.toString()}`
}

export const apiGoogleSharedDriveFileList = async (userId: string, driveId: string, parentId = 'root') => {
  const items: GoogleDriveFile[] = []
  let pageToken = ''
  do {
    const data = await googleDriveRequest<GoogleListResponse>(userId, buildGoogleSharedDriveFilesListPath(driveId, parentId, pageToken), { method: 'GET' }, '获取 Google 共享云端硬盘文件失败')
    items.push(...(data?.files || []))
    pageToken = data?.nextPageToken || ''
  } while (pageToken)
  for (const item of items) sharedDriveByFileId.set(item.id, driveId)
  return items
}

export const getGoogleSharedDriveIdForFile = (fileId: string) => sharedDriveByFileId.get(fileId) || ''

export const buildGoogleTrashListPath = (pageToken = '') => {
  const params = new URLSearchParams({ q: 'trashed = true', pageSize: '1000', orderBy: 'modifiedTime desc', fields: GOOGLE_FILE_FIELDS, spaces: 'drive', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
  if (pageToken) params.set('pageToken', pageToken)
  return `/files?${params.toString()}`
}

export const apiGoogleTrashList = async (userId: string) => {
  const items: GoogleDriveFile[] = []
  let pageToken = ''
  do {
    const data = await googleDriveRequest<GoogleListResponse>(userId, buildGoogleTrashListPath(pageToken), { method: 'GET' }, '获取 Google Drive 回收站失败')
    items.push(...(data?.files || []))
    pageToken = data?.nextPageToken || ''
  } while (pageToken)
  return items
}

export const buildGoogleFileDetailPath = (fileId: string) => `/files/${encodeURIComponent(fileId)}?${new URLSearchParams({ fields: GOOGLE_FILE_FIELDS.replace('nextPageToken,files(', '').replace(/\)$/, ''), supportsAllDrives: 'true' }).toString()}`

export const apiGoogleFileDetail = async (userId: string, fileId: string) => await googleDriveRequest<GoogleDriveFile>(userId, buildGoogleFileDetailPath(fileId), { method: 'GET' }, '获取 Google Drive 文件详情失败')

export const mapGoogleFileToAliModel = (item: GoogleDriveFile, driveId: string, parentId: string): IAliGetFileModel => {
  const fileId = item.shortcutDetails?.targetId || item.id
  const mimeType = item.shortcutDetails?.targetMimeType || item.mimeType || ''
  const isDir = mimeType === GOOGLE_FOLDER_MIME
  const name = item.name || ''
  const ext = isDir ? '' : name.split('.').pop() || ''
  const size = Number(item.size || 0)
  const time = new Date(item.modifiedTime || item.createdTime || '').getTime() || 0
  const iconInfo = isDir ? ['', 'iconfile-folder'] : getFileIcon('', ext, ext, '', size)
  return {
    __v_skip: true, drive_id: driveId, file_id: fileId, parent_file_id: parentId, name, namesearch: HanToPin(name), ext, mime_type: mimeType, mime_extension: ext, category: isDir ? '' : iconInfo[0], icon: iconInfo[1], file_count: 0, size, sizeStr: humanSize(size), time, timeStr: time ? humanDateTimeDateStr(new Date(time).toISOString()) : '', starred: false, isDir, thumbnail: item.thumbnailLink || '', description: item.webContentLink ? `google_download:${encodeURIComponent(item.webContentLink)}` : '', content_hash: item.md5Checksum || '', created_at: item.createdTime || '', updated_at: item.modifiedTime || item.createdTime || '', type: isDir ? 'folder' : 'file'
  } as any
}

export const buildGoogleDownloadUrl = (fileId: string, resourceKey = '') => {
  const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' })
  if (resourceKey) params.set('resourceKey', resourceKey)
  return `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`
}

const googleExportMimeTypes: Record<string, string> = {
  'application/vnd.google-apps.document': 'application/pdf',
  'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.google-apps.drawing': 'image/png'
}

export const buildGoogleExportUrl = (fileId: string, sourceMimeType: string) => {
  const mimeType = googleExportMimeTypes[sourceMimeType]
  return mimeType ? `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(fileId)}/export?${new URLSearchParams({ mimeType }).toString()}` : ''
}

export const buildGoogleSearchPath = (query: string, pageToken = '') => {
  const params = new URLSearchParams({ q: `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`, pageSize: '1000', orderBy: 'modifiedTime desc', fields: GOOGLE_FILE_FIELDS, spaces: 'drive', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
  if (pageToken) params.set('pageToken', pageToken)
  return `/files?${params.toString()}`
}

export const apiGoogleSearch = async (userId: string, query: string) => {
  const items: GoogleDriveFile[] = []
  let pageToken = ''
  do {
    const data = await googleDriveRequest<GoogleListResponse>(userId, buildGoogleSearchPath(query, pageToken), { method: 'GET' }, '搜索 Google Drive 文件失败')
    items.push(...(data?.files || []))
    pageToken = data?.nextPageToken || ''
  } while (pageToken)
  return items
}

export const parseGoogleSearchId = (dirId: string) => ({ query: dirId.startsWith('google_search:') ? decodeURIComponent(dirId.slice('google_search:'.length)) : dirId.replace(/^search/, '').trim() })

export const googleDriveFolderMimeType = GOOGLE_FOLDER_MIME
