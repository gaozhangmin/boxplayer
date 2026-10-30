import { describe, expect, it } from 'vitest'
import { getOssExpiryTime } from '../ossExpiry'

const signingTime = Date.parse('2026-10-30T02:00:00Z')
const v4 = 'https://media.example/video.mkv?x-oss-date=20261030T020000Z&x-oss-expires=14400&x-oss-signature-version=OSS4-HMAC-SHA256'

describe('OSS media expiry', () => {
  it('does not mistake a valid V4 lifetime for a timestamp in 1970', () => {
    const expires = getOssExpiryTime(v4)
    expect(expires).toBe(signingTime + 14400 * 1000)
    // PageVideo refreshes at expiry minus one minute. Playback must not reload.
    expect(expires <= signingTime + 60_000).toBe(false)
    expect(expires <= signingTime + 14400 * 1000).toBe(true)
  })

  it('reads a legacy absolute timestamp even when it is the last parameter', () => {
    expect(getOssExpiryTime('https://media.example/video?x-oss-expires=1793332800')).toBe(1793332800000)
    expect(getOssExpiryTime('https://media.example/video?x-oss-expires=1793332800&signature=example')).toBe(1793332800000)
  })

  it('accepts stored encoded URLs and does not split encoded signature contents', () => {
    expect(getOssExpiryTime(encodeURIComponent(v4))).toBe(signingTime + 14400 * 1000)
    expect(getOssExpiryTime('https://media.example/video?signature=example%26x-oss-expires%3D1')).toBe(0)
  })

  it.each([
    '', '%malformed', 'https://media.example/video',
    'https://media.example/video?x-oss-expires=invalid',
    'https://media.example/video?x-oss-expires=-1',
    'https://media.example/video?x-oss-expires=1&x-oss-signature-version=OSS4-HMAC-SHA256',
    'https://media.example/video?x-oss-expires=1&x-oss-date=20260230T020000Z',
    'https://media.example/video?x-oss-expires=604801&x-oss-date=20261030T020000Z'
  ])('returns unknown expiry for malformed or unsupported input: %s', value => {
    expect(getOssExpiryTime(value)).toBe(0)
  })
})
