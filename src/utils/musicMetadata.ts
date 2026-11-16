import axios from 'axios'
import DebugLog from './debuglog'
import Config from '../config'
import type { LyricFetchDebug } from '../module/musicsdk/index'

export interface LyricLine {
  time: number // seconds
  text: string
}

export interface MusicMetadata {
  title: string
  artist: string
  album: string
  cover: string // url
  metadataSources?: string[]
  durationMs?: number
  lrc: string // raw LRC text
  lines: LyricLine[]
  fromCache?: boolean
  debug?: MusicMetadataDebug
}

export interface MusicMetadataDebug {
  query: {
    filename: string
    artist: string
    title: string
    album: string
    durationSec?: number
  }
  lyricProvider: 'boxplayer-api'
  lyric?: LyricFetchDebug
  lrcLength: number
  parsedLineCount: number
  lyricLineSource?: 'timed' | 'plain' | 'empty'
  reason: string
}

interface MetaQuery {
  filename: string
  durationSec?: number
  artistHint?: string
  titleHint?: string
  albumHint?: string
  includeLyrics?: boolean
  coverHint?: string
  lyricHint?: string
  preserveHints?: boolean
  sourceHint?: string
}

const META_TTL_MS = 24 * 60 * 60 * 1000
const memCache = new Map<string, { ts: number, data: MusicMetadata }>()
const inflight = new Map<string, Promise<MusicMetadata>>()

export class MusicMetadataTransientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MusicMetadataTransientError'
  }
}

function isTransientMetadataRequestError(error: any): boolean {
  const status = Number(error?.response?.status || error?.status || 0)
  const code = String(error?.code || '')
  return status === 429 || status >= 500 || !status || ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK', 'ERR_CANCELED'].includes(code)
}

const COMMON_BRACKETS_RE = /[\(\[（【][^\)\]）】]*[\)\]）】]/g
const TRAILING_TAGS_RE = /\s*-\s*(official|mv|hd|hq|lossless|高清|无损|完整版)\s*$/gi

function stripExt(name: string): string {
  if (!name) return ''
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

function cleanFragment(s: string): string {
  return s
    .replace(COMMON_BRACKETS_RE, (group) => /official|\bmv\b|\bhd\b|\bhq\b|lossless|hi[- ]?res|无损|高清/i.test(group) ? ' ' : group)
    .replace(TRAILING_TAGS_RE, ' ')
    .replace(/[_\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripLeadingTrackNo(s: string): string {
  return s.replace(/^\s*(?:cd\s*\d+\s*)?\d{1,3}\s+[-–—.]?\s*/i, '').trim()
}

function formatDurationForSdk(durationSec?: number): string | undefined {
  if (!Number.isFinite(durationSec) || !durationSec || durationSec <= 0) return undefined
  const sec = Math.max(0, Math.round(durationSec))
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export function guessArtistTitle(filename: string): { artist: string, title: string } {
  const base = stripLeadingTrackNo(cleanFragment(stripExt(filename)))
  if (!base) return { artist: '', title: '' }
  const seps = [' - ', '_-_', ' – ', '–', ' — ', '—']
  for (const sep of seps) {
    const i = base.indexOf(sep)
    if (i > 0) {
      const a = stripLeadingTrackNo(base.slice(0, i).trim())
      const t = stripLeadingTrackNo(base.slice(i + sep.length).trim())
      if (a && t) return { artist: a, title: t }
    }
  }
  return { artist: '', title: base }
}

function buildKey(q: MetaQuery): string {
  const guess = guessArtistTitle(q.filename)
  const artist = (q.artistHint || guess.artist || '').trim()
  const title = (q.titleHint || guess.title || '').trim()
  const dur = q.durationSec ? Math.round(q.durationSec) : 0
  return `${artist}|${title}|${q.albumHint || ''}|${q.coverHint || ''}|${q.lyricHint || ''}|${dur}|lyrics:${q.includeLyrics !== false}`.toLowerCase()
}

export function parseLrc(lrc: string, durationSec?: number): LyricLine[] {
  return parseLyricText(lrc, durationSec).lines
}

function parseLyricText(lrc: string, durationSec?: number): { lines: LyricLine[], source: MusicMetadataDebug['lyricLineSource'] } {
  if (!lrc) return { lines: [], source: 'empty' }
  const out: LyricLine[] = []
  const lines = lrc.split(/\r?\n/)
  const tagRe = /\[(\d{1,2}):(\d{1,2}(?:[\.:]\d{1,3})?)\]/g
  const krcTagRe = /\[(\d{1,8})(?:,\d{1,8})?\]/g
  const offsetSec = (Number(lrc.match(/\[offset:([+-]?\d+)\]/i)?.[1]) || 0) / 1000
  const cleanTimedText = (text: string) => text
    .replace(/<\d+,\d+>/g, '')
    .replace(/\(\d+,\d+,\d+\)/g, '')
    .trim()
  for (const raw of lines) {
    if (!raw) continue
    const stamps: number[] = []
    let m: RegExpExecArray | null
    tagRe.lastIndex = 0
    while ((m = tagRe.exec(raw)) !== null) {
      const min = parseInt(m[1], 10) || 0
      const sec = parseFloat(String(m[2]).replace(':', '.')) || 0
      stamps.push(Math.max(0, min * 60 + sec + offsetSec))
    }
    if (!stamps.length) {
      krcTagRe.lastIndex = 0
      while ((m = krcTagRe.exec(raw)) !== null) {
        const ms = parseInt(m[1], 10) || 0
        stamps.push(Math.max(0, ms / 1000 + offsetSec))
      }
    }
    if (!stamps.length) continue
    const text = cleanTimedText(raw.replace(tagRe, '').replace(krcTagRe, ''))
    if (!text) continue
    for (const s of stamps) out.push({ time: s, text })
  }
  out.sort((a, b) => a.time - b.time)
  // 去重相邻重复时间戳
  const dedup: LyricLine[] = []
  for (const line of out) {
    const prev = dedup[dedup.length - 1]
    if (prev && Math.abs(prev.time - line.time) < 0.001 && prev.text === line.text) continue
    dedup.push(line)
  }
  if (dedup.length) return { lines: dedup, source: 'timed' }
  const plainLines = parsePlainLyricLines(lrc, durationSec)
  return { lines: plainLines, source: plainLines.length ? 'plain' : 'empty' }
}

function parsePlainLyricLines(lrc: string, durationSec?: number): LyricLine[] {
  const lines = lrc
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]+\]/g, '').trim())
    .filter((line) => line && !/^(暂无歌词|纯音乐，请欣赏|歌词获取失败)$/i.test(line))
  const safeDuration = Number.isFinite(durationSec) && durationSec && durationSec > 0 ? Math.max(4, durationSec) : 0
  const step = safeDuration && lines.length > 1 ? safeDuration / lines.length : 4
  return lines.map((text, index) => ({
    time: index * step,
    text
  }))
}

function chooseLyricText(lyric: { lyric?: string, lxlyric?: string, tlyric?: string, rlyric?: string } | null | undefined, durationSec?: number): { text: string, source: MusicMetadataDebug['lyricLineSource'] } {
  const candidates = [lyric?.lyric || '', lyric?.lxlyric || '', lyric?.tlyric || '', lyric?.rlyric || ''].filter(Boolean)
  let bestPlain = ''
  for (const candidate of candidates) {
    const parsed = parseLyricText(candidate, durationSec)
    if (parsed.source === 'timed') return { text: candidate, source: parsed.source }
    if (!bestPlain && parsed.source === 'plain') bestPlain = candidate
  }
  if (bestPlain) return { text: bestPlain, source: 'plain' }
  return { text: candidates[0] || '', source: candidates[0] ? 'empty' : undefined }
}

export async function fetchMusicMetadata(q: MetaQuery): Promise<MusicMetadata> {
  const guess = guessArtistTitle(q.filename)
  const artist = (q.artistHint || guess.artist || '').trim()
  const title = (q.titleHint || guess.title || '').trim()
  const album = q.albumHint || ''
  const key = buildKey(q), cached = memCache.get(key)
  if (cached && Date.now() - cached.ts < META_TTL_MS) return { ...cached.data, fromCache: true }
  if (inflight.has(key)) return inflight.get(key)!
  const pending = (async () => {
    const data: MusicMetadata = { title, artist, album, cover: q.coverHint || '', lrc: q.lyricHint || '', lines: [], metadataSources: [q.sourceHint || 'filename'] }
    const api = Config.BOXPLAYER_API_URL.replace(/\/+$/, '')
    if (title && artist) {
      try {
        const response = await axios.post(`${api}/api/music/metadata`, { tracks: [{ id: 'playback', title, artist, album: album || undefined }] }, { timeout: 45000 })
        if (!Array.isArray(response.data?.matches)) throw new MusicMetadataTransientError('Invalid metadata response')
        const match = response.data.matches.find((item: any) => item.id === 'playback' && Number.isFinite(item.confidence) && item.confidence >= 0.88)
        if (match) {
          if (!q.preserveHints) { data.title = match.title || title; data.artist = match.artist || artist; data.album = match.album || album }
          data.cover ||= match.artworkURL || ''
          data.metadataSources!.push(`${match.provider}:metadata`)
        } else if (response.data.retryableFailureIDs?.includes('playback')) throw new MusicMetadataTransientError('Music catalog temporarily unavailable')
      } catch (error) {
        if (q.includeLyrics === false && (error instanceof MusicMetadataTransientError || isTransientMetadataRequestError(error))) throw new MusicMetadataTransientError('Music catalog temporarily unavailable')
      }
      if (q.includeLyrics !== false && !data.lrc) {
        try {
          const response = await axios.post(`${api}/api/music/lyrics`, { title: data.title, artist: data.artist, album: data.album, durationSec: q.durationSec }, { timeout: 12000 })
          data.lrc = typeof response.data?.lyrics === 'string' ? response.data.lyrics : ''
          if (data.lrc) data.metadataSources!.push(`${response.data.provider}:lyrics`)
        } catch { /* Retain usable metadata; lyrics can retry on a later playback. */ }
      }
    }
    data.lines = parseLrc(data.lrc, q.durationSec)
    memCache.set(key, { ts: Date.now(), data })
    return data
  })().finally(() => inflight.delete(key))
  inflight.set(key, pending)
  return pending
}

export function findActiveLineIndex(lines: LyricLine[], currentSec: number): number {
  if (!lines.length) return -1
  if (currentSec < lines[0].time) return -1
  let lo = 0
  let hi = lines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lines[mid].time <= currentSec) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function clearMusicMetaCache(): void {
  memCache.clear()
  inflight.clear()
}

function getLyricDebugReason(debug: LyricFetchDebug | undefined, lrc: string, lineCount: number, source?: MusicMetadataDebug['lyricLineSource']): string {
  if (lrc && lineCount > 0 && source === 'plain') return `歌词接口返回纯文本，已按行展示 ${lineCount} 行`
  if (lrc && lineCount > 0) return `歌词已获取并解析 ${lineCount} 行`
  if (lrc && lineCount === 0) return `歌词接口返回 ${lrc.length} 字符，但没有解析出时间轴行`
  if (!debug) return '未执行歌词接口请求'
  if (debug.finalStatus === 'no-match') return '搜索接口未匹配到歌曲'
  const lastError = [...debug.steps].reverse().find((step) => step.status === 'error')
  if (lastError) return `${lastError.source} 歌词接口失败：${lastError.message}`
  const empty = debug.steps.find((step) => step.status === 'empty')
  if (empty) return `${empty.source} ${empty.message}`
  const skipped = debug.steps.find((step) => step.status === 'skipped')
  if (skipped) return `${skipped.source} ${skipped.message}`
  return '歌词接口未返回可用歌词'
}

function logMusicMetadataDebug(data: MusicMetadata) {
  const debug = data.debug
  if (!debug) return
  const matched = debug.lyric?.matched
    ? ` matched=${debug.lyric.matched.source}:${debug.lyric.matched.name}/${debug.lyric.matched.singer}`
    : ''
  const steps = (debug.lyric?.steps || [])
    .map((step) => `${step.source}:${step.status}${step.lyricLength !== undefined ? `(${step.lyricLength})` : ''}`)
    .join(',')
  const message = `[MusicMetadata] ${debug.reason}; query="${debug.query.artist ? `${debug.query.artist} - ` : ''}${debug.query.title}" file="${debug.query.filename}"${matched} steps=[${steps}] lrc=${debug.lrcLength} lines=${debug.parsedLineCount}`
  if (debug.parsedLineCount > 0) console.info(message)
  else {
    console.warn(message)
    DebugLog.mSaveWarning(message)
  }
}
