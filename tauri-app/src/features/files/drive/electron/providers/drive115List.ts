import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {message} from '../../ports'
import {drive115Check} from '../../drive115FileTransport'
import {drive115ListRequest} from '../../drive115ListTransport'
// Native callers use strict/silent reads and display errors after lifecycle checks.
const DebugLog={mSaveWarning:(_message:string)=>{}}

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
  drive115Check(user_id)
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
    const resp = await drive115ListRequest(user_id, url)
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
