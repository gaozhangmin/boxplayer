import { describe, it, expect, vi, afterEach } from 'vitest'
import { pikpakRefreshToken, pikpakListDir, pikpakRenameBatch } from '../providers/pikpak.mjs'
import { dropboxRefreshToken, dropboxListDir, dropboxRenameBatch } from '../providers/dropbox.mjs'
import { onedriveRefreshToken, onedriveListDir, onedriveRenameBatch } from '../providers/onedrive.mjs'
import { boxRefreshToken, boxListDir, boxRenameBatch } from '../providers/box.mjs'
import { baiduRefreshToken, baiduListDir, baiduRenameBatch, baiduGetFile } from '../providers/baidu.mjs'
import { drive115RefreshToken, drive115ListDir, drive115RenameBatch } from '../providers/drive115.mjs'
import { cloud123ListDir, cloud123RenameBatch } from '../providers/cloud123.mjs'
import { quarkListDir, quarkRenameBatch } from '../providers/quark.mjs'
import { cloud139ListDir, cloud139RenameBatch } from '../providers/cloud139.mjs'
import { cloud189ListDir, cloud189RenameBatch } from '../providers/cloud189.mjs'
import { createPikpakProvider } from '../providers/pikpakProvider.mjs'
import { createDropboxProvider } from '../providers/dropboxProvider.mjs'
import { createOnedriveProvider } from '../providers/onedriveProvider.mjs'
import { createBoxProvider } from '../providers/boxProvider.mjs'
import { createBaiduProvider } from '../providers/baiduProvider.mjs'
import { createDrive115Provider } from '../providers/drive115Provider.mjs'
import { createCloud123Provider } from '../providers/cloud123Provider.mjs'
import { createQuarkProvider } from '../providers/quarkProvider.mjs'
import { createCloud139Provider } from '../providers/cloud139Provider.mjs'
import { createCloud189Provider } from '../providers/cloud189Provider.mjs'

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  })
}

const TOKEN = { access_token: 'tok', refresh_token: 'ref', user_id: 'u1', device_id: 'dev1' }

afterEach(() => vi.unstubAllGlobals())

// ─── PikPak ──────────────────────────────────────────────────────────────────
describe('PikPak - refresh token', () => {
  it('posts to user.mypikpak.com with refresh_token grant', async () => {
    const fetchMock = mockFetch({ access_token: 'new-tok', refresh_token: 'new-ref', expires_in: 7200 })
    vi.stubGlobal('fetch', fetchMock)
    const result = await pikpakRefreshToken(TOKEN)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('mypikpak.com')
    expect(JSON.parse(opts.body).grant_type).toBe('refresh_token')
    expect(result.access_token).toBe('new-tok')
  })
})

describe('PikPak - list dir', () => {
  it('maps files array to FileItem[]', async () => {
    vi.stubGlobal('fetch', mockFetch({
      files: [{ id: 'f1', parent_id: 'p1', name: 'Movie.mkv', kind: 'drive#file', size: '1024', modified_time: '2026-01-01T00:00:00Z' }],
      next_page_token: '',
    }))
    const items = await pikpakListDir(TOKEN, 'p1')
    expect(items[0]).toMatchObject({ provider: 'pikpak', fileId: 'f1', type: 'file', name: 'Movie.mkv', size: 1024 })
  })

  it('detects folder type from kind', async () => {
    vi.stubGlobal('fetch', mockFetch({ files: [{ id: 'd1', name: 'Movies', kind: 'drive#folder' }], next_page_token: '' }))
    const items = await pikpakListDir(TOKEN, '')
    expect(items[0].type).toBe('folder')
  })
})

describe('PikPak - rename batch', () => {
  it('sends PATCH per file and returns success', async () => {
    vi.stubGlobal('fetch', mockFetch({ file: { id: 'f1', name: 'New.mkv' } }))
    const results = await pikpakRenameBatch(TOKEN, [{ fileId: 'f1', newName: 'New.mkv' }])
    expect(results[0]).toMatchObject({ fileId: 'f1', status: 'success', newName: 'New.mkv' })
  })

  it('reports error on API failure', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'conflict' }, 409))
    const results = await pikpakRenameBatch(TOKEN, [{ fileId: 'f2', newName: 'Conflict.mkv' }])
    expect(results[0].status).toBe('error')
  })
})

describe('createPikpakProvider', () => {
  it('has correct capabilities', () => {
    const p = createPikpakProvider()
    expect(p.id).toBe('pikpak')
    expect(p.capabilities.batchRename).toBe(true)
    expect(p.capabilities.permanentDelete).toBe(true)
  })
})

// ─── Dropbox ─────────────────────────────────────────────────────────────────
describe('Dropbox - refresh token', () => {
  it('posts with refresh_token grant', async () => {
    const fetchMock = mockFetch({ access_token: 'new-tok', expires_in: 14400 })
    vi.stubGlobal('fetch', fetchMock)
    const result = await dropboxRefreshToken(TOKEN)
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(result.access_token).toBe('new-tok')
  })
})

describe('Dropbox - list dir', () => {
  it('maps entries to FileItem[]', async () => {
    vi.stubGlobal('fetch', mockFetch({
      entries: [
        { '.tag': 'file', id: 'id:abc', name: 'Movie.mkv', path_display: '/Movies/Movie.mkv', size: 2048, server_modified: '2026-01-01T00:00:00Z' },
        { '.tag': 'folder', id: 'id:dir1', name: 'Movies', path_display: '/Movies' },
      ],
      has_more: false,
      cursor: '',
    }))
    const items = await dropboxListDir(TOKEN, '')
    expect(items[0]).toMatchObject({ provider: 'dropbox', fileId: 'id:abc', type: 'file', size: 2048 })
    expect(items[1].type).toBe('folder')
  })

  it('skips deleted entries', async () => {
    vi.stubGlobal('fetch', mockFetch({
      entries: [{ '.tag': 'deleted', name: 'gone.mkv', path_display: '/gone.mkv' }],
      has_more: false,
    }))
    const items = await dropboxListDir(TOKEN, '')
    expect(items).toHaveLength(0)
  })
})

describe('Dropbox - rename batch', () => {
  it('uses move_v2 with swapped path', async () => {
    const fetchMock = mockFetch({ metadata: { name: 'New.mkv', path_display: '/Movies/New.mkv' } })
    vi.stubGlobal('fetch', fetchMock)
    const results = await dropboxRenameBatch(TOKEN, [{ fileId: '/Movies/Old.mkv', newName: 'New.mkv' }])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.from_path).toBe('/Movies/Old.mkv')
    expect(body.to_path).toBe('/Movies/New.mkv')
    expect(results[0]).toMatchObject({ status: 'success', newName: 'New.mkv' })
  })
})

describe('createDropboxProvider', () => {
  it('has correct capabilities', () => {
    const p = createDropboxProvider()
    expect(p.id).toBe('dropbox')
    expect(p.capabilities.pathAddressable).toBe(true)
    expect(p.capabilities.trash).toBe(false)
  })
})

// ─── OneDrive ─────────────────────────────────────────────────────────────────
describe('OneDrive - refresh token', () => {
  it('posts refresh_token grant to Microsoft', async () => {
    const fetchMock = mockFetch({ access_token: 'new-tok', refresh_token: 'new-ref', expires_in: 3600 })
    vi.stubGlobal('fetch', fetchMock)
    const result = await onedriveRefreshToken(TOKEN)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('microsoftonline.com')
    const body = new URLSearchParams(opts.body)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(result.access_token).toBe('new-tok')
    expect(result.refresh_token).toBe('new-ref')
  })
})

describe('OneDrive - list dir', () => {
  it('maps Graph API items to FileItem[]', async () => {
    vi.stubGlobal('fetch', mockFetch({
      value: [
        { id: 'od1', name: 'Movie.mkv', file: { mimeType: 'video/x-matroska' }, size: 2048, lastModifiedDateTime: '2026-01-01T00:00:00Z', parentReference: { id: 'root' } },
        { id: 'od2', name: 'Movies', folder: { childCount: 5 }, parentReference: { id: 'root' } },
      ],
    }))
    const items = await onedriveListDir(TOKEN, 'onedrive_root')
    expect(items[0]).toMatchObject({ provider: 'onedrive', fileId: 'od1', type: 'file', size: 2048 })
    expect(items[1].type).toBe('folder')
  })

  it('follows @odata.nextLink pagination', async () => {
    let call = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      call++
      return Promise.resolve({
        ok: true,
        json: async () => call === 1
          ? { value: [{ id: 'f1', name: 'a.mkv', file: {}, parentReference: { id: 'root' } }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' }
          : { value: [{ id: 'f2', name: 'b.mkv', file: {}, parentReference: { id: 'root' } }] },
      })
    }))
    const items = await onedriveListDir(TOKEN, 'onedrive_root')
    expect(items).toHaveLength(2)
    expect(call).toBe(2)
  })
})

describe('OneDrive - search', () => {
  it('deduplicates repeated items by id', async () => {
    vi.stubGlobal('fetch', mockFetch({
      value: [
        { id: 'dup', name: 'test.mp4', file: { mimeType: 'video/mp4' } },
        { id: 'dup', name: 'test.mp4', file: { mimeType: 'video/mp4' } },
        { id: 'unique', name: 'test2.mp4', file: { mimeType: 'video/mp4' } },
      ],
    }))

    const { onedriveSearch } = await import('../providers/onedrive.mjs')
    const items = await onedriveSearch(TOKEN, 'test', { limit: 5 })

    expect(items.map((item) => item.fileId)).toEqual(['dup', 'unique'])
  })
})

describe('OneDrive - rename batch', () => {
  it('sends PATCH with name field', async () => {
    const fetchMock = mockFetch({ id: 'od1', name: 'New.mkv' })
    vi.stubGlobal('fetch', fetchMock)
    const results = await onedriveRenameBatch(TOKEN, [{ fileId: 'od1', newName: 'New.mkv' }])
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/me/drive/items/od1')
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body).name).toBe('New.mkv')
    expect(results[0]).toMatchObject({ status: 'success', newName: 'New.mkv' })
  })
})

describe('createOnedriveProvider', () => {
  it('has correct capabilities', () => {
    const p = createOnedriveProvider()
    expect(p.id).toBe('onedrive')
    expect(p.capabilities.batchRename).toBe(true)
    expect(p.capabilities.pathAddressable).toBe(false)
  })
})

// ─── Box ──────────────────────────────────────────────────────────────────────
describe('Box - refresh token', () => {
  it('posts refresh_token grant to Box', async () => {
    const refreshedAt = Date.now()
    const fetchMock = mockFetch({ access_token: 'new-tok', refresh_token: 'new-ref', expires_in: 3600 })
    vi.stubGlobal('fetch', fetchMock)
    const result = await boxRefreshToken(TOKEN)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.box.com/oauth2/token')
    const body = new URLSearchParams(opts.body)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(result.access_token).toBe('new-tok')
    expect(result.refresh_token).toBe('new-ref')
    expect(new Date(String(result.expire_time)).getTime()).toBeGreaterThanOrEqual(refreshedAt + 3600_000)
  })
})

describe('Box - list dir', () => {
  it('maps entries to FileItem[]', async () => {
    vi.stubGlobal('fetch', mockFetch({
      entries: [
        { id: 'b1', type: 'file', name: 'Movie.mkv', size: 1024, parent: { id: '0' }, modified_at: '2026-01-01T00:00:00Z' },
        { id: 'b2', type: 'folder', name: 'Movies', parent: { id: '0' } },
      ],
      total_count: 2,
      offset: 0,
      limit: 500,
    }))
    const items = await boxListDir(TOKEN, 'box_root')
    expect(items[0]).toMatchObject({ provider: 'box', fileId: 'b1', type: 'file', size: 1024 })
    expect(items[1].type).toBe('folder')
  })

  it('resolves box_root to folder id 0', async () => {
    const fetchMock = mockFetch({ entries: [], total_count: 0, offset: 0, limit: 500 })
    vi.stubGlobal('fetch', fetchMock)
    await boxListDir(TOKEN, 'box_root')
    expect(fetchMock.mock.calls[0][0]).toContain('/folders/0/items')
  })
})

describe('Box - rename batch', () => {
  it('sends PUT with name field', async () => {
    const fetchMock = mockFetch({ id: 'b1', name: 'New.mkv', type: 'file' })
    vi.stubGlobal('fetch', fetchMock)
    const results = await boxRenameBatch(TOKEN, [{ fileId: 'b1', newName: 'New.mkv' }])
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/files/b1')
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body).name).toBe('New.mkv')
    expect(results[0]).toMatchObject({ status: 'success', newName: 'New.mkv' })
  })
})

describe('createBoxProvider', () => {
  it('has correct capabilities', () => {
    const p = createBoxProvider()
    expect(p.id).toBe('box')
    expect(p.capabilities.batchRename).toBe(true)
    expect(p.capabilities.trash).toBe(true)
  })
})

// ─── Baidu ────────────────────────────────────────────────────────────────────
describe('Baidu - refresh token', () => {
  it('sends access_token as query param not header', async () => {
    const fetchMock = mockFetch({ access_token: 'new-tok', refresh_token: 'new-ref' })
    vi.stubGlobal('fetch', fetchMock)
    const result = await baiduRefreshToken(TOKEN)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('openapi.baidu.com')
    expect(url).toContain('refresh_token')
    expect(result.access_token).toBe('new-tok')
  })
})

describe('Baidu - list dir', () => {
  it('maps list array to FileItem[]', async () => {
    vi.stubGlobal('fetch', mockFetch({
      errno: 0,
      list: [
        { fs_id: 12345, server_filename: 'Movie.mkv', path: '/Movies/Movie.mkv', isdir: 0, size: 2048, server_mtime: 1700000000 },
        { fs_id: 67890, server_filename: 'Movies', path: '/Movies', isdir: 1, size: 0 },
      ],
    }))
    const items = await baiduListDir(TOKEN, '/')
    expect(items[0]).toMatchObject({ provider: 'baidu', fileId: '12345', type: 'file', size: 2048 })
    expect(items[1].type).toBe('folder')
  })

  it('sends access_token in URL query not header', async () => {
    const fetchMock = mockFetch({ errno: 0, list: [] })
    vi.stubGlobal('fetch', fetchMock)
    await baiduListDir(TOKEN, '/')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('access_token=tok')
    expect(opts?.headers?.Authorization).toBeUndefined()
  })
})

describe('Baidu - file info', () => {
  it('maps filemetas info response to FileItem', async () => {
    vi.stubGlobal('fetch', mockFetch({
      errno: 0,
      info: [{ fs_id: 12345, filename: 'Movie.mkv', path: '/Movies/Movie.mkv', isdir: 0, size: 2048, server_mtime: 1700000000 }],
    }))

    const item = await baiduGetFile(TOKEN, '12345')

    expect(item).toMatchObject({ provider: 'baidu', fileId: '12345', type: 'file', name: 'Movie.mkv', size: 2048 })
  })
})

describe('Baidu - rename batch', () => {
  it('sends filemanager rename POST', async () => {
    const fetchMock = mockFetch({ errno: 0, info: [{ errno: 0 }] })
    vi.stubGlobal('fetch', fetchMock)
    const results = await baiduRenameBatch(TOKEN, [{ fileId: '12345', newName: 'New.mkv', filePath: '/Movies/Old.mkv' }])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('opera=rename')
    expect(results[0].status).toBe('success')
  })
})

describe('createBaiduProvider', () => {
  it('has correct capabilities', () => {
    const p = createBaiduProvider()
    expect(p.id).toBe('baidu')
    expect(p.capabilities.pathAddressable).toBe(true)
    expect(p.capabilities.fileIdAddressable).toBe(false)
  })
})

// ─── 115 ─────────────────────────────────────────────────────────────────────
describe('115 - refresh token', () => {
  it('posts to passportapi.115.com', async () => {
    const refreshedAt = Date.now()
    const fetchMock = mockFetch({ code: 0, data: { access_token: 'new-tok', refresh_token: 'new-ref', expires_in: 7200 } })
    vi.stubGlobal('fetch', fetchMock)
    const result = await drive115RefreshToken(TOKEN)
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('passportapi.115.com')
    expect(result.access_token).toBe('new-tok')
    expect(result.refresh_token).toBe('new-ref')
    expect(new Date(String(result.expire_time)).getTime()).toBeGreaterThanOrEqual(refreshedAt + 7200_000)
  })
})

describe('115 - list dir', () => {
  it('maps data array to FileItem[]', async () => {
    vi.stubGlobal('fetch', mockFetch({
      code: 0,
      data: [
        { fid: '111', pid: '0', n: 'Movie.mkv', s: 1024, te: '1700000000', sha: 'abc' },
        { fid: '222', pid: '0', n: 'Movies', fc: '1' },
      ],
      count: 2,
    }))
    const items = await drive115ListDir(TOKEN, '0')
    expect(items[0]).toMatchObject({ provider: '115', fileId: '111', type: 'file', size: 1024 })
    expect(items[1].type).toBe('folder')
  })

  it('uses Authorization header not query param', async () => {
    const fetchMock = mockFetch({ code: 0, data: [], count: 0 })
    vi.stubGlobal('fetch', fetchMock)
    await drive115ListDir(TOKEN, '0')
    const opts = fetchMock.mock.calls[0][1]
    expect(opts.headers['Authorization']).toBe('Bearer tok')
  })
})

describe('115 - rename batch', () => {
  it('sends POST to ufile/update', async () => {
    const fetchMock = mockFetch({ code: 0 })
    vi.stubGlobal('fetch', fetchMock)
    const results = await drive115RenameBatch(TOKEN, [{ fileId: '111', newName: 'New.mkv' }])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('ufile/update')
    expect(results[0]).toMatchObject({ fileId: '111', status: 'success', newName: 'New.mkv' })
  })
})

describe('createDrive115Provider', () => {
  it('has correct capabilities', () => {
    const p = createDrive115Provider()
    expect(p.id).toBe('115')
    expect(p.capabilities.batchRename).toBe(true)
    expect(p.capabilities.fileIdAddressable).toBe(true)
  })
})

// ─── 123网盘 ────────────────────────────────────────────────────────────────
describe('123网盘 - list dir', () => {
  it('maps fileList to FileItem[]', async () => {
    vi.stubGlobal('fetch', mockFetch({
      code: 0,
      data: {
        fileList: [
          { fileId: 1, parentFileId: 0, filename: 'Movies', type: 1, size: 0 },
          { fileId: 2, parentFileId: 0, filename: 'Movie.mkv', type: 0, size: 1024 },
        ],
      },
    }))

    const items = await cloud123ListDir(TOKEN, '0')

    expect(items[0]).toMatchObject({ provider: 'cloud123', fileId: '1', type: 'folder', name: 'Movies' })
    expect(items[1]).toMatchObject({ provider: 'cloud123', fileId: '2', type: 'file', size: 1024 })
  })
})

describe('123网盘 - rename batch', () => {
  it('sends renameList and returns success', async () => {
    const fetchMock = mockFetch({ code: 0, data: {} })
    vi.stubGlobal('fetch', fetchMock)

    const results = await cloud123RenameBatch(TOKEN, [{ fileId: '2', newName: 'New.mkv' }])
    const [, opts] = fetchMock.mock.calls[0]

    expect(JSON.parse(opts.body).renameList).toEqual(['2|New.mkv'])
    expect(results[0]).toMatchObject({ fileId: '2', status: 'success', newName: 'New.mkv' })
  })
})

describe('createCloud123Provider', () => {
  it('has correct capabilities', () => {
    const p = createCloud123Provider()
    expect(p.id).toBe('cloud123')
    expect(p.capabilities.batchRename).toBe(true)
    expect(p.capabilities.fileIdAddressable).toBe(true)
    expect(p.capabilities.mkdir).toBe(true)
  })
})

// ─── 夸克网盘 ────────────────────────────────────────────────────────────────
describe('Quark - list dir', () => {
  it('maps drive-pc file list to FileItem[]', async () => {
    vi.stubGlobal('fetch', mockFetch({
      code: 0,
      data: {
        list: [
          { fid: 'd1', pdir_fid: '0', file_name: 'Movies', file_type: 0 },
          { fid: 'f1', pdir_fid: '0', file_name: 'Movie.mkv', file_type: 1, size: 2048 },
        ],
      },
    }))

    const items = await quarkListDir({ ...TOKEN, access_token: '__uid=u1; __kps=k' }, 'quark_root')

    expect(items[0]).toMatchObject({ provider: 'quark', fileId: 'd1', type: 'folder', name: 'Movies' })
    expect(items[1]).toMatchObject({ provider: 'quark', fileId: 'f1', type: 'file', size: 2048 })
  })
})

describe('Quark - rename batch', () => {
  it('posts fid and file_name', async () => {
    const fetchMock = mockFetch({ code: 0, data: { fid: 'f1' } })
    vi.stubGlobal('fetch', fetchMock)

    const results = await quarkRenameBatch({ ...TOKEN, access_token: '__uid=u1; __kps=k' }, [{ fileId: 'f1', newName: 'New.mkv' }])
    const [, opts] = fetchMock.mock.calls[0]

    expect(JSON.parse(opts.body)).toMatchObject({ fid: 'f1', file_name: 'New.mkv' })
    expect(results[0]).toMatchObject({ fileId: 'f1', status: 'success', newName: 'New.mkv' })
  })
})

describe('createQuarkProvider', () => {
  it('has correct capabilities', () => {
    const p = createQuarkProvider()
    expect(p.id).toBe('quark')
    expect(p.capabilities.serverSideSearch).toBe(true)
    expect(p.capabilities.uploadFile).toBe(false)
  })
})

// ─── 139云盘 ────────────────────────────────────────────────────────────────
describe('139云盘 - list dir', () => {
  it('routes then maps list response to FileItem[]', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { routePolicyList: [{ modName: 'personal', httpsUrl: 'https://cloud139.test' }] } }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { list: [{ fileId: 'f1', parentFileId: '/', name: 'Movie.mkv', type: 'file', size: 1024 }] } }),
        text: async () => '',
      })
    vi.stubGlobal('fetch', fetchMock)

    const auth = Buffer.from('pc:13900000000:token|x|x|9999999999999').toString('base64')
    const items = await cloud139ListDir({ ...TOKEN, access_token: auth, user_name: '13900000000' }, 'cloud139_root')

    expect(fetchMock.mock.calls[0][0]).toContain('qryRoutePolicy')
    expect(fetchMock.mock.calls[1][0]).toContain('/orchestration/file/list')
    expect(items[0]).toMatchObject({ provider: '139', fileId: 'f1', type: 'file', size: 1024 })
  })
})

describe('139云盘 - rename batch', () => {
  it('posts fileId and fileName', async () => {
    const auth = Buffer.from('pc:13900000001:token|x|x|9999999999999').toString('base64')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { routePolicyList: [{ modName: 'personal', httpsUrl: 'https://cloud139.test' }] } }), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: {} }), text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    const results = await cloud139RenameBatch({ ...TOKEN, user_id: 'u139_rename', access_token: auth, user_name: '13900000001' }, [{ fileId: 'f1', newName: 'New.mkv' }])
    const [, opts] = fetchMock.mock.calls[1]

    expect(JSON.parse(opts.body)).toMatchObject({ fileId: 'f1', fileName: 'New.mkv' })
    expect(results[0]).toMatchObject({ fileId: 'f1', status: 'success', newName: 'New.mkv' })
  })
})

describe('createCloud139Provider', () => {
  it('has correct capabilities', () => {
    const p = createCloud139Provider()
    expect(p.id).toBe('139')
    expect(p.capabilities.fileIdAddressable).toBe(true)
    expect(p.capabilities.uploadFile).toBe(false)
  })
})

// ─── 天翼云盘 ────────────────────────────────────────────────────────────────
describe('189云盘 - list dir', () => {
  it('maps folderList and fileList to FileItem[]', async () => {
    vi.stubGlobal('fetch', mockFetch({
      res_code: 0,
      fileListAO: {
        folderList: [{ id: 'd1', name: 'Movies', parentId: '-11' }],
        fileList: [{ id: 'f1', name: 'Movie.mkv', parentId: '-11', size: 4096 }],
      },
    }))

    const items = await cloud189ListDir({ ...TOKEN, open_api_access_token: 'sk', open_api_refresh_token: 'ss' }, 'cloud189_root')

    expect(items[0]).toMatchObject({ provider: '189', fileId: 'd1', type: 'folder', name: 'Movies' })
    expect(items[1]).toMatchObject({ provider: '189', fileId: 'f1', type: 'file', size: 4096 })
  })
})

describe('189云盘 - rename batch', () => {
  it('posts renameFile.action first', async () => {
    const fetchMock = mockFetch({ res_code: 0 })
    vi.stubGlobal('fetch', fetchMock)

    const results = await cloud189RenameBatch({ ...TOKEN, open_api_access_token: 'sk', open_api_refresh_token: 'ss' }, [{ fileId: 'f1', newName: 'New.mkv' }])
    const [url] = fetchMock.mock.calls[0]

    expect(url).toContain('renameFile.action')
    expect(url).toContain('destFileName=New.mkv')
    expect(results[0]).toMatchObject({ fileId: 'f1', status: 'success', newName: 'New.mkv' })
  })
})

describe('createCloud189Provider', () => {
  it('has correct capabilities', () => {
    const p = createCloud189Provider()
    expect(p.id).toBe('189')
    expect(p.capabilities.recursiveWalk).toBe(true)
    expect(p.capabilities.uploadFile).toBe(false)
  })
})
