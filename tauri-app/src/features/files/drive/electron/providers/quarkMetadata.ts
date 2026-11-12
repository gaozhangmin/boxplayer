import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
import {quarkRequest} from '../../quarkFileTransport'
export type QuarkFileItem = {
  fid: string
  record_id?: string
  pdir_fid?: string
  file_name: string
  category?: number
  file_type?: number
  dir?: boolean
  format_type?: string
  size?: number | string
  updated_at?: number | string
  created_at?: number | string
  thumbnail?: string
  preview_url?: string
  obj_category?: string
}

export const quarkParams = (params: Record<string, string | number | undefined> = {}) => {
  const qs = new URLSearchParams({
    pr: 'ucpro',
    fr: 'pc',
    uc_param_str: '',
    __t: String(Date.now()),
    __dt: '1000'
  })
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value))
  }
  return qs
}

const isQuarkError = (data: any): data is { __error: true; code: number; message: string } => !!data?.__error

const getListFromResponse = (data: any): QuarkFileItem[] => {
  const list = data?.data?.list || data?.data || []
  return Array.isArray(list) ? list : []
}

const getQuarkTime = (value: number | string | undefined): number => {
  if (!value) return 0
  if (typeof value === 'number') return value > 100000000000 ? value : value * 1000
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const apiQuarkFileList = async (
  user_id: string,
  parentId = '0',
  size = 100,
  page = 1,
  strict = false
): Promise<{ items: QuarkFileItem[]; total: number }> => {
  const data = await quarkRequest(user_id, 'file/sort', {}, {
    pdir_fid: parentId === 'quark_root' ? '0' : parentId,
    _page: page,
    _size: size,
    _fetch_total: 1,
    fetch_all_file: 1,
    fetch_risk_file_name: 1,
    _sort: 'file_name:asc'
  })
  if (!data || isQuarkError(data)) {
    if (strict) throw new Error(data?.message || '夸克网盘请求失败')
    return { items: [], total: 0 }
  }
  return {
    items: getListFromResponse(data),
    total: Number((data as any)?.metadata?._total || (data as any)?.data?.metadata?._total || getListFromResponse(data).length)
  }
}

export const apiQuarkTrashList = async (
  user_id: string,
  size = 100,
  page = 1,
  strict = false
): Promise<{ items: QuarkFileItem[]; total: number }> => {
  const data = await quarkRequest(user_id, 'file/recycle/list', {}, {
    _page: page,
    _size: size,
    _fetch_total: 1
  })
  if (!data || isQuarkError(data)) {
    if (strict) throw new Error(data?.message || '获取夸克回收站失败')
    return { items: [], total: 0 }
  }
  const items = getListFromResponse(data)
  return {
    items,
    total: Number((data as any)?.metadata?._total || (data as any)?.data?.metadata?._total || items.length)
  }
}

export const apiQuarkSearch = async (user_id: string, keyword: string, size = 200, silent = false): Promise<QuarkFileItem[]> => {
  if (!keyword) return []
  const data = await quarkRequest(user_id, 'file/search', {}, {
    q: keyword,
    _page: 1,
    _size: size,
    _fetch_total: 1,
    _sort: 'file_type:desc,updated_at:desc',
    _is_hl: 1
  }, silent)
  return data && !isQuarkError(data) ? getListFromResponse(data) : []
}

export const apiQuarkFileDetail = async (user_id: string, fileId: string): Promise<QuarkFileItem | null> => {
  if (fileId === 'quark_root' || fileId === '0') {
    return { fid: '0', pdir_fid: '', file_name: '根目录', file_type: 0 }
  }
  const data = await quarkRequest(user_id, 'file', {}, { fids: fileId })
  if (!data || isQuarkError(data)) return null
  const item = getListFromResponse(data).find((entry) => String(entry.fid) === String(fileId))
  return item || getListFromResponse(data)[0] || null
}

export const mapQuarkFileToAliModel = (item: QuarkFileItem, drive_id: string, parentId: string): IAliGetFileModel => {
  const isDir = item.dir === true || Number(item.file_type || 0) === 0
  const name = item.file_name || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const size = Number(item.size || 0)
  const time = getQuarkTime(item.updated_at || item.created_at)
  const timeStr = time ? humanDateTimeDateStr(new Date(time).toISOString()) : ''
  let category = ''
  let icon = 'iconfile-folder'
  if (!isDir) {
    const iconInfo = getFileIcon('', ext, ext, item.format_type || item.obj_category || '', size)
    category = iconInfo[0]
    icon = iconInfo[1]
  }
  return {
    __v_skip: true,
    drive_id,
    file_id: String(item.fid || ''),
    parent_file_id: item.pdir_fid != null && String(item.pdir_fid) !== ''
      ? (String(item.pdir_fid) === '0' ? 'quark_root' : String(item.pdir_fid)) : parentId,
    name,
    namesearch: HanToPin(name),
    ext,
    mime_type: item.format_type || '',
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
    thumbnail: item.thumbnail || item.preview_url || '',
    description: `quark_fid:${item.fid || ''};quark_pdir:${item.pdir_fid || parentId}${item.record_id ? `;quark_record:${item.record_id}` : ''}`
  }
}
