import { describe, expect, it } from 'vitest'
import { isMediaWatched, localWatchedKeys } from '../localWatchedState'
import { hasLocalMedia } from '../unifiedMediaScope'
import type { MediaLibraryItem, DriveFileItem } from '../../types/media'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'

const file = (source: string) => ({ driveServerId: source, driveId: source } as DriveFileItem)
const item = (files: DriveFileItem[]) => ({ driveFiles: files } as MediaLibraryItem)

describe('watched status across local entrances', () => {
  const media = { id: 'movie-1', driveFiles: [{ id: '/video/a.mp4', path: '/video/a.mp4', driveId: 'local' }] } as MediaLibraryItem
  it('excludes file-path markers from unwatched and restores after cancellation', () => {
    const watched = localWatchedKeys(media)
    expect(isMediaWatched(media, watched)).toBe(true)
    expect([media].filter(row => !isMediaWatched(row, watched))).toEqual([])
    expect([media].filter(row => !isMediaWatched(row, []))).toEqual([media])
  })
  it('also recognizes media IDs without confusing unrelated files', () => {
    expect(isMediaWatched(media, ['movie-1'])).toBe(true)
    expect(isMediaWatched(media, ['local-file:/video/b.mp4'])).toBe(false)
  })
})

describe('unified category browsing', () => {
  it('uses dedicated grouped search with server API and full library records', () => {
    const view = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    expect(view).toContain("selectedHomeRowKey.value = 'search-results'")
    expect(view).toContain('await content.loadSearch(server, keyword)')
    expect(view).toContain('searchLibrary.value = library.items')
    expect(view).toContain("item.kind === 'series'")
    expect(view).toContain('hasLocalMedia(item)')
    expect(view).toContain('class="sidebar-search-results"')
    expect(view).toContain('clearTimeout(searchTimer)')
  })
  it('routes source providers explicitly and keeps folder browsing scoped to the media library', () => {
    const view = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    const sourceForm = readFileSync(resolve(process.cwd(), 'src/components/AddFileSourceModal.vue'), 'utf8')
    expect(view).toContain('<AddFileSourceModal')
    expect(view).toContain('@connected="fileSourceConnected"')
    expect(sourceForm).toContain("['plex', 'emby', 'jellyfin'] as const")
    expect(sourceForm).toContain("detail = { kind: 'server', type }")
    expect(sourceForm).toContain('form-only embedded :default-type="detail.type"')
    expect(view).toContain(':unified-files="isFolderPage"')
    expect(view).toContain('unified.removeFavoriteFolder')
    const panel = readFileSync(resolve(process.cwd(), 'src/components/media-server/MediaServerRegistryPanel.vue'), 'utf8')
    expect(panel).toContain('openProvider: handleQuickAdd')
    expect(panel).toContain('pendingType.value = type')
    expect(panel).toContain('void handlePlexSignIn()')
  })
  it('keeps source context actions provider-specific and folder playback scoped', () => {
    const view = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    expect(view).toContain('@contextmenu.prevent="openFileCardMenu($event, card.key)"')
    expect(view).toContain("{ id: 'endpoint', icon: RefreshCw }")
    expect(view).toContain("{ id: 'removeFavoriteFolder', icon: Star }")
    expect(view).toContain('addRegistryView.value?.deleteServer(key.slice(7))')
    expect(view).toContain('videoView.value?.playFolder(folder.id')
    expect(view).toContain("source-context-menu button')?.focus()")
    const library = readFileSync(resolve(process.cwd(), 'src/components/MediaLibrary.vue'), 'utf8')
    expect(library).toContain('!folderId || item.folderId === folderId')
  })
  it('distinguishes local, cloud and mixed-source media', () => {
    expect(hasLocalMedia(item([file('local')]))).toBe(true)
    expect(hasLocalMedia(item([file('aliyun')]))).toBe(false)
    expect(hasLocalMedia(item([file('aliyun'), file('local')]))).toBe(true)
    expect(hasLocalMedia(item([]))).toBe(false)
  })
  it('includes local episodes without treating cloud-only series as local', () => {
    const series = item([])
    series.seasons = [{ episodes: [{ driveFiles: [file('local')] }] }] as MediaLibraryItem['seasons']
    expect(hasLocalMedia(series)).toBe(true)
    series.seasons![0].episodes![0].driveFiles = [file('aliyun')]
    expect(hasLocalMedia(series)).toBe(false)
  })
  it.each(['views/UnifiedMediaLibraryView.vue', 'views/MediaLibraryView.vue', 'components/MediaLibrary.vue', 'views/MediaServerWorkspace.vue', 'components/MediaEmptyFolder.vue', 'components/MediaPanRight.vue', 'components/media-server/MediaServerRegistryPanel.vue'])('compiles the category controls in %s', path => {
    const source = readFileSync(resolve(process.cwd(), 'src', path), 'utf8')
    const { descriptor, errors } = parse(source)
    expect(errors).toEqual([])
    const script = compileScript(descriptor, { id: path })
    const template = compileTemplate({ source: descriptor.template!.content, filename: path, id: path, compilerOptions: { bindingMetadata: script.bindings } })
    expect(template.errors).toEqual([])
  })
  it('keeps category actions connected to selection, playback and home preferences', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    for (const action of ["playBrowse('play')", "playBrowse('loop')", "playBrowse('shuffle')", 'hideCurrentHomeMenu', 'renameCurrentHomeMenu', 'browseSelection = !browseSelection']) expect(source).toContain(action)
    const library = readFileSync(resolve(process.cwd(), 'src/components/MediaLibrary.vue'), 'utf8')
    expect(library).toContain('selectedBrowseIds.value.includes(item.id)')
    expect(library).toContain('sort: props.browseSort ? compareBrowseItems : undefined')
    expect(library).toContain("playlistLoop: mode === 'loop'")
  })
  it('right-aligns the action menu and separates icons from text', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    expect(source).toContain('v-if="!detailPageVisible && !isLibrarySettingsPage" class="unified-toolbar"')
    expect(source).toContain(`v-else-if="!['home', 'music', 'book'].includes(section) && !isLibrarySettingsPage" trigger="click" position="br"`)
    const options = [...source.matchAll(/<a-doption\b[^>]*class="unified-action-option(?: server-root-option)?"[^>]*>(.*?)<\/a-doption>/gs)]
    expect(options.length).toBe(source.match(/class="unified-action-option(?: server-root-option)?"/g)?.length)
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) expect(option[1]).toContain('<template #icon>')
    expect(source).toContain('<template #icon><ListFilter :size="14" /></template>')
    expect(source).toContain('min-width:190px')
  })
  it('uses one combined category index and limits its toolbar', () => {
    const view = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    expect(view).toContain("(isCategoryPage || isServerRootPage || isFolderPage || section === 'files') && !isGenreIndexPage")
    expect(view.match(/v-if="!isGenreIndexPage" class="unified-action-option"/g)).toHaveLength(4)
    const library = readFileSync(resolve(process.cwd(), 'src/components/MediaLibrary.vue'), 'utf8')
    expect(library).toContain("['genres', 'years', 'ratings'].flatMap(getCategoryGroups)")
    expect(library).toContain('props.unifiedBrowse && localFileForMedia(item)')
    expect(library).toContain('height: 230px')
  })
  it('opens user favorite media instead of home shortcut cards', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    expect(source).toContain("if (id === 'sources') { showCatalog('favorites'); return }")
    expect(source).toContain("if (id === 'sources') return isCatalogPage.value && selectedHomeRowKey.value === 'catalog:favorites'")
  })
  it('shows only the home collection title for server categories', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    expect(source).toContain('(serverCategorySubtitle || title)')
    expect(source).not.toContain('class="server-category-subtitle"')
  })
  it('keeps the music sidebar entry without nested navigation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    expect(source).toContain("if (route === 'music' || route === 'books') { app.mediaLibrarySection = route === 'books' ? 'book' : 'music'; return }")
    expect(source).toContain('v-for="card in libraryShortcutCards"')
    expect(source).toContain('@click="card.action()"')
    expect(source).not.toContain('v-for="item in musicTabs"')
    expect(source).not.toContain('selectMusicTab')
  })
  it('keeps favorite shortcuts and library index independent of media posters', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    expect(source).toContain('v-for="card in favoritePageCards"')
    expect(source).toContain('data-testid="library-settings"')
    expect(source).not.toContain('v-for="item in bookTabs"')
    expect(source).toContain('v-for="stat in libraryStatistics"')
    expect(source).toContain('toggleLibrarySource(source.key')
    expect(source).toContain("action: () => showCatalog('library')")
    expect(source).toContain('const visibleSourceCards = computed(')
    expect(source).toContain("key: 'source:video'")
    expect(source).toContain('!homePreferences.hidden.includes(card.key)')
    expect(source).toContain('@click="card.action"')
    expect(source).toContain('grid-template-columns:repeat(8,minmax(0,1fr))')
    expect(source).toContain("{ key: 'library', title: t('media.library'), icon: GalleryVerticalEnd, action: () => showCatalog() }")
    expect(source).toContain('v-for="card in libraryShortcutCards"')
    expect(source).toContain("selectedHomeRowKey === 'library-index'")
  })
  it('isolates plain server posters from the global glass card theme', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/MediaServerWorkspace.vue'), 'utf8')
    expect(source).toContain('#xbybody .media-server-workspace.unified-server-category .unified-listing .library-card')
    expect(source).toContain('background: transparent !important;')
    expect(source).toContain('border-radius: 12px !important;')
    expect(source).toContain('font-size: 13px !important;')
    expect(source).toContain('.listing-overlay-badge { display: none !important; }')
    expect(source).toContain('gap: 22px 20px;')
  })
})

describe('local file presentation', () => {
  it('compiles the shared local file card', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/LocalMediaFileCard.vue'), 'utf8')
    const { descriptor } = parse(source)
    const script = compileScript(descriptor, { id: 'local-file' })
    const result = compileTemplate({ source: descriptor.template!.content, filename: 'LocalMediaFileCard.vue', id: 'local-file', compilerOptions: { bindingMetadata: script.bindings } })
    expect(result.errors).toEqual([])
    expect(source).toContain('object-position:center')
    expect(source).toContain('mediaServer.markWatched')
  })
  it('shares local cards between category and folder entrances, including mixed categories', () => {
    const library = readFileSync(resolve(process.cwd(), 'src/components/MediaLibrary.vue'), 'utf8')
    const folder = readFileSync(resolve(process.cwd(), 'src/components/MediaPanRight.vue'), 'utf8')
    expect(library.match(/<LocalMediaFileCard/g)?.length).toBe(3)
    expect(folder).toContain('<LocalMediaFileCard')
    expect(library).toContain('props.unifiedBrowse && localFileForMedia(item)')
    const wrapper = readFileSync(resolve(process.cwd(), 'src/views/MediaLibraryView.vue'), 'utf8')
    expect(wrapper).toContain('computed, watch, onMounted')
    expect(wrapper).toContain('browseContextChange')
  })
})

describe('local watched indicator', () => {
  it('hides the corner and shows the orange watched button from the same watched prop', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/LocalMediaFileCard.vue'), 'utf8')
    expect(source).toContain('<WatchedIndicator v-if="!directory" corner :watched="!!watched" />')
    const indicator = readFileSync(resolve(process.cwd(), 'src/components/WatchedIndicator.vue'), 'utf8')
    expect(indicator).toContain('v-if="corner && !watched"')
    expect(indicator).toContain('clip-path:polygon(0 0,100% 0,100% 100%)')
    const row = readFileSync(resolve(process.cwd(), 'src/components/UnifiedMediaRow.vue'), 'utf8')
    expect(row).toContain("row.key !== 'resume' && card.posterMenu")
    expect(source).toContain("{ 'is-watched': watched }")
    expect(source).toContain("t(watched ? 'unified.watched' : 'mediaServer.markWatched')")
    expect(source).toContain('.local-file-watched.is-watched{background:#ff8800;color:#fff}')
  })
})

describe('watched controls across posters', () => {
  it('compiles shared indicator, server listings and homepage posters', () => {
    for (const path of ['src/components/WatchedIndicator.vue', 'src/views/MediaServerWorkspace.vue', 'src/components/media-server/home/MediaServerPosterRow.vue']) {
      const { descriptor } = parse(readFileSync(resolve(process.cwd(), path), 'utf8'))
      const script = compileScript(descriptor, { id: path })
      expect(compileTemplate({ source: descriptor.template!.content, filename: path, id: path, compilerOptions: { bindingMetadata: script.bindings } }).errors).toEqual([])
    }
  })
  it('refreshes the active server listing after a successful watched request', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/MediaServerWorkspace.vue'), 'utf8')
    expect(source).toContain('item.isPlayed = !wasPlayed')
    expect(source).toContain("currentRoute.value.kind === 'collection-page' ? loadCurrentCollection(true) : loadCurrentLibrary(true)")
    expect(source).toContain('watchedPending.value.has(item.id)')
    expect(source).toContain(`@toggle="handleHomeMediaAction(item, 'watched')"`)
  })
})

 describe('custom media series', () => {
 it('compiles the series editor', () => {
 const source = readFileSync(resolve(process.cwd(), 'src/components/CustomMediaSeriesModal.vue'), 'utf8');
 const descriptor = parse(source).descriptor; const script = compileScript(descriptor, { id: 'series-editor' });
 expect(compileTemplate({ source: descriptor.template!.content, filename: 'CustomMediaSeriesModal.vue', id: 'series-editor', compilerOptions: { bindingMetadata: script.bindings } }).errors).toEqual([])
 })
 it('toggles membership independently for different servers', async () => {
 const { toggleSeriesMember } = await import('../customMediaSeries');
 const a = { id: 'same', title: 'A', serverId: 'server-a' }; const b = { id: 'same', title: 'B', serverId: 'server-b' };
 let group: import('../customMediaSeries').CustomMediaSeries = { id: 'group', title: 'Test', members: [a] };
 group = toggleSeriesMember(group, b); expect(group.members).toHaveLength(2);
 group = toggleSeriesMember(group, a); expect(group.members).toEqual([b]);
 })
 })

describe('poster menu variants', () => {
 it('keeps the four reference orders distinct', async () => {
 const { mediaPosterActions } = await import('../mediaPosterMenu');
 expect(mediaPosterActions(true,true)).toEqual(['play','loop','shuffle','rating','favorite','refresh','watched','playlist','delete']);
 expect(mediaPosterActions(true,false)).toEqual(['play','loop','rating','share','download','refresh','watched','favorite','playlist','delete']);
 expect(mediaPosterActions(false,true)).toEqual(['play','loop','shuffle','select','rating','watched','continue','playlist','series','delete']);
 expect(mediaPosterActions(false,false)).toEqual(['play','loop','select','rating','share','download','metadata','watched','continue','playlist','series','delete']);
 });
 it('compiles the shared menu', () => { const path='src/components/MediaPosterMenu.vue'; const {descriptor}=parse(readFileSync(resolve(process.cwd(),path),'utf8')); const script=compileScript(descriptor,{id:path}); expect(compileTemplate({source:descriptor.template!.content,filename:path,id:path,compilerOptions:{bindingMetadata:script.bindings}}).errors).toEqual([]) });
})

describe('homepage video poster menus', () => {
 it('compiles video-only menu bindings', () => { const path='src/components/UnifiedMediaRow.vue'; const source=readFileSync(resolve(process.cwd(),path),'utf8'); const {descriptor}=parse(source); const script=compileScript(descriptor,{id:path}); expect(compileTemplate({source:descriptor.template!.content,filename:path,id:path,compilerOptions:{bindingMetadata:script.bindings}}).errors).toEqual([]); expect(source).toContain('if (!card.posterMenu) { card.action(); return }'); expect(source).toContain('if (!card.posterMenu) return'); expect(source).toContain('@dblclick.stop="openMenu($event, card)"'); expect(source).toContain('@contextmenu="openMenu($event, card)"'); });
})
