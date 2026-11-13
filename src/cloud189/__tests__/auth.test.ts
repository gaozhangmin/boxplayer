import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloud189EncryptParams, refreshCloud189Token } from '../auth'

afterEach(() => vi.unstubAllGlobals())

describe('cloud189 signed parameters', () => {
  it('encrypts sorted business parameters for the list API', () => {
    const secret = '0123456789abcdef-session-secret'
    expect(cloud189EncryptParams({ pageSize: '1000', folderId: '-11', pageNum: '1' }, secret))
      .toBe('825C2FE582CBDD429FC44C2CBF1C5031F1FCD46C38D8E9340AA9DB9952BDD1DAFA6E0E05EDA3B8E796329266E716E0F6')
  })

  it('retains the last known capacity while renewing a session', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'new-access', refreshToken: 'new-refresh' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sessionKey: 'new-key', sessionSecret: 'new-secret' }))))
    const refreshed = await refreshCloud189Token({
      user_id: 'cloud189_quota-test', refresh_token: 'old-refresh',
      total_size: 1000, used_size: 200, free_size: 800, spaceinfo: 'previous'
    } as any)
    expect(refreshed).toMatchObject({
      user_id: 'cloud189_quota-test', open_api_access_token: 'new-key',
      total_size: 1000, used_size: 200, free_size: 800, spaceinfo: 'previous'
    })
  })
})
