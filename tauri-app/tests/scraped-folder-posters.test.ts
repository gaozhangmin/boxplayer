import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FileBrowser from '@/features/files/FileBrowser.vue'
import FileBrowserCard from '@/features/files/electron/FileBrowserCard.vue'
import { buildFileSidebarEntries } from '@/features/files/sidebar'
import { cachedArtwork } from '@/features/library/artworkCache'
import { driver } from '@/features/sources/drivers'
import type { Account, SourceEntry } from '@/features/sources/contracts'
import { nativeCall } from '@/platform/native'
import { useFileSourcesStore } from '@/stores/fileSources'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
vi.mock('@/features/sources/drivers', () => ({ driver: vi.fn(), playSource: vi.fn() }))
vi.mock('@/platform/native', async original => ({
  ...await original<typeof import('@/platform/native')>(), isNative: () => true, nativeCall: vi.fn(),
}))

const account = { id: 'aliyun-account', providerId: 'aliyun' as const, name: '阿里云盘', baseUrl: '', authOrigins: [] }
const location = (fileId: string) => JSON.stringify({ driveId: 'resource-drive', fileId })
const root = location('root')
const show = location('show')
const season = location('season')
const episode = location('episode')
const plain = location('plain')
const poster = 'https://api.boxplayer.cc/api/tmdb/image/w500/scraped.jpg'
const folder = (id: string, name: string): SourceEntry => ({ id, name, isDirectory: true, size: 0, playable: false })
const entries = new Map<string, SourceEntry[]>([
  [root, [folder(show, '剧集文件夹'), folder(plain, '普通文件夹')]],
  [show, [folder(season, '第 2 季')]],
  [season, [{ id: episode, name: 'S02E01.mkv', isDirectory: false, size: 1024, playable: true }]],
])

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe() { this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
    disconnect() {}
  })
  vi.mocked(nativeCall).mockImplementation(async command => {
    if (command === 'transfer_snapshot') return { sequence: 0, config: { revision: 0 }, uploads: [], downloads: [] }
    if (command === 'catalog_load') return {
      schemaVersion: 1, revision: 0, playlists: {}, series: {}, items: [{
        id: 'episode', sourceId: account.id, fileId: episode, fileName: 'S02E01.mkv', name: '刮削剧名', type: 'tv',
        local: false, addedAt: '2026-11-28', genres: [], size: 1024, poster, folderPath: season, folderAncestors: [root, show, season],
      }],
    }
    return undefined
  })
})
afterEach(() => vi.unstubAllGlobals())

it.each(['grid', 'list'])('renders catalog posters and keeps folder navigation from Files in %s mode', async mode => {
  localStorage.setItem('MediaLibrary_BrowseMode', mode)
  const pinia = createPinia()
  const sources = useFileSourcesStore(pinia)
  sources.accounts = [account]
  sources.replaceSnapshot({
    localFolders: [], mediaServers: [], hasDirectURLs: false,
    drives: [{ id: account.id, name: account.name, kind: 'remote', favorites: [] }],
  })
  sources.bookmark(account.id, root, '资源盘', false)
  const list = vi.fn(async (_account: Account, path: string) => ({ entries: entries.get(path) || [] }))
  vi.mocked(driver).mockReturnValue({ list, resolve: vi.fn() })
  const wrapper = mount(FileBrowser, { global: { plugins: [pinia] } })
  await flushPromises()
  const favoriteCard = wrapper.findAll('.file-source-card').find(card => card.text() === '资源盘')!
  await favoriteCard.trigger('click')
  const favoriteId = JSON.stringify([account.id, root])
  expect(wrapper.emitted('openFolder')).toEqual([[{ sourceId: account.id, path: root, local: false, favoriteId }]])

  const source = buildFileSidebarEntries(sources.snapshot, '').find(entry => entry.favoriteId === favoriteId)!
  await wrapper.setProps({ source })
  await flushPromises()
  const showCard = wrapper.get('button[aria-label="剧集文件夹"]')
  expect(showCard.get('img').attributes('src')).toBe(cachedArtwork(poster))
  expect(wrapper.get('button[aria-label="普通文件夹"]').find('img').exists()).toBe(false)

  await showCard.trigger('click')
  await flushPromises()
  expect(list.mock.calls.at(-1)?.[1]).toBe(show)
  const seasonCard = wrapper.get('button[aria-label="第 2 季"]')
  expect(seasonCard.get('img').attributes('src')).toBe(cachedArtwork(poster))
  await seasonCard.trigger('click')
  await flushPromises()
  expect(list.mock.calls.at(-1)?.[1]).toBe(season)
  const videoCard = wrapper.get('button[aria-label="刮削剧名"]')
  expect(videoCard.get('img').attributes('src')).toBe(cachedArtwork(poster))
  expect(videoCard.classes().includes('folder-browser-card-list')).toBe(mode === 'list')
  expect(vi.mocked(nativeCall).mock.calls.some(([command]) => ['source_artwork', 'source_thumbnail', 'player_open_catalog_queue'].includes(command))).toBe(false)
  await videoCard.trigger('click')
  await flushPromises()
  expect(nativeCall).toHaveBeenCalledWith('player_open_catalog_queue', {
    entries: [expect.objectContaining({ sourceId: account.id, fileId: episode })], index: 0, loopPlayback: false,
  })
})

it('uses the provider thumbnail if the catalog poster fails', async () => {
  const thumbnail = 'data:image/png;base64,dGh1bWJuYWls'
  const card = mount(FileBrowserCard, { props: { name: 'video.mkv', directory: false, poster, thumbnail } })
  expect(card.get('img').attributes('src')).toBe(poster)
  await card.get('img').trigger('error')
  expect(card.get('img').attributes('src')).toBe(thumbnail)
})
