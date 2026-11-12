import type { IAliGetFileModel } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import { humanDateTimeDateStr, humanSize } from '../utils/format'
import { HanToPin } from '../utils/utils'
import message from '../utils/message'

const BOX_API_HOST = 'https://api.box.com/2.0'
export const BOX_FIELDS = 'id,type,name,size,sha1,parent,path_collection,item_collection,created_at,modified_at,content_created_at,content_modified_at,extension,shared_link,representations,item_status'

export type BoxItem = {
  id: string
  type: 'file' | 'folder' | string
  name: string
  size?: number
  sha1?: string
  extension?: string
  parent?: { id?: string; type?: string; name?: string }
  path_collection?: { entries?: Array<{ id?: string; name?: string; type?: string }> }
  item_collection?: { total_count?: number }
  created_at?: string
  modified_at?: string
  content_created_at?: string
  content_modified_at?: string
  shared_link?: {
    url?: string
    download_url?: string
  } | null
  representations?: {
    entries?: Array<{
      content?: {
        url_template?: string
      }
    }>
  }
  item_status?: string
}

type BoxCollectionResp = {
  entries?: BoxItem[]
  total_count?: number
  limit?: number
  offset?: number
}

type BoxTokenReader = {
  getUserToken: (user_id: string) => any
  getUserTokenFromDB: (user_id: string) => Promise<any>
}

const isUsableBoxToken = (token: any) => {
  return token?.tokenfrom === 'box' && !!token.access_token
}
const isUsableBoxTokenForUser = (token: any, userId: string) => isUsableBoxToken(token) && token.user_id === userId

export const resolveBoxTokenForRequest = async (user_id: string, reader: BoxTokenReader) => {
  let token = reader.getUserToken(user_id)
  if (!isUsableBoxTokenForUser(token, user_id)) {
    const dbToken = await reader.getUserTokenFromDB(user_id)
    if (isUsableBoxTokenForUser(dbToken, user_id)) token = dbToken
  }
  return isUsableBoxTokenForUser(token, user_id) ? token : undefined
}

export const getBoxToken = async (user_id: string) => {
  const { default: UserDAL } = await import('../user/userdal')
  return resolveBoxTokenForRequest(user_id, {
    getUserToken: UserDAL.GetUserToken.bind(UserDAL),
    getUserTokenFromDB: UserDAL.GetUserTokenFromDB.bind(UserDAL)
  })
}

export const boxApiRequest = async <T>(user_id: string, pathOrUrl: string, init: RequestInit, fallback: string, silent = false, strict = false): Promise<T | null> => {
  const token = await getBoxToken(user_id)
  if (!token?.access_token) {
    if (!silent) message.error('未登录 Box')
    if (strict) throw new Error('未登录 Box')
    return null
  }
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${BOX_API_HOST}${pathOrUrl}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.access_token}`,
    ...(init.headers as Record<string, string> || {})
  }
  const resp = await fetch(url, { ...init, headers })
  const text = await resp.text().catch(() => '')
  let data: any = undefined
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }
  if (!resp.ok || data?.error) {
    if (!silent) message.error(data?.message || fallback)
    if (strict) throw new Error(data?.message || fallback)
    return null
  }
  return (data || {}) as T
}

export const toBoxId = (fileId: string) => {
  return !fileId || fileId === 'box_root' ? '0' : fileId
}

export const buildBoxChildrenPath = (parentId: string, limit = 500, offset = 0): string => {
  const params = new URLSearchParams({
    fields: BOX_FIELDS,
    limit: String(limit),
    offset: String(offset)
  })
  return `/folders/${encodeURIComponent(toBoxId(parentId))}/items?${params.toString()}`
}

export const buildBoxDetailPath = (fileId: string, isFolder: boolean): string => {
  const id = toBoxId(fileId)
  const params = new URLSearchParams({ fields: BOX_FIELDS })
  return `/${isFolder ? 'folders' : 'files'}/${encodeURIComponent(id)}?${params.toString()}`
}

export const apiBoxFileList = async (user_id: string, parentId: string, limit = 500, strict = false): Promise<BoxItem[]> => {
  let offset = 0
  const items: BoxItem[] = []
  while (true) {
    const page = await apiBoxFileListPage(user_id, parentId, limit, offset, strict)
    items.push(...page.items)
    if (!page.items.length || page.nextOffset === null) break
    offset = page.nextOffset
  }
  return items
}

export const apiBoxFileListPage = async (user_id: string, parentId: string, limit = 500, offset = 0, strict = false): Promise<{ items: BoxItem[]; nextOffset: number | null }> => {
  const data = await boxApiRequest<BoxCollectionResp>(user_id, buildBoxChildrenPath(parentId, limit, offset), { method: 'GET', headers: { 'x-rep-hints': '[jpg?dimensions=320x320]' } }, '获取 Box 文件列表失败', false, strict)
  const items = Array.isArray(data?.entries) ? data.entries : []
  const nextOffset = offset + Number(data?.limit || limit)
  return { items, nextOffset: !data || !items.length || nextOffset >= Number(data.total_count || 0) ? null : nextOffset }
}

export const apiBoxFileDetail = async (user_id: string, fileId: string, isFolder = false): Promise<BoxItem | null> => {
  return await boxApiRequest<BoxItem>(user_id, buildBoxDetailPath(fileId, isFolder || fileId === 'box_root'), {
    method: 'GET',
    headers: { 'x-rep-hints': '[jpg?dimensions=320x320]' }
  }, '获取 Box 文件详情失败')
}

const encodeDescription = (item: BoxItem) => {
  const parts: string[] = []
  if (item.parent?.id) parts.push(`box_parent:${item.parent.id}`)
  if (item.path_collection?.entries?.length) parts.push(`box_path:${encodeURIComponent(item.path_collection.entries.map((entry) => entry.name || '').filter(Boolean).join('/'))}`)
  if (item.shared_link?.download_url) parts.push(`box_download:${encodeURIComponent(item.shared_link.download_url)}`)
  if (item.shared_link?.url) parts.push(`box_shared:${encodeURIComponent(item.shared_link.url)}`)
  return parts.join(';')
}

const pickThumbnail = (item: BoxItem) => {
  const template = item.representations?.entries?.[0]?.content?.url_template || ''
  return template
}

export const mapBoxItemToAliModel = (item: BoxItem, drive_id: string, parentId: string): IAliGetFileModel => {
  const isDir = item.type === 'folder'
  const name = item.name || ''
  const ext = isDir ? '' : (item.extension || name.split('.').pop() || '')
  const time = new Date(item.modified_at || item.content_modified_at || item.created_at || '').getTime() || 0
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
    file_id: item.id || '',
    parent_file_id: parentId,
    name,
    namesearch: HanToPin(name),
    ext,
    mime_type: '',
    mime_extension: ext,
    category,
    icon,
    file_count: Number(item.item_collection?.total_count || 0),
    size,
    sizeStr: humanSize(size),
    time,
    timeStr,
    starred: false,
    isDir,
    thumbnail: pickThumbnail(item),
    description: encodeDescription(item),
    content_hash: item.sha1 || '',
    content_hash_name: item.sha1 ? 'sha1' : '',
    created_at: item.created_at || item.content_created_at || '',
    updated_at: item.modified_at || item.content_modified_at || item.created_at || '',
    type: isDir ? 'folder' : 'file'
  } as any
}

export const buildBoxDownloadUrl = (fileId: string, accessToken: string) => {
  const params = new URLSearchParams({ access_token: accessToken })
  return `${BOX_API_HOST}/files/${encodeURIComponent(fileId)}/content?${params.toString()}`
}
