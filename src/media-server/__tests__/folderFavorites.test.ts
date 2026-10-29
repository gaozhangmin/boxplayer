import { afterEach, expect, it, vi } from 'vitest'
import type { MediaServerConfig } from '../../types/mediaServer'
import type { MediaServerCardItem } from '../../types/mediaServerContent'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
it('persists ordinary folders and whole-server shortcuts separately for each account', async () => {
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) || null, setItem: (key: string, value: string) => saved.set(key, value) })
  const { rememberServerFolderFavorite, serverFolderFavorites } = await import('../folderFavorites')
  const server = { id: 'server', userId: 'first', type: 'emby' } as MediaServerConfig
  const folder = { id: 'folder', serverId: 'server', provider: 'emby', kind: 'folder', title: 'Movies' } as MediaServerCardItem
  rememberServerFolderFavorite(server, folder, true)
  rememberServerFolderFavorite(server, { ...folder, id: '__all__' }, true)
  rememberServerFolderFavorite({ ...server, userId: 'second' }, folder, true)
  rememberServerFolderFavorite(server, folder, false)
  expect(serverFolderFavorites.value.map(f => [f.userId, f.item.id])).toEqual([['first', '__all__'], ['second', 'folder']])
  vi.resetModules()
  const restored = await import('../folderFavorites')
  expect(restored.serverFolderFavorites.value.map(f => [f.userId, f.item.id])).toEqual([['first', '__all__'], ['second', 'folder']])
})
