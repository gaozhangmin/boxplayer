import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

;(globalThis as any).self = globalThis
;(globalThis as any).pinyinlite = (input: string) => input.split('').map((char) => [char])

vi.mock('../../utils/message', () => ({
  default: {
    error: vi.fn()
  }
}))

vi.mock('../../user/userdal', () => ({
  default: {
    GetUserToken: vi.fn(() => ({})),
    GetUserTokenFromDB: vi.fn(async () => ({})),
    SaveUserToken: vi.fn()
  }
}))

vi.mock('../auth', () => ({
  GUANGYA_API_URL: 'https://api.guangyapan.com',
  guangyaApiHeaders: vi.fn(() => ({})),
  refreshGuangyaAccessToken: vi.fn()
}))

vi.mock('../../drive/account', () => ({
  getProviderTokenForUser: vi.fn(async () => ({ user_id: 'guangya-user', access_token: 'token', tokenfrom: 'guangya' }))
}))

const { saveWarning } = vi.hoisted(() => ({ saveWarning: vi.fn() }))
vi.mock('../../utils/debuglog', () => ({ default: { mSaveWarning: saveWarning } }))

let helpers: typeof import('../dirfilelist')

beforeAll(async () => {
  helpers = await import('../dirfilelist')
})

afterEach(() => {
  vi.unstubAllGlobals()
  saveWarning.mockClear()
})

describe('Guangya dirfilelist helpers', () => {
  it('normalizes root parent ids for Guangya API calls', () => {
    expect(helpers.guangyaApiParentId('guangya_root')).toBe('')
    expect(helpers.guangyaApiParentId('0')).toBe('')
    expect(helpers.guangyaApiParentId('/')).toBe('')
    expect(helpers.guangyaApiParentId('*')).toBe('*')
    expect(helpers.guangyaApiParentId('folder-id')).toBe('folder-id')
  })

  it('reads common id, name and folder fields from Guangya items', () => {
    expect(helpers.getGuangyaFileId({ fileId: 'file-id' })).toBe('file-id')
    expect(helpers.getGuangyaFileName({ fileName: 'movie.mp4' })).toBe('movie.mp4')
    expect(helpers.isGuangyaDir({ type: 'folder' })).toBe(true)
    expect(helpers.isGuangyaDir({ fileName: 'test', dirType: 1, resType: 2 })).toBe(true)
    expect(helpers.isGuangyaDir({ fileName: 'test', fileSize: 126, fileType: 11, dirType: 1, resType: 1 })).toBe(false)
    expect(helpers.isGuangyaDir({ fileName: 'note.txt', dirType: 1 })).toBe(false)
    expect(helpers.isGuangyaDir({ name: 'movie.mp4', type: 'file' })).toBe(false)
  })

  it('reads the signed download URL returned by Guangya', () => {
    expect(helpers.getGuangyaDownloadUrlFromResponse({ data: { signedURL: 'https://vip-lixian-08.guangyapan.com/download' } })).toBe('https://vip-lixian-08.guangyapan.com/download')
  })

  it('rejects an HTTP 200 response with a nonzero Guangya business code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 112, msg: '参数错误' })
    }))

    await expect(helpers.guangyaRequest('guangya-user', '/nd.bizuserres.s/v1/get_res_center_token', {})).rejects.toThrow('光鸭云盘请求失败 code 112: 参数错误')
    expect(saveWarning).toHaveBeenCalledWith('光鸭云盘接口错误 /nd.bizuserres.s/v1/get_res_center_token code 112 参数错误')
  })

  it('maps Guangya files into the shared cloud file model with hashes', () => {
    const model = helpers.mapGuangyaFileToAliModel({
      fileId: 'file-id',
      parentId: 'parent-id',
      name: 'movie.mp4',
      size: 1048576,
      contentHash: 'md5-base64',
      updateAt: '2026-07-10T01:00:00Z',
      thumbnailUrl: 'https://thumb'
    })

    expect(model.drive_id).toBe('guangya')
    expect(model.file_id).toBe('file-id')
    expect(model.parent_file_id).toBe('parent-id')
    expect(model.ext).toBe('mp4')
    expect(model.sizeStr).toBe('1.00MB')
    expect(model.thumbnail).toBe('https://thumb')
    expect((model as any).content_hash).toBe('md5-base64')
    expect(model.description).toBe('guangya_id:file-id')
  })
})
