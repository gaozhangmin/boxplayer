import { describe, expect, it } from 'vitest'
import { resolveAgentModelEndpoint } from '../agentModelTransport.ts'

describe('resolveAgentModelEndpoint', () => {
  it('pins BoxPlayer Cloud to its configured OpenAI-compatible gateway', () => {
    expect(resolveAgentModelEndpoint({ providerName: 'boxplayer-cloud', endpoint: 'https://attacker.invalid/v1', cloudBaseUrl: 'https://api.xbyvideohub.com/' })).toBe('https://api.xbyvideohub.com/v1')
  })

  it('normalizes a BYOK endpoint but only permits local HTTP or HTTPS', () => {
    expect(resolveAgentModelEndpoint({ providerName: 'ollama', endpoint: 'http://127.0.0.1:11434/', cloudBaseUrl: '' })).toBe('http://127.0.0.1:11434')
    expect(() => resolveAgentModelEndpoint({ providerName: 'openai', endpoint: 'http://api.example.com/v1', cloudBaseUrl: '' })).toThrow('HTTPS')
  })
})
