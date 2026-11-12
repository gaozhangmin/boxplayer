import { beforeEach, expect, it, vi } from 'vitest'
import { createServerPlaylist, deleteServerMedia, deleteServerPlaylist, listServerPlaylists, setServerPlaylistMembership } from '@/features/sources/playlists'
import { mediaServer } from '@/features/sources/mediaServer'
import { plex } from '@/features/sources/plex'
import { json, request } from '@/features/sources/transport'
import type { Account } from '@/features/sources/contracts'
vi.mock('@/features/sources/transport', async original => ({ ...await original<typeof import('@/features/sources/transport')>(), json: vi.fn(), request: vi.fn(async () => ({ status: 204, headers: {}, body: [], finalUrl: '' })) }))
const owner = (providerId: Account['providerId']): Account => ({ id: providerId + '-a', providerId, userId: 'user', name: providerId, baseUrl: `https://${providerId}.test/prefix`, authOrigins: [`https://${providerId}.test`] })
beforeEach(() => vi.clearAllMocks())
it('Jellyfin creates a private playlist with JSON; Emby uses its query protocol', async () => {
  const jellyfin = owner('jellyfin');await createServerPlaylist(jellyfin, ' Films ', 'video/a')
  expect(request).toHaveBeenLastCalledWith(jellyfin, 'POST', 'https://jellyfin.test/prefix/Playlists', JSON.stringify({ Name: 'Films', UserId: 'user', Ids: ['video/a'], MediaType: 'Video', IsPublic: false }), { 'Content-Type': 'application/json' })
  const emby = owner('emby');await createServerPlaylist(emby, 'Films', 'video/a')
  const call = vi.mocked(request).mock.calls.at(-1)!;expect(call[0]).toBe(emby);expect(call[1]).toBe('POST');const url = new URL(call[2]);expect(url.searchParams.get('Ids')).toBe('video/a');expect(url.searchParams.get('UserId')).toBe('user')
})
it('Plex playlist URIs use its owning machine and membership uses playlist entry IDs', async () => {
  const account = owner('plex');vi.mocked(json).mockResolvedValueOnce({ MediaContainer: { machineIdentifier: 'machine-a' } })
  await createServerPlaylist(account, 'Films', 'video')
  expect(new URL(vi.mocked(request).mock.calls[0]![2]).searchParams.get('uri')).toBe('server://machine-a/com.plexapp.plugins.library/library/metadata/video')
  vi.mocked(json).mockResolvedValueOnce({ MediaContainer: { Metadata: [{ ratingKey: 'video', playlistItemID: 'entry-1' }, { ratingKey: 'video', playlistItemID: 'entry-2' }], totalSize: 2 } })
  await setServerPlaylistMembership(account, 'playlist:list/a', 'video', false)
  expect(vi.mocked(request).mock.calls.slice(1).map(call => [call[0].id, call[1], new URL(call[2]).pathname])).toEqual([['plex-a', 'DELETE', '/prefix/playlists/list%2Fa/items/entry-1'], ['plex-a', 'DELETE', '/prefix/playlists/list%2Fa/items/entry-2']])
})
it('Jellyfin removal uses PlaylistItemId and never media file IDs', async () => {
  const account = owner('jellyfin');vi.mocked(json).mockResolvedValueOnce({ Items: [{ Id: 'video', PlaylistItemId: 'membership' }], TotalRecordCount: 1 })
  await setServerPlaylistMembership(account, 'list', 'video', false)
  const url = new URL(vi.mocked(request).mock.calls[0]![2]);expect(url.searchParams.get('EntryIds')).toBe('membership');expect(url.searchParams.has('Ids')).toBe(false)
  vi.mocked(json).mockResolvedValueOnce({ Items: [{ Id: 'video' }], TotalRecordCount: 1 });vi.mocked(request).mockClear()
  await expect(setServerPlaylistMembership(account, 'list', 'video', false)).rejects.toThrow('条目 ID');expect(request).not.toHaveBeenCalled()
})
it('paginates playlists and browses playlist contents through the correct provider path', async () => {
  const account = owner('emby');vi.mocked(json).mockResolvedValueOnce({ Items: [{ Id: 'first', Name: 'First', ChildCount: 2 }], TotalRecordCount: 2 }).mockResolvedValueOnce({ Items: [{ Id: 'second', Name: 'Second' }], TotalRecordCount: 2 })
  expect((await listServerPlaylists(account)).map(list => list.id)).toEqual(['first', 'second']);expect(new URL(vi.mocked(json).mock.calls[1]![2]).searchParams.get('StartIndex')).toBe('1')
  vi.mocked(json).mockResolvedValueOnce({ Items: [{ Id: 'video', Name: 'Film', Type: 'Movie' }], TotalRecordCount: 1 })
  expect((await mediaServer.list(account, 'playlist:list/a')).entries[0]).toMatchObject({ id: 'video', playable: true })
  expect(new URL(vi.mocked(json).mock.calls[2]![2]).pathname).toBe('/prefix/Playlists/list%2Fa/Items')
  vi.mocked(json).mockResolvedValueOnce({ MediaContainer: { Metadata: [{ ratingKey: 'film', title: 'Film', type: 'movie' }], totalSize: 1 } })
  await plex.list(owner('plex'), 'playlist:list/a');expect(new URL(vi.mocked(json).mock.calls[3]![2]).pathname).toBe('/prefix/playlists/list%2Fa/items')
  vi.mocked(json).mockResolvedValueOnce({MediaContainer:{Metadata:[],totalSize:100}});expect((await plex.list(owner('plex'),'playlist:list/a')).nextCursor).toBeUndefined()
})
it.each(['jellyfin', 'emby', 'plex'] as const)('deletes only the selected %s target with the owning account', async provider => {
  const account = owner(provider);await deleteServerPlaylist(account, 'playlist:list/a');await deleteServerMedia(account, { id: 'film/a', name: 'Film', size: 0, isDirectory: false, playable: true })
  const paths = vi.mocked(request).mock.calls.map(call => { expect(call[0]).toBe(account);expect(call[1]).toBe('DELETE');return new URL(call[2]).pathname })
  expect(paths).toEqual(provider === 'plex' ? ['/prefix/playlists/list%2Fa', '/prefix/library/metadata/film%2Fa'] : ['/prefix/Items/list%2Fa', '/prefix/Items/film%2Fa'])
})
