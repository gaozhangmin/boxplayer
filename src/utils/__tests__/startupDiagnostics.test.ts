import { describe, expect, it } from 'vitest'
import { summarizeStartupFailures, summarizeCloud123AuthResponse } from '../startupDiagnostics'

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

it('OAuth response diagnostics never expose credentials or arbitrary server messages', () => {
  const result = summarizeCloud123AuthResponse(400, { code: 401, error: 'invalid_grant', access_token: 'secret-access', refresh_token: 'secret-refresh', message: 'private-account' })
  expect(result).toEqual({ provider: 'cloud123', httpStatus: 400, providerCode: 401, reason: 'invalid_grant' })
  expect(JSON.stringify(result)).not.toMatch(/secret|private-account/)
  expect(summarizeCloud123AuthResponse(500, { error: 'secret-refresh', code: 'private-account' })).toEqual({ provider: 'cloud123', httpStatus: 500 })
})
