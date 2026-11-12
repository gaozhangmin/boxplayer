import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import useHomePreferences, { UNIFIED_HOME_PREFERENCES_KEY } from './unifiedHomePreferences'
import useBookmarks, { CATEGORY_BOOKMARKS_KEY } from './unifiedLibraryBookmarks'
import { applyCategoryHomeSettings, categoryPlacementState, categoryRoute, changeCategoryPlacement, favoriteCardKey, orderedFavoriteKeys, migrateCategoryPlacement, renameCategoryRoute, type CategoryPlacementAction, type CategoryPlacementSnapshot } from '../features/library/categoryPlacement'
import type { HomeManagementItem, UnifiedHomeSettings } from '../features/library/unifiedHomeManagement'

export const CATEGORY_PLACEMENT_KEY = 'unified-library-category-placement-v2'
export const LEGACY_FAVORITE_ORDER_KEY = 'unified-library-favorite-card-order-v1'
export const CATEGORY_PLACEMENT_BACKUP_KEY = CATEGORY_PLACEMENT_KEY + ':migration-backup'
export default defineStore('unified-library-category-placement', () => {
  const home = useHomePreferences(), bookmarks = useBookmarks()
  const revision = ref(0)
  let loaded = false
  let current: CategoryPlacementSnapshot
  const catalog = ref<HomeManagementItem[]>([])
  let favoriteCatalog: string[] = []
  function legacyFavoriteOrder(): string[] {
    try { const saved = JSON.parse(localStorage.getItem(LEGACY_FAVORITE_ORDER_KEY) || '[]'); return Array.isArray(saved) ? saved.filter(key => typeof key === 'string') : [] } catch { return [] }
  }
  function decode(value: string | null): CategoryPlacementSnapshot | undefined {
    if (!value) return
    try { const parsed = JSON.parse(value); if (parsed.version === 2 && parsed.home && parsed.bookmarks) return migrateCategoryPlacement(parsed.home, parsed.bookmarks, parsed.identities, parsed.favoriteOrder ?? legacyFavoriteOrder()) } catch { /* Use the recoverable legacy snapshot. */ }
  }
  function publish(snapshot: CategoryPlacementSnapshot) {
    current = snapshot
    home.$patch(snapshot.home)
    bookmarks.$patch(snapshot.bookmarks)
    revision.value++
  }
  function commit(snapshot: CategoryPlacementSnapshot) {
    // One authoritative write makes location + both titles atomic to other
    // windows. Existing keys are compatibility mirrors, not independent truth.
    localStorage.setItem(CATEGORY_PLACEMENT_KEY, JSON.stringify(snapshot))
    localStorage.setItem(UNIFIED_HOME_PREFERENCES_KEY, JSON.stringify(snapshot.home))
    localStorage.setItem(CATEGORY_BOOKMARKS_KEY, JSON.stringify(snapshot.bookmarks))
    localStorage.setItem(LEGACY_FAVORITE_ORDER_KEY, JSON.stringify(snapshot.favoriteOrder))
    publish(snapshot)
  }
  function ensureLoaded() {
    if (loaded) return
    loaded = true
    home.ensureLoaded(); bookmarks.ensureLoaded()
    const saved = decode(localStorage.getItem(CATEGORY_PLACEMENT_KEY))
    if (saved) publish(saved)
    else {
      if (!localStorage.getItem(CATEGORY_PLACEMENT_BACKUP_KEY)) localStorage.setItem(CATEGORY_PLACEMENT_BACKUP_KEY, JSON.stringify({ home: home.$state, bookmarks: bookmarks.$state, favoriteOrder: legacyFavoriteOrder() }))
      commit(migrateCategoryPlacement(home.$state, bookmarks.$state, {}, legacyFavoriteOrder()))
    }
    if (typeof window !== 'undefined') window.addEventListener('storage', event => {
      if (event.key === CATEGORY_PLACEMENT_KEY) { const saved = decode(event.newValue); if (saved) publish(saved) }
    })
  }
  function latest() { ensureLoaded(); return decode(localStorage.getItem(CATEGORY_PLACEMENT_KEY)) || current }
  function state(route: string) { ensureLoaded(); void revision.value; return categoryPlacementState(current, route, catalog.value) }
  function serialize<T>(transact: () => T): T | Promise<T> {
    if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function') return navigator.locks.request(CATEGORY_PLACEMENT_KEY, transact)
    return transact()
  }
  function change(route: string, action: CategoryPlacementAction, name = '') {
    return serialize(() => {
      const snapshot = latest()
      const next = changeCategoryPlacement(snapshot, route, action, name, catalog.value, favoriteCatalog.filter(key => key.startsWith('source:') || key.startsWith('root:')))
      if (next === snapshot) { publish(snapshot); return false }
      const normalized = categoryRoute(route)
      if (!next.identities[normalized]) next.identities[normalized] = normalized.startsWith('playlist/') ? `local-library/playlist/${crypto.randomUUID()}` : `local-library/${normalized}`
      commit(next)
      return true
    })
  }
  function applyHome(settings: UnifiedHomeSettings) { return serialize(() => commit(applyCategoryHomeSettings(latest(), settings, catalog.value))) }
  function renameHome(id: string, title: string) { const snapshot = latest(); if (title.trim()) return applyHome({ ...snapshot.home, titles: { ...snapshot.home.titles, [id]: title.trim() } }) }
  function restoreOrder() { const snapshot = latest(); return applyHome({ order: [], hidden: [], titles: { ...snapshot.home.titles } }) }
  function renameRoute(from: string, to: string) { return serialize(() => commit(renameCategoryRoute(latest(), from, to))) }
  function setCatalog(items: HomeManagementItem[]) { catalog.value = items }
  function setFavoriteCatalog(keys: string[]) {
    const nextKeys = [...new Set(keys.map(favoriteCardKey))]
    const removed = new Set(favoriteCatalog.filter(key => !nextKeys.includes(key)))
    favoriteCatalog = nextKeys
    return serialize(() => {
      const snapshot = latest()
      // Initial registration retains saved unavailable sources so late loading
      // does not discard their manual order. Subsequent explicit removals forget
      // that position, so a source added again joins the end too.
      const order = [...new Set([...snapshot.favoriteOrder.filter(key => !removed.has(key)), ...nextKeys])]
      if (order.join('\0') !== snapshot.favoriteOrder.join('\0')) commit({ ...snapshot, favoriteOrder: order })
    })
  }
  function orderFavoriteCards<T extends { key: string }>(cards: T[]): T[] {
    ensureLoaded(); void revision.value
    const byKey = new Map(cards.map(card => [favoriteCardKey(card.key), card]))
    return orderedFavoriteKeys(current, cards.map(card => card.key)).map(key => byKey.get(key)!)
  }
  function reorderFavorites(keys: string[]) {
    return serialize(() => {
      const snapshot = latest()
      const order = [...new Set([...keys.map(favoriteCardKey), ...snapshot.favoriteOrder])]
      commit({ ...snapshot, favoriteOrder: order })
    })
  }
  const favoriteRoutes = computed(() => { ensureLoaded(); void revision.value; return [...current.bookmarks.favorites] })
  return { ensureLoaded, state, change, applyHome, renameHome, restoreOrder, renameRoute, setCatalog, setFavoriteCatalog, orderFavoriteCards, reorderFavorites, favoriteRoutes }
})
