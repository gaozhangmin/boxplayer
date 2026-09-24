import { afterEach, describe, expect, it, vi } from 'vitest'

const { messageError } = vi.hoisted(() => ({ messageError: vi.fn() }))
vi.mock('../../utils/message', () => ({ default: { error: messageError } }))

import { GOOGLE_AUTH_REQUEST_TIMEOUT_MS, refreshGoogleAccessToken } from '../auth'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  messageError.mockReset()
})

describe('Google OAuth refresh', () => {
  it('bounds the token request and returns null when Google OAuth times out', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'))
    vi.stubGlobal('fetch', fetchMock)

    const refreshed = await refreshGoogleAccessToken({
      tokenfrom: 'google',
      user_id: 'google-account',
      device_id: 'google-client-id',
      refresh_token: 'google-refresh-token',
      access_token: 'expired-access-token'
    } as any)

    expect(refreshed).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(messageError).toHaveBeenCalledWith('连接 Google OAuth 超时，请检查网络代理后重试')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(GOOGLE_AUTH_REQUEST_TIMEOUT_MS).toBe(15_000)
  })

  it('keeps the account identity and updates token expiry after a successful refresh', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'fresh-access-token', expires_in: 3600, token_type: 'Bearer' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { permissionId: 'permission-id', displayName: 'Gavin gao' }, storageQuota: { limit: '1000', usage: '250' } }) })
    vi.stubGlobal('fetch', fetchMock)

    const refreshed = await refreshGoogleAccessToken({
      tokenfrom: 'google',
      user_id: 'google_permission-id',
      user_name: 'Gavin gao',
      nick_name: 'Gavin gao',
      name: 'Gavin gao',
      device_id: 'google-client-id',
      refresh_token: 'google-refresh-token',
      access_token: 'expired-access-token'
    } as any)

    expect(refreshed?.user_id).toBe('google_permission-id')
    expect(refreshed?.access_token).toBe('fresh-access-token')
    expect(refreshed?.refresh_token).toBe('google-refresh-token')
    expect(refreshed?.expire_time).toBeTruthy()
    expect(refreshed?.free_size).toBe(750)
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).signal instanceof AbortSignal)).toBe(true)
  })
})
