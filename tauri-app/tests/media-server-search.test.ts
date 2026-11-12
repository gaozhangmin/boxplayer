import { beforeEach, expect, it, vi } from 'vitest'
import { mediaServer } from '@/features/sources/mediaServer'
import { plex } from '@/features/sources/plex'
import { json } from '@/features/sources/transport'
import type { Account } from '@/features/sources/contracts'
vi.mock('@/features/sources/transport', async original => ({ ...await original<typeof import('@/features/sources/transport')>(), json: vi.fn() }))
const account = (providerId: Account['providerId']): Account => ({ id: `${providerId}-a`, providerId, name: providerId, userId: 'user/a', baseUrl: `https://${providerId}.test/prefix`, authOrigins: [`https://${providerId}.test`] })
beforeEach(() => vi.clearAllMocks())
it.each(['jellyfin', 'emby'] as const)('%s search preserves account, user, query and pagination', async provider => {
  const owner = account(provider)
  vi.mocked(json).mockResolvedValueOnce({ Items: [{ Id: 'series', Name: 'A & B', Type: 'Series' }, { Id: 'movie', Name: 'Film', Type: 'Movie', UserData: { IsFavorite: true } }], TotalRecordCount: 5 }).mockResolvedValueOnce({ Items: [], TotalRecordCount: 5 })
  const first = await mediaServer.search!(owner, '  A & B  ')
  expect(first.entries[0]).toMatchObject({ id: 'series', isDirectory: true, playable: false });expect(first.entries[1]).toMatchObject({ playable: true, favorite: true });expect(first.nextCursor).toBe('2')
  const request = vi.mocked(json).mock.calls[0]!;expect(request[0]).toBe(owner);const url = new URL(request[2]);expect(url.pathname).toBe('/prefix/Users/user%2Fa/Items');expect(url.searchParams.get('SearchTerm')).toBe('A & B');expect(url.searchParams.get('Recursive')).toBe('true')
  expect((await mediaServer.search!(owner, 'A & B', first.nextCursor)).nextCursor).toBeUndefined()
  expect(new URL(vi.mocked(json).mock.calls[1]![2]).searchParams.get('StartIndex')).toBe('2')
})
it('Plex search flattens local hubs, deduplicates rating keys, and disables external media', async () => {
  const owner = account('plex')
  vi.mocked(json).mockResolvedValueOnce({ MediaContainer: { Hub: [{ Metadata: [{ ratingKey: 'movie', title: 'Film', type: 'movie' }] }, { Metadata: [{ ratingKey: 'movie', title: 'Film', type: 'movie' }, { ratingKey: 'series', title: 'Shows', type: 'show' }] }] } })
  const result = await plex.search!(owner, ' Film ')
  expect(result.entries.map(item => item.id)).toEqual(['movie', 'series']);expect(result.entries[1]!.isDirectory).toBe(true)
  const url = new URL(vi.mocked(json).mock.calls[0]![2]);expect(url.pathname).toBe('/prefix/hubs/search');expect(url.searchParams.get('query')).toBe('Film');expect(url.searchParams.get('includeExternalMedia')).toBe('0');expect(result.nextCursor).toBeUndefined()
})
it('empty searches do not make requests and malformed or invalid pages fail visibly', async () => {
  expect(await mediaServer.search!(account('emby'), ' ')).toEqual({ entries: [] });expect(await plex.search!(account('plex'), '')).toEqual({ entries: [] });expect(json).not.toHaveBeenCalled()
  await expect(mediaServer.search!(account('jellyfin'), 'film', '-1')).rejects.toThrow('分页')
  vi.mocked(json).mockResolvedValueOnce({ error: 'permission' });await expect(mediaServer.search!(account('emby'), 'film')).rejects.toThrow('响应无效')
})
