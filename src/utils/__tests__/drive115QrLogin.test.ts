import fs from 'fs'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestDeviceCode } from '../drive115'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('115 QR login flow', () => {
  it('returns qrcode payload when 115 device code request succeeds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: 1,
        code: 0,
        errno: 0,
        data: {
          uid: 'uid-115',
          time: '1700000000',
          sign: 'sign-115',
          qrcode: 'https://115.com/scan?uid=uid-115'
        }
      })
    }) as any

    const res = await requestDeviceCode('client-115', 'challenge-abc')
    expect(res).toEqual({
      uid: 'uid-115',
      time: '1700000000',
      sign: 'sign-115',
      qrcode: 'https://115.com/scan?uid=uid-115',
      error: ''
    })
  })

  it('returns an error when 115 response omits qrcode content even if uid exists', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: 1,
        code: 0,
        data: {
          uid: 'uid-only',
          time: '1700000000',
          sign: 'sign-115',
          qrcode: ''
        }
      })
    }) as any

    const res = await requestDeviceCode('client-115', 'challenge-abc')
    expect(res.error).toBe('获取二维码失败')
  })

  it('renders 115 login QR locally via AntQRCode without external qrserver or clipping wrapper', () => {
    const vuePath = path.resolve(process.cwd(), 'src/user/UserLogin.vue')
    const source = fs.readFileSync(vuePath, 'utf8')
    const start = source.indexOf(`<div v-else-if="loginProvider === '115'">`)
    const end = source.indexOf(`<div v-else-if="loginProvider === '139'">`)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const block = source.slice(start, end)
    expect(block).toContain('<AntQRCode :value="drive115QrContent"')
    expect(block).not.toContain('class="loginframe"')
    expect(source).not.toContain('buildQrImageUrl')
    expect(source).not.toContain('api.qrserver.com')
  })
})
