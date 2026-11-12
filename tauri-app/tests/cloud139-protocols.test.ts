import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import { beforeEach, expect, it, vi } from 'vitest'
import { cloud139, personalUrls } from '@/features/sources/cloud139'
import { json } from '@/features/sources/transport'
import type { Account } from '@/features/sources/contracts'
vi.mock('@/features/sources/transport', async original => ({ ...await original<typeof import('@/features/sources/transport')>(), json: vi.fn() }))
const account: Account = { id: '139-a', providerId: '139', name: '移动云盘', userId: 'synthetic-subject', baseUrl: 'https://personal-kd-njs.yun.139.com/hcy', authOrigins: ['https://personal-kd-njs.yun.139.com', 'https://yun.139.com'] }
beforeEach(() => {vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]})
it('uses routed hcy paths and preserves opaque page tokens without repeating the last cursor', async () => {
  expect(personalUrls(account.baseUrl, '/file/list')).toEqual(['https://personal-kd-njs.yun.139.com/hcy/file/list', 'https://personal-kd-njs.yun.139.com/orchestration/file/list'])
  vi.mocked(json).mockResolvedValueOnce({ success: true, data: { items: [{ fileId: 'folder', name: '电影', type: 'folder' }], pageInfo: { nextPageCursor: 'opaque+/=' } } }).mockResolvedValueOnce({ data: { items: [], pageInfo: { nextPageCursor: 'opaque+/=' } } })
  const first = await cloud139.list(account, '');expect(first.entries[0]).toMatchObject({ id: 'folder', isDirectory: true, playable: false })
  await expect(cloud139.list(account, '/', first.nextCursor)).rejects.toThrow('游标重复')
  expect(json).toHaveBeenNthCalledWith(2, account, 'POST', 'https://personal-kd-njs.yun.139.com/hcy/file/list', expect.objectContaining({ parentFileId: '/', pageInfo: { pageSize: 100, pageCursor: 'opaque+/=' } }))
})
it('falls back only for missing routes and paginates the legacy endpoint', async () => {
  vi.mocked(json).mockRejectedValueOnce(new Error('来源请求失败（404）')).mockRejectedValueOnce(new Error('来源请求失败（404）')).mockResolvedValueOnce({ data: { getDiskResult: { catalogList: [], contentList: Array.from({ length: 100 }, (_, i) => ({ contentID: String(i + 1), contentName: 'clip.mp4' })) } } }).mockResolvedValueOnce({ data: { getDiskResult: { catalogList: [], contentList: [] } } })
  const first = await cloud139.list(account, '/');expect(first.entries).toHaveLength(100)
  expect(first.entries[0]).toMatchObject({ isDirectory: false, playable: true })
  const second = await cloud139.list(account, '/', first.nextCursor);expect(second.nextCursor).toBeUndefined()
  expect(json).toHaveBeenNthCalledWith(4, account, 'POST', 'https://yun.139.com/orchestration/personalCloud/catalog/v1.0/getDisk', expect.objectContaining({ catalogID: 'root', startNumber: 101, endNumber: 200, commonAccountInfo: { account: 'synthetic-subject', accountType: 1 } }))
  vi.mocked(json).mockClear();vi.mocked(json).mockResolvedValueOnce({ success: false, code: '9008' })
  await expect(cloud139.list(account, '')).rejects.toThrow('请求失败');expect(json).toHaveBeenCalledTimes(1)
})
it('preserves owning account and provider playback headers for download links', async () => {
  vi.mocked(json).mockResolvedValueOnce({ data: { cdnUrl: 'https://cdn.test/video?signature=synthetic' } })
  const media = await cloud139.resolve(account, { id: 'video', name: 'video.mp4', isDirectory: false, size: 0, playable: true })
  expect(media).toMatchObject({ sourceId: account.id, accountId: account.id, fileId: 'video', url: 'https://cdn.test/video?signature=synthetic', headers: { Referer: 'https://yun.139.com/', Origin: 'https://yun.139.com' } })
})
