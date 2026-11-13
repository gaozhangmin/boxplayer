import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyQuotaValues } from '../../drive/providerQuota'
import { applyQuarkQuota, refreshQuarkProfileAndQuota } from '../../quark/quota'
import { applyCloud189Quota } from '../../cloud189/quota'

vi.mock('../../quark/auth', () => ({
  syncQuarkCookiesToElectron: vi.fn().mockResolvedValue(undefined),
  quarkAuthHeaders: (cookie: string) => ({ Cookie: cookie }),
  refreshQuarkAccountInfo: vi.fn()
}))
vi.mock('../../cloud189/dirfilelist', () => ({ cloud189Request: vi.fn() }))
import { cloud189Request } from '../../cloud189/dirfilelist'
import { refreshQuarkAccountInfo } from '../../quark/auth'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('provider capacity refresh', () => {
  it('refreshes capacity even when the independent Quark identity endpoint fails', async () => {
    vi.mocked(refreshQuarkAccountInfo).mockRejectedValue(new Error('identity endpoint unavailable'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { total_capacity: 1000, use_capacity: 250 } }) }))
    const token = { access_token: 'test-cookie', user_id: 'quark_test', total_size: 500, used_size: 100 } as any
    expect(await refreshQuarkProfileAndQuota(token)).toBe(true)
    expect(token).toMatchObject({ user_id: 'quark_test', total_size: 1000, used_size: 250 })
  })

  it('does not let a successful identity response mask quota failure or erase the previous quota', async () => {
    const token = { access_token: 'test-cookie', total_size: 500, used_size: 100 } as any
    vi.mocked(refreshQuarkAccountInfo).mockResolvedValue({ ...token, nick_name: 'Updated' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ code: 31001 }) }))
    expect(await refreshQuarkProfileAndQuota(token)).toBe(false)
    expect(token).toMatchObject({ total_size: 500, used_size: 100, nick_name: 'Updated' })
  })

  it.each([[undefined, 0], [100, null], ['', 0], ['NaN', 0], [100, -1], [Infinity, 1]])('preserves the previous capacity for invalid values %s/%s', (total, used) => {
    const token = { total_size: 500, used_size: 100, free_size: 400, spaceinfo: 'previous' } as any
    expect(applyQuotaValues(token, total, used)).toBe(false)
    expect(token).toEqual({ total_size: 500, used_size: 100, free_size: 400, spaceinfo: 'previous' })
  })

  it('uses Quark member capacity rather than identity fields or used_capacity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { total_capacity: '1000', use_capacity: '250' } }) })
    vi.stubGlobal('fetch', fetchMock)
    const token = { access_token: 'test-cookie', user_id: 'quark_test' } as any
    expect(await applyQuarkQuota(token)).toBe(true)
    expect(token).toMatchObject({ total_size: 1000, used_size: 250, free_size: 750 })
    const [url, options] = fetchMock.mock.calls[0]
    expect(new URL(url).pathname).toBe('/1/clouddrive/member')
    expect(options).toMatchObject({ credentials: 'include', headers: { Cookie: 'test-cookie' } })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps the last quota on an expired Quark session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 31001 }) }))
    const token = { access_token: 'expired-test-cookie', total_size: 1000, used_size: 250 } as any
    expect(await applyQuarkQuota(token)).toBe(false)
    expect(token.total_size).toBe(1000)
    expect(token.used_size).toBe(250)
  })

  it('loads Tianyi personal capacity through the signed request for the exact account', async () => {
    vi.mocked(cloud189Request).mockResolvedValue({
      cloudCapacityInfo: { totalSize: 1000, usedSize: 200 },
      familyCapacityInfo: { totalSize: 5000, usedSize: 4500 }
    })
    const token = { user_id: 'cloud189_test' } as any
    expect(await applyCloud189Quota(token)).toBe(true)
    expect(cloud189Request).toHaveBeenCalledWith('cloud189_test', 'portal/getUserSizeInfo.action', {})
    expect(token).toMatchObject({ total_size: 1000, used_size: 200, free_size: 800 })
  })

  it('does not report a failed Tianyi quota read as an empty account', async () => {
    vi.mocked(cloud189Request).mockRejectedValue(new Error('timeout'))
    const token = { user_id: 'cloud189_test', total_size: 1000, used_size: 200 } as any
    expect(await applyCloud189Quota(token)).toBe(false)
    expect(token.total_size).toBe(1000)
    expect(token.used_size).toBe(200)
  })
})
