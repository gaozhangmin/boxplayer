import { describe, expect, it } from 'vitest'
import { buildUpstreamProxyHeaders, ensureInlinePreviewRange, normalizeProxyRangeHeaders, normalizeProxyStatusCode } from '../proxyHeaders'
import { shouldRefreshProxyUrl } from '../proxyCache'

describe('buildUpstreamProxyHeaders', () => {
  it('keeps range and media auth headers while dropping conditional and hop-by-hop headers', () => {
    const headers = buildUpstreamProxyHeaders({
      host: '127.0.0.1:4961',
      connection: 'keep-alive',
      range: 'bytes=32768-33051',
      'if-none-match': '"b968913fc5e95732a0646ac5c32db3db"',
      'accept-encoding': 'gzip, deflate, br',
      referer: 'https://www.aliyundrive.com/',
      authorization: 'Bearer local-token',
      'user-agent': 'Mozilla/5.0'
    }, JSON.stringify({
      'X-Emby-Authorization': 'MediaBrowser Token="server-token"',
      'X-Emby-Token': 'server-token'
    }))

    expect(headers.range).toBe('bytes=32768-33051')
    expect(headers['x-emby-authorization']).toBe('MediaBrowser Token="server-token"')
    expect(headers['x-emby-token']).toBe('server-token')
    expect(headers['accept-encoding']).toBe('identity')
    expect(headers.host).toBeUndefined()
    expect(headers.connection).toBeUndefined()
    expect(headers['if-none-match']).toBeUndefined()
    expect(headers.referer).toBeUndefined()
    expect(headers.authorization).toBeUndefined()
  })
})

describe('ensureInlinePreviewRange', () => {
  it('requests the complete PDF when an inline preview has no range request', () => {
    expect(ensureInlinePreviewRange({}, true).range).toBe('bytes=0-')
  })

  it('preserves PDF.js byte-range requests and leaves downloads unchanged', () => {
    expect(ensureInlinePreviewRange({ range: 'bytes=524288-589823' }, true).range).toBe('bytes=524288-589823')
    expect(ensureInlinePreviewRange({}, false).range).toBeUndefined()
  })
})

describe('normalizeProxyStatusCode', () => {
  it('marks a content-range response as partial even when the upstream incorrectly returns 200', () => {
    expect(normalizeProxyStatusCode(200, 'bytes 0-524287/21662389')).toBe(206)
  })

  it('keeps ordinary complete and already-partial responses unchanged', () => {
    expect(normalizeProxyStatusCode(200)).toBe(200)
    expect(normalizeProxyStatusCode(206, 'bytes 0-524287/21662389')).toBe(206)
  })
})

describe('normalizeProxyRangeHeaders', () => {
  it('keeps the accept-ranges value PDF.js requires when an upstream duplicates bytes', () => {
    expect(normalizeProxyRangeHeaders({ 'content-range': 'bytes 0-65535/36240717', 'accept-ranges': ['bytes', 'bytes'] })['accept-ranges']).toBe('bytes')
    expect(normalizeProxyRangeHeaders({ 'content-range': 'bytes 0-65535/36240717', 'accept-ranges': 'bytes, bytes' })['accept-ranges']).toBe('bytes')
  })

  it('does not rewrite unrelated range capabilities', () => {
    expect(normalizeProxyRangeHeaders({ 'content-range': 'bytes 0-65535/36240717', 'accept-ranges': ['bytes', 'none'] })['accept-ranges']).toEqual(['bytes', 'none'])
  })
})

describe('shouldRefreshProxyUrl', () => {
  it('does not refresh media server proxy urls through cloud drive APIs', () => {
    expect(shouldRefreshProxyUrl({
      driveId: 'media_server',
      proxyUrl: 'https://emby.example/Videos/1555651/stream',
      proxyInfo: {
        file_id: '1555651',
        expires_time: 1,
        videoQuality: 'Origin'
      },
      fileId: '1555651',
      selectQuality: 'FHD'
    })).toBe(false)
  })
})

describe('proxy response lifecycle', () => {
  it('ends the local response when an upstream stream closes before completing', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'src/utils/proxyhelper.ts'), 'utf8')

    expect(source).toContain("httpResp.on('aborted'")
    expect(source).toContain("httpResp.on('close', () => {")
    expect(source).toContain('if (!httpResp.complete) finishResponse(true)')
    expect(source).toContain('if (endClient && !clientRes.writableEnded) clientRes.end()')
    expect(source).toContain("if (proxyUrl.includes('.aliyuncs.com') && !isAuthenticatedMpvProxy)")
  })
})
