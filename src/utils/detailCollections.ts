import type { MediaLibraryItem, MediaEpisode } from '../types/media'
import { detailSeriesId } from './detailResume'

// Expanded movie entries may omit their siblings; recover them from the library.
export function isDetailCollectionSource(item: MediaLibraryItem, candidate: MediaLibraryItem): boolean {
  if (item.type !== 'movie' || candidate.type !== 'movie') return false
  return Boolean((item.collectionId && candidate.collectionId === item.collectionId)
    || candidate.id === item.id
    || candidate.collectionMovies?.some(movie => movie.id === item.id || (item.tmdbId && movie.tmdbId === item.tmdbId)))
}

export function detailCollectionMovies(item: MediaLibraryItem, library: MediaLibraryItem[]): MediaLibraryItem[] {
  if (item.type !== 'movie') return []
  const sources = library.filter(candidate => isDetailCollectionSource(item, candidate))
  const collectionId = item.collectionId || sources.find(candidate => candidate.collectionId)?.collectionId
  const collectionName = item.collectionName || sources.find(candidate => candidate.collectionName)?.collectionName
  const movies = new Map<string, MediaLibraryItem>()
  for (const source of [...sources, item]) {
    if (!collectionId && !source.collectionMovies?.length) continue
    for (const movie of source.collectionMovies?.length ? source.collectionMovies : [source]) {
      const member = { ...movie, type: 'movie' as const, collectionId, collectionName, collectionMovies: undefined }
      movies.set(movie.tmdbId ? `tmdb:${movie.tmdbId}` : movie.id, member)
    }
  }
  return [...movies.values()].sort((a, b) => (a.releaseDate || a.year || '9999').localeCompare(b.releaseDate || b.year || '9999') || a.name.localeCompare(b.name))
}

export function detailCollectionTarget(item: MediaLibraryItem, episode?: Pick<MediaEpisode, 'seasonNumber' | 'episodeNumber' | 'name'> | null) {
  if (item.type === 'tv') {
    if (!episode) return null
    return { id: `${detailSeriesId(item.id)}_${episode.seasonNumber}_${episode.episodeNumber}`, title: `${item.name} · S${episode.seasonNumber}E${episode.episodeNumber} ${episode.name}`.trim() }
  }
  return { id: item.id, title: item.name }
}

export function playlistEntryIds(item: MediaLibraryItem): string[] {
  if (item.type === 'tv') {
    const seasons = [...(item.seasons || [])].sort((a, b) => a.seasonNumber - b.seasonNumber)
    return seasons.flatMap(season => [...(season.episodes || [])]
      .filter(episode => episode.driveFiles?.length)
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map(episode => `${detailSeriesId(item.id)}_${season.seasonNumber}_${episode.episodeNumber}`))
  }
  if (item.collectionMovies?.length) return item.collectionMovies.map(movie => movie.id)
  return [item.id]
}

export function playlistSelection(playlists: Record<string, string[]>, itemId: string): string[] {
  return Object.keys(playlists).filter(name => playlists[name].includes(itemId))
}

export function applyPlaylistSelection(playlists: Record<string, string[]>, itemId: string, selected: string[], expandedIds: string[] = [itemId]): Record<string, string[]> {
  if (!itemId) return playlists
  const included = new Set(selected)
  const additions = [...new Set(expandedIds)]
  const removed = new Set([itemId, ...additions])
  return Object.fromEntries(Object.entries(playlists).map(([name, ids]) => [name,
    included.has(name) ? [...new Set([...ids, ...additions])] : ids.filter(id => !removed.has(id))]))
}
