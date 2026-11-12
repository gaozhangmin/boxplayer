import type { IAliGetFileModel } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import { humanDateTimeDateStr, humanSize } from '../utils/format'
import { HanToPin } from '../utils/utils'
import message from '../utils/message'
import { getProviderTokenForUser } from '../drive/account'

export type DropboxMetadata = {
  '.tag': 'file' | 'folder' | 'deleted'
  name: string
  id?: string
  path_lower?: string
  path_display?: string
  rev?: string
  size?: number
  server_modified?: string
  client_modified?: string
  content_hash?: string
}

type DropboxListFolderResp = {
  entries?: DropboxMetadata[]
  cursor?: string
  has_more?: boolean
  error_summary?: string
}

type DropboxTemporaryLinkResp = {
  metadata?: DropboxMetadata
  link?: string
  error_summary?: string
}

const DROPBOX_API_HOST = 'https://api.dropboxapi.com/2'

export const getDropboxToken = async (user_id: string) => {
  return getProviderTokenForUser(user_id, 'dropbox')
}

export const dropboxRpc = async <T>(user_id: string, endpoint: string, body: any, fallback: string, strict = false): Promise<T | null> => {
  const token = await getDropboxToken(user_id)
  if (!token?.access_token) {
    message.error('未登录 Dropbox')
    if (strict) throw new Error('未登录 Dropbox')
    return null
  }
  const resp = await fetch(`${DROPBOX_API_HOST}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.error) {
    message.error(data?.error_summary || fallback)
    if (strict) throw new Error(data?.error_summary || fallback)
    return null
  }
  return data as T
}

export const resolveDropboxListPath = (parentId: string): string => {
  if (!parentId || parentId === 'dropbox_root') return ''
  return parentId
}

export const resolveDropboxParentIdFromPath = (pathValue: string | undefined): string => {
  if (!pathValue) return 'dropbox_root'
  const parentPath = pathValue.split('/').slice(0, -1).join('/')
  return parentPath || 'dropbox_root'
}

export const apiDropboxFileList = async (user_id: string, parentId: string, limit = 500, strict = false): Promise<DropboxMetadata[]> => {
  const items: DropboxMetadata[] = []
  let cursor = ''
  do {
    const page = await apiDropboxFileListPage(user_id, parentId, limit, cursor, strict)
    items.push(...page.items)
    cursor = page.hasMore ? page.cursor : ''
  } while (cursor)
  return items
}

export const apiDropboxFileListPage = async (user_id: string, parentId: string, limit = 500, cursor = '', strict = false): Promise<{ items: DropboxMetadata[]; cursor: string; hasMore: boolean }> => {
  const first = await dropboxRpc<DropboxListFolderResp>(user_id, cursor ? '/files/list_folder/continue' : '/files/list_folder', cursor ? { cursor } : {
    path: resolveDropboxListPath(parentId),
    recursive: false,
    include_media_info: false,
    include_deleted: false,
    include_has_explicit_shared_members: false,
    include_mounted_folders: true,
    limit
  }, '获取 Dropbox 文件列表失败', strict)
  if (!first) return { items: [], cursor: '', hasMore: false }
  return { items: (Array.isArray(first.entries) ? first.entries : []).filter((item) => item['.tag'] !== 'deleted'), cursor: first.cursor || '', hasMore: !!first.has_more }
}

export const apiDropboxTemporaryLink = async (user_id: string, fileId: string): Promise<{ url: string; metadata?: DropboxMetadata; error: string }> => {
  const data = await dropboxRpc<DropboxTemporaryLinkResp>(user_id, '/files/get_temporary_link', {
    path: fileId
  }, '获取 Dropbox 下载地址失败')
  return {
    url: data?.link || '',
    metadata: data?.metadata,
    error: data?.link ? '' : '获取 Dropbox 下载地址失败'
  }
}

export const apiDropboxFileDetail = async (user_id: string, fileId: string): Promise<DropboxMetadata | null> => {
  const data = await dropboxRpc<DropboxMetadata>(user_id, '/files/get_metadata', {
    path: fileId,
    include_media_info: true,
    include_deleted: false,
    include_has_explicit_shared_members: false
  }, '获取 Dropbox 文件详情失败')
  return data || null
}

const encodeDescription = (item: DropboxMetadata) => {
  const parts: string[] = []
  if (item.path_display || item.path_lower) parts.push(`dropbox_path:${encodeURIComponent(item.path_display || item.path_lower || '')}`)
  if (item.rev) parts.push(`dropbox_rev:${item.rev}`)
  if (item.content_hash) parts.push(`dropbox_hash:${item.content_hash}`)
  return parts.join(';')
}

export const mapDropboxFileToAliModel = (item: DropboxMetadata, drive_id: string, parentId: string): IAliGetFileModel => {
  const isDir = item['.tag'] === 'folder'
  const name = item.name || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const time = new Date(item.server_modified || item.client_modified || '').getTime() || 0
  const timeStr = time ? humanDateTimeDateStr(new Date(time).toISOString()) : ''
  const size = Number(item.size || 0)
  let category = ''
  let icon = 'iconfile-folder'
  if (!isDir) {
    const iconInfo = getFileIcon('', ext, ext, '', size)
    category = iconInfo[0]
    icon = iconInfo[1]
  }
  return {
    __v_skip: true,
    drive_id,
    file_id: item.id || item.path_display || item.path_lower || '',
    parent_file_id: parentId,
    path: item.path_display || item.path_lower || '',
    name,
    namesearch: HanToPin(name),
    ext,
    mime_type: '',
    mime_extension: ext,
    category,
    icon,
    file_count: 0,
    size,
    sizeStr: humanSize(size),
    time,
    timeStr,
    starred: false,
    isDir,
    thumbnail: '',
    description: encodeDescription(item),
    content_hash: item.content_hash || '',
    content_hash_name: item.content_hash ? 'dropbox-content-hash' : '',
    created_at: item.server_modified || item.client_modified || '',
    updated_at: item.server_modified || item.client_modified || '',
    type: isDir ? 'folder' : 'file'
  } as any
}
