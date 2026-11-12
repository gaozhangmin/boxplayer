import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
import type {GoogleDriveFile} from './googleMetadata'
const GOOGLE_FILE_FIELDS = 'nextPageToken,files(id,name,mimeType,size,parents,createdTime,modifiedTime,thumbnailLink,webContentLink,md5Checksum,resourceKey,trashed,shortcutDetails)'

const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'

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

export const buildGoogleSharedDriveFilesListPath = (driveId: string, parentId = 'root', pageToken = '') => {
  const params = new URLSearchParams({ q: `'${parentId.replace(/'/g, "\\'")}' in parents and trashed = false`, corpora: 'drive', driveId, pageSize: '1000', orderBy: 'folder,name_natural', fields: GOOGLE_FILE_FIELDS, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
  if (pageToken) params.set('pageToken', pageToken)
  return `/files?${params.toString()}`
}

export const buildGoogleSharedWithMeListPath = (pageToken = '', pageSize = 1000) => {
  const params = new URLSearchParams({ q: 'sharedWithMe = true and trashed = false', pageSize: String(Math.min(1000, Math.max(1, pageSize))), orderBy: 'sharedWithMeTime desc', fields: GOOGLE_FILE_FIELDS, spaces: 'drive', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })
  if (pageToken) params.set('pageToken', pageToken)
  return `/files?${params.toString()}`
}
