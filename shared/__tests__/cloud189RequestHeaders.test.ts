import { describe, expect, it } from 'vitest'
import { CLOUD189_DATE_TRANSPORT_HEADER, restoreCloud189DateHeader } from '../cloud189RequestHeaders'

describe('Tianyi Cloud signed request headers', () => {
  it('restores a valid marked Date header for signed Cloud189 requests', () => {
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
    expect(restoreCloud189DateHeader('https://provider-upload.example/upload', headers)).toEqual({
      Date: 'Thu, 04 Sep 2026 01:02:03 GMT', SessionKey: 'session-key', Signature: 'signature'
    })
    expect(restoreCloud189DateHeader('https://upload.cloud.189.cn/person/initMultiUpload', headers)).toEqual({
      Date: 'Thu, 04 Sep 2026 01:02:03 GMT', SessionKey: 'session-key', Signature: 'signature'
    })
    expect(restoreCloud189DateHeader('https://cloudcube-jswx-person.oss-cn-east-1.aliyuncs.com/PERSONCLOUD/file', headers)).toEqual({
      Date: 'Thu, 04 Sep 2026 01:02:03 GMT', SessionKey: 'session-key', Signature: 'signature'
    })
  })

  it('does not invent a Date header when the transport header is absent', () => {
    const headers = { SessionKey: 'session-key', Signature: 'signature' }
    expect(restoreCloud189DateHeader('https://api.cloud.189.cn/listFiles.action', headers)).toEqual(headers)
  })
})
