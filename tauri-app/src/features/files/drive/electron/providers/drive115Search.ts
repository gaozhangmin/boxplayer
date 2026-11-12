import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {drive115Check} from '../../drive115FileTransport'
import {drive115SearchRequest} from '../../drive115SearchTransport'
const SEARCH_URL = 'https://proapi.115.com/open/ufile/search'

export type Drive115SearchItem = {
  file_id: string
  parent_id: string
  file_name: string
  file_size?: string | number
  user_utime?: string | number
  file_category?: string
  ico?: string
  thumb?: string
  thumbnail?: string
  thumbnail_url?: string
  thumb_url?: string
}

export type Drive115SearchResp = {
  state: boolean
  code: number
  message: string
  count?: number
  data?: Drive115SearchItem[]
}

const toTime = (val?: number | string) => {
  if (val === undefined || val === null) return 0
  const n = Number(val)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n < 1000000000000 ? n * 1000 : n
}

const pickDrive115Thumbnail = (item: { thumb?: string; thumbnail?: string; thumbnail_url?: string; thumb_url?: string; ico?: string }) => {
  const thumbnail = [item.thumbnail, item.thumbnail_url, item.thumb, item.thumb_url, item.ico]
    .find((value) => typeof value === 'string' && /^(https?:|data:image\/)/i.test(value))
  return thumbnail || ''
}

export const apiDrive115Search = async (
  user_id: string,
  searchValue: string,
  limit = 200,
  offset = 0
): Promise<{ items: Drive115SearchItem[]; total: number }> => {
  drive115Check(user_id)
  const params = new URLSearchParams()
  params.set('search_value', searchValue)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  const url = `${SEARCH_URL}?${params.toString()}`
  const resp = await drive115SearchRequest(user_id, url)
  if (!resp.ok) {
    throw new Error('获取 115 网盘搜索结果失败')
  }
  const data = (await resp.json()) as Drive115SearchResp
  if (data?.code !== 0 || !Array.isArray(data.data)) throw new Error('115 网盘搜索结果无效')
  return { items: data.data, total: Number(data.count || data.data.length) }
}

export const mapDrive115SearchToAliModel = (item: Drive115SearchItem, drive_id: string): IAliGetFileModel => {
  const isDir = String(item.file_category) !== '1'
  const name = item.file_name || ''
  const ext = isDir ? '' : (item.ico || name.split('.').pop() || '')
  const time = toTime(item.user_utime)
  const timeStr = time ? humanDateTimeDateStr(new Date(time).toISOString()) : ''
  const size = Number(item.file_size || 0)
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
    file_id: String(item.file_id),
    parent_file_id: String(item.parent_id),
    name: name,
    namesearch: HanToPin(name),
    ext: ext,
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
    thumbnail: pickDrive115Thumbnail(item),
    description: ''
  }
}

export const mapDrive115DetailToAliModel = (detail: {
  file_id: string
  name: string
  size: number
  isDir: boolean
  updated_at: string
  created_at: string
  play_long?: number
}, drive_id: string): IAliGetFileModel => {
  const isDir = detail.isDir
  const name = detail.name || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const timeStr = humanDateTimeDateStr(detail.updated_at || detail.created_at || '')
  const time = new Date(detail.updated_at || detail.created_at || '').getTime()
  const size = Number(detail.size || 0)
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
    file_id: String(detail.file_id),
    parent_file_id: '',
    name: name,
    namesearch: HanToPin(name),
    ext: ext,
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
    description: ''
  }
}
