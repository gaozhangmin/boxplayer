import { seriesPreferences, expandedMovieCollections } from './seriesVersionPreferences'
import type { MediaLibraryItem } from '../types/media'
import { t } from '../i18n'
import { tmdbImageUrl } from './tmdb'
import { categoryGroupValue, categoryRoute } from './categoryPlacement'

const FEATURED_NETWORKS = new Map<number, string>([
  [213, 'Netflix'], [453, 'Hulu'], [2552, 'Apple TV+'], [2739, 'Disney+'],
  [1024, 'Prime Video'], [3186, 'Max'], [49, 'HBO'], [67, 'Showtime'],
  [4330, 'Paramount+'], [3353, 'Peacock']
])

function networkGroup(id: number, name: string): string {
  const featured = FEATURED_NETWORKS.get(id)
  if (featured) return featured
  const aliases: Record<string, string> = {
    netflix: 'Netflix', hulu: 'Hulu', 'apple tv': 'Apple TV+', 'apple tv+': 'Apple TV+',
    'disney+': 'Disney+', 'prime video': 'Prime Video', 'amazon prime video': 'Prime Video',
    'hbo max': 'Max', max: 'Max', hbo: 'HBO', showtime: 'Showtime',
    'paramount+': 'Paramount+', peacock: 'Peacock'
  }
  return aliases[name.trim().toLowerCase()] || t('unified.other')
}

// Sidebar navigation is fixed and independent of library contents and Home visibility.
export const LIBRARY_SIDEBAR_ROUTES = [
  'playlist', 'daily', 'movies/all', 'tv/all', 'tv/mini', 'recent', 'unwatched',
  'series', 'movies/genres', 'tv/networks', 'movies/ratings', 'movies/years', 'movies/certification',
  'movies/concerts', 'movies/shorts', 'other', 'music', 'books'
] as const

export const LIBRARY_CATEGORY_IDS = ['playlist', 'series', 'recent', 'unwatched', 'daily', 'movies', 'tv', 'other', 'music', 'books'] as const
export const MOVIE_CATEGORY_IDS = ['all', 'recent', 'unwatched', 'genres', 'ratings', 'years', 'certification', 'resolution', 'concerts', 'shorts'] as const
export const TV_CATEGORY_IDS = ['all', 'recent', 'unwatched', 'mini', 'genres', 'ratings', 'years', 'certification', 'resolution', 'networks'] as const
export type LibraryCategoryId = typeof LIBRARY_CATEGORY_IDS[number]
export { LIBRARY_HOME_ROUTES, libraryHomeId } from './categoryPlacement'

export function libraryGroupRoute(route: string, name: string) { return categoryRoute(route + '/' + encodeURIComponent(name)) }
export function libraryGroupLabel(category: string, value: string): string {
  if (category === 'networks' && value === 'network:other') return t('unified.other')
  if (category === 'ratings') {
    if (value === 'rating:top30') return t('aggregation.top30')
    if (value === 'rating:8-10') return t('aggregation.rating8To10')
    if (value === 'rating:1-4') return t('aggregation.rating1To4')
    if (/^rating:[5-7]$/.test(value)) return t('home.ratingStars', { count: value.slice(7) })
  }
  if (category === 'years') {
    if (value === 'year:newest') return t('aggregation.newest')
    if (value === 'year:earlier') return t('aggregation.earlier')
  }
  return value
}

export function libraryYearGroup(year: string) {
  const value = Number(year)
  return value >= 2020 ? '2020+' : value < 1940 ? t('aggregation.earlier') : `${Math.floor(value / 10) * 10}s`
}
export function libraryRatingGroup(rating: number) {
  return rating >= 8 ? t('aggregation.rating8To10') : rating >= 5 ? t('home.ratingStars', { count: Math.floor(rating) }) : t('aggregation.rating1To4')
}

export function libraryMediaFiles(item: MediaLibraryItem) {
  return item.type === 'tv' ? (item.seasons || []).flatMap(season => season.episodes || []).flatMap(episode => episode.driveFiles || []) : item.driveFiles
}

export function libraryResolution(item: MediaLibraryItem): string[] {
  const heights = libraryMediaFiles(item).map(file => file.height || Number(file.name.match(/\b(2160|1080|720|480)p\b/i)?.[1]) || (/\b4k\b/i.test(file.name) ? 2160 : 0))
  return [...new Set(heights.map(height => height >= 2160 ? '4K' : height >= 1080 ? '1080p' : height >= 720 ? '720p' : height > 0 ? 'SD' : ''))].filter(Boolean)
}

export function filterLibraryCategory(items: MediaLibraryItem[], route: string, watched: (item: MediaLibraryItem) => boolean): MediaLibraryItem[] {
  const [root, category = 'all', rawValue = ''] = categoryRoute(route).split('/')
  const value = libraryGroupLabel(category, categoryGroupValue(category, decodeURIComponent(rawValue)))
  let result = expandedMovieCollections(items).filter(item => root === 'movies' ? item.type === 'movie' : root === 'tv' ? item.type === 'tv' : root === 'other' ? item.type === 'unmatched' : true)
  if (root === 'unwatched' || category === 'unwatched') result = result.filter(item => !watched(item))
  if (category === 'genres' && value) result = result.filter(item => item.genres.includes(value))
  if (category === 'ratings' && value) {
    if (value === t('aggregation.top30')) return [...result].filter(item => (item.rating ?? 0) > 0).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 30)
    const normalizedValue = /^\d+$/.test(value) ? libraryRatingGroup(Number(value)) : value
    result = result.filter(item => item.rating !== undefined && item.rating > 0 && item.rating <= 10 && libraryRatingGroup(item.rating) === normalizedValue)
  }
  if (category === 'years' && value) {
    if (value === t('aggregation.newest')) return [...result].filter(item => item.year).sort((a, b) => String(b.releaseDate || b.year).localeCompare(String(a.releaseDate || a.year))).slice(0, 30)
    result = result.filter(item => item.year === value || libraryYearGroup(item.year || '') === value)
  }
  if (category === 'resolution' && value) result = result.filter(item => libraryResolution(item).includes(value))
  if (category === 'certification' && value) result = result.filter(item => item.certification === value)
  if (category === 'networks' && value) result = result.filter(item => item.networks?.some(network => networkGroup(network.id, network.name) === value))
  // Unknown source metadata must not be guessed from the title or season count.
  if (category === 'mini') result = result.filter(item => item.isMiniseries === true)
  if (category === 'concerts') result = result.filter(item => item.mediaSubtype === 'concert')
  if (category === 'shorts') result = result.filter(item => item.mediaSubtype === 'short')
  if (category === 'movies') result = result.filter(item => !item.mediaSubtype || item.mediaSubtype === 'movie')
  if (root === 'recent' || category === 'recent') result = [...result].sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
  return result
}

export function libraryCategoryGroups(items: MediaLibraryItem[], category: string) {
  if (category === 'ratings') {
    const rated = items.filter(item => item.rating !== undefined && item.rating > 0 && item.rating <= 10)
    const groups = new Map<string, MediaLibraryItem[]>([
      [t('aggregation.top30'), [...rated].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 30)],
      [t('aggregation.rating8To10'), []], [t('home.ratingStars', { count: 7 }), []],
      [t('home.ratingStars', { count: 6 }), []], [t('home.ratingStars', { count: 5 }), []],
      [t('aggregation.rating1To4'), []]
    ])
    for (const item of rated) groups.get(libraryRatingGroup(item.rating!))!.push(item)
    return [...groups].filter(([, members]) => members.length).map(([name, members]) => ({ name, members }))
  }
  if (category === 'years') {
    const dated = items.filter(item => item.year && Number(item.year) > 0)
    const names = ['2020+', '2010s', '2000s', '1990s', '1980s', '1970s', '1960s', '1950s', '1940s', t('aggregation.earlier')]
    const groups = new Map<string, MediaLibraryItem[]>([[t('aggregation.newest'), [...dated].sort((a, b) => String(b.releaseDate || b.year).localeCompare(String(a.releaseDate || a.year))).slice(0, 30)], ...names.map(name => [name, [] as MediaLibraryItem[]] as [string, MediaLibraryItem[]])])
    for (const item of dated) groups.get(libraryYearGroup(item.year!))!.push(item)
    return [...groups].filter(([, members]) => members.length).map(([name, members]) => ({ name, members }))
  }
  const groups = new Map<string, MediaLibraryItem[]>()
  for (const item of items) {
    if (category === 'networks' && item.type !== 'tv') continue
    const values = category === 'genres' ? item.genres : category === 'ratings' ? (item.rating === undefined ? [] : [String(Math.floor(item.rating))]) : category === 'years' ? (item.year ? [libraryYearGroup(item.year)] : []) : category === 'resolution' ? libraryResolution(item) : category === 'certification' ? (item.certification ? [item.certification] : []) : category === 'networks' ? (item.networks?.map(network => networkGroup(network.id, network.name)) || []) : []
    for (const value of new Set(values)) {
      const members = groups.get(value)
      if (members) members.push(item)
      else groups.set(value, [item])
    }
  }
  return [...groups].map(([name, members]) => ({ name, members })).sort((a, b) => {
    if (category === 'networks') {
      const other = t('unified.other')
      if ((a.name === other) !== (b.name === other)) return a.name === other ? 1 : -1
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
}

export function libraryMovieSeries(items: MediaLibraryItem[]) {
  if (!seriesPreferences.useTMDB) return []
  const groups = new Map<string, { id: string; title: string; members: MediaLibraryItem[] }>()
  for (const item of items.filter(item => item.type === 'movie' && item.collectionId)) {
    const id = String(item.collectionId)
    const group = groups.get(id) || { id, title: item.collectionName || item.name, members: [] }
    // A collection may already be stored as one aggregate item with its movies nested.
    const members = item.collectionMovies?.length ? item.collectionMovies : [item]
    for (const member of members) if (!group.members.some(existing => existing.id === member.id)) group.members.push(member)
    groups.set(id, group)
  }
  return [...groups.values()]
}

export function libraryPlaylistMembers(items: MediaLibraryItem[], ids: string[]): MediaLibraryItem[] {
  const byId = new Map(items.flatMap(item => [item, ...(item.collectionMovies || [])]).map(item => [item.id, item]))
  const seriesItems = items.filter(item => item.type === 'tv')
  return ids.flatMap(id => {
    const exact = byId.get(id)
    if (exact) return [exact]
    for (const series of seriesItems) {
      const season = series.seasons?.find(season => season.episodes?.some(episode => `${series.id}_${episode.seasonNumber}_${episode.episodeNumber}` === id))
      const episode = season?.episodes?.find(episode => `${series.id}_${episode.seasonNumber}_${episode.episodeNumber}` === id)
      if (episode) return [{ ...series, id, parentId: series.id, name: `${series.name} · S${episode.seasonNumber}E${episode.episodeNumber}${episode.name ? ` ${episode.name}` : ''}`, type: 'unmatched' as const, posterUrl: season?.posterPath ? tmdbImageUrl(season.posterPath) : series.posterUrl, seasons: season ? [{ ...season, episodes: [episode] }] : series.seasons, driveFiles: episode.driveFiles }]
    }
    return []
  })
}
