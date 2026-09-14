import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ token: { open_api_access_token: 'old', open_api_refresh_token: 'secret' }, refresh: vi.fn() }))
vi.mock('../../drive/account', () => ({ getProviderTokenForUser: async () => state.token }))
vi.mock('../../user/userdal', () => ({ default: { SaveUserToken: (token: any) => { state.token = token } } }))
vi.mock('../auth', () => ({ CLOUD189_API_URL: 'https://example.test', CLOUD189_USER_AGENT: 'test', CLOUD189_WEB_URL: 'https://example.test', cloud189ClientSuffix: () => ({}), cloud189SignatureHeaders: (key: string) => ({ sessionkey: key }), refreshCloud189Token: state.refresh }))
vi.mock('../../utils/message', () => ({ default: { error: vi.fn() } }))
import { cloud189Request, cloud189FormRequest } from '../dirfilelist'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); state.token = { open_api_access_token: 'old', open_api_refresh_token: 'secret' } })

it.each([cloud189Request, cloud189FormRequest])('refreshes an invalid session and signs the retry with the new key', async (request) => {
  state.refresh.mockResolvedValue({ open_api_access_token: 'new', open_api_refresh_token: 'new-secret' })
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ errorCode: 'InvalidSessionKey' }), { status: 400 })).mockResolvedValueOnce(new Response(JSON.stringify({ res_code: 0 })))
  vi.stubGlobal('fetch', fetcher)
  await request('user', 'listFiles.action', {})
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls[1][1].headers.sessionkey).toBe('new')
})

it('does not retry an invalid session indefinitely', async () => {
  state.refresh.mockResolvedValue({ open_api_access_token: 'new', open_api_refresh_token: 'secret' })
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ errorCode: 'InvalidSessionKey', errorMsg: 'expired' })))
  vi.stubGlobal('fetch', fetcher)
  await expect(cloud189Request('user', 'listFiles.action', {})).rejects.toThrow('expired')
  expect(fetcher).toHaveBeenCalledTimes(2)
})
