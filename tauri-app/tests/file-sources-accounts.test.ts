import { expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { useFileSourcesStore } from '@/stores/fileSources'
import { buildFileSidebarEntries } from '@/features/files/sidebar'
vi.mock('@/platform/native', () => ({ isNative: () => true, localSources: vi.fn(async () => [{ id: 'local', name: 'Films' }]) }))
vi.mock('@/features/sources/transport', () => ({ accountsList: vi.fn(async () => [
  { id: 'drive', providerId: 'onedrive', name: 'Drive' }, { id: 'server', providerId: 'jellyfin', name: 'Jellyfin' }, { id: 'boxplayer', providerId: 'boxplayer', name: 'Account' },
]) }))
it('keeps server identity separate while rendering a flat unified files hierarchy', async () => {
  const store = useFileSourcesStore(createPinia());await store.refresh()
  expect(store.snapshot.drives.map(source => source.id)).toEqual(['drive']);expect(store.snapshot.mediaServers.map(source => source.id)).toEqual(['server'])
  expect(buildFileSidebarEntries(store.snapshot, 'URL').map(entry => [entry.title, entry.kind])).toEqual([['Drive', 'drive'], ['Films', 'localFolder'], ['Jellyfin', 'mediaServer']])
})
