import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { loadRealMediaServerE2EConfig } = require('../real-media-server-e2e-config.cjs')

describe('real media server E2E config', () => {
  it('normalizes an Emby target without logging credentials', () => {
    expect(loadRealMediaServerE2EConfig({ BOXPLAYER_E2E_EMBY_JSON: JSON.stringify({ baseUrl: 'https://emby.example.test/', accessToken: 'secret', userId: 'user', mediaTitle: 'E2E Sample' }) })).toEqual({
      type: 'emby', name: 'BoxPlayer E2E Emby', baseUrl: 'https://emby.example.test', accessToken: 'secret', userId: 'user', deviceId: 'boxplayer-github-actions', mediaTitle: 'E2E Sample'
    })
  })

  it('fails closed when playback identity is incomplete', () => {
    expect(() => loadRealMediaServerE2EConfig({ BOXPLAYER_E2E_EMBY_JSON: '{}' })).toThrow(/accessToken is required/)
  })
})
