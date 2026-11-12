import { beforeEach, expect, it, vi } from 'vitest'
import { guangya } from '@/features/sources/guangya'
import { json, request } from '@/features/sources/transport'
import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import type { Account } from '@/features/sources/contracts'
vi.mock('@/features/sources/transport', async original => ({ ...await original<typeof import('@/features/sources/transport')>(), json: vi.fn(), request: vi.fn() }))
const account: Account = { id: 'guangya-a', providerId: 'guangya', name: '光鸭', baseUrl: 'https://api.guangyapan.com', authOrigins: ['https://api.guangyapan.com'] }
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(() => {vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]})
it('preserves zero-based pagination and distinguishes resType from ambiguous dirType', async () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ fileId: `file-${i}`, name: `clip-${i}.mkv`, dirType: 1, resType: 1, fileSize: 42 }))
  vi.mocked(request).mockResolvedValueOnce(response({ code: 0, data: { fileList: items } })).mockResolvedValueOnce(response({ data: { list: [{ resId: 'folder', dirName: 'Films', resType: 2 }] } }))
  const first = await guangya.list(account, 'guangya_root')
  expect(JSON.parse(first.nextCursor!)).toMatchObject({page:1,parent:''})
  expect(first.entries[0]).toMatchObject({ id: 'file-0', isDirectory: false, playable: true, size: 42 })
  expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!)).toEqual({ parentId: '', page: 0, pageSize: 100, orderBy: 0, sortType: 0 })
  const second = await guangya.list(account, '', first.nextCursor)
  expect(second.nextCursor).toBeUndefined()
  expect(second.entries[0]).toMatchObject({ id: 'folder', name: 'Films', isDirectory: true, playable: false })
  expect(JSON.parse(vi.mocked(request).mock.calls[1]![3]!)).toMatchObject({parentId:'',page:1})
})
it('binds download to the owning account and preserves signed URL and playback headers', async () => {
  vi.mocked(json).mockResolvedValueOnce({ code: 0, data: { signedURL: 'https://cdn.test/movie?signature=synthetic' } })
  const entry = { id: 'video', name: 'movie.mkv', size: 42, isDirectory: false, playable: true }
  const media = await guangya.resolve(account, entry)
  expect(json).toHaveBeenCalledWith(account, 'POST', 'https://api.guangyapan.com/nd.bizuserres.s/v1/get_res_download_url', { fileId: 'video' })
  expect(media).toEqual({ schemaVersion: 1, sourceId: account.id, accountId: account.id, fileId: 'video', url: 'https://cdn.test/movie?signature=synthetic', headers: { Referer: 'https://www.guangyapan.com/', Origin: 'https://www.guangyapan.com' } })
})
it('rejects business failures, invalid cursors, provider mismatches and credential-bearing links', async () => {
  await expect(guangya.list(account, '', '-1')).rejects.toThrow('游标')
  await expect(guangya.list({ ...account, providerId: '139' }, '')).rejects.toThrow('来源不匹配')
  expect(json).not.toHaveBeenCalled()
  vi.mocked(request).mockResolvedValueOnce(response({ code: 401, message: 'synthetic' }))
  await expect(guangya.list(account, '')).rejects.toThrow('未确认成功')
  vi.mocked(json).mockResolvedValueOnce({ data: { url: 'https://user:password@cdn.test/video' } })
  await expect(guangya.resolve(account, { id: 'video', name: 'video.mp4', isDirectory: false, size: 0, playable: true })).rejects.toThrow('地址无效')
})
