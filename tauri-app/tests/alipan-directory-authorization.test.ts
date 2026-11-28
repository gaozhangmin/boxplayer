import { beforeEach, expect, it, vi } from 'vitest'
import { alipan, aliFileDisplayPath } from '@/features/sources/alipan'
import { json } from '@/features/sources/transport'

vi.mock('@/features/sources/transport', () => ({ json: vi.fn(), playable: () => false }))

const account = { id: 'paired-account', providerId: 'aliyun' as const, name: 'Aliyun', baseUrl: 'https://api.aliyundrive.com', authOrigins: ['https://api.aliyundrive.com', 'https://openapi.alipan.com'] }
const root = JSON.stringify({ driveId: 'drive', fileId: 'root' })
const rejected = { code: 'ALIYUN_WEB', message: 'Web session rejected', retryable: false }
const web = 'https://api.aliyundrive.com/adrive/v3/file/list'
const open = 'https://openapi.alipan.com/adrive/v1.0/openFile/list'

beforeEach(() => vi.resetAllMocks())

it('uses the same account’s OpenAPI authorization after a web session rejection', async () => {
  vi.mocked(json).mockRejectedValueOnce(rejected).mockResolvedValueOnce({
    items: [{ type: 'folder', file_id: 'child', name: 'Folder' }],
    next_marker: 'second',
  }).mockResolvedValueOnce({ items: [] })

  const first = await alipan.list(account, root)
  expect(first.entries).toMatchObject([{ name: 'Folder', isDirectory: true }])
  await alipan.list(account, root, first.nextCursor)
  expect(vi.mocked(json).mock.calls.map(([owner, , url, body]) => [owner.id, url, body && (body as { marker?: string }).marker])).toEqual([
    [account.id, web, ''],
    [account.id, open, ''],
    [account.id, open, 'second'],
  ])
})

it('preserves the web error for an account without a second authorization', async () => {
  vi.mocked(json).mockRejectedValueOnce(rejected).mockRejectedValueOnce({ code: 'ALIYUN_OPEN_AUTH', message: 'Missing OpenAPI authorization' })
  await expect(alipan.list(account, root)).rejects.toEqual(rejected)
})

it('never starts another channel in the middle of web pagination', async () => {
  vi.mocked(json).mockRejectedValueOnce(rejected)
  await expect(alipan.list(account, root, 'web-marker')).rejects.toEqual(rejected)
  expect(json).toHaveBeenCalledTimes(1)
})

it('resolves the original file through the paired authorization when web authentication fails', async () => {
  const id = JSON.stringify({ driveId: 'drive', fileId: 'video' })
  const item = { id, name: 'Catalog movie', isDirectory: false, size: 0, playable: true }
  vi.mocked(json).mockRejectedValueOnce(rejected).mockResolvedValueOnce({ url: 'https://cdn.example.invalid/video' })

  await expect(alipan.resolve(account, item)).resolves.toMatchObject({
    sourceId: account.id,
    accountId: account.id,
    fileId: id,
    url: 'https://cdn.example.invalid/video',
    headers: { Referer: 'https://www.aliyundrive.com/' },
  })
  expect(vi.mocked(json).mock.calls).toEqual([
    [account, 'POST', 'https://api.aliyundrive.com/v2/file/get_download_url', { drive_id: 'drive', file_id: 'video' }],
    [account, 'POST', 'https://openapi.alipan.com/adrive/v1.0/openFile/getDownloadUrl', { drive_id: 'drive', file_id: 'video', expire_sec: 14400 }],
  ])
})

it('retains a file-level permission error without switching channels', async () => {
  const error = new Error('Access denied for this file')
  vi.mocked(json).mockRejectedValueOnce(error)
  await expect(alipan.resolve(account, { id: root, name: 'Movie', isDirectory: false, size: 0, playable: true })).rejects.toBe(error)
  expect(json).toHaveBeenCalledTimes(1)
})

it('resolves a complete path by following the same account and drive through all parents', async () => {
  const id = JSON.stringify({ driveId: 'drive', fileId: 'video' })
  vi.mocked(json).mockRejectedValueOnce(rejected)
    .mockResolvedValueOnce({ resource_drive_id: 'drive' })
    .mockResolvedValueOnce({ drive_id: 'drive', file_id: 'video', parent_file_id: 'folder', name: 'Film.mkv' })
    .mockResolvedValueOnce({ drive_id: 'drive', file_id: 'folder', parent_file_id: 'root', name: 'Documentaries' })

  await expect(aliFileDisplayPath(account, id)).resolves.toBe('资源盘/Documentaries/Film.mkv')
  expect(vi.mocked(json).mock.calls.slice(2).map(([_, , , body]) => body)).toEqual([
    { drive_id: 'drive', file_id: 'video' },
    { drive_id: 'drive', file_id: 'folder' },
  ])
})
