import { getDrive115Token } from './auth'
import message from '../utils/message'
import { DRIVE115_DOWN_AGENT } from './constants'
import { apiDrive115FileDetailResult } from './filecmd'
import { mapDrive115SubtitleItems, type Drive115SubtitleSource } from './subtitle'
import { registerDrive115PlaybackAuth } from './playbackAuth'

export { mapDrive115SubtitleItems } from './subtitle'

type Drive115VideoUrlItem = {
  url: string
  height?: number
  width?: number
  definition?: number | string
  definition_n?: number | string
  title?: string
  headers?: Record<string, string>
}

type Drive115VideoPlayData = {
  file_id?: string
  file_name?: string
  play_long?: number | string
  user_def?: number
  multitrack_list?: { title?: string; is_selected?: string | number }[]
  definition_list_new?: number[]
  video_url?: Drive115VideoUrlItem[]
}

type Drive115VideoPlayResp = {
  state: boolean
  code: number
  message: string
  data?: Drive115VideoPlayData
}

type Drive115VideoHistoryResp = {
  state: boolean
  code: number
  message: string
  data?: { time?: string | number }[]
}

const PLAY_URL = 'https://proapi.115.com/open/video/play'
const SUBTITLE_URL = 'https://proapi.115.com/open/video/subtitle'
const HISTORY_URL = 'https://proapi.115.com/open/video/history'
const VIDEO_PUSH_URL = 'https://proapi.115.com/open/video/video_push'

type Drive115PickCodeResult = {
  pick_code: string
  play_long: number
  error: string
}

const pickCodeCache = new Map<string, { pick_code: string; play_long: number }>()

const buildDrive115Headers = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  'User-Agent': DRIVE115_DOWN_AGENT
})

export const apiDrive115VideoPlay = async (user_id: string, pick_code: string): Promise<Drive115VideoPlayData | string> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token || !pick_code) return '参数错误'
  const params = new URLSearchParams({ pick_code })
  const url = `${PLAY_URL}?${params.toString()}`
  try {
    const resp = await fetch(url, {
      headers: buildDrive115Headers(token.access_token)
    })
    if (!resp.ok) return '获取播放地址失败'
    const data = (await resp.json()) as Drive115VideoPlayResp
    if (data?.code !== 0 || !data?.data) {
      return data?.message || '获取播放地址失败'
    }
    const headers = buildDrive115Headers(token.access_token)
    data.data.video_url = (data.data.video_url || []).map(item => ({ ...item, headers }))
    registerDrive115PlaybackAuth(data.data.video_url.map(item => item.url).filter(Boolean), headers)
    return data.data
  } catch (err: any) {
    message.error('获取播放地址失败 ' + (err?.message || ''))
    return '获取播放地址失败'
  }
}

export const apiDrive115VideoSubtitle = async (user_id: string, pick_code: string, timeoutMs = 1500): Promise<Drive115SubtitleSource[]> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token || !pick_code) return []
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = buildDrive115Headers(token.access_token)
    const resp = await fetch(`${SUBTITLE_URL}?${new URLSearchParams({ pick_code }).toString()}`, {
      headers,
      signal: controller.signal
    })
    if (!resp.ok) return []
    const body = await resp.json()
    if (body?.code !== 0 || !body?.data) return []
    const data = body.data
    const items = Array.isArray(data) ? data : data.list || data.subtitles || data.subtitle_list || []
    return mapDrive115SubtitleItems(items).map((item) => ({ ...item, headers }))
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

export const apiDrive115VideoHistory = async (user_id: string, pick_code: string): Promise<number> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token || !pick_code) return 0
  const params = new URLSearchParams({ pick_code })
  const url = `${HISTORY_URL}?${params.toString()}`
  try {
    const resp = await fetch(url, {
      headers: buildDrive115Headers(token.access_token)
    })
    if (!resp.ok) return 0
    const data = (await resp.json()) as Drive115VideoHistoryResp
    if (data?.code !== 0 || !Array.isArray(data.data) || data.data.length === 0) return 0
    const time = Number(data.data[0]?.time || 0)
    return Number.isFinite(time) ? time : 0
  } catch {
    return 0
  }
}

export const apiDrive115VideoHistoryUpdate = async (
  user_id: string,
  pick_code: string,
  time: number,
  watch_end: number = 0
): Promise<boolean> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token || !pick_code) return false
  const body = new URLSearchParams()
  body.set('pick_code', pick_code)
  body.set('time', Math.max(0, Math.trunc(time)).toString())
  body.set('watch_end', watch_end ? '1' : '0')
  try {
    const resp = await fetch(HISTORY_URL, {
      method: 'POST',
      headers: {
        ...buildDrive115Headers(token.access_token),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })
    if (!resp.ok) return false
    const data = await resp.json()
    return data?.code === 0 && data?.state === true
  } catch {
    return false
  }
}

export const apiDrive115VideoPush = async (user_id: string, pick_code: string, op: 'vip_push' | 'pay_push') => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token || !pick_code) return { success: false, message: '参数错误' }
  const body = new URLSearchParams({ pick_code, op })
  try {
    const resp = await fetch(VIDEO_PUSH_URL, {
      method: 'POST',
      headers: { ...buildDrive115Headers(token.access_token), 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data?.code !== 0 || data?.state === false) return { success: false, message: data?.message || '提交视频转码失败' }
    return { success: true, message: data?.message || '视频转码任务已提交' }
  } catch (error: any) {
    return { success: false, message: error?.message || '提交视频转码失败' }
  }
}

export const getDrive115PickCode = async (user_id: string, file_id: string): Promise<Drive115PickCodeResult | null> => {
  const cacheKey = `${user_id}:${file_id}`
  if (pickCodeCache.has(cacheKey)) {
    const cached = pickCodeCache.get(cacheKey)
    return cached ? { ...cached, error: '' } : null
  }
  const { detail, error } = await apiDrive115FileDetailResult(user_id, file_id)
  if (!detail?.pick_code) return { pick_code: '', play_long: 0, error: error || '获取文件详情失败' }
  const meta = { pick_code: detail.pick_code, play_long: Number(detail.play_long || 0) }
  pickCodeCache.set(cacheKey, meta)
  return { ...meta, error: '' }
}
