import {pikpakListFetch} from '../../pikpakListTransport'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {pikpakFileCheck,pikpakFileDetailFetch} from '../../pikpakFileTransport'
const API_URL = 'https://api-drive.mypikpak.com/drive/v1/files'

export type PikPakFileItem = {
  id: string
  parent_id?: string
  kind?: string
  name: string
  size?: string | number
  modified_time?: string
  created_time?: string
  thumbnail_link?: string
  web_content_link?: string
  medias?: Array<{ link?: { url?: string }; media_name?: string }>
}

export const apiPikPakFileDetail = async (user_id: string, fileId: string): Promise<PikPakFileItem | null> => {
  pikpakFileCheck(user_id)
  const resp = await pikpakFileDetailFetch(user_id, fileId)
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.error) return null
  return data as PikPakFileItem
}

type PikPakFileListResp = {
  files?: PikPakFileItem[]
  next_page_token?: string
}

const isPikPakDir = (item: PikPakFileItem) => (item.kind || '').includes('folder')

const getPikPakStreamUrl = (item: PikPakFileItem) => {
  return item.medias?.find(media => media?.link?.url)?.link?.url || ''
}

const getPikPakWebContentUrl = (item: PikPakFileItem) => item.web_content_link || ''

const encodeDescription = (item: PikPakFileItem) => {
  const downloadUrl = getPikPakStreamUrl(item) || getPikPakWebContentUrl(item)
  return downloadUrl ? `pikpak_download:${encodeURIComponent(downloadUrl)}` : ''
}

const parsePikPakError = (data: any, fallback: string) => {
  return data?.error_description || data?.message || data?.error || fallback
}

export const apiPikPakFileList = async (
  user_id: string,
  parentId: string,
  limit = 100,
  pageToken = '',
  trashed = false,
  strict = false
): Promise<{ items: PikPakFileItem[]; nextPageToken: string }> => {
  pikpakFileCheck(user_id)
  const params = new URLSearchParams()
  params.set('thumbnail_size', 'SIZE_MEDIUM')
  params.set('limit', String(limit))
  params.set('with_audit', 'true')
  params.set('filters', JSON.stringify({
    trashed: { eq: trashed },
    phase: { eq: 'PHASE_TYPE_COMPLETE' }
  }))
  if (!trashed && parentId && parentId !== 'pikpak_root') params.set('parent_id', parentId)
  if (pageToken) params.set('page_token', pageToken)
  const resp = await pikpakListFetch(user_id, `${API_URL}?${params.toString()}`)
  const data = await resp.json().catch(() => undefined) as PikPakFileListResp | any
  if (!resp.ok || data?.error) {
    // Strict native caller reports errors after checking its lifecycle.
    if (strict) throw new Error(parsePikPakError(data, '获取 PikPak 文件列表失败'))
    return { items: [], nextPageToken: '' }
  }
  return {
    items: Array.isArray(data?.files) ? data.files : [],
    nextPageToken: data?.next_page_token || ''
  }
}

export const mapPikPakFileToAliModel = (item: PikPakFileItem, drive_id: string, parentId: string): IAliGetFileModel => {
  const isDir = isPikPakDir(item)
  const name = item.name || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const time = new Date(item.modified_time || item.created_time || '').getTime() || 0
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
    file_id: String(item.id || ''),
    parent_file_id: item.parent_id || parentId,
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
    thumbnail: item.thumbnail_link || '',
    description: encodeDescription(item)
  }
}
