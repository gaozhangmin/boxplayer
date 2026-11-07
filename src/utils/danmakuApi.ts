import type { Danmu, Option as DanmukuPluginOption } from 'artplayer-plugin-danmuku'

export interface DanmakuApiConfig {
  id: string
  name: string
  url: string
}

export interface DanmakuMatch {
  episodeId: number
  animeId: number
  animeTitle: string
  episodeTitle: string
  type?: string
  typeDescription?: string
  shift?: number
  imageUrl?: string
}

export interface DanmakuMatchResponse {
  errorCode: number
  success: boolean
  errorMessage: string
  isMatched: boolean
  matches: DanmakuMatch[]
}

export interface DanmakuMatchResponseWithApi {
  response: DanmakuMatchResponse
  api: DanmakuApiConfig
}

export interface DanmakuSearchAnime {
  animeId: number
  animeTitle: string
  type?: string
  typeDescription?: string
  imageUrl?: string
  episodeCount?: number
  startDate?: string
}

export interface DanmakuEpisode {
  episodeId: number
  episodeTitle: string
  episodeNumber?: string | number
  airDate?: string
}

export interface DanmakuBangumiDetail {
  animeId: number
  animeTitle: string
  type?: string
  typeDescription?: string
  imageUrl?: string
  episodes: DanmakuEpisode[]
}

type FetchLike = typeof fetch

export function normalizeDanmakuApiUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
}

function createHeaders(contentType = false) {
  const headers: Record<string, string> = {
    'User-Agent': 'BoxPlayer'
  }
  if (contentType) headers['Content-Type'] = 'application/json'
  return headers
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export async function searchDanmakuMatches(videoTitle: string, api: DanmakuApiConfig, fetcher: FetchLike = fetch): Promise<DanmakuMatchResponseWithApi | undefined> {
  const baseUrl = normalizeDanmakuApiUrl(api.url)
  if (!videoTitle.trim() || !baseUrl) return undefined

  const response = await fetcher(`${baseUrl}/api/v2/match`, {
    method: 'POST',
    headers: createHeaders(true),
    body: JSON.stringify({
      matchMode: 'fileNameOnly',
      fileHash: '',
      fileSize: 0,
      fileName: videoTitle,
      videoDuration: 0
    })
  })
  const data = await readJson<DanmakuMatchResponse>(response as Response)
  if (!data.success || data.errorCode !== 0 || !data.isMatched || !data.matches?.length) return undefined
  return { response: data, api }
}

export async function autoMatchDanmaku(videoTitle: string, apis: DanmakuApiConfig[], fetcher: FetchLike = fetch) {
  const firstApi = apis.find((api) => api.url.trim())
  if (!firstApi) return undefined
  return searchDanmakuMatches(videoTitle, firstApi, fetcher)
}

export async function searchAnime(keyword: string, api: DanmakuApiConfig, fetcher: FetchLike = fetch): Promise<DanmakuSearchAnime[]> {
  const baseUrl = normalizeDanmakuApiUrl(api.url)
  if (!keyword.trim() || !baseUrl) return []
  const encodedKeyword = encodeURIComponent(keyword)
  const response = await fetcher(`${baseUrl}/api/v2/search/anime?keyword=${encodedKeyword}`, {
    headers: createHeaders()
  })
  const data = await readJson<any>(response as Response)
  if (!data.success || data.errorCode !== 0) throw new Error(data.errorMessage || '搜索弹幕失败')
  return data.animes || []
}

export async function getBangumiDetail(animeId: number | string, api: DanmakuApiConfig, fetcher: FetchLike = fetch): Promise<DanmakuBangumiDetail> {
  const baseUrl = normalizeDanmakuApiUrl(api.url)
  const response = await fetcher(`${baseUrl}/api/v2/bangumi/${animeId}`, {
    headers: {
      ...createHeaders(),
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Connection: 'keep-alive',
      'X-Timestamp': String(Math.floor(Date.now() / 1000))
    }
  })
  const data = await readJson<any>(response as Response)
  if (!data.success || data.errorCode !== 0) throw new Error(data.errorMessage || '获取弹幕详情失败')
  return data.bangumi
}

function mapDanmakuMode(mode: number): 0 | 1 | 2 {
  if (mode === 5) return 1
  if (mode === 4) return 2
  return 0
}

function colorToHex(colorValue: number) {
  if (!Number.isFinite(colorValue)) return '#ffffff'
  return `#${Math.max(0, colorValue).toString(16).padStart(6, '0').slice(-6)}`
}

export function convertCommentToDanmu(comment: { cid?: number | string, p: string, m: string, t?: number | string }): Danmu | undefined {
  const params = comment.p.split(',')
  if (params.length < 3) return undefined
  return {
    text: comment.m,
    time: Number(params[0]) || 0,
    mode: mapDanmakuMode(Number(params[1])),
    color: colorToHex(Number(params[2]))
  }
}

export async function loadDanmakuComments(episodeId: number, api: DanmakuApiConfig, fetcher: FetchLike = fetch): Promise<Danmu[]> {
  const baseUrl = normalizeDanmakuApiUrl(api.url)
  const response = await fetcher(`${baseUrl}/api/v2/comment/${episodeId}?chConvert=0&withRelated=true`, {
    headers: {
      ...createHeaders(),
      Accept: 'application/json'
    }
  })
  const data = await readJson<{ count: number, comments: Array<{ cid?: number | string, p: string, m: string, t?: number | string }> }>(response as Response)
  return (data.comments || []).map(convertCommentToDanmu).filter(Boolean) as Danmu[]
}

export function createDanmakuFilter(filterText = '') {
  const keywords = filterText
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return (danmu: Pick<Danmu, 'text'>) => !keywords.some((keyword) => danmu.text.includes(keyword))
}

export type DanmakuSettingsLike = Partial<{
  danmakuSpeed: number
  danmakuMarginTop: number
  danmakuMarginBottom: string
  danmakuOpacity: number
  danmakuColor: string
  danmakuMode: 0 | 1 | 2
  danmakuModes: Array<0 | 1 | 2>
  danmakuFontSize: number
  danmakuAntiOverlap: boolean
  danmakuSynchronousPlayback: boolean
  danmakuHeatmap: boolean
  danmakuEnabled: boolean
  danmakuVisible: boolean
  danmakuTheme: 'dark' | 'light'
  danmakuFilterText: string
}>

function normalizeDanmakuMarginBottom(value?: string): number | `${number}%` {
  const margin = (value || '25%').trim()
  if (/^\d+(\.\d+)?%$/.test(margin)) return margin as `${number}%`
  const numericMargin = Number(margin)
  if (Number.isFinite(numericMargin)) return numericMargin
  return '25%'
}

export function buildDanmakuPluginOption(settings: DanmakuSettingsLike): Partial<DanmukuPluginOption> {
  return {
    speed: settings.danmakuSpeed ?? 5,
    margin: [settings.danmakuMarginTop ?? 10, normalizeDanmakuMarginBottom(settings.danmakuMarginBottom)],
    opacity: settings.danmakuOpacity ?? 1,
    color: settings.danmakuColor || '#FFFFFF',
    mode: settings.danmakuMode ?? 0,
    modes: settings.danmakuModes || [0, 1, 2],
    fontSize: settings.danmakuFontSize ?? 25,
    antiOverlap: settings.danmakuAntiOverlap ?? true,
    synchronousPlayback: settings.danmakuSynchronousPlayback ?? false,
    heatmap: settings.danmakuHeatmap ?? false,
    visible: settings.danmakuEnabled !== false && (settings.danmakuVisible ?? false),
    emitter: false,
    theme: settings.danmakuTheme || 'dark',
    filter: createDanmakuFilter(settings.danmakuFilterText)
  }
}
