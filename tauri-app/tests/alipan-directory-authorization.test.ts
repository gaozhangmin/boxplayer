import { beforeEach, expect, it, vi } from 'vitest'
import { alipan } from '@/features/sources/alipan'
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
