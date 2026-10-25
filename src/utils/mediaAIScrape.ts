import DebugLog from './debuglog'
import message from './message'
import { resolveAIProviderConfig } from './bookAI'
import { BoxPlayerMediaScrapeError, isBoxPlayerCloudProvider, scrapeMediaWithBoxPlayerCloud, type BoxPlayerCloudMediaScrapeResult } from './boxplayerCloudAI'
import { checkAndIncrement, isPro } from './usageLimit'
import { TmdbService, tmdbImageUrl } from './tmdb'
import { scrapedMediaId } from './mediaScrapeMerge'
import { buildMediaFingerprint } from './mediaFingerprint'
import type { DriveFileItem, MediaCollectionMovie, MediaEpisode, MediaLibraryItem, MediaLibraryTvSeriesItem, MovieItem } from '../types/media'

export interface MediaAIScrapeInput {
  file?: DriveFileItem
  item?: MediaLibraryItem
  folderName?: string
  folderId?: string
  folderContext?: string[]
  currentMatch?: {
    type?: MediaLibraryItem['type']
    name?: string
    tmdbId?: number
    year?: string
  }
}

export interface MediaAIScrapeDecision {
  type: 'movie' | 'tv' | 'unknown'
  title: string
  year?: number
  season?: number
  episode?: number
  episodes?: number[]
  altTitles?: string[]
  confidence: number
  allowOverwrite: boolean
  reason: string
}

export interface MediaAIScrapeResult {
  ok: boolean
  decision?: MediaAIScrapeDecision
  provider?: string
  error?: string
}

export interface AIScrapeApplyOptions {
  tmdb?: Pick<TmdbService, 'searchMovie' | 'searchTV'>
  now?: () => Date
}

const MIN_CONFIDENCE = 0.70
const MEDIA_SCRAPE_CLIENT_TIMEOUT_MS = 60_000
const MEDIA_SCRAPE_BATCH_SIZE = 10
const MEDIA_SCRAPE_MAX_ATTEMPTS = 3

export function canUseMediaAIScrape(options: { manual: boolean }): { allowed: boolean, message?: string } {
  if (options.manual) return checkAndIncrement('mediaAIScrape', 1, { metered: false })
  if (!isPro()) return { allowed: false }
  return { allowed: true }
}

export function parseMediaAIScrapeDecision(text: string): MediaAIScrapeDecision {
  const raw = extractJson(text)
  const parsed = JSON.parse(raw)
  const normalized = normalizeMediaAIScrapeDecision(parsed)
  if (!normalized.decision) throw new Error(normalized.reason || 'AI 未返回有效刮削决策')
  return normalized.decision
}

export function normalizeMediaAIScrapeDecision(value: unknown): { usable: boolean, decision?: MediaAIScrapeDecision, reason?: string } {
  const raw = value as Record<string, unknown>
  const type = raw?.type
  if (type !== 'movie' && type !== 'tv' && type !== 'unknown') return { usable: false, reason: 'AI 返回了无效媒体类型' }
  const confidence = clampNumber(raw.confidence, 0, 1)
  const title = String(raw.title || '').trim()
  const decision: MediaAIScrapeDecision = {
    type,
    title,
    year: optionalInt(raw.year),
    season: optionalInt(raw.season),
    episode: optionalInt(raw.episode),
    episodes: normalizeEpisodes(raw.episodes),
    altTitles: normalizeAltTitles(raw.altTitles || raw.alt_titles),
    confidence,
    allowOverwrite: raw.allowOverwrite === true,
    reason: String(raw.reason || '').slice(0, 160)
  }
  if (decision.type === 'unknown') return { usable: false, decision, reason: 'AI 无法识别该文件' }
  if (!decision.title) return { usable: false, decision, reason: 'AI 未返回片名' }
  if (decision.confidence < MIN_CONFIDENCE) return { usable: false, decision, reason: `AI 置信度过低：${decision.confidence}` }
  if (decision.type === 'tv' && (decision.season === undefined || (decision.episode === undefined && !decision.episodes?.length))) return { usable: false, decision, reason: 'AI 未返回剧集季集信息' }
  return { usable: true, decision }
}

export async function scrapeMediaWithAI(input: MediaAIScrapeInput, options: { manual?: boolean, timeoutMs?: number } = {}): Promise<MediaAIScrapeResult> {
  const cfg = resolveAIProviderConfig()
  const gate = canUseMediaAIScrape({ manual: options.manual === true })
  if (!gate.allowed) return { ok: false, error: gate.message || 'AI 影视刮削不可用' }
  if (!cfg || !isBoxPlayerCloudProvider(cfg.providerName)) return { ok: false }

  try {
    DebugLog.mSaveLog('info', '[MediaAIScrape] input ' + JSON.stringify(buildInputLog(input)), undefined)
    const decision = await scrapeSingleMediaWithBoxPlayerCloud(input, options.timeoutMs || MEDIA_SCRAPE_CLIENT_TIMEOUT_MS)
    const normalized = normalizeMediaAIScrapeDecision(decision)
    if (!normalized.usable || !normalized.decision) return { ok: false, decision, provider: cfg.providerName, error: normalized.reason || 'AI 决策不可用' }
    return { ok: true, decision: normalized.decision, provider: cfg.providerName }
  } catch (error: any) {
    const msg = error?.message || String(error)
    DebugLog.mSaveWarning('[MediaAIScrape] failed ' + msg)
    return { ok: false, provider: cfg.providerName, error: msg }
  }
}

export async function applyAIScrapeResult(input: MediaAIScrapeInput, result: MediaAIScrapeResult, options: AIScrapeApplyOptions = {}): Promise<MediaLibraryItem | null> {
  const decision = result.decision
  if (!result.ok || !decision) return null
  const files = resolveDriveFiles(input)
  if (!files.length) return null
  const file = files[0]
  const folderName = input.folderName || input.item?.parentId || file.path.split('/').slice(-2, -1)[0] || ''
  const folderId = input.folderId || input.item?.folderId
  const folderPath = input.item?.folderPath || file.path.substring(0, file.path.lastIndexOf('/')) || ''
  const tmdb = options.tmdb || TmdbService.getInstance()
  const now = options.now?.() || new Date()

  if (decision.type === 'movie') {
    const movie = await searchMovieWithTitles(tmdb, decision, file)
    if (!movie) return null
    return decorateAIScrapeItem(movieToMediaItem(movie, files, folderName, folderId, folderPath, now), result, input.item)
  }

  if (decision.type === 'tv') {
    const tv = await searchTvWithTitles(tmdb, decision, file)
    if (!tv) return null
    const item = tvToMediaItem(tv, decision, files, folderName, folderId, folderPath, now)
    return item ? decorateAIScrapeItem(item, result, input.item) : null
  }

  return null
}

export async function manualAIScrapeItem(item: MediaLibraryItem): Promise<MediaLibraryItem | null> {
  const result = await scrapeMediaWithAI({ item, currentMatch: mediaItemToCurrentMatch(item) }, { manual: true })
  if (!result.ok) {
    if (result.error) message.error(result.error)
    return null
  }
  const applied = await applyAIScrapeResult({ item, currentMatch: mediaItemToCurrentMatch(item) }, result)
  if (!applied) {
    message.error('AI 重刮削未匹配到 TMDB 结果')
    return null
  }
  return applied
}

export async function manualAIScrapeItems(item: MediaLibraryItem): Promise<MediaLibraryItem[]> {
  const files = resolveDriveFiles({ item })
  if (item.type !== 'tv' && files.length <= 1) {
    const single = await manualAIScrapeItem(item)
    return single ? [single] : []
  }

  const results = await batchScrapeMediaWithAI(
    files.map(file => ({
      name: file.name,
      path: file.path,
      fileSize: file.fileSize,
      driveFile: file
    })),
    item.name,
    item.folderId
  )
  const scraped = results
    .map(result => result.mediaItem)
    .filter((mediaItem): mediaItem is MediaLibraryItem => !!mediaItem)
    .map(mediaItem => mediaItem.type === item.type && mediaItem.tmdbId === item.tmdbId && mediaItem.collectionId === item.collectionId
      ? { ...mediaItem, id: item.id, lastWatched: item.lastWatched, watchProgress: item.watchProgress, lastPlayedFileId: item.lastPlayedFileId, lastPlayedPositionSeconds: item.lastPlayedPositionSeconds, lastPlayedDurationSeconds: item.lastPlayedDurationSeconds, addedAt: item.addedAt }
      : mediaItem)

  if (!scraped.length) {
    const firstError = results.find(result => result.error)?.error
    if (firstError) message.error(firstError)
  }
  return scraped
}

function movieToMediaItem(movie: MovieItem, files: DriveFileItem[], folderName: string, folderId: string | undefined, folderPath: string, addedAt: Date): MediaLibraryItem {
  const collection = movie.belongs_to_collection
  const movieItem: MediaCollectionMovie = {
    id: scrapedMediaId('movie', movie.id),
    parentId: folderName,
    folderId,
    folderPath,
    type: 'movie',
    name: movie.title || movie.original_title,
    overview: movie.overview,
    posterUrl: tmdbImageUrl(movie.poster_path) || undefined,
    backdropUrl: tmdbImageUrl(movie.backdrop_path) || undefined,
    year: movie.release_date?.substring(0, 4),
    certification: movie.certification,
    rating: movie.vote_average,
    genres: movie.genres?.map(g => g.name) || [],
    credits: movie.credits,
    productionCountries: movie.production_countries?.map(c => c.name) || [],
    tmdbId: movie.id,
    imdbId: movie.imdb_id,
    driveFiles: files,
    addedAt
  }
  if (collection) {
    return {
      ...movieItem,
      id: `collection_${collection.id}`,
      name: collection.name || movieItem.name,
      collectionId: collection.id,
      collectionName: collection.name,
      collectionMovies: [movieItem]
    }
  }
  return {
    ...movieItem
  }
}

function tvToMediaItem(tvResult: MediaLibraryTvSeriesItem, decision: MediaAIScrapeDecision, files: DriveFileItem[], folderName: string, folderId: string | undefined, folderPath: string, addedAt: Date): MediaLibraryItem | null {
  const season = tvResult.current_season
  const episodeNumbers = decision.episodes?.length ? decision.episodes : decision.episode === undefined ? [] : [decision.episode]
  const matchedEpisodes = episodeNumbers.map(number => season?.episodes?.find(ep => ep.episode_number === number)).filter((episode): episode is NonNullable<typeof episode> => !!episode)
  if (!season || !matchedEpisodes.length) return null
  const episodes: MediaEpisode[] = matchedEpisodes.map((matchedEpisode, index) => ({
    id: matchedEpisode.id,
    episodeNumber: matchedEpisode.episode_number,
    rating: matchedEpisode.vote_average,
    seasonNumber: matchedEpisode.season_number,
    name: matchedEpisode.name,
    overview: matchedEpisode.overview,
    stillPath: tmdbImageUrl(matchedEpisode.still_path) || undefined,
    airDate: matchedEpisode.air_date,
    runtime: matchedEpisode.runtime,
    crew: matchedEpisode.crew,
    driveFiles: files
  }))
  return {
    id: scrapedMediaId('tv', tvResult.tv.id), parentId: folderName, folderId, folderPath, type: 'tv',
    name: tvResult.tv.name || tvResult.tv.original_name || decision.title, overview: tvResult.tv.overview,
    posterUrl: tmdbImageUrl(tvResult.tv.poster_path) || undefined, backdropUrl: tmdbImageUrl(tvResult.tv.backdrop_path) || undefined,
    logoUrl: tmdbImageUrl(tvResult.tv.logo_path) || undefined, year: tvResult.tv.first_air_date?.substring(0, 4),
    certification: tvResult.tv.certification, rating: tvResult.tv.vote_average, genres: tvResult.tv.genres?.map(g => g.name) || [],
    credits: season.credits || tvResult.tv.credits, productionCountries: tvResult.tv.production_countries?.map(c => c.name) || [],
    tmdbId: tvResult.tv.id, imdbId: tvResult.tv.imdbId, tvdbId: tvResult.tv.tvdbId,
    seasons: [{ id: season.id, seasonNumber: season.season_number, name: season.name, overview: season.overview,
      posterPath: season.poster_path, episodeCount: season.episode_count || season.episodes?.length || 0,
      airDate: season.air_date, credits: season.credits, episodes }], driveFiles: [], addedAt
  }
}

function decorateAIScrapeItem(item: MediaLibraryItem, result: MediaAIScrapeResult, existing?: MediaLibraryItem): MediaLibraryItem {
  const preserved = existing ? {
    ...(existing.type === item.type && existing.tmdbId === item.tmdbId && existing.collectionId === item.collectionId ? { id: existing.id } : {}),
    lastWatched: existing.lastWatched,
    watchProgress: existing.watchProgress,
    lastPlayedFileId: existing.lastPlayedFileId,
    lastPlayedPositionSeconds: existing.lastPlayedPositionSeconds,
    lastPlayedDurationSeconds: existing.lastPlayedDurationSeconds,
    addedAt: existing.addedAt || item.addedAt
  } : {}
  return {
    ...item,
    ...preserved,
    aiScrape: {
      provider: result.provider || 'unknown',
      confidence: result.decision?.confidence || 0,
      reason: result.decision?.reason || '',
      updatedAt: Date.now()
    },
    metadataSource: 'ai-tmdb'
  } as MediaLibraryItem
}

function resolveDriveFiles(input: MediaAIScrapeInput): DriveFileItem[] {
  if (input.file) return [input.file]
  if (input.item?.driveFiles?.length) return input.item.driveFiles
  return input.item?.seasons
    ?.flatMap(season => season.episodes || [])
    .flatMap(episode => episode.driveFiles || []) || []
}

function mediaItemToCurrentMatch(item: MediaLibraryItem): MediaAIScrapeInput['currentMatch'] {
  return {
    type: item.type,
    name: item.name,
    tmdbId: item.tmdbId,
    year: item.year
  }
}

function extractJson(text: string): string {
  const trimmed = String(text || '').trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

function optionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : parseInt(String(value), 10)
  return Number.isFinite(n) ? n : undefined
}

function normalizeEpisodes(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const episodes = Array.from(new Set(value.map(optionalInt).filter((episode): episode is number => !!episode && episode > 0)))
  return episodes.length ? episodes : undefined
}

function clampNumber(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value || '0'))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function buildInputLog(input: MediaAIScrapeInput): Record<string, unknown> {
  const file = input.file || input.item?.driveFiles?.[0]
  return {
    fileName: file?.name || input.item?.name,
    path: file?.path,
    folderName: input.folderName || input.item?.parentId,
    currentMatch: input.currentMatch
  }
}

async function scrapeMediaWithAbortTimeout(items: Parameters<typeof scrapeMediaWithBoxPlayerCloud>[0], timeoutMs: number, signal?: AbortSignal): Promise<BoxPlayerCloudMediaScrapeResult[]> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, timeoutMs)
  try {
    return (await scrapeMediaWithBoxPlayerCloud(items, controller.signal)).results
  } catch (error) {
    if (signal?.aborted) throw new Error('AI 刮削已取消')
    if (controller.signal.aborted) throw new Error('AI 刮削超时')
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    clearTimeout(timer)
  }
}

export interface BatchScrapeFileInfo {
  name: string
  path: string
  fileSize?: number
  driveFile?: DriveFileItem
}

export interface BatchScrapeResult {
  file: BatchScrapeFileInfo
  // Candidate is retained for recognition diagnostics even when validation rejects
  // it. Only a valid decision is permitted to query TMDB.
  candidate?: MediaAIScrapeDecision | null
  decision?: MediaAIScrapeDecision | null
  mediaItem?: MediaLibraryItem | null
  error?: string
}

export async function batchScrapeMediaWithAI(files: BatchScrapeFileInfo[], folderName: string, folderId?: string): Promise<BatchScrapeResult[]> {
  if (!files.length) return []

  const cfg = resolveAIProviderConfig()
  const gate = canUseMediaAIScrape({ manual: true })
  if (!gate.allowed) {
    return files.map(f => ({ file: f, error: gate.message || 'AI 影视刮削不可用' }))
  }

  if (!cfg || !isBoxPlayerCloudProvider(cfg.providerName)) {
    return files.map(file => ({ file }))
  }

  try {
    DebugLog.mSaveLog('info', '[BatchAIScrape] input ' + files.length + ' files, folder: ' + folderName, undefined)
    const batch = await scrapeBatchMediaWithBoxPlayerCloud(files, folderName)
    const tmdb = TmdbService.getInstance()
    const now = new Date()

    const results = await mapWithConcurrency(files, 3, async (file, i): Promise<BatchScrapeResult> => {
      if (batch.errors[i]) return { file, error: batch.errors[i] }
      const decision = batch.decisions[i]
      const candidate = batch.candidates[i]
      if (!decision || decision.type === 'unknown') {
        return { file, candidate, decision }
      }

      try {
        let mediaItem: MediaLibraryItem | null = null
        if (decision.type === 'movie') {
          const movie = await searchMovieWithTitles(tmdb, decision, toDriveFileItem(file))
          if (movie) {
            mediaItem = decorateAIScrapeItem(movieToMediaItem(movie, [toDriveFileItem(file)], folderName, folderId, file.path.substring(0, file.path.lastIndexOf('/')) || '', now), { ok: true, decision, provider: cfg.providerName })
          }
        } else if (decision.type === 'tv') {
          const tv = await searchTvWithTitles(tmdb, decision, toDriveFileItem(file))
          if (tv) {
            mediaItem = tvToMediaItem(tv, decision, [toDriveFileItem(file)], folderName, folderId, file.path.substring(0, file.path.lastIndexOf('/')) || '', now)
            if (mediaItem) mediaItem = decorateAIScrapeItem(mediaItem, { ok: true, decision, provider: cfg.providerName })
          }
        }
        return { file, candidate, decision, mediaItem }
      } catch (e: any) {
        return { file, candidate, decision, error: e?.message || 'TMDB 查询失败' }
      }
    })
    return results
  } catch (error: any) {
    const msg = error?.message || String(error)
    DebugLog.mSaveWarning('[BatchAIScrape] failed ' + msg)
    return files.map(f => ({ file: f, error: msg }))
  }
}

async function scrapeSingleMediaWithBoxPlayerCloud(input: MediaAIScrapeInput, timeoutMs: number): Promise<MediaAIScrapeDecision> {
  const file = input.file || input.item?.driveFiles?.[0]
  if (!file) throw new Error('没有可供刮削的视频文件')
  const id = `0:${crypto.randomUUID()}`
  const results = await scrapeMediaWithAbortTimeout([{
    id,
    filename: file.name,
    context: [input.folderName || input.item?.folderPath || input.folderContext?.join(' | ') || '', file.path].filter(Boolean).join('\n') || null
  }], timeoutMs)
  const result = results[0]
  if (!result || result.idx !== 0 || result.id !== id) throw new Error('AI 刮削返回的文件关联无效')
  const normalized = normalizeCloudMediaScrapeDecision(result)
  if (!normalized.decision) throw new Error(normalized.reason || 'AI 未返回有效刮削决策')
  DebugLog.mSaveLog('info', '[MediaAIScrape] cloud result ' + JSON.stringify(result), undefined)
  return normalized.decision
}

async function scrapeBatchMediaWithBoxPlayerCloud(files: BatchScrapeFileInfo[], folderName: string, signal?: AbortSignal): Promise<{ decisions: Array<MediaAIScrapeDecision | null>, candidates: Array<MediaAIScrapeDecision | null>, errors: Array<string | undefined> }> {
  const decisions: Array<MediaAIScrapeDecision | null> = Array(files.length).fill(null)
  const candidates: Array<MediaAIScrapeDecision | null> = Array(files.length).fill(null)
  const errors: Array<string | undefined> = Array(files.length).fill(undefined)
  const chunks = Array.from({ length: Math.ceil(files.length / MEDIA_SCRAPE_BATCH_SIZE) }, (_, index) => files.slice(index * MEDIA_SCRAPE_BATCH_SIZE, index * MEDIA_SCRAPE_BATCH_SIZE + MEDIA_SCRAPE_BATCH_SIZE))
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const start = chunkIndex * MEDIA_SCRAPE_BATCH_SIZE
    const ids = chunk.map((_, index) => `${start + index}:${crypto.randomUUID()}`)
    try {
      let results: BoxPlayerCloudMediaScrapeResult[] = []
      for (let attempt = 1; attempt <= MEDIA_SCRAPE_MAX_ATTEMPTS; attempt++) {
        if (signal?.aborted) throw new Error('AI 刮削已取消')
        try {
          results = await scrapeMediaWithAbortTimeout(chunk.map((file, index) => ({ id: ids[index], filename: file.name, context: [folderName, file.path].filter(Boolean).join('\n') || null })), MEDIA_SCRAPE_CLIENT_TIMEOUT_MS, signal)
          break
        } catch (error) {
          if (!(error instanceof BoxPlayerMediaScrapeError) || !error.retryable || attempt === MEDIA_SCRAPE_MAX_ATTEMPTS) throw error
        }
      }
      const seen = new Set<number>()
      for (const result of results) {
        const localIndex = result.idx
        if (!Number.isInteger(localIndex) || localIndex < 0 || localIndex >= chunk.length || result.id !== ids[localIndex] || seen.has(localIndex)) throw new Error('AI 刮削返回的文件关联无效')
        seen.add(localIndex)
        const index = start + localIndex
        const normalized = normalizeCloudMediaScrapeDecision(result)
        if (normalized.decision) candidates[index] = normalized.decision
        if (normalized.usable && normalized.decision) decisions[index] = normalized.decision
      }
    } catch (error: any) {
      const message = error?.message || 'AI 刮削请求失败'
      DebugLog.mSaveWarning(`[BatchAIScrape] chunk ${chunkIndex + 1} failed: ${message}`)
      for (let index = start; index < start + chunk.length; index++) errors[index] = message
      if (signal?.aborted) break
    }
  }
  return { decisions, candidates, errors }
}

function normalizeCloudMediaScrapeDecision(result: BoxPlayerCloudMediaScrapeResult | undefined): { usable: boolean, decision?: MediaAIScrapeDecision, reason?: string } {
  if (!result) return { usable: false, reason: 'AI 未返回刮削结果' }
  return normalizeMediaAIScrapeDecision({ ...result, altTitles: result.alt_titles, allowOverwrite: true, reason: '' })
}

function normalizeAltTitles(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean))).slice(0, 5)
}

function mediaTitles(decision: MediaAIScrapeDecision): string[] {
  return Array.from(new Set([decision.title, ...(decision.altTitles || [])].map(title => title.trim()).filter(Boolean)))
}

async function searchMovieWithTitles(tmdb: Pick<TmdbService, 'searchMovie'>, decision: MediaAIScrapeDecision, file: DriveFileItem): Promise<MovieItem | null> {
  for (const title of mediaTitles(decision)) {
    const movie = await tmdb.searchMovie(title, decision.year ? String(decision.year) : undefined, undefined, buildMediaFingerprint(file), file.name)
    if (movie) return movie
  }
  return null
}

async function searchTvWithTitles(tmdb: Pick<TmdbService, 'searchTV'>, decision: MediaAIScrapeDecision, file: DriveFileItem): Promise<MediaLibraryTvSeriesItem | null> {
  for (const title of mediaTitles(decision)) {
    const tv = await tmdb.searchTV(title, decision.season === undefined ? 1 : decision.season, decision.year ? String(decision.year) : undefined, undefined, buildMediaFingerprint(file), file.name)
    if (tv) return tv
  }
  return null
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}

function toDriveFileItem(f: BatchScrapeFileInfo): DriveFileItem {
  if (f.driveFile) return f.driveFile
  return { id: '', name: f.name, path: f.path, userId: '', driveId: '', driveServerId: '', fileSize: f.fileSize || 0 }
}
