import { describe, expect, it } from 'vitest'
import { sanitizeMpvDiagnostic } from '../../../../shared/mpvDiagnostics'

describe('native MPV diagnostics', () => {
  it('retains actionable HTTP and TLS failures without signed URLs', () => {
    expect(sanitizeMpvDiagnostic('ffmpeg: HTTP error 403 at https://example.com/video?secret=abc'))
      .toBe('ffmpeg: HTTP error 403 at [media URL]')
    expect(sanitizeMpvDiagnostic('tls: connection timed out')).toBe('tls: connection timed out')
  })
  it('removes credential-bearing lines and bounds native output', () => {
    expect(sanitizeMpvDiagnostic('Cookie: private\nAuthorization: Bearer abc\nloading failed'))
      .toBe('[redacted source diagnostic]\n[redacted source diagnostic]\nloading failed')
    expect(sanitizeMpvDiagnostic('x'.repeat(4000))).toHaveLength(2000)
  })
})
