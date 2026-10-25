import type {
  TmdbSearchResult,
  MediaLibraryItem,
  MovieItem,
  MediaLibraryTvSeriesItem,
  MovieItemResponse,
  TvSeriesItemResponse
} from '../types/media'
import Config from '../config'
import { tmdbCertification } from './tmdbCertification'
import { fetchRankingPages } from './tmdbLibraryRecommendations'
import { mediaFileNormalizer, type NormalizedMediaFileDescriptor } from './mediaFileNormalizer'
import type { MediaFingerprint } from './mediaFingerprint'

const TMDB_BASE_URL = `${Config.BOXPLAYER_API_URL.replace(/\/+$/, '')}/api/tmdb`
const TMDB_REQUEST_TIMEOUT_MS = 45_000
const TMDB_MAX_RETRY_AFTER_MS = 15_000

export class TmdbTransientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TmdbTransientError'
  }
}

async function fetchWithRetry(url: string, retries = 3, delayMs = 2000, timeoutMs = TMDB_REQUEST_TIMEOUT_MS, consume?: (response: Response) => Promise<void>): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let attempt = 0; attempt <= retries; attempt++) {
      let resp: Response
      try {
        resp = await fetch(url, { signal: controller.signal })
      } catch (error) {
        if (controller.signal.aborted) throw new Error(`TMDB fetch timed out after ${timeoutMs}ms`)
        if (attempt < retries) {
          await waitForRetry(delayMs * Math.pow(2, attempt), controller.signal)
          continue
        }
        throw error
      }
      if (resp.ok) {
        // Keep the deadline active while the body is read, not just until headers.
        if (consume) await consume(resp)
        return resp
      }

      const retryable = resp.status === 408 || resp.status === 429 || resp.status === 500 || resp.status === 502 || resp.status === 503 || resp.status === 504
      if (retryable && attempt < retries) {
        const fallbackDelay = delayMs * Math.pow(2, attempt)
        await waitForRetry(getRetryDelayMs(resp, fallbackDelay), controller.signal)
        continue
      }
      throw new Error(`TMDB fetch failed: ${resp.status}`)
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`TMDB fetch timed out after ${timeoutMs}ms`)
    throw error
  } finally {
    clearTimeout(timer)
  }
  throw new Error(`TMDB fetch failed after ${retries} retries`)
}

function getRetryDelayMs(response: Response, fallbackDelayMs: number): number {
  const retryAfter = response.headers?.get('retry-after')?.trim()
  if (!retryAfter) return fallbackDelayMs
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(TMDB_MAX_RETRY_AFTER_MS, Math.max(1000, Math.round(seconds * 1000)))
  }
  const dateDelay = Date.parse(retryAfter) - Date.now()
  return Number.isFinite(dateDelay) && dateDelay > 0
    ? Math.min(TMDB_MAX_RETRY_AFTER_MS, Math.max(1000, dateDelay))
    : fallbackDelayMs
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delayMs)
    const abort = () => done(new Error('TMDB fetch aborted'))
    function done(error?: Error) {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export const TMDB_BASE = TMDB_BASE_URL
export const TMDB_BASE_URL_PROXY = `${TMDB_BASE_URL}/proxy`

type TmdbFingerprintInput = MediaFingerprint | string | undefined

function appendFingerprint(params: URLSearchParams, fingerprint: TmdbFingerprintInput): void {
  if (!fingerprint) return
  if (typeof fingerprint === 'string') {
    params.append('md5', fingerprint)
    return
  }
  params.append('fingerprintNamespace', fingerprint.fingerprintNamespace)
  params.append('fingerprint', fingerprint.fingerprint)
  params.append('fileSize', String(fingerprint.fileSize))
}

function unwrapTmdbResponse<T>(payload: { code?: number; data?: T; msg?: string }): T | null {
  if (payload?.code === undefined || payload.code === 0) return payload.data || null
  if (payload.code === 404) return null
  throw new TmdbTransientError(payload.msg || `TMDB 服务暂时不可用（${payload.code}）`)
}

export function tmdbImageUrl(path?: string | null, size: string = 'w500'): string {
  const imagePath = String(path || '').replace(/^\/+/, '')
  return imagePath ? `${TMDB_BASE_URL}/image/${size}/${imagePath}` : ''
}

export { TMDB_BASE_URL }

type LibraryRankings = { daily: import('./tmdbLibraryRecommendations').TmdbRankedEntry[]; topMovies: import('./tmdbLibraryRecommendations').TmdbRankedEntry[] }
let libraryRankingsCache: { day: string; value: LibraryRankings } | undefined
let libraryRankingsRequest: Promise<LibraryRankings> | undefined
export function getLibraryRankings(): Promise<LibraryRankings> {
  const day = new Date().toISOString().slice(0, 10)
  if (libraryRankingsCache?.day === day) return Promise.resolve(libraryRankingsCache.value)
  if (libraryRankingsRequest) return libraryRankingsRequest
  libraryRankingsRequest = Promise.all([
    fetchRankingPages(TMDB_BASE_URL_PROXY, '/trending/movie/day', 'movie', fetchWithRetry),
    fetchRankingPages(TMDB_BASE_URL_PROXY, '/trending/tv/day', 'tv', fetchWithRetry),
    fetchRankingPages(TMDB_BASE_URL_PROXY, '/movie/top_rated', 'movie', fetchWithRetry)
  ]).then(([movies, tv, topMovies]) => {
    const value = { daily: [...movies, ...tv], topMovies }
    libraryRankingsCache = { day, value }
    return value
  }).finally(() => { libraryRankingsRequest = undefined })
  return libraryRankingsRequest
}


export class TmdbService {
  private readonly networkRequests = new Map<number, Promise<import('../types/media').Network[] | undefined>>()

  private async supplementNetworks(item: MediaLibraryTvSeriesItem | null): Promise<void> {
    const tv = item?.tv
    if (!tv?.id || tv.networks?.length) return
    let request = this.networkRequests.get(tv.id)
    if (!request) {
      request = (async () => {
        try {
          const response = await fetchWithRetry(`${TMDB_BASE_URL_PROXY}/tv/${tv.id}`, 0, 0, 10000)
          const payload = await response.json()
          const details = payload.data ?? payload
          if (Number(details.id) !== Number(tv.id) || !Array.isArray(details.networks)) return undefined
          return details.networks.filter((network: import('../types/media').Network) => typeof network?.name === 'string' && network.name.trim())
        } catch { return undefined }
      })()
      this.networkRequests.set(tv.id, request)
      // Share concurrent episode lookups; bound cached successful series details.
      void request.then(networks => {
        if (!networks) this.networkRequests.delete(tv.id)
        else if (this.networkRequests.size > 256) this.networkRequests.delete(this.networkRequests.keys().next().value!)
      })
    }
    const networks = await request
    if (networks) tv.networks = networks
  }

  private async supplementCertification(item: MovieItem | MediaLibraryTvSeriesItem | null, tv: boolean): Promise<void> {
    if (!item) return
    const metadata = tv ? (item as MediaLibraryTvSeriesItem).tv : item as MovieItem
    metadata.certification = tmdbCertification(metadata, tv)
    if (metadata.certification || !metadata.id) return
    try {
      const endpoint = tv ? `tv/${metadata.id}/content_ratings` : `movie/${metadata.id}/release_dates`
      const response = await fetchWithRetry(`${TMDB_BASE_URL_PROXY}/${endpoint}`, 0, 0, 10000)
      const payload = await response.json()
      metadata.certification = tmdbCertification({ [tv ? 'content_ratings' : 'release_dates']: payload.data ?? payload }, tv)
    } catch { /* Optional metadata must not invalidate a successful match. */ }
  }
  private static instance: TmdbService
  
  static getInstance(): TmdbService {
    if (!TmdbService.instance) {
      TmdbService.instance = new TmdbService()
    }
    return TmdbService.instance
  }

  async searchMovie(
    queryName: string,
    year?: string,
    tmdbId?: string,
    fingerprint?: TmdbFingerprintInput,
    fileName?: string
  ): Promise<MovieItem | null> {
    try {
      const params = new URLSearchParams({
        language: 'zh-CN', append_to_response: 'release_dates'
      })

      if (tmdbId) {
        params.append('tmdbId', tmdbId)
      } else {
        params.append('title', queryName)
      }

      if (year) {
        params.append('year', year)
      }
      appendFingerprint(params, fingerprint)
      if (fileName) {
        params.append('fileName', fileName)
      }

      let data!: MovieItemResponse
      await fetchWithRetry(`${TMDB_BASE_URL}/movie?${params}`, 3, 2000, TMDB_REQUEST_TIMEOUT_MS, async response => {
        data = await response.json()
      })
      const item = unwrapTmdbResponse(data)
      await this.supplementCertification(item, false)
      return item
    } catch (error) {
      console.error('Error searching movie:', error)
      if (error instanceof TmdbTransientError) throw error
      throw new TmdbTransientError(error instanceof Error ? error.message : 'TMDB 查询失败')
    }
  }

  async getMovieByTmdbId(tmdbId: number | string): Promise<MovieItem | null> {
    return this.searchMovie('', undefined, String(tmdbId))
  }

  async searchMedia(query: string, isTVFirst = false): Promise<{ movies: TmdbSearchResult[]; tv: TmdbSearchResult[] }> {
    const params = new URLSearchParams({ query, isTVFirst: String(isTVFirst), language: 'zh-CN' })
    const response = await fetchWithRetry(`${TMDB_BASE_URL}/search?${params}`)
    const data = await response.json()
    return {
      movies: Array.isArray(data?.movies) ? data.movies.map((item: TmdbSearchResult) => ({ ...item, media_type: 'movie' as const })) : [],
      tv: Array.isArray(data?.tv) ? data.tv.map((item: TmdbSearchResult) => ({ ...item, media_type: 'tv' as const })) : []
    }
  }

  async getTvByTmdbId(tmdbId: number | string, season = 1): Promise<MediaLibraryTvSeriesItem | null> {
    try {
      const params = new URLSearchParams({ id: String(tmdbId), season: String(season), language: 'zh-CN', append_to_response: 'content_ratings' })
      const response = await fetchWithRetry(`${TMDB_BASE_URL}/tv/id?${params}`)
      const data: TvSeriesItemResponse = await response.json()
      const item = data.data || null
      await Promise.all([this.supplementCertification(item, true), this.supplementNetworks(item)])
      return item
    } catch (error) {
      console.error('Error loading TV metadata:', error)
      return null
    }
  }

  async searchTV(
    queryName: string,
    season: number,
    year?: string,
    tmdbId?: string,
    fingerprint?: TmdbFingerprintInput,
    fileName?: string
  ): Promise<MediaLibraryTvSeriesItem | null> {
    try {
      const params = new URLSearchParams({
        language: 'zh-CN',
        season: season.toString(),
        append_to_response: 'content_ratings'
      })

      if (tmdbId) {
        params.append('tmdbId', tmdbId)
      } else {
        params.append('title', queryName)
      }

      if (year) {
        params.append('year', year)
      }
      appendFingerprint(params, fingerprint)
      if (fileName) {
        params.append('fileName', fileName)
      }

      let data!: TvSeriesItemResponse
      await fetchWithRetry(`${TMDB_BASE_URL}/tv?${params}`, 3, 2000, TMDB_REQUEST_TIMEOUT_MS, async response => {
        data = await response.json()
      })
      const item = unwrapTmdbResponse(data)
      await Promise.all([this.supplementCertification(item, true), this.supplementNetworks(item)])
      return item
    } catch (error) {
      console.error('Error searching TV show:', error)
      if (error instanceof TmdbTransientError) throw error
      throw new TmdbTransientError(error instanceof Error ? error.message : 'TMDB 查询失败')
    }
  }


  normalizeFileName(fileName: string, folderHint?: string): NormalizedMediaFileDescriptor {
    return mediaFileNormalizer.normalize(fileName, folderHint)
  }

  cleanFileName(fileName: string, folderHint?: string): string {
    const descriptor = this.normalizeFileName(fileName, folderHint)
    return descriptor.searchTitle || descriptor.cleanedTitle
  }

  parseYear(fileName: string): string | undefined {
    const year = this.normalizeFileName(fileName).releaseYear
    return year === undefined ? undefined : String(year)
  }

  parseSeasonEpisode(fileName: string): { season: number; episode: number } | null {
    const descriptor = this.normalizeFileName(fileName)
    return descriptor.seasonNumber === undefined || descriptor.episodeNumber === undefined
      ? null
      : { season: descriptor.seasonNumber, episode: descriptor.episodeNumber }
  }

  async matchMedia(fileName: string, filePath: string, normalized?: NormalizedMediaFileDescriptor): Promise<Partial<MediaLibraryItem> | null> {
    const descriptor = normalized || this.normalizeFileName(fileName, filePath)
    const cleanedName = descriptor.searchTitle || descriptor.cleanedTitle
    const year = descriptor.releaseYear === undefined ? undefined : String(descriptor.releaseYear)
    const seasonEpisode = descriptor.seasonNumber === undefined || descriptor.episodeNumber === undefined
      ? null
      : { season: descriptor.seasonNumber, episode: descriptor.episodeNumber }

    if (seasonEpisode) {
      // 可能是电视剧
      const tvResult = await this.searchTV(cleanedName, seasonEpisode.season, year)
      if (tvResult) {
        // 从current_season中找到匹配的集数
        let matchedEpisode = null
        if (tvResult.current_season?.episodes) {
          matchedEpisode = tvResult.current_season.episodes.find(ep => ep.episode_number === seasonEpisode.episode)
        }

        // 构造返回的媒体信息，包含完整的剧集结构
        const mediaItem: Partial<MediaLibraryItem> = {
          type: 'tv',
          name: tvResult.tv.name || tvResult.tv.original_name,
          overview: tvResult.tv.overview,
          posterUrl: tvResult.tv.poster_path ? tmdbImageUrl(tvResult.tv.poster_path) : undefined,
          backdropUrl: tvResult.tv.backdrop_path ? tmdbImageUrl(tvResult.tv.backdrop_path, 'original') : undefined,
          logoUrl: tvResult.tv.logo_path ? tmdbImageUrl(tvResult.tv.logo_path, 'original') : undefined,
          year: tvResult.tv.first_air_date?.substring(0, 4),
          certification: tvResult.tv.certification,
          rating: tvResult.tv.vote_average,
          genres: tvResult.tv.genres?.map(g => g.name) || [],
          networks: tvResult.tv.networks || [],
          credits: tvResult.tv.credits || tvResult.current_season?.credits,
          productionCountries: tvResult.tv.production_countries?.map(c => c.name) || [],
          tmdbId: tvResult.tv.id,
          imdbId: tvResult.tv.imdbId,
          tvdbId: tvResult.tv.tvdbId,
          // 包含季信息
          seasons: tvResult.current_season ? [{
            id: tvResult.current_season.id,
            seasonNumber: tvResult.current_season.season_number,
            name: tvResult.current_season.name,
            overview: tvResult.current_season.overview,
            posterPath: tvResult.current_season.poster_path,
            episodeCount: tvResult.current_season.episode_count || tvResult.current_season.episodes?.length || 0,
            airDate: tvResult.current_season.air_date,
            credits: tvResult.current_season.credits
          }] : undefined
        }

        return mediaItem
      }
    } else {
      // 可能是电影
      const movieResult = await this.searchMovie(cleanedName, year)
      if (movieResult) {
        return {
          type: 'movie',
          name: movieResult.title || movieResult.original_title,
          overview: movieResult.overview,
          posterUrl: movieResult.poster_path ? tmdbImageUrl(movieResult.poster_path) : undefined,
          backdropUrl: movieResult.backdrop_path ? tmdbImageUrl(movieResult.backdrop_path, 'original') : undefined,
          logoUrl: movieResult.logo_path ? tmdbImageUrl(movieResult.logo_path, 'original') : undefined,
          year: movieResult.release_date?.substring(0, 4),
          certification: movieResult.certification,
          rating: movieResult.vote_average,
          genres: movieResult.genres?.map(g => g.name) || [],
          credits: movieResult.credits,
          productionCountries: movieResult.production_countries?.map(c => c.name) || [],
          collectionId: movieResult.belongs_to_collection?.id,
          collectionName: movieResult.belongs_to_collection?.name,
          tmdbId: movieResult.id,
          imdbId: movieResult.imdb_id,
          driveFiles: [] // 这个会在后续处理中填充实际的文件信息
        }
      }
    }

    return null
  }
}
