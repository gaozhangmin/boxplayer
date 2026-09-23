import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { loadRealMediaServerE2EConfig, resolveRealMediaServerE2EConfig } = require('../real-media-server-e2e-config.cjs')

const credentialEnv = {
  BOXPLAYER_E2E_EMBY_JSON: JSON.stringify({
    url: 'https://emby.example.test/',
    username: 'ci-user',
    password: 'ci-password',
    userAgent: 'BoxPlayer E2E'
  })
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

describe('real media server E2E config', () => {
  it('accepts only URL, username, password, and userAgent', () => {
    expect(loadRealMediaServerE2EConfig(credentialEnv)).toEqual({
      type: 'emby', name: 'BoxPlayer E2E Emby', baseUrl: 'https://emby.example.test',
      username: 'ci-user', password: 'ci-password', userAgent: 'BoxPlayer E2E',
      accessToken: '', userId: '', deviceId: 'boxplayer-github-actions', mediaTitle: ''
    })
  })

  it('logs in and discovers a playable media title without exposing credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ AccessToken: 'temporary-token', User: { Id: 'user-id' } }))
      .mockResolvedValueOnce(jsonResponse({ Items: [{ Id: 'video-id', Name: 'CI Sample' }] }))
    await expect(resolveRealMediaServerE2EConfig(credentialEnv, fetchMock)).resolves.toEqual({
      type: 'emby', name: 'BoxPlayer E2E Emby', baseUrl: 'https://emby.example.test', accessToken: 'temporary-token', userId: 'user-id',
      deviceId: 'boxplayer-github-actions', userAgent: 'BoxPlayer E2E', mediaTitle: 'CI Sample'
    })
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://emby.example.test/Users/AuthenticateByName', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ Username: 'ci-user', Pw: 'ci-password' }), headers: expect.objectContaining({ 'User-Agent': 'BoxPlayer E2E' })
    }))
    expect(fetchMock.mock.calls[1][0]).toContain('/Users/user-id/Items?')
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ 'User-Agent': 'BoxPlayer E2E', 'X-Emby-Token': 'temporary-token' })
  })

  it('keeps the legacy accessToken/userId format compatible', async () => {
    const env = { BOXPLAYER_E2E_EMBY_JSON: JSON.stringify({ baseUrl: 'https://emby.example.test', accessToken: 'legacy-token', userId: 'legacy-user', mediaTitle: 'Fixed Sample' }) }
    const fetchMock = vi.fn()
    await expect(resolveRealMediaServerE2EConfig(env, fetchMock)).resolves.toMatchObject({ accessToken: 'legacy-token', userId: 'legacy-user', mediaTitle: 'Fixed Sample' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when the login identity is incomplete', () => {
    expect(() => loadRealMediaServerE2EConfig({ BOXPLAYER_E2E_EMBY_JSON: JSON.stringify({ url: 'https://emby.example.test', username: 'ci-user' }) })).toThrow(/password must be a string/)
  })

  it('rejects a userAgent that could inject authorization fields', () => {
    expect(() => loadRealMediaServerE2EConfig({ BOXPLAYER_E2E_EMBY_JSON: JSON.stringify({ url: 'https://emby.example.test', username: 'ci-user', password: 'secret', userAgent: 'bad", Token="leak' }) })).toThrow(/unsupported characters/)
  })

  it('reports an authentication failure without echoing username or password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 401))
    await expect(resolveRealMediaServerE2EConfig(credentialEnv, fetchMock)).rejects.toThrow('Emby login failed (401)')
  })
})
