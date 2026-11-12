import type { MediaExpectedSeason, MediaLibraryItem } from '../types/media'

export interface MediaSeasonGap {
  seasonNumber: number
  missingEpisodes: number[]
}

export interface MediaCoverage {
  missingSeasons: number[]
  seasonGaps: MediaSeasonGap[]
  missingEpisodeCount: number
  summary: string
}

function hasAired(date: string | undefined, now: Date): boolean {
  if (!date) return true
  const timestamp = Date.parse(date)
  return !Number.isFinite(timestamp) || timestamp <= now.getTime()
}

function expectedEpisodeNumbers(season: MediaExpectedSeason, now: Date): number[] {
  if (season.episodes?.length) {
    return season.episodes
      .filter(episode => hasAired(episode.airDate, now))
      .map(episode => episode.episodeNumber)
      .filter(number => number > 0)
  }
  if (season.latestAiredEpisode !== undefined) {
    return Array.from({ length: Math.max(0, Math.min(season.episodeCount, season.latestAiredEpisode)) }, (_, index) => index + 1)
  }
  if (!hasAired(season.airDate, now)) return []
  return Array.from({ length: Math.max(0, season.episodeCount) }, (_, index) => index + 1)
}

export function getMediaCoverage(item: MediaLibraryItem, now = new Date()): MediaCoverage | null {
  if (item.type !== 'tv' || !item.expectedSeasons?.length) return null

  const localSeasons = new Map((item.seasons || []).map(season => [season.seasonNumber, season]))
  const missingSeasons: number[] = []
  const seasonGaps: MediaSeasonGap[] = []

  for (const expected of item.expectedSeasons) {
    if (expected.seasonNumber <= 0) continue
    const expectedEpisodes = expectedEpisodeNumbers(expected, now)
    if (!expectedEpisodes.length) continue
    const localSeason = localSeasons.get(expected.seasonNumber)
    const localEpisodes = new Set((localSeason?.episodes || []).map(episode => episode.episodeNumber))
    const missingEpisodes = expectedEpisodes.filter(number => !localEpisodes.has(number))
    if (!missingEpisodes.length) continue
    if (!localSeason || localEpisodes.size === 0) missingSeasons.push(expected.seasonNumber)
    seasonGaps.push({ seasonNumber: expected.seasonNumber, missingEpisodes })
  }

  if (!seasonGaps.length) return null
  const missingEpisodeCount = seasonGaps.reduce((total, gap) => total + gap.missingEpisodes.length, 0)
  const parts = [missingSeasons.length ? `缺 ${missingSeasons.length} 季` : '', missingEpisodeCount ? `缺 ${missingEpisodeCount} 集` : ''].filter(Boolean)
  return { missingSeasons, seasonGaps, missingEpisodeCount, summary: parts.join(' · ') }
}

export function buildExpectedSeasons(tvResult: any): MediaExpectedSeason[] {
  const current = tvResult?.current_season
  const lastAired = tvResult?.tv?.last_episode_to_air
  const seasons = Array.isArray(tvResult?.tv?.seasons) && tvResult.tv.seasons.length
    ? tvResult.tv.seasons
    : current ? [current] : []
  return seasons
    .filter((season: any) => Number(season?.season_number) > 0)
    .map((season: any) => {
      const isCurrent = Number(current?.season_number) === Number(season.season_number)
      const episodes = isCurrent && Array.isArray(current?.episodes)
        ? current.episodes.map((episode: any) => ({ episodeNumber: Number(episode.episode_number), airDate: episode.air_date || undefined })).filter((episode: any) => episode.episodeNumber > 0)
        : undefined
      const seasonNumber = Number(season.season_number)
      const episodeCount = Number(season.episode_count || episodes?.length || 0)
      const latestAiredEpisode = episodes?.length
        ? episodes.filter((episode: any) => hasAired(episode.airDate, new Date())).reduce((latest: number, episode: any) => Math.max(latest, episode.episodeNumber), 0)
        : Number(lastAired?.season_number) > seasonNumber ? episodeCount
          : Number(lastAired?.season_number) === seasonNumber ? Math.min(episodeCount, Number(lastAired?.episode_number || 0))
            : 0
      return {
        seasonNumber,
        episodeCount,
        latestAiredEpisode,
        airDate: season.air_date || undefined,
        episodes
      }
    })
}
