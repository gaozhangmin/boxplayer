import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { aliPost, aliRefreshToken } from '../providers/aliyunHttp.mjs'
import { aliListDir, aliListAll, aliRenameBatch } from '../providers/aliyunFiles.mjs'
import { createAliyunProvider } from '../providers/aliyun.mjs'

const MOCK_TOKEN = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  device_id: 'test-device-id',
  signature: 'test-signature',
  user_id: 'user-001',
  default_drive_id: 'drive-001',
  token_type: 'Bearer',
}

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  })
}

describe('aliyunHttp - aliPost', () => {
  beforeEach(() => { vi.stubGlobal('fetch', undefined) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('maps legacy v3/file/list to openapi.alipan.com openFile/list', async () => {
    const fetchMock = mockFetch({ items: [], next_marker: '' })
    vi.stubGlobal('fetch', fetchMock)

    await aliPost('adrive/v3/file/list', { drive_id: 'x' }, {
      ...MOCK_TOKEN,
      open_api_access_token: 'open-token',
      open_api_token_type: 'Bearer',
    })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('openapi.alipan.com')
    expect(url).toContain('openFile/list')
    expect(opts.headers['Authorization']).toBe('Bearer open-token')
    expect(opts.headers['x-device-id']).toBeUndefined()
  })

  it('posts to openapi.alipan.com for v1.0 paths', async () => {
    const fetchMock = mockFetch({ items: [], next_marker: '' })
    vi.stubGlobal('fetch', fetchMock)

    await aliPost('adrive/v1.0/openFile/list', {}, {
      ...MOCK_TOKEN,
      open_api_access_token: 'open-token',
      open_api_token_type: 'Bearer',
    })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('openapi.alipan.com')
    expect(opts.headers['Authorization']).toBe('Bearer open-token')
    expect(opts.headers['x-device-id']).toBeUndefined()
  })

  it('throws on non-2xx response', async () => {
    vi.stubGlobal('fetch', mockFetch({ message: 'Unauthorized' }, 401))
    await expect(aliPost('adrive/v3/file/list', {}, {
      ...MOCK_TOKEN,
      open_api_access_token: 'open-token',
    })).rejects.toThrow('401')
  })
})

describe('aliyunHttp - aliRefreshToken', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls openapi.alipan.com oauth with refresh_token grant', async () => {
    const fetchMock = mockFetch({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 7200,
      token_type: 'Bearer',
      user_id: 'user-001',
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await aliRefreshToken(MOCK_TOKEN)

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('openapi.alipan.com/oauth/access_token')
    const body = JSON.parse(opts.body)
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('test-refresh-token')
    expect(body).toHaveProperty('client_id')
    expect(body).toHaveProperty('client_secret')
    expect(result.access_token).toBe('new-access')
    expect(result.refresh_token).toBe('new-refresh')
    expect(result.open_api_access_token).toBe('new-access')
  })

  it('preserves existing token fields that are missing from response', async () => {
    vi.stubGlobal('fetch', mockFetch({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    }))

    const result = await aliRefreshToken({ ...MOCK_TOKEN, device_id: 'keep-me' })
    expect(result.device_id).toBe('keep-me')
  })

  it('throws on auth failure', async () => {
    vi.stubGlobal('fetch', mockFetch({ message: 'invalid refresh token' }, 400))
    await expect(aliRefreshToken(MOCK_TOKEN)).rejects.toThrow('refresh failed')
  })
})

describe('aliyunFiles - aliListDir', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('maps API response to FileItem array', async () => {
    vi.stubGlobal('fetch', mockFetch({
      items: [
        {
          file_id: 'f1', parent_file_id: 'root', drive_id: 'drive-001',
          name: 'Movie.mkv', type: 'file', size: 1024,
          content_hash: 'abc', mime_type: 'video/x-matroska',
          category: 'video', updated_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          file_id: 'dir1', parent_file_id: 'root', drive_id: 'drive-001',
          name: 'Movies', type: 'folder',
          updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
        },
      ],
      next_marker: '',
    }))

    const { items, nextMarker } = await aliListDir(MOCK_TOKEN, 'drive-001', 'root')
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      provider: 'aliyun',
      fileId: 'f1',
      name: 'Movie.mkv',
      type: 'file',
      size: 1024,
    })
    expect(items[1]).toMatchObject({ type: 'folder', name: 'Movies' })
    expect(nextMarker).toBe('')
  })

  it('passes marker for pagination', async () => {
    const fetchMock = mockFetch({ items: [], next_marker: '' })
    vi.stubGlobal('fetch', fetchMock)

    await aliListDir(MOCK_TOKEN, 'drive-001', 'root', 'cursor-xyz')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.marker).toBe('cursor-xyz')
  })

  it('passes limit for pagination', async () => {
    const fetchMock = mockFetch({ items: [], next_marker: '' })
    vi.stubGlobal('fetch', fetchMock)

    await aliListDir(MOCK_TOKEN, 'drive-001', 'root', '', 25)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.limit).toBe(25)
  })
})

describe('aliyunFiles - aliListAll', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('paginates until next_marker is empty', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++
      const isFirst = callCount === 1
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items: [{ file_id: `f${callCount}`, parent_file_id: 'root', drive_id: 'drive-001',
            name: `file${callCount}.mkv`, type: 'file',
            updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }],
          next_marker: isFirst ? 'page2' : '',
        }),
      })
    }))

    const items = await aliListAll(MOCK_TOKEN, 'drive-001', 'root')
    expect(items).toHaveLength(2)
    expect(callCount).toBe(2)
  })
})

describe('aliyunFiles - aliRenameBatch', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls openFile/update per file (no v4/batch)', async () => {
    const fetchMock = mockFetch({ name: 'New Name.mkv', file_id: 'f1' })
    vi.stubGlobal('fetch', fetchMock)

    const results = await aliRenameBatch(MOCK_TOKEN, 'drive-001', [
      { fileId: 'f1', newName: 'New Name.mkv' },
    ])

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('openapi.alipan.com')
    expect(url).toContain('openFile/update')
    const body = JSON.parse(opts.body)
    expect(body.name).toBe('New Name.mkv')
    expect(body.check_name_mode).toBe('refuse')
    expect(body.file_id).toBe('f1')
    expect(results[0]).toMatchObject({ fileId: 'f1', status: 'success', newName: 'New Name.mkv' })
  })

  it('reports error status for failed items', async () => {
    vi.stubGlobal('fetch', mockFetch({ message: 'name conflict', code: 'AlreadyExist' }, 409))

    const results = await aliRenameBatch(MOCK_TOKEN, 'drive-001', [
      { fileId: 'f2', newName: 'Conflict.mkv' },
    ])
    expect(results[0]).toMatchObject({ fileId: 'f2', status: 'error' })
    expect(results[0].message).toMatch(/409|conflict|AlreadyExist/i)
  })

  it('loops one request per rename (no batch chunking)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'ok' }),
      text: async () => '{}',
    })
    vi.stubGlobal('fetch', fetchMock)

    const renames = Array.from({ length: 3 }, (_, i) => ({ fileId: `f${i}`, newName: `file${i}.mkv` }))
    await aliRenameBatch(MOCK_TOKEN, 'drive-001', renames)

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('createAliyunProvider', () => {
  it('exposes correct capabilities', () => {
    const provider = createAliyunProvider()
    expect(provider.id).toBe('aliyun')
    expect(provider.capabilities.batchRename).toBe(true)
    expect(provider.capabilities.recursiveWalk).toBe(true)
    expect(provider.capabilities.permanentDelete).toBe(false)
  })

  it('auth.login throws ERR_PROVIDER_OPERATION_UNIMPLEMENTED', async () => {
    const provider = createAliyunProvider()
    await expect(provider.auth.login()).rejects.toMatchObject({
      code: 'ERR_PROVIDER_OPERATION_UNIMPLEMENTED',
    })
  })

  it('auth.refresh calls aliRefreshToken', async () => {
    vi.stubGlobal('fetch', mockFetch({
      access_token: 'refreshed', refresh_token: 'new-refresh', user_id: 'u1',
    }))
    const provider = createAliyunProvider()
    const result = await provider.auth.refresh(MOCK_TOKEN)
    expect(result.access_token).toBe('refreshed')
    vi.unstubAllGlobals()
  })
})
