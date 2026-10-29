import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import useCategoryPlacement, { CATEGORY_PLACEMENT_BACKUP_KEY, CATEGORY_PLACEMENT_KEY } from '../../store/categoryPlacement'
import useBookmarks, { CATEGORY_BOOKMARKS_KEY } from '../../store/unifiedLibraryBookmarks'
import useHome, { UNIFIED_HOME_PREFERENCES_KEY } from '../../store/unifiedHomePreferences'
import { applyCategoryHomeSettings, categoryPlacementState, categoryRouteForHomeId, changeCategoryPlacement, libraryHomeId, migrateCategoryPlacement, renameCategoryRoute } from '../categoryPlacement'
import { defaultHomeSettings } from '../unifiedHomeManagement'

const blank = () => migrateCategoryPlacement(defaultHomeSettings(), { favorites: [] })

describe('category placement identity and state', () => {
  it('lets a media server category sit on Home and in Favorites at once', () => {
    const route = 'home-entry/' + encodeURIComponent('emby-1:global-series')
    const catalog = [{ id: 'emby-1:global-series', title: 'Global Series', sourceId: 'emby-1', available: true, optIn: true }]
    const favorite = changeCategoryPlacement(blank(), route, 'favorite', 'Global Series', catalog)
    const both = changeCategoryPlacement(favorite, route, 'home', 'Latest Global Series', catalog)
    expect(categoryPlacementState(both, route, catalog)).toMatchObject({ home: true, favorite: true })
    const unfavorited = changeCategoryPlacement(both, route, 'removeFavorite', '', catalog)
    expect(categoryPlacementState(unfavorited, route, catalog)).toMatchObject({ home: true, favorite: false })
    expect(applyCategoryHomeSettings(both, both.home, catalog).home.hidden).not.toContain('emby-1:global-series')
  })
  it('keeps local categories exclusive', () => {
    const favorite = changeCategoryPlacement(blank(), 'movies/genres/Drama', 'favorite', 'Drama')
    expect(changeCategoryPlacement(favorite, 'movies/genres/Drama', 'home', 'Drama')).toBe(favorite)
  })
  it.each(['movies', 'tv', 'movies/genres', 'tv/genres', 'movies/genres/Science%20Fiction', 'tv/years/2020%2B', 'playlist/Mix%2F2026', 'custom-series/42', 'series/42'])('round trips %s through the only home identity adapter', route => {
    expect(categoryRouteForHomeId(libraryHomeId(route))).toBe(route)
  })
  it('normalizes language-dependent facet values without merging media scopes', () => {
    expect(libraryHomeId('movies/ratings/Top%2030')).toBe(libraryHomeId('movies/ratings/' + encodeURIComponent('前 30')))
    expect(libraryHomeId('tv/years/Newest')).toBe(libraryHomeId('tv/years/' + encodeURIComponent('最新的')))
    expect(libraryHomeId('movies/ratings/8')).toBe(libraryHomeId('movies/ratings/' + encodeURIComponent('8–10 星')))
    expect(libraryHomeId('tv/ratings/Top%2030')).not.toBe(libraryHomeId('movies/ratings/Top%2030'))
  })
  it('keeps roots, media scopes, series, and recent/unwatched children independent', () => {
    const routes = ['movies', 'movies/all', 'tv', 'tv/all', 'recent', 'movies/recent', 'tv/recent', 'unwatched', 'movies/unwatched', 'tv/unwatched', 'movies/genres/Drama', 'tv/genres/Drama', 'series/42', 'custom-series/42']
    expect(new Set(routes.map(libraryHomeId)).size).toBe(routes.length)
  })
  it('recognizes default placement without loaded content and respects a persistent removal', () => {
    const initial = migrateCategoryPlacement(defaultHomeSettings(), {})
    expect(categoryPlacementState(initial, 'tv').favorite).toBe(true)
    expect(categoryPlacementState(initial, 'tv/all').home).toBe(true)
    expect(categoryPlacementState(initial, 'movies/genres', [{ id: 'local:genres', title: '', sourceId: 'local', available: false }]).home).toBe(true)
    const removed = changeCategoryPlacement(initial, 'tv/all', 'remove')
    expect(categoryPlacementState(migrateCategoryPlacement(removed.home, removed.bookmarks), 'tv/all').placed).toBe(false)
    expect(categoryPlacementState(removed, 'tv').favorite).toBe(true)
  })
  it('retains an explicit child shelf when its data or parent disappears', () => {
    const route = 'tv/genres/Drama'
    const added = changeCategoryPlacement(blank(), route, 'home', 'Drama')
    added.home.hidden.push('catalog:tv/genres')
    expect(categoryPlacementState(added, route, []).home).toBe(true)
    expect(categoryPlacementState(added, 'tv/genres').home).toBe(false)
  })
  it.each(['home', 'favorite'] as const)('rechecks the second stale add request after %s succeeds', target => {
    const first = changeCategoryPlacement(blank(), 'tv/recent', target, 'First')
    const second = changeCategoryPlacement(first, 'tv/recent', target === 'home' ? 'favorite' : 'home', 'Stale')
    expect(second).toBe(first)
    expect(categoryPlacementState(second, 'tv/recent').placed).toBe(true)
  })
  it('removes both sides of legacy placement and keeps independent titles', () => {
    const legacy = migrateCategoryPlacement({ order: ['catalog:tv/recent'], hidden: [], titles: { 'catalog:tv/recent': 'Home' } }, { favorites: ['tv/recent'], titles: { 'tv/recent': 'Favorite' } })
    const renamed = changeCategoryPlacement(legacy, 'tv/recent', 'rename', 'New favorite')
    expect(renamed.home.titles['catalog:tv/recent']).toBe('Home')
    expect(renamed.bookmarks.titles['tv/recent']).toBe('New favorite')
    const removed = changeCategoryPlacement(renamed, 'tv/recent', 'remove')
    expect(categoryPlacementState(removed, 'tv/recent').placed).toBe(false)
  })
  it('rejects a stale rename after removal and preserves unknown old group values', () => {
    const added = changeCategoryPlacement(blank(), 'tv/recent', 'home', 'Home')
    const removed = changeCategoryPlacement(added, 'tv/recent', 'remove')
    expect(changeCategoryPlacement(removed, 'tv/recent', 'rename', 'Stale')).toBe(removed)
    expect(categoryRouteForHomeId(libraryHomeId('tv/years/Unknown%20legacy'))).toBe('tv/years/Unknown%20legacy')
    expect(libraryHomeId('tv/networks/Other')).toBe(libraryHomeId('tv/networks/' + encodeURIComponent('其他')))
  })
  it('renaming a home-only category neither creates a favorite nor changes its home name', () => {
    const home = changeCategoryPlacement(blank(), 'tv/recent', 'home', 'Home')
    const renamed = changeCategoryPlacement(home, 'tv/recent', 'rename', 'Favorite')
    expect(renamed.home.titles['catalog:tv/recent']).toBe('Home')
    expect(renamed.bookmarks.favorites).toEqual([])
  })
  it('migrates old shortcut shelves idempotently without deleting legacy dual placement', () => {
    const migrated = migrateCategoryPlacement(defaultHomeSettings(), { favorites: ['tv'], home: ['tv'], titles: { tv: 'My TV' } })
    expect(migrated.home.order).toContain('catalog:tv')
    expect(migrated.bookmarks.home).toEqual([])
    expect(categoryPlacementState(migrated, 'tv')).toMatchObject({ home: true, favorite: true })
    expect(migrateCategoryPlacement(migrated.home, migrated.bookmarks, migrated.identities)).toEqual(migrated)
  })
  it('management cannot introduce dual placement but preserves a migrated dual placement', () => {
    const favorite = changeCategoryPlacement(blank(), 'tv/recent', 'favorite', 'TV')
    const proposed = { ...favorite.home, order: ['catalog:tv/recent'] }
    const rejected = applyCategoryHomeSettings(favorite, proposed)
    expect(categoryPlacementState(rejected, 'tv/recent')).toMatchObject({ home: false, favorite: true })
    const legacy = { ...favorite, home: proposed }
    expect(categoryPlacementState(applyCategoryHomeSettings(legacy, proposed), 'tv/recent')).toMatchObject({ home: true, favorite: true })
  })
  it('playlist rename carries its stable identity, placements and both aliases', () => {
    const initial = changeCategoryPlacement(blank(), 'playlist/Before', 'home', 'Shelf')
    initial.identities['playlist/Before'] = 'local-library/playlist/stable-id'
    initial.bookmarks.titles['playlist/Before'] = 'Card'
    const renamed = renameCategoryRoute(initial, 'playlist/Before', 'playlist/After')
    expect(categoryPlacementState(renamed, 'playlist/After')).toMatchObject({ home: true, identity: 'local-library/playlist/stable-id' })
    expect(renamed.home.titles['local:playlist:group:After']).toBe('Shelf')
    expect(renamed.bookmarks.titles['playlist/After']).toBe('Card')
    expect(categoryPlacementState(renamed, 'playlist/Before').placed).toBe(false)
  })
})

describe('category placement persistence and shared consumers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const cache = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value) })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('migrates once with a recovery backup and updates the existing render stores immediately', async () => {
    localStorage.setItem(UNIFIED_HOME_PREFERENCES_KEY, JSON.stringify({ order: [], hidden: ['local:tv'], titles: {} }))
    localStorage.setItem(CATEGORY_BOOKMARKS_KEY, JSON.stringify({ favorites: ['tv'], home: ['movies'], titles: { tv: 'Television' } }))
    const service = useCategoryPlacement()
    service.ensureLoaded()
    expect(localStorage.getItem(CATEGORY_PLACEMENT_BACKUP_KEY)).toContain('Television')
    expect(service.state('tv').placed).toBe(true)
    expect(service.state('tv/all').placed).toBe(false)
    expect(useHome().order).toContain('catalog:movies')
    await service.change('tv', 'remove')
    expect(useBookmarks().favorites).not.toContain('tv')
    setActivePinia(createPinia())
    expect(useCategoryPlacement().state('tv').placed).toBe(false)
  })
  it('supports runtimes without Web Locks and still checks the latest committed state', () => {
    vi.stubGlobal('navigator', {})
    const service = useCategoryPlacement()
    expect(service.change('tv/recent', 'home', 'Home')).toBe(true)
    expect(service.change('tv/recent', 'favorite', 'Favorite')).toBe(false)
  })
  it('serializes simultaneous named adds across two store instances', async () => {
    const first = useCategoryPlacement(); first.ensureLoaded()
    setActivePinia(createPinia())
    const second = useCategoryPlacement(); second.ensureLoaded()
    const outcomes = await Promise.all([first.change('tv/recent', 'home', 'Home'), second.change('tv/recent', 'favorite', 'Favorite')])
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    const saved = JSON.parse(localStorage.getItem(CATEGORY_PLACEMENT_KEY)!)
    const state = categoryPlacementState(saved, 'tv/recent')
    expect(Number(state.home) + Number(state.favorite)).toBe(1)
  })
  it('uses the current stored transaction when another window wins an add', async () => {
    const service = useCategoryPlacement(); service.ensureLoaded()
    expect(service.state('tv/recent').placed).toBe(false)
    const foreign = changeCategoryPlacement(JSON.parse(localStorage.getItem(CATEGORY_PLACEMENT_KEY)!), 'tv/recent', 'home', 'Other window')
    localStorage.setItem(CATEGORY_PLACEMENT_KEY, JSON.stringify(foreign))
    expect(await service.change('tv/recent', 'favorite', 'Stale dialog')).toBe(false)
    expect(service.state('tv/recent')).toMatchObject({ home: true, favorite: false })
  })
})

// Parse the actual touched Vue scripts and client templates to catch integration
// syntax errors without starting Electron or invoking the build pipeline.
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import ts from 'typescript'
it.each(['src/views/UnifiedMediaLibraryView.vue', 'src/components/UnifiedLibraryBrowser.vue', 'src/components/LibraryObjectActions.vue', 'src/components/UnifiedHomeManagement.vue'])('parses the placement consumer %s', filename => {
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  expect(errors).toEqual([])
  const script = compileScript(descriptor, { id: filename })
  const result = compileTemplate({ filename, id: filename, source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  expect(result.errors).toEqual([])
  const compiled = ts.transpileModule(script.content, { fileName: filename + '.ts', reportDiagnostics: true })
  expect(compiled.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([])
})
