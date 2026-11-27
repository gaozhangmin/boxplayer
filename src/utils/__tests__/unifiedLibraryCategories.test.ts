import { describe, expect, it } from 'vitest'
import type { MediaLibraryItem } from '../../types/media'
import { t } from '../../i18n'
import { LIBRARY_SIDEBAR_ROUTES, LIBRARY_CATEGORY_IDS, MOVIE_CATEGORY_IDS, TV_CATEGORY_IDS, filterLibraryCategory, libraryCategoryGroups, libraryMovieSeries, libraryResolution, libraryPlaylistMembers } from '../unifiedLibraryCategories'
const movie = (id: string, extra: Partial<MediaLibraryItem> = {}): MediaLibraryItem => ({ id, parentId: '', type: 'movie', name: id, genres: ['Drama'], driveFiles: [], addedAt: new Date('2026-01-01'), ...extra })
describe('unified library category navigation', () => {
  it('keeps eight video categories plus music and books in order', () => {
    expect(LIBRARY_CATEGORY_IDS).toEqual(['playlist', 'series', 'recent', 'unwatched', 'daily', 'movies', 'tv', 'other', 'music', 'books'])
    expect(MOVIE_CATEGORY_IDS).toHaveLength(10)
    expect(MOVIE_CATEGORY_IDS).not.toContain('networks')
    expect(TV_CATEGORY_IDS).toContain('networks')
    expect(TV_CATEGORY_IDS).toHaveLength(10)
  })
  it('never leaks TV shows into movie subcategories', () => {
    const items = [movie('film'), movie('show', { type: 'tv' })]
    expect(filterLibraryCategory(items, 'movies/genres/Drama', () => false).map(item => item.id)).toEqual(['film'])
    expect(filterLibraryCategory(items, 'tv/unwatched', item => item.id === 'show')).toEqual([])
  })
  it('uses all records rather than the homepage preview limit', () => {
    expect(filterLibraryCategory(Array.from({ length: 75 }, (_, i) => movie(String(i))), 'movies/all', () => false)).toHaveLength(75)
  })
  it('matches ratings, years, and real certification metadata', () => {
    const items = [movie('a', { rating: 7.6, year: '2022', certification: 'PG-13' }), movie('b')]
    for (const route of ['movies/ratings/7', 'movies/years/2022', 'movies/certification/PG-13']) expect(filterLibraryCategory(items, route, () => false).map(item => item.id)).toEqual(['a'])
    expect(libraryCategoryGroups(items, 'certification').map(group => group.name)).toEqual(['PG-13'])
  })
  it('uses the requested rating card names and order', () => {
    const items = [
      movie('ten', { rating: 9.2 }), movie('seven', { rating: 7.4 }),
      movie('six', { rating: 6.2 }), movie('five', { rating: 5.1 }), movie('four', { rating: 4.8 })
    ]
    expect(libraryCategoryGroups(items, 'ratings').map(group => group.name)).toEqual([
      t('aggregation.top30'), t('aggregation.rating8To10'), t('home.ratingStars', { count: 7 }),
      t('home.ratingStars', { count: 6 }), t('home.ratingStars', { count: 5 }), t('aggregation.rating1To4')
    ])
  })
  it('groups only actual streaming network metadata', () => {
    const items = [movie('show', { type: 'tv', networks: [{ id: 213, name: 'Netflix' }] }), movie('film', { networks: [{ id: 213, name: 'Netflix' }] })]
    expect(libraryCategoryGroups(items, 'networks').map(group => group.name)).toEqual(['Netflix'])
    expect(filterLibraryCategory(items, 'tv/networks/Netflix', () => false).map(item => item.id)).toEqual(['show'])
    expect(libraryCategoryGroups(items, 'networks')[0].members.map(item => item.id)).toEqual(['show'])
    expect(filterLibraryCategory(items, 'tv/networks', () => false).map(item => item.id)).toEqual(['show'])
    expect(filterLibraryCategory(items, 'movies/networks/Netflix', () => false).map(item => item.id)).toEqual(['show'])
    const independent = movie('independent', { type: 'tv', networks: [{ id: 99999, name: 'Independent' }] })
    expect(libraryCategoryGroups([independent], 'networks').map(group => group.name)).toEqual([t('unified.other')])
    expect(filterLibraryCategory([independent], 'tv/networks/' + encodeURIComponent(t('unified.other')), () => false)).toEqual([independent])
  })
  it('does not infer a miniseries or concert from its title', () => {
    expect(filterLibraryCategory([movie('Concert')], 'movies/concerts', () => false)).toEqual([])
    expect(filterLibraryCategory([movie('limited', { type: 'tv', isMiniseries: true })], 'tv/mini', () => false)).toHaveLength(1)
  })
  it('groups nested and standalone collection members without duplicates', () => {
    const a = { ...movie('a'), type: 'movie' as const }, b = { ...movie('b'), type: 'movie' as const }
    expect(libraryMovieSeries([movie('root', { collectionId: 1, collectionName: 'Saga', collectionMovies: [a, b] }), movie('a', { collectionId: 1 })])[0].members.map(item => item.id)).toEqual(['a', 'b'])
  })
  it('recognizes filename resolution without assigning unknown files to SD', () => {
    expect(libraryResolution(movie('a', { driveFiles: [{ id: 'f', name: 'movie.1080p.mkv', driveId: 'local', driveServerId: '', path: '', fileSize: 0 }] }))).toEqual(['1080p'])
    expect(libraryResolution(movie('unknown'))).toEqual([])
  })
  it('preserves playlist episode identity and order without playing episode one instead', () => {
    const items = [movie('show', { type: 'tv', seasons: [{ id: 1, seasonNumber: 1, name: '', episodeCount: 2, episodes: [{ id: 2, episodeNumber: 2, seasonNumber: 1, name: 'Second', driveFiles: [] }] }] }), movie('film')]
    const members = libraryPlaylistMembers(items, ['show_1_2', 'film', 'missing'])
    expect(members.map(item => item.id)).toEqual(['show_1_2', 'film'])
    expect(members[0].name).toContain('S1E2')
  })
})

it('keeps network browsing in the sidebar even without metadata', () => {
  expect(LIBRARY_SIDEBAR_ROUTES).toContain('tv/networks')
  expect(libraryCategoryGroups([], 'networks')).toEqual([])
})

it('excludes unmatched items from unwatched/recent and filters watched members before collapsing collections', () => {
  const m1 = { ...movie('m1', { collectionId: 10, collectionName: 'Trilogy' }), type: 'movie' as const }
  const m2 = { ...movie('m2', { collectionId: 10, collectionName: 'Trilogy' }), type: 'movie' as const }
  const col = movie('collection_10', { collectionId: 10, collectionName: 'Trilogy', collectionMovies: [m1, m2] })
  const show = movie('tv_1', { type: 'tv' })
  const unmatched = movie('u1', { type: 'unmatched' })
  const items = [col, show, unmatched]
  const unwatched = filterLibraryCategory(items, 'unwatched', item => item.id === 'm1')
  expect(unwatched.map(i => i.id)).toEqual(['m2', 'tv_1'])
  expect(libraryMovieSeries(unwatched)[0].members.map(i => i.id)).toEqual(['m2'])
  expect(filterLibraryCategory(items, 'recent', () => false).map(i => i.id)).not.toContain('u1')
  expect(filterLibraryCategory(items, 'other', () => false).map(i => i.id)).toEqual(['u1'])
})
