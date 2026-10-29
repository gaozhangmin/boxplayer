import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useAppStore from '../../store/appstore'
import useMediaServerNavigationStore from '../../store/mediaServerNavigation'

vi.mock('../debuglog', () => ({ default: { aLoadFromDB: vi.fn() } }))
vi.mock('../keyboardhelper', () => ({ onHideRightMenu: vi.fn() }))

describe('unified media library navigation', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it.each([['media-server', 'server'], ['music', 'music'], ['book', 'book']])('redirects legacy %s entries to the media tab', (tab, section) => {
    const app = useAppStore()
    app.toggleTab(tab)
    expect(app.appTab).toBe('media')
    expect(app.mediaLibrarySection).toBe(section)
    app.resetTab(tab)
    expect(app.appTab).toBe('media')
    expect(app.mediaLibrarySection).toBe(section)
    app.toggleTabSetting(tab, 'legacy-menu')
    expect(app.appTab).toBe('media')
    app.toggleTabMenu(tab, 'legacy-menu')
    expect(app.appTab).toBe('media')
  })

  it('preserves ordinary tabs and the selected media section when returning', () => {
    const app = useAppStore()
    app.toggleTab('music')
    for (const tab of ['pan', 'search', 'ai-workspace', 'down', 'share', 'rss']) {
      app.toggleTab(tab)
      expect(app.appTab).toBe(tab)
    }
    app.toggleTab('media')
    expect(app.mediaLibrarySection).toBe('music')
  })

  it('does not cycle into removed top-level tabs', () => {
    const app = useAppStore()
    app.resetTab('media')
    app.toggleTabNext()
    expect(app.appTab).toBe('setting')
    app.toggleTabNext()
    expect(app.appTab).toBe('pan')
  })

  it('can return from a server item to the library root', () => {
    const navigation = useMediaServerNavigationStore()
    navigation.goLibraryRoot()
    navigation.push({ kind: 'item-detail', itemId: 'same-id', title: 'Title' })
    navigation.back()
    expect(navigation.currentRoute.kind).toBe('library-root')
  })

  it('renders one media tab while keeping cloud-drive sign-in and other tabs', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/layout/PageMain.vue'), 'utf8')
    expect(source).toContain('<UnifiedMediaLibraryView :nav-visible="mediaNavVisible" />')
    expect(source).toContain("labelKey: 'media.library'")
    for (const tab of ['media-server', 'music', 'book']) expect(source).not.toContain(`<a-tab-pane key='${tab}'`)
    for (const tab of ['pan', 'search', 'ai-workspace', 'down', 'share', 'rss', 'setting']) expect(source).toContain(`<a-tab-pane key='${tab}'`)
    expect(source).toContain('<UserLogin')
  })

  it('keeps source identity, folder import, cached sections and existing player actions', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    expect(source).toContain('toMsCacheUrl(item.serverId,')
    expect(source).toContain('key: `${item.serverId}:${item.id}`')
    expect(source).toContain('addRegistryView.value?.openAddServer()')
    expect(source).toContain('videoView.value?.showAddFolder()')
    const videoView = readFileSync(resolve(process.cwd(), 'src/views/MediaLibraryView.vue'), 'utf8')
    const videoNav = readFileSync(resolve(process.cwd(), 'src/components/MediaLibraryNav.vue'), 'utf8')
    expect(videoView).toContain('showAddFolder: () => mediaNav.value?.importLocalFolder()')
    expect(videoNav).toContain('importLocalFolder: handleImportLocalFolder')
    expect(source).toContain('confirmRemoveFavorite(() => media.removeFolder(folder.id))')
    expect(source).toContain('musicView.value?.playFromList(')
    expect(source).toContain('bookView.value?.openBook(item)')
    expect(source).toContain('music.loadFromDB()')
    expect(source).toContain('books.loadFromDB()')
    expect(source).toContain("collectionId: 'home:nextup'")
    expect(source).toContain('media.continueWatching')
    expect(source).toContain('KeepAlive')
    expect(source).not.toContain("v-show=\"section === 'book'\"")
    expect(source).toContain("more: () => showHomeRow('resume')")
    expect(source).toContain('window.removeEventListener(\'storage\', handleStorage)')
    expect(source).toContain('@open-server="useManagedServer"')
  })

  it('keeps consistent poster widths and image fallback isolated to library cards', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/UnifiedMediaRow.vue'), 'utf8')
    expect(source).toContain('repeat(auto-fill, 110px)')
    expect(source).toContain('.mode-list .media-card')
    expect(source).toContain('failedImages.has(card.image)')
    expect(source).toContain('button:focus-visible')
  })

  it('cannot fall back to the legacy library header or segmented view switcher', () => {
    const shell = readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8')
    const browser = readFileSync(resolve(process.cwd(), 'src/components/MediaLibrary.vue'), 'utf8')
    expect(shell).toContain(':unified-browse="true"')
    expect(shell).not.toMatch(/<VideoLibrary[^>]*:unified-browse="isCategoryPage"/)
    expect(browser).not.toContain('class="library-header"')
    expect(browser).not.toContain('class="view-toggle-pill"')
  })

  it('provides matching Chinese and English strings for the new library UI', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/i18n/index.ts'), 'utf8')
    const keys = [...readFileSync(resolve(process.cwd(), 'src/views/UnifiedMediaLibraryView.vue'), 'utf8').matchAll(/t\('(unified\.[^']+)'/g)].map(match => match[1])
    for (const key of new Set(keys)) expect(source.split(`'${key}':`)).toHaveLength(3)
  })
})
