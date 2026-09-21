import type { IAliGetFileModel } from '../aliapi/alimodels'
import type { IVideoPreviewUrl } from '../aliapi/models'
import getFileIcon from '../aliapi/fileicon'
import { humanDateTimeDateStr, humanSize } from '../utils/format'
import { HanToPin } from '../utils/utils'
import message from '../utils/message'
import { getProviderTokenForUser } from '../drive/account'
import { quarkAuthHeaders, quarkDownloadHeaders, syncQuarkCookiesToElectron } from './auth'

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

const BASE = 'https://drive-pc.quark.cn/1/clouddrive'

const quarkDownloadRequestHeaders = (cookie: string, url: string): Record<string, string> => {
  const headers = quarkDownloadHeaders(cookie) as Record<string, string>
  try {
    const path = new URL(url).pathname
    if (path) headers['x-urlp'] = path
  } catch {}
  return headers
}

const quarkParams = (params: Record<string, string | number | undefined> = {}) => {
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

export const getQuarkToken = (user_id: string) => getProviderTokenForUser(user_id, 'quark')

export const quarkRequest = async <T = any>(
  user_id: string,
  path: string,
  init: RequestInit = {},
  params: Record<string, string | number | undefined> = {},
  silent = false
): Promise<T | { __error: true; code: number; message: string } | null> => {
  const token = await getQuarkToken(user_id)
  if (!token?.access_token) {
    message.error('未登录夸克网盘')
    return null
  }
  await syncQuarkCookiesToElectron(token.access_token)
  const resp = await fetch(`${BASE}/${path.replace(/^\//, '')}?${quarkParams(params).toString()}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...quarkAuthHeaders(token.access_token),
      ...(init.headers || {})
    }
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.status === 'error' || (data?.code && data.code !== 0)) {
    const missingLoginCookie = data?.code === 31001 || /require login/i.test(data?.message || '')
    if (!silent) message.error(missingLoginCookie ? '夸克网盘登录 Cookie 无效或未写入，请重新登录夸克' : (data?.message || '夸克网盘请求失败'))
    return { __error: true, code: Number(data?.code || data?.status || resp.status || 0), message: data?.message || '夸克网盘请求失败' }
  }
  return data as T
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
  const token = await getQuarkToken(user_id)
  if (token?.access_token && typeof window !== 'undefined' && (window as any).WebQuarkFileList) {
    const result = await (window as any).WebQuarkFileList({ cookie: token.access_token, parentId: parentId === 'quark_root' ? '0' : parentId, size, page })
    const data = result?.body ? JSON.parse(result.body) : undefined
    if (result?.ok && data && !isQuarkError(data) && !(data?.code && data.code !== 0)) {
      const items = getListFromResponse(data)
      return { items, total: Number(data?.metadata?._total || data?.data?.metadata?._total || items.length) }
    }
    if (data?.code === 31001 || /require login/i.test(data?.message || '')) message.error('夸克网盘登录 Cookie 无效或未写入，请重新登录夸克')
    if (strict) throw new Error(data?.message || '夸克网盘请求失败')
    return { items: [], total: 0 }
  }
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

/**
 * The recycle bin is not a normal directory. Passing `trash` to file/sort
 * silently returns an empty list, even while deleted files exist. Quark keeps
 * the recycle records behind this separate, paginated endpoint.
 */
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

export const apiQuarkDownloadUrl = async (user_id: string, fileId: string): Promise<{ url: string; size: number; name: string; error: string; headers?: Record<string, string> }> => {
  const token = await getQuarkToken(user_id)
  if (!token?.access_token) {
    message.error('未登录夸克网盘')
    return { url: '', size: 0, name: '', error: '未登录夸克网盘' }
  }
  if (typeof window !== 'undefined' && (window as any).WebQuarkDownloadUrl) {
    const result = await (window as any).WebQuarkDownloadUrl({ fileId, cookie: token.access_token })
    const data = result?.body ? JSON.parse(result.body) : undefined
    if (!result?.ok || data?.status === 'error' || (data?.code && data.code !== 0)) {
      const error = data?.message || result?.error || '获取夸克下载地址失败'
      message.error(error)
      return { url: '', size: 0, name: '', error }
    }
    const info = Array.isArray(data?.data) ? data.data[0] : null
    const url = info?.download_url || ''
    const playbackCookie = String(result?.cookie || token.access_token)
    return {
      url,
      size: Number(info?.size || 0),
      name: info?.file_name || '',
      error: url ? '' : '获取夸克下载地址失败',
      headers: url ? quarkDownloadRequestHeaders(playbackCookie, url) : undefined
    }
  }
  const params = new URLSearchParams({
    pr: 'ucpro',
    fr: 'pc',
    sys: 'win32',
    ve: '2.5.56',
    ut: '',
    guid: ''
  })
  const resp = await fetch(`${BASE}/file/download?${params.toString()}`, {
    method: 'POST',
    credentials: 'include',
    headers: quarkDownloadHeaders(token.access_token),
    body: JSON.stringify({ fids: [fileId] })
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.status === 'error' || (data?.code && data.code !== 0)) {
    const error = data?.message || '获取夸克下载地址失败'
    message.error(error)
    return {
      url: '',
      size: 0,
      name: '',
      error
    }
  }
  const info = Array.isArray((data as any)?.data) ? (data as any).data[0] : null
  const url = info?.download_url || ''
  return {
    url,
    size: Number(info?.size || 0),
    name: info?.file_name || '',
    error: url ? '' : '获取夸克下载地址失败',
    headers: url ? quarkDownloadRequestHeaders(token.access_token, url) : undefined
  }
}

export const apiQuarkVideoPreviewUrl = async (user_id: string, fileId: string): Promise<IVideoPreviewUrl | string> => {
  // Quark's browser-cookie playback endpoint currently returns 14018/plf_invalid.
  // Use the authenticated original stream directly so playback never sends the
  // known-failing play/project request or exposes a false transcode error.
  const download = await apiQuarkDownloadUrl(user_id, fileId)
  if (download.error || !download.url) return download.error || '获取夸克播放地址失败'
  const type = /m3u8|hls/i.test(download.url) ? 'm3u8' : ''
  return {
    drive_id: 'quark',
    file_id: fileId,
    size: download.size,
    duration: 0,
    expire_time: 0,
    width: 0,
    height: 0,
    qualities: [{
      html: '原画',
      quality: 'Origin',
      height: 0,
      width: 0,
      label: '原画',
      value: 'Origin',
      url: download.url,
      type,
      headers: download.headers
    }],
    subtitles: []
  }
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
    parent_file_id: item.pdir_fid && item.pdir_fid !== '0' ? String(item.pdir_fid) : parentId,
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
