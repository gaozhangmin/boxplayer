import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildQuarkCookieString, completeQuarkQrLogin, createQuarkTokenFromCookies, pollQuarkQrStatus, refreshQuarkAccountInfo, requestQuarkQrCode } from '../auth'

afterEach(() => vi.unstubAllGlobals())

describe('buildQuarkCookieString', () => {
  it('keeps quark cookies in request header format', () => {
    const cookie = buildQuarkCookieString([
      { name: '__uid', value: 'u1', domain: '.quark.cn' },
      { name: '__kps', value: 'kps1', domain: '.pan.quark.cn' },
      { name: 'other', value: 'ignored', domain: '.example.com' }
    ] as any)

    expect(cookie).toBe('__uid=u1; __kps=kps1')
  })

  it('deduplicates same-name cookies from different Quark subdomains', () => {
    const cookie = buildQuarkCookieString([
      { name: '__pus', value: 'old', domain: '.pan.quark.cn' },
      { name: '__pus', value: 'current', domain: '.drive-pc.quark.cn' }
    ] as any)

    expect(cookie).toBe('__pus=current')
  })
})

describe('createQuarkTokenFromCookies', () => {
  it('creates a desktop token from browser cookies and account info', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 200,
        data: {
          uid: '12345',
          nickname: 'Quark User',
          avatar_url: 'https://avatar'
        }
      })
    }))

    const token = await createQuarkTokenFromCookies('__uid=12345; __kps=kps1; __pus=pus1')

    expect(token.tokenfrom).toBe('quark')
    expect(token.access_token).toBe('__uid=12345; __kps=kps1; __pus=pus1')
    expect(token.user_id).toBe('quark_12345')
    expect(token.nick_name).toBe('Quark User')
    expect(token.default_drive_id).toBe('quark')
  })

  it('rejects a guest-only cookie before accepting it as an account credential', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createQuarkTokenFromCookies('__puus=guest')).rejects.toThrow('夸克登录 Cookie 无效')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the display name from nested member info and camel-case fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          member_info: {
            uid: '12345',
            nickName: '夸克昵称'
          }
        }
      })
    }))

    const token = await createQuarkTokenFromCookies('__uid=12345; __kps=kps1; __pus=pus1')

    expect(token.user_id).toBe('quark_12345')
    expect(token.nick_name).toBe('夸克昵称')
  })

  it('does not expose the cookie uid as the account display name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} })
    }))

    const token = await createQuarkTokenFromCookies('__uid=AAQKNprO2OEl; __kps=kps1; __pus=pus1')

    expect(token.user_id).toBe('quark_AAQKNprO2OEl')
    expect(token.nick_name).toBe('夸克用户')
  })

  it('refreshes the display name without changing the stored account id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { uid: 'new-provider-id', nickname: '更新后的昵称' }
      })
    }))

    const token = await refreshQuarkAccountInfo({
      tokenfrom: 'quark',
      user_id: 'quark_existing-id',
      access_token: '__uid=new-provider-id; __kps=kps1; __pus=pus1',
      default_drive_id: 'quark',
      total_size: 1000, used_size: 200, free_size: 800, spaceinfo: 'previous'
    } as any)

    expect(token.user_id).toBe('quark_existing-id')
    expect(token.nick_name).toBe('更新后的昵称')
    expect(token).toMatchObject({ total_size: 1000, used_size: 200, free_size: 800, spaceinfo: 'previous' })
  })
})

describe('requestQuarkQrCode', () => {
  it('gets a QR token and image URL from Quark login API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 2000000,
        data: { members: { token: 'qr-token' } }
      })
    }))

    const result = await requestQuarkQrCode()

    expect(result.token).toBe('qr-token')
    expect(result.qrUrl).toContain('https://su.quark.cn/4_eMHBJ')
    expect(result.qrImageUrl).toContain('api.qrserver.com')
  })
})

describe('completeQuarkQrLogin', () => {
  it('creates token from service ticket account info without a second validation request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: 200,
        data: {
          uid: '12345',
          nickname: 'Quark User'
        }
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {
      WebGetCookies: vi.fn().mockResolvedValue([
        { name: '__uid', value: '12345', domain: '.quark.cn' },
        { name: '__kps', value: 'kps1', domain: '.quark.cn' },
        { name: '__pus', value: 'pus1', domain: '.quark.cn' }
      ])
    })

    const token = await completeQuarkQrLogin('service-ticket')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('st=service-ticket')
    expect(token.access_token).toBe('__uid=12345; __kps=kps1; __pus=pus1')
    expect(token.user_id).toBe('quark_12345')
    expect(token.nick_name).toBe('Quark User')
  })

  it('accepts Quark account info success response shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        success: true,
        data: {
          nickname: '高章敏',
          avatarUri: 'http://image.quark.cn/avatar.jpg',
          mobile: ''
        }
      })
    }))
    vi.stubGlobal('window', {
      WebGetCookies: vi.fn().mockResolvedValue([
        { name: '__uid', value: '666', domain: '.quark.cn' },
        { name: '__kps', value: 'kps1', domain: '.quark.cn' },
        { name: '__pus', value: 'pus1', domain: '.quark.cn' }
      ])
    })

    const token = await completeQuarkQrLogin('service-ticket')

    expect(token.user_id).toBe('quark_666')
    expect(token.nick_name).toBe('高章敏')
    expect(token.avatar).toBe('http://image.quark.cn/avatar.jpg')
  })

  it('uses a stable internal account id when Quark account info has no uid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        success: true,
        data: {
          nickname: 'Quark User'
        }
      })
    }))
    vi.stubGlobal('window', {
      WebGetCookies: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { name: '__kps', value: 'kps-secret', domain: '.quark.cn' },
          { name: '__pus', value: 'pus-secret', domain: '.quark.cn' }
        ])
        .mockResolvedValue([])
    })

    const token = await completeQuarkQrLogin('service-ticket')

    expect(token.user_id).toMatch(/^quark_cookie_/)
    expect(token.nick_name).toBe('Quark User')
    expect(token.access_token).toContain('__kps=kps-secret')
  })

  it('uses Electron main process account info result with Set-Cookie cookies', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('window', {
      WebQuarkAccountInfo: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: JSON.stringify({
          success: true,
          data: {
            nickname: 'Quark User'
          }
        }),
        cookies: [
          { name: '__kps', value: 'kps-secret', domain: '.quark.cn' },
          { name: '__pus', value: 'pus-secret', domain: '.quark.cn' }
        ]
      })
    })

    const token = await completeQuarkQrLogin('service-ticket')

    expect(window.WebQuarkAccountInfo).toHaveBeenCalledWith({ serviceTicket: 'service-ticket' })
    expect(fetch).not.toHaveBeenCalled()
    expect(token.access_token).toBe('__kps=kps-secret; __pus=pus-secret')
    expect(token.user_id).toMatch(/^quark_cookie_/)
  })

  it('rejects account info cookies that do not include Quark auth cookies', async () => {
    vi.stubGlobal('window', {
      WebQuarkAccountInfo: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: JSON.stringify({ success: true, data: { nickname: 'Guest' } }),
        cookies: [
          { name: 'b-user-id', value: 'visitor', domain: '.quark.cn' },
          { name: '_UP_D_', value: 'pc', domain: '.quark.cn' }
        ]
      })
    })

    await expect(completeQuarkQrLogin('service-ticket')).rejects.toThrow('未获取到夸克登录 Cookie')
  })

  it('includes Quark account response details when service ticket exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: 'Forbidden' })
    }))

    await expect(completeQuarkQrLogin('service-ticket')).rejects.toThrow('HTTP 403：Forbidden')
  })
})

describe('pollQuarkQrStatus', () => {
  it('returns service ticket when QR login is confirmed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 2000000,
        message: 'ok',
        data: { members: { service_ticket: 'st-1' } }
      })
    }))

    const result = await pollQuarkQrStatus('qr-token')

    expect(result.status).toBe('confirmed')
    expect(result.serviceTicket).toBe('st-1')
  })

  it('treats empty query result as waiting without exposing API wording', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 50004001,
        message: 'Query result is empty'
      })
    }))

    const result = await pollQuarkQrStatus('qr-token')

    expect(result.status).toBe('waiting')
    expect(result.message).toBe('请使用夸克 App 扫码')
  })

  it('treats token not found as an expired QR code with friendly wording', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 50004002,
        message: 'Token Not Found'
      })
    }))

    const result = await pollQuarkQrStatus('qr-token')

    expect(result.status).toBe('expired')
    expect(result.message).toBe('二维码已失效，请刷新')
  })
})
