import { afterEach, describe, expect, it, vi } from 'vitest'

const { messageError, saveUserToken } = vi.hoisted(() => ({ messageError: vi.fn(), saveUserToken: vi.fn() }))
vi.mock('../../secrets.generated', () => ({ GOOGLE_CLIENT_ID: 'test-google-client', GOOGLE_CLIENT_SECRET: 'test-google-secret' }))
vi.mock('../../user/userdal', () => ({ default: { SaveUserToken: saveUserToken, GetUserTokenFromDB: vi.fn(async () => ({ source_name: 'Existing Drive alias' })) } }))
vi.mock('../../utils/message', () => ({ default: { error: messageError } }))

import { applyGoogleQuota, exchangeGoogleCodeForToken, GOOGLE_AUTH_REQUEST_TIMEOUT_MS, GOOGLE_DRIVE_SCOPE, refreshGoogleAccessToken } from '../auth'
import { GOOGLE_DRIVE_RECONNECT_MESSAGE } from '../accessPolicy'
import type { ITokenInfo } from '../../user/userstore'

const savedCredential = (scope?: string) => ({ tokenfrom: 'google', user_id: 'google_account', device_id: 'google-client-id', refresh_token: 'old-refresh-token', access_token: 'old-access-token', google_drive_scope: scope }) as ITokenInfo
const accountResponse = { ok: true, json: async () => ({ user: { permissionId: 'account', displayName: 'Sample' } }) }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  messageError.mockReset()
  saveUserToken.mockReset()
})

describe('Google OAuth refresh', () => {
  it('bounds the token request and returns null when Google OAuth times out', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'))
    vi.stubGlobal('fetch', fetchMock)

    const refreshed = await refreshGoogleAccessToken({
      tokenfrom: 'google',
      google_drive_scope: GOOGLE_DRIVE_SCOPE,
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'fresh-access-token', expires_in: 3600, token_type: 'Bearer', scope: GOOGLE_DRIVE_SCOPE }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { permissionId: 'permission-id', displayName: 'Gavin gao' }, storageQuota: { limit: '1000', usage: '250' } }) })
    vi.stubGlobal('fetch', fetchMock)

    const refreshed = await refreshGoogleAccessToken({
      tokenfrom: 'google',
      google_drive_scope: GOOGLE_DRIVE_SCOPE,
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

describe('Google Drive scope enforcement', () => {
  const exchange = () => exchangeGoogleCodeForToken('code', 'test-client', 'verifier', 'http://127.0.0.1/callback')

  it.each([undefined, 'https://www.googleapis.com/auth/drive', `${GOOGLE_DRIVE_SCOPE} https://www.googleapis.com/auth/drive`])(
    'does not adopt a missing or broader scope returned by code exchange (%s)', async scope => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'unexpected-access-token', scope }) })
      vi.stubGlobal('fetch', fetchMock)
      await expect(exchange()).resolves.toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(saveUserToken).not.toHaveBeenCalled()
      expect(messageError).toHaveBeenCalledWith(GOOGLE_DRIVE_RECONNECT_MESSAGE)
    }
  )

  it('persists an exactly scoped credential after resolving its account', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'read-only-token', refresh_token: 'fresh-refresh-token', scope: GOOGLE_DRIVE_SCOPE }) }).mockResolvedValueOnce(accountResponse)
    vi.stubGlobal('fetch', fetchMock)
    await expect(exchange()).resolves.toMatchObject({ user_id: 'google_account', google_drive_scope: GOOGLE_DRIVE_SCOPE })
    expect(saveUserToken).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'google_account', google_drive_scope: GOOGLE_DRIVE_SCOPE, source_name: 'Existing Drive alias' }))
  })

  it('refuses to refresh or call Google About with a legacy cached grant', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const legacy = savedCredential()
    await expect(refreshGoogleAccessToken(legacy)).resolves.toBeNull()
    await expect(applyGoogleQuota(legacy)).resolves.toBe(false)
    expect(legacy.access_token).toBe('old-access-token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a broader returned scope without replacing the previous read-only token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'unexpected-access-token', scope: 'https://www.googleapis.com/auth/drive' }) })
    vi.stubGlobal('fetch', fetchMock)
    const existing = savedCredential(GOOGLE_DRIVE_SCOPE)
    await expect(refreshGoogleAccessToken(existing)).resolves.toBeNull()
    expect(existing.access_token).toBe('old-access-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
