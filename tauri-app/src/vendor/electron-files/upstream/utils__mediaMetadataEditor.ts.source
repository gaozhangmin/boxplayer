import type { Episode, MediaEpisode, MediaLibraryItem, MediaLibraryTvSeriesItem, MediaSeason, MovieItem, Season } from '../types/media'
import { tmdbImageUrl } from './tmdb'

export type MediaMetadataEdit =
  | {
      scope: 'item'
      changes: Partial<Pick<MediaLibraryItem, 'name' | 'type' | 'year' | 'rating' | 'tmdbId' | 'genres' | 'productionCountries' | 'overview' | 'posterUrl' | 'backdropUrl'>>
    }
  | {
      scope: 'season'
      seasonNumber: number
      changes: Partial<Pick<MediaSeason, 'name' | 'overview' | 'posterPath' | 'airDate'>>
    }
  | {
      scope: 'episode'
      seasonNumber: number
      episodeNumber: number
      changes: Partial<Pick<MediaEpisode, 'name' | 'overview' | 'stillPath' | 'airDate' | 'runtime'>>
    }

const ITEM_METADATA_KEYS = ['name', 'type', 'year', 'rating', 'tmdbId', 'genres', 'productionCountries', 'overview', 'posterUrl', 'backdropUrl'] as const

export function applyManualMediaMetadataEdit(item: MediaLibraryItem, edit: MediaMetadataEdit, updatedAt = Date.now()): MediaLibraryItem {
  if (edit.scope === 'item') {
    return { ...item, ...edit.changes, metadataSource: 'manual', metadataUpdatedAt: updatedAt }
  }

  const seasons = (item.seasons || []).map((season) => {
    if (season.seasonNumber !== edit.seasonNumber) return season
    if (edit.scope === 'season') {
      return { ...season, ...edit.changes, metadataSource: 'manual' as const, metadataUpdatedAt: updatedAt }
    }
    return {
      ...season,
      episodes: (season.episodes || []).map((episode) => episode.episodeNumber === edit.episodeNumber
        ? { ...episode, ...edit.changes, metadataSource: 'manual' as const, metadataUpdatedAt: updatedAt }
        : episode)
    }
  })
  return { ...item, seasons }
}

export function preserveManualMediaMetadata(existing: MediaLibraryItem, incoming: MediaLibraryItem): MediaLibraryItem {
  const merged: MediaLibraryItem = { ...incoming }
  if (existing.metadataSource === 'manual') {
    for (const key of ITEM_METADATA_KEYS) {
      Object.assign(merged, { [key]: existing[key] })
    }
    merged.metadataSource = 'manual'
    merged.metadataUpdatedAt = existing.metadataUpdatedAt
  }

  if (incoming.collectionMovies?.length || existing.collectionMovies?.length) {
    const existingMovies = new Map((existing.collectionMovies || []).map((movie) => [movie.id, movie]))
    merged.collectionMovies = (incoming.collectionMovies || existing.collectionMovies || []).map((movie) => {
      const current = existingMovies.get(movie.id)
      if (current?.metadataSource !== 'manual') return movie
      const preserved = { ...movie }
      for (const key of ITEM_METADATA_KEYS) {
        Object.assign(preserved, { [key]: current[key] })
      }
      preserved.metadataSource = 'manual'
      preserved.metadataUpdatedAt = current.metadataUpdatedAt
      return preserved
    })
  }

  const incomingSeasons = new Map((incoming.seasons || []).map((season) => [season.seasonNumber, season]))
  const existingSeasons = new Map((existing.seasons || []).map((season) => [season.seasonNumber, season]))
  const seasonNumbers = new Set([...incomingSeasons.keys(), ...existingSeasons.keys()])
  if (seasonNumbers.size) {
    merged.seasons = [...seasonNumbers].sort((a, b) => a - b).map((seasonNumber) => {
      const current = existingSeasons.get(seasonNumber)
      const next = incomingSeasons.get(seasonNumber)
      if (!current) return next!
      if (!next) return current

      const mergedSeason: MediaSeason = current.metadataSource === 'manual'
        ? { ...next, name: current.name, overview: current.overview, posterPath: current.posterPath, airDate: current.airDate, metadataSource: 'manual', metadataUpdatedAt: current.metadataUpdatedAt }
        : { ...next }
      const incomingEpisodes = new Map((next.episodes || []).map((episode) => [episode.episodeNumber, episode]))
      const existingEpisodes = new Map((current.episodes || []).map((episode) => [episode.episodeNumber, episode]))
      const episodeNumbers = new Set([...incomingEpisodes.keys(), ...existingEpisodes.keys()])
      mergedSeason.episodes = [...episodeNumbers].sort((a, b) => a - b).map((episodeNumber) => {
        const currentEpisode = existingEpisodes.get(episodeNumber)
        const nextEpisode = incomingEpisodes.get(episodeNumber)
        if (!currentEpisode) return nextEpisode!
        if (!nextEpisode) return currentEpisode
        if (currentEpisode.metadataSource !== 'manual') return nextEpisode
        return {
          ...nextEpisode,
          name: currentEpisode.name,
          overview: currentEpisode.overview,
          stillPath: currentEpisode.stillPath,
          airDate: currentEpisode.airDate,
          runtime: currentEpisode.runtime,
          metadataSource: 'manual',
          metadataUpdatedAt: currentEpisode.metadataUpdatedAt
        }
      })
      return mergedSeason
    })
  }
  return merged
}

const imageUrl = (path?: string) => path ? (path.startsWith('http') ? path : tmdbImageUrl(path)) : undefined

export function applyTmdbMovieMatch(item: MediaLibraryItem, movie: MovieItem, updatedAt = Date.now()): MediaLibraryItem {
  return {
    ...item,
    type: 'movie',
    name: movie.title || movie.original_title || item.name,
    year: movie.release_date?.slice(0, 4) || undefined,
    certification: movie.certification || (item.tmdbId === movie.id ? item.certification : undefined),
    rating: movie.vote_average,
    genres: (movie.genres || []).map((genre) => genre.name),
    productionCountries: (movie.production_countries || []).map((country) => country.name),
    overview: movie.overview || undefined,
    posterUrl: imageUrl(movie.poster_path),
    backdropUrl: imageUrl(movie.backdrop_path),
    logoUrl: imageUrl(movie.logo_path),
    tmdbId: movie.id,
    imdbId: movie.imdb_id,
    credits: movie.credits,
    metadataSource: 'manual',
    metadataUpdatedAt: updatedAt
  }
}

const mapTmdbEpisode = (episode: Episode, driveFiles: MediaEpisode['driveFiles'], updatedAt: number): MediaEpisode => ({
  id: episode.id,
  episodeNumber: episode.episode_number,
  rating: episode.vote_average,
  seasonNumber: episode.season_number,
  name: episode.name,
  overview: episode.overview,
  stillPath: imageUrl(episode.still_path),
  airDate: episode.air_date,
  runtime: episode.runtime,
  crew: episode.crew,
  driveFiles,
  metadataSource: 'manual',
  metadataUpdatedAt: updatedAt
})

const mapTmdbSeason = (season: Season, existing: MediaSeason | undefined, updatedAt: number): MediaSeason => {
  const sourceEpisodes = new Map((season.episodes || []).map((episode) => [episode.episode_number, episode]))
  return {
    id: season.id,
    seasonNumber: season.season_number,
    name: season.name,
    overview: season.overview,
    posterPath: imageUrl(season.poster_path),
    episodeCount: season.episode_count || season.episodes?.length || 0,
    airDate: season.air_date,
    credits: season.credits,
    episodes: (existing?.episodes || []).map((episode) => {
      const source = sourceEpisodes.get(episode.episodeNumber)
      return source ? mapTmdbEpisode(source, episode.driveFiles, updatedAt) : episode
    }),
    metadataSource: 'manual',
    metadataUpdatedAt: updatedAt
  }
}

function applyTvSeriesFields(item: MediaLibraryItem, result: MediaLibraryTvSeriesItem, updatedAt: number): MediaLibraryItem {
  const tv = result.tv
  return {
    ...item,
    type: 'tv',
    name: tv.name || tv.original_name || item.name,
    year: tv.first_air_date?.slice(0, 4) || undefined,
    certification: tv.certification || (item.tmdbId === tv.id ? item.certification : undefined),
    rating: tv.vote_average,
    genres: (tv.genres || []).map((genre) => genre.name),
    productionCountries: (tv.production_countries || []).map((country) => country.name),
    overview: tv.overview || undefined,
    posterUrl: imageUrl(tv.poster_path),
    backdropUrl: imageUrl(tv.backdrop_path),
    logoUrl: imageUrl(tv.logo_path),
    tmdbId: tv.id,
    imdbId: tv.imdbId,
    tvdbId: tv.tvdbId,
    credits: tv.credits || result.current_season?.credits,
    expectedSeasons: (tv.seasons || []).filter((season) => season.season_number > 0).map((season) => ({
      seasonNumber: season.season_number,
      episodeCount: season.episode_count || 0,
      airDate: season.air_date
    })),
    metadataSource: 'manual',
    metadataUpdatedAt: updatedAt
  }
}

export function applyTmdbTvWholeMatch(item: MediaLibraryItem, results: MediaLibraryTvSeriesItem[], updatedAt = Date.now()): MediaLibraryItem {
  const primary = results[0]
  if (!primary) return item
  const detailsBySeason = new Map(results.filter((result) => result.current_season).map((result) => [result.current_season!.season_number, result.current_season!]))
  const updated = applyTvSeriesFields(item, primary, updatedAt)
  updated.seasons = (item.seasons || []).map((season) => {
    const detail = detailsBySeason.get(season.seasonNumber)
    return detail ? mapTmdbSeason(detail, season, updatedAt) : season
  })
  return updated
}

export function applyTmdbTvSeasonMatch(item: MediaLibraryItem, targetSeasonNumber: number, result: MediaLibraryTvSeriesItem, updatedAt = Date.now()): MediaLibraryItem {
  const source = result.current_season
  if (!source) return item
  return {
    ...item,
    seasons: (item.seasons || []).map((season) => {
      if (season.seasonNumber !== targetSeasonNumber) return season
      const mapped = mapTmdbSeason(source, season, updatedAt)
      return {
        ...mapped,
        seasonNumber: targetSeasonNumber,
        episodes: (mapped.episodes || []).map((episode) => ({ ...episode, seasonNumber: targetSeasonNumber }))
      }
    })
  }
}

export function applyTmdbTvEpisodeMatch(item: MediaLibraryItem, targetSeasonNumber: number, targetEpisodeNumber: number, result: MediaLibraryTvSeriesItem, sourceEpisodeNumber: number, updatedAt = Date.now()): MediaLibraryItem {
  const source = result.current_season?.episodes?.find((episode) => episode.episode_number === sourceEpisodeNumber)
  if (!source) return item
  return {
    ...item,
    seasons: (item.seasons || []).map((season) => season.seasonNumber !== targetSeasonNumber
      ? season
      : {
          ...season,
          episodes: (season.episodes || []).map((episode) => episode.episodeNumber === targetEpisodeNumber
            ? { ...mapTmdbEpisode(source, episode.driveFiles, updatedAt), seasonNumber: targetSeasonNumber, episodeNumber: targetEpisodeNumber }
            : episode)
        })
  }
}
