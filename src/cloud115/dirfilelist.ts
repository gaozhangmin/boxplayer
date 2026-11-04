import { humanDateTimeDateStr, humanSize } from '../utils/format'
import { HanToPin } from '../utils/utils'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import { getDrive115Token } from './auth'
import message from '../utils/message'
import DebugLog from '../utils/debuglog'

export type Drive115FileItem = {
  fid: string | number
  pid: string | number
  fc: string | number
  fn: string
  fs?: number
  upt?: number
  uet?: number
  uppt?: number
  ico?: string
  thumb?: string
  thumbnail?: string
  thumbnail_url?: string
  thumb_url?: string
}

export type Drive115FileListResp = {
  state: boolean
  code: number
  message: string
  data?: Drive115FileItem[]
}

const API_URL = 'https://proapi.115.com/open/ufile/files'
const SEARCH_URL = 'https://proapi.115.com/open/ufile/search'
const LIST_REQUEST_GAP_MS = 900
const ERROR_TOAST_GAP_MS = 60 * 1000
const RATE_LIMIT_COOLDOWN_MS = 2 * 60 * 1000

type Drive115RequestOptions = {
  silent?: boolean
  strict?: boolean
}

let listQueue: Promise<unknown> = Promise.resolve()
let lastListRequestAt = 0
let rateLimitedUntil = 0
const lastErrorNoticeAt = new Map<string, number>()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isRateLimitMessage = (text: string) => /访问上限|频繁|稍后再试|rate/i.test(text)

const enqueueListRequest = async <T>(runner: () => Promise<T>): Promise<T> => {
  const run = async () => {
    const wait = Math.max(0, LIST_REQUEST_GAP_MS - (Date.now() - lastListRequestAt))
    if (wait > 0) await sleep(wait)
    lastListRequestAt = Date.now()
    return runner()
  }
  const next = listQueue.then(run, run)
  listQueue = next.catch(() => undefined)
  return next
}

const reportDrive115ListError = (text: string, options: Drive115RequestOptions = {}) => {
  const msg = text || '获取 115 网盘文件列表失败'
  const now = Date.now()
  const noticeKey = `${options.silent ? 'silent' : 'toast'}:${msg}`
  const last = lastErrorNoticeAt.get(noticeKey) || 0
  if (now - last < ERROR_TOAST_GAP_MS) {
    DebugLog.mSaveWarning(`[drive115] suppressed repeated list error: ${msg}`)
    return
  }
  lastErrorNoticeAt.set(noticeKey, now)
  if (options.silent) {
    DebugLog.mSaveWarning(`[drive115] list error: ${msg}`)
  } else {
    message.error(msg)
  }
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

export const apiDrive115FileList = async (
  user_id: string,
  cid: string | number,
  limit = 200,
  offset = 0,
  showDir = true,
  options: Drive115RequestOptions = {}
): Promise<Drive115FileItem[]> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) {
    reportDrive115ListError('未登录 115 网盘', options)
    if (options.strict) throw new Error('未登录 115 网盘')
    return []
  }
  if (rateLimitedUntil > Date.now()) {
    reportDrive115ListError('已达到当前访问上限，请稍后再试', options)
    if (options.strict) throw new Error('已达到当前访问上限，请稍后再试')
    return []
  }
  const params = new URLSearchParams()
  params.set('cid', String(cid))
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  params.set('cur', '1')
  params.set('show_dir', showDir ? '1' : '0')
  const url = `${API_URL}?${params.toString()}`
  // Keep response parsing inside the queue: a rate-limit result must become
  // visible before the next queued request is allowed to start.
  return enqueueListRequest(async () => {
    if (rateLimitedUntil > Date.now()) {
      const msg = '已达到当前访问上限，请稍后再试'
      reportDrive115ListError(msg, options)
      if (options.strict) throw new Error(msg)
      return []
    }
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(30_000)
    })
    if (!resp.ok) {
      if (resp.status === 429) {
        const retryAfter = resp.headers.get('Retry-After') || ''
        const seconds = Number(retryAfter)
        const retryMs = retryAfter && Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryAfter) - Date.now()
        rateLimitedUntil = Date.now() + Math.max(RATE_LIMIT_COOLDOWN_MS, Number.isFinite(retryMs) ? retryMs : 0)
      }
      const msg = resp.status === 429 ? '已达到当前访问上限，请稍后再试' : '获取 115 网盘文件列表失败'
      reportDrive115ListError(msg, options)
      if (options.strict) throw new Error(`${msg} HTTP ${resp.status}`)
      return []
    }
    const data = (await resp.json()) as Drive115FileListResp
    if (data?.code !== 0 || !Array.isArray(data.data)) {
      const msg = data?.message || '获取 115 网盘文件列表失败'
      if (isRateLimitMessage(msg)) rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS
      reportDrive115ListError(msg, options)
      if (options.strict) throw new Error(msg)
      return []
    }
    return data.data
  })
}

export const mapDrive115FileToAliModel = (item: Drive115FileItem, drive_id: string): IAliGetFileModel => {
  const isDir = String(item.fc) === '0'
  const name = item.fn || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const time = toTime(item.upt || item.uet || item.uppt)
  const timeStr = time ? humanDateTimeDateStr(new Date(time).toISOString()) : ''
  const size = Number(item.fs || 0)
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
    file_id: String(item.fid),
    parent_file_id: String(item.pid),
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

export type Drive115TrashItem = {
  id: string
  file_name: string
  type: string
  file_size?: string | number
  dtime?: string | number
  cid?: number
  parent_name?: string
  pick_code?: string
  thumb?: string
  thumbnail?: string
  thumbnail_url?: string
  thumb_url?: string
}

export const apiDrive115Search = async (
  user_id: string,
  searchValue: string,
  limit = 200,
  offset = 0
): Promise<{ items: Drive115SearchItem[]; total: number }> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) {
    message.error('未登录 115 网盘')
    return { items: [], total: 0 }
  }
  const params = new URLSearchParams()
  params.set('search_value', searchValue)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  const url = `${SEARCH_URL}?${params.toString()}`
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.access_token}`
    }
  })
  if (!resp.ok) {
    message.error('获取 115 网盘搜索结果失败')
    return { items: [], total: 0 }
  }
  const data = (await resp.json()) as Drive115SearchResp
  if (data?.code !== 0 || !Array.isArray(data.data)) return { items: [], total: 0 }
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

export const mapDrive115TrashToAliModel = (item: Drive115TrashItem, drive_id: string): IAliGetFileModel => {
  const isDir = String(item.type) === '2'
  const name = item.file_name || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const time = toTime(item.dtime)
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
    file_id: String(item.id),
    parent_file_id: String(item.cid || ''),
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
