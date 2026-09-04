import { describe, expect, it } from 'vitest'
import { CLOUD189_DATE_TRANSPORT_HEADER, restoreCloud189DateHeader } from '../cloud189RequestHeaders'

describe('Tianyi Cloud signed request headers', () => {
  it('restores the browser-forbidden Date header only for the official API host', () => {
    const headers = {
      [CLOUD189_DATE_TRANSPORT_HEADER]: 'Thu, 04 Sep 2026 01:02:03 GMT',
      SessionKey: 'session-key',
      Signature: 'signature'
    }

    expect(restoreCloud189DateHeader('https://api.cloud.189.cn/listFiles.action', headers)).toEqual({
      Date: 'Thu, 04 Sep 2026 01:02:03 GMT',
      SessionKey: 'session-key',
      Signature: 'signature'
    })
    expect(restoreCloud189DateHeader('https://example.com/listFiles.action', headers)).toEqual(headers)
  })

  it('does not invent a Date header when the transport header is absent', () => {
    const headers = { SessionKey: 'session-key', Signature: 'signature' }
    expect(restoreCloud189DateHeader('https://api.cloud.189.cn/listFiles.action', headers)).toEqual(headers)
  })
})
