import { beforeEach, expect, it, vi } from 'vitest'
import { pikpak } from '@/features/sources/pikpak'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import { json,request } from '@/features/sources/transport'
import { nativeCall } from '@/platform/native'
import type { Account } from '@/features/sources/contracts'
vi.mock('@/features/sources/transport', async original => ({ ...await original<typeof import('@/features/sources/transport')>(), json: vi.fn(),request:vi.fn() }))
vi.mock('@/platform/native', () => ({ nativeCall: vi.fn() }))
const account: Account = { id: 'pikpak-a', providerId: 'pikpak', name: 'PikPak', baseUrl: 'https://api-drive.mypikpak.com', authOrigins: ['https://api-drive.mypikpak.com', 'https://user.mypikpak.com'] }
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(() => {vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]})
it('preserves opaque page tokens and filters while mapping folder and file kinds', async () => {
  vi.mocked(request).mockResolvedValueOnce(response({ files: [{ id: 'folder', name: 'Films', kind: 'drive#folder' }, { id: 'video', name: 'clip.mkv', kind: 'drive#file', size: '42' }], next_page_token: 'next+/=' })).mockResolvedValueOnce(response({ files: [] })).mockResolvedValueOnce(response({files:[]}))
  const first = await pikpak.list(account, 'pikpak_root')
  expect(first.entries[0]).toMatchObject({ isDirectory: true, playable: false })
  expect(first.entries[1]).toMatchObject({ id: 'video', size: 42, playable: true })
  const root = new URL(vi.mocked(request).mock.calls[0]![2]);expect(root.searchParams.has('parent_id')).toBe(false)
  expect(JSON.parse(root.searchParams.get('filters')!)).toEqual({ trashed: { eq: false }, phase: { eq: 'PHASE_TYPE_COMPLETE' } })
  const second = await pikpak.list(account, 'pikpak_root', first.nextCursor)
  const page = new URL(vi.mocked(request).mock.calls[1]![2]);expect(page.searchParams.get('page_token')).toBe('next+/=');expect(page.searchParams.has('parent_id')).toBe(false);expect(second.nextCursor).toBeUndefined();await pikpak.list(account,'folder');expect(new URL(vi.mocked(request).mock.calls[2]![2]).searchParams.get('parent_id')).toBe('folder')
})
it('uses owning account protected resolution and never exchanges captcha or tokens in the WebView', async () => {
  const handle = { schemaVersion: 1, sourceId: account.id, accountId: account.id, fileId: 'video', url: 'boxplayer-prepared:synthetic', headers: {} }
  vi.mocked(nativeCall).mockResolvedValueOnce(handle)
  expect(await pikpak.resolve(account, { id: 'video', name: 'film.mp4', isDirectory: false, size: 0, playable: true })).toEqual(handle)
  expect(nativeCall).toHaveBeenCalledWith('resolve_protected_media', { accountId: account.id, fileId: 'video' })
  expect(request).not.toHaveBeenCalled()
})
it('rejects malformed results and cross-provider calls', async () => {
  vi.mocked(request).mockResolvedValueOnce(response({ error: 'invalid_grant' }))
  await expect(pikpak.list(account, '')).rejects.toThrow('invalid_grant')
  vi.mocked(request).mockClear()
  await expect(pikpak.list({ ...account, providerId: '139' }, '')).rejects.toThrow('不匹配')
  expect(request).not.toHaveBeenCalled()
})
