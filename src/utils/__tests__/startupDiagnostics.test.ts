import { describe, expect, it } from 'vitest'
import { summarizeStartupFailures } from '../startupDiagnostics'

describe('startup diagnostics', () => {
  it('classifies refresh failures without exposing secrets, URLs or account identifiers', () => {
    const logs = [{ logtype: 'danger', logmessage: 'ensureTokenReady pikpak HTTP 401 invalid_grant https://example.com?refresh_token=secret user@example.com' }]
    const result = summarizeStartupFailures(logs)
    expect(result).toEqual([{ provider: 'pikpak', reason: 'invalid_grant', httpStatus: 401 }])
    expect(JSON.stringify(result)).not.toMatch(/secret|example|token=/)
  })
  it('bounds diagnostics and excludes success messages', () => {
    expect(summarizeStartupFailures([{ logtype: 'success', logmessage: 'pikpak' }])).toEqual([])
    expect(summarizeStartupFailures(Array.from({ length: 30 }, () => ({ logtype: 'warning', logmessage: 'guangya timed out' })))).toHaveLength(20)
  })
})
