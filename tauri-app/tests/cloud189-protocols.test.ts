import {createPinia,setActivePinia} from 'pinia'
import {useFileSourcesStore} from '@/stores/fileSources'
import { beforeEach, expect, it, vi } from 'vitest'
import { cloud189 } from '@/features/sources/cloud189'
import { json } from '@/features/sources/transport'
import type { Account } from '@/features/sources/contracts'
vi.mock('@/features/sources/transport', async original => ({ ...await original<typeof import('@/features/sources/transport')>(), json: vi.fn() }))
const account: Account = { id: '189-a', providerId: '189', name: '天翼', baseUrl: 'https://api.cloud.189.cn', authOrigins: ['https://api.cloud.189.cn'] }
beforeEach(() => {vi.resetAllMocks();setActivePinia(createPinia());useFileSourcesStore().accounts=[account]})
it('keeps personal/family IDs distinct across browsing and resolution', async () => {
  const roots = await cloud189.list(account, '');expect(json).not.toHaveBeenCalled()
  vi.mocked(json).mockResolvedValueOnce({ familyInfoResp: [{ familyId: '9007199254740999', remarkName: 'Family' }] }).mockResolvedValueOnce({ fileListAO: { folderList: [], fileList: [{ id: '9007199254740997', name: 'clip.mkv', size: '42' }] } }).mockResolvedValueOnce({ fileDownloadUrl: 'http://cdn.test/video?a=1&amp;b=2' })
  const families = await cloud189.list(account, roots.entries[1]!.id)
  const files = await cloud189.list(account, families.entries[0]!.id)
  expect(JSON.parse(files.entries[0]!.id)).toEqual({ fileId: '9007199254740997', familyId: '9007199254740999' })
  const list = new URL(vi.mocked(json).mock.calls[1]![2]);expect(list.pathname).toBe('/family/file/listFiles.action');expect(list.searchParams.get('familyId')).toBe('9007199254740999')
  const media = await cloud189.resolve(account, files.entries[0]!);expect(media).toMatchObject({ accountId: account.id, sourceId: account.id, fileId: files.entries[0]!.id, url: 'https://cdn.test/video?a=1&b=2', headers: { Referer: 'https://cloud.189.cn' } })
  const download = new URL(vi.mocked(json).mock.calls[2]![2]);expect(download.pathname).toBe('/family/file/getFileDownloadUrl.action');expect(download.searchParams.get('fileId')).toBe('9007199254740997');expect(download.searchParams.has('dt')).toBe(false)
})
it('paginates personal space and preserves folder/video classification', async () => {
  const root = JSON.stringify({ fileId: '-11' })
  vi.mocked(json).mockResolvedValueOnce({ fileListAO: { folderList: [{ id: 'folder', name: 'Films' }], fileList: Array.from({ length: 99 }, (_, i) => ({ id: String(i), name: 'clip.mp4' })) } }).mockResolvedValueOnce({ fileListAO: { folderList: [], fileList: [] } })
  const first = await cloud189.list(account, root);expect(JSON.parse(first.nextCursor!).page).toBe(2);expect(first.entries[0]).toMatchObject({ isDirectory: true, playable: false });expect(first.entries[1]).toMatchObject({ isDirectory: false, playable: true })
  expect((await cloud189.list(account, root, first.nextCursor)).nextCursor).toBeUndefined()
  const page = new URL(vi.mocked(json).mock.calls[1]![2]);expect(page.pathname).toBe('/listFiles.action');expect(page.searchParams.get('pageNum')).toBe('2');expect(page.searchParams.get('folderId')).toBe('-11');expect(page.searchParams.get('recursive')).toBe('0')
})
it('rejects business failures and identifiers that already lost precision', async () => {
  vi.mocked(json).mockResolvedValueOnce({ errorCode: 'InvalidSessionKey' })
  await expect(cloud189.list(account, JSON.stringify({ fileId: '-11' }))).rejects.toThrow('请求失败')
  vi.mocked(json).mockResolvedValueOnce({ fileListAO: { fileList: [{ id: 9007199254740996, name: 'video.mp4' }] } })
  await expect(cloud189.list(account, JSON.stringify({ fileId: '-11' }))).rejects.toThrow('精度')
  vi.mocked(json).mockClear()
  await expect(cloud189.list(account, JSON.stringify({ fileId: '', familyId: 'invalid' }))).rejects.toThrow('位置无效');expect(json).not.toHaveBeenCalled()
})
