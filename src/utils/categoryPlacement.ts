import { isHomeItemEnabled, orderedHomeItems, type HomeManagementItem, type UnifiedHomeSettings } from './unifiedHomeManagement'

// This is the only route <-> placement identity adapter. Root index pages and
// independently placeable children deliberately have different identities.
export const LIBRARY_HOME_ROUTES: Record<string, string> = {
  recent: 'recent', unwatched: 'local:unwatched', daily: 'local:daily',
  'movies/all': 'local:movies', 'movies/genres': 'local:genres',
  'movies/ratings': 'local:ratings', 'movies/years': 'local:years',
  'tv/all': 'local:tv', other: 'local:unmatched', music: 'music', books: 'books',
  playlist: 'local:playlist', series: 'custom-series'
}
const DEFAULT_HOME_IDS = new Set([...Object.values(LIBRARY_HOME_ROUTES), 'sources'])
export const DEFAULT_CATEGORY_FAVORITES = ['library', 'movies', 'tv', 'other', 'music', 'books']
export interface CategoryBookmarks { favorites: string[]; home: string[]; titles: Record<string, string> }
export interface CategoryPlacementSnapshot {
  version: 2
  home: UnifiedHomeSettings
  bookmarks: CategoryBookmarks
  /** One order for category cards and connected source cards in both Favorites views. */
  favoriteOrder: string[]
  /** Stable object identities survive playlist renames; routes remain navigation addresses. */
  identities: Record<string, string>
}
export type CategoryPlacementAction = 'home' | 'favorite' | 'rename' | 'remove' | 'removeFavorite'
export function categoryGroupValue(category: string, value: string): string {
  if (category === 'ratings') {
    if (['前 30', 'Top 30'].includes(value)) return 'rating:top30'
    if (['8–10 星', '8–10 Stars'].includes(value)) return 'rating:8-10'
    if (['1–4 星', '1–4 Stars'].includes(value)) return 'rating:1-4'
    if (/^(8|9|10)$/.test(value)) return 'rating:8-10'
    if (/^[1-4]$/.test(value)) return 'rating:1-4'
    const stars = value.match(/^([5-7])(?: 星| Stars)?$/)
    if (stars) return 'rating:' + stars[1]
  }
  if (category === 'networks' && ['其他', '其它', 'Other'].includes(value)) return 'network:other'
  if (category === 'years') {
    if (['最新的', 'Newest'].includes(value)) return 'year:newest'
    if (['更早', 'Earlier'].includes(value)) return 'year:earlier'
  }
  return value
}
export function categoryRoute(route: string) {
  const parts = route.split('/').map(part => { try { return decodeURIComponent(part) } catch { return part } })
  if (parts[0] === 'movies' && parts[1] === 'networks') parts[0] = 'tv'
  if (['movies', 'tv'].includes(parts[0]) && parts[2]) parts[2] = categoryGroupValue(parts[1], parts[2])
  return parts.map(encodeURIComponent).join('/')
}
export function libraryHomeId(address: string): string {
  const route = categoryRoute(address)
  if (route.startsWith('home-entry/')) return decodeURIComponent(route.slice('home-entry/'.length))
  if (route.startsWith('custom-series/')) return 'custom-series:' + route.slice('custom-series/'.length)
  if (route.startsWith('playlist/')) return 'local:playlist:group:' + route.slice('playlist/'.length)
  const [root, category, value] = route.split('/')
  if (value && (root === 'movies' || root === 'tv')) return `${libraryHomeId(`${root}/${category}`)}:group:${value}`
  return LIBRARY_HOME_ROUTES[route] || 'catalog:' + route
}
export function categoryRouteForHomeId(id: string): string {
  if (id.startsWith('custom-series:')) return 'custom-series/' + id.slice('custom-series:'.length)
  if (id.startsWith('local:playlist:group:')) return 'playlist/' + id.slice('local:playlist:group:'.length)
  const group = id.indexOf(':group:')
  if (group >= 0) return categoryRouteForHomeId(id.slice(0, group)) + '/' + id.slice(group + ':group:'.length)
  if (id.startsWith('catalog:')) return id.slice('catalog:'.length)
  return Object.entries(LIBRARY_HOME_ROUTES).find(([, homeId]) => id === homeId)?.[0] || 'home-entry/' + encodeURIComponent(id)
}
const unique = (values: string[]) => [...new Set(values)]
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
const titles = (value: unknown): Record<string, string> => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([, name]) => typeof name === 'string')) : {}
export function migrateCategoryPlacement(home: Partial<UnifiedHomeSettings>, bookmarks: Partial<CategoryBookmarks>, identities: Record<string, string> = {}, favoriteOrder: string[] = []): CategoryPlacementSnapshot {
  const normalizeHome = (id: string) => libraryHomeId(categoryRouteForHomeId(id))
  const normalizeTitles = (source: unknown, normalize: (id: string) => string) => Object.fromEntries(Object.entries(titles(source)).map(([id, name]) => [normalize(id), name]))
  const result: CategoryPlacementSnapshot = {
    version: 2,
    home: { order: unique(strings(home.order).map(normalizeHome)), hidden: unique(strings(home.hidden).map(normalizeHome)), titles: normalizeTitles(home.titles, normalizeHome) },
    bookmarks: { favorites: unique((Array.isArray(bookmarks.favorites) ? strings(bookmarks.favorites) : DEFAULT_CATEGORY_FAVORITES).map(categoryRoute)), home: [], titles: normalizeTitles(bookmarks.titles, categoryRoute) },
    favoriteOrder: unique(strings(favoriteOrder).map(favoriteCardKey)),
    identities: { ...identities }
  }
  // Convert the old extra home shortcut list into the same shelf records. Keep
  // old double placements and explicit removals; migration never picks a winner.
  for (const route of strings(bookmarks.home).map(categoryRoute)) {
    const id = libraryHomeId(route)
    result.home.order = unique([...result.home.order, id])
  }
  for (const route of unique([...result.bookmarks.favorites, ...result.home.order.map(categoryRouteForHomeId)])) {
    if (route.startsWith('playlist/') && !result.identities[route]) result.identities[route] = 'local-library/playlist/legacy:' + route.slice('playlist/'.length)
  }
  return result
}
export function favoriteCardKey(key: string): string {
  return key.startsWith('source:') || key.startsWith('root:') ? key : categoryRoute(key)
}
export function orderedFavoriteKeys(snapshot: CategoryPlacementSnapshot, keys: string[]): string[] {
  const available = unique(keys.map(favoriteCardKey))
  const positions = new Map(snapshot.favoriteOrder.map((id, index) => [id, index]))
  return available.map((key, index) => ({ key, rank: positions.get(key) ?? snapshot.favoriteOrder.length + index }))
    .sort((a, b) => a.rank - b.rank).map(item => item.key)
}
function appendHomePlacement(snapshot: CategoryPlacementSnapshot, id: string, catalog: HomeManagementItem[]): string[] {
  const entries = catalog.length ? catalog : [...DEFAULT_HOME_IDS].map(id => ({ id, title: '', sourceId: 'local', available: true }))
  // Materialize defaults in the same order used by the Home/sidebar consumers
  // before appending. Keep offline/hidden saved identities, but never reuse the
  // target's former position after a remove + add.
  const existing = orderedHomeItems(entries, snapshot.home)
    .filter(item => (!item.child || item.id.includes(':group:')) && isHomeItemEnabled(item, snapshot.home)).map(item => item.id)
  return [...unique([...existing, ...snapshot.home.order]).filter(key => key !== id), id]
}
/** Media server categories may sit on Home and in Favorites at once; local categories stay exclusive. */
export function isIndependentCategoryRoute(address: string) {
  const route = categoryRoute(address)
  return route.startsWith('home-entry/') && !libraryHomeId(route).startsWith('local:')
}
export function categoryPlacementState(snapshot: CategoryPlacementSnapshot, address: string, catalog: HomeManagementItem[] = []) {
  const route = categoryRoute(address), id = libraryHomeId(route)
  const item = catalog.find(item => item.id === id)
  const defaultHome = item ? !item.optIn && !item.child : DEFAULT_HOME_IDS.has(id)
  const home = !snapshot.home.hidden.includes(id) && (snapshot.home.order.includes(id) || defaultHome)
  const favorite = snapshot.bookmarks.favorites.includes(route)
  return { route, homeId: id, identity: snapshot.identities[route] || `local-library/${route}`, home, favorite, placed: home || favorite }
}
export function changeCategoryPlacement(snapshot: CategoryPlacementSnapshot, address: string, action: CategoryPlacementAction, name = '', catalog: HomeManagementItem[] = [], favoriteKeys: string[] = []): CategoryPlacementSnapshot {
  const state = categoryPlacementState(snapshot, address, catalog)
  const independent = isIndependentCategoryRoute(state.route)
  if (action === 'home' && (independent ? state.home : state.placed)) return snapshot
  if (action === 'favorite' && (independent ? state.favorite : state.placed)) return snapshot
  if (action === 'rename' && !(independent ? state.favorite : state.placed)) return snapshot
  if (action !== 'remove' && action !== 'removeFavorite' && !name.trim()) return snapshot
  const next = structuredClone(snapshot)
  if (action === 'removeFavorite') {
    // Only the Favorites card goes; the category keeps its Home shelf.
    next.bookmarks.favorites = next.bookmarks.favorites.filter(route => route !== state.route)
    next.favoriteOrder = next.favoriteOrder.filter(key => key !== state.route)
  } else if (action === 'remove') {
    next.home.hidden = unique([...next.home.hidden, state.homeId])
    next.bookmarks.favorites = next.bookmarks.favorites.filter(route => route !== state.route)
    next.favoriteOrder = next.favoriteOrder.filter(key => key !== state.route)
  } else if (action === 'home') {
    next.home.order = appendHomePlacement(snapshot, state.homeId, catalog)
    next.home.hidden = next.home.hidden.filter(id => id !== state.homeId)
    next.home.titles[state.homeId] = name.trim()
  } else {
    next.bookmarks.titles[state.route] = name.trim()
    if (action === 'favorite') {
      next.bookmarks.favorites.push(state.route)
      const existing = orderedFavoriteKeys(snapshot, unique([...snapshot.bookmarks.favorites, ...favoriteKeys]))
      next.favoriteOrder = [...unique([...existing, ...snapshot.favoriteOrder]).filter(key => key !== state.route), state.route]
    }
  }
  return next
}
export function applyCategoryHomeSettings(snapshot: CategoryPlacementSnapshot, settings: UnifiedHomeSettings, catalog: HomeManagementItem[] = []) {
  const next = structuredClone(snapshot)
  next.home = { order: unique(settings.order), hidden: unique(settings.hidden), titles: { ...settings.titles } }
  // Home management may reorder legacy dual placements, but cannot introduce a
  // new one. Checking the old state also preserves explicit default removals.
  for (const route of next.bookmarks.favorites) {
    if (isIndependentCategoryRoute(route)) continue
    if (!categoryPlacementState(snapshot, route, catalog).home && categoryPlacementState(next, route, catalog).home) next.home.hidden = unique([...next.home.hidden, libraryHomeId(route)])
  }
  return next
}
export function renameCategoryRoute(snapshot: CategoryPlacementSnapshot, oldAddress: string, newAddress: string) {
  const oldRoute = categoryRoute(oldAddress), newRoute = categoryRoute(newAddress)
  if (oldRoute === newRoute) return snapshot
  const oldId = libraryHomeId(oldRoute), newId = libraryHomeId(newRoute)
  const next = structuredClone(snapshot)
  next.home.order = unique(next.home.order.map(id => id === oldId ? newId : id))
  next.home.hidden = unique(next.home.hidden.map(id => id === oldId ? newId : id))
  next.bookmarks.favorites = unique(next.bookmarks.favorites.map(route => route === oldRoute ? newRoute : route))
  next.favoriteOrder = unique(next.favoriteOrder.map(route => route === oldRoute ? newRoute : route))
  for (const [values, from, to] of [[next.home.titles, oldId, newId], [next.bookmarks.titles, oldRoute, newRoute], [next.identities, oldRoute, newRoute]] as const) {
    if (values[from]) { values[to] = values[from]; delete values[from] }
  }
  return next
}
