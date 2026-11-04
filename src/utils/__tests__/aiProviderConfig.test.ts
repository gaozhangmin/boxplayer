import { describe, expect, it } from 'vitest'
import { loadProviderConfig, saveProviderConfig } from '../aiProviderConfig'

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('AI provider configuration persistence', () => {
  it('refreshes an edited default with the newly saved model and endpoint', () => {
    const local = storage()
    saveProviderConfig('custom', { modelId: 'old-model', baseUrl: 'https://old.example/v1' }, '', local)
    const updated = saveProviderConfig('custom', { modelId: 'new-model', baseUrl: 'https://new.example/v1' }, 'custom', local)
    expect(updated.shouldSetAsDefault).toBe(true)
    expect(loadProviderConfig('custom', local)).toMatchObject({ modelId: 'new-model', baseUrl: 'https://new.example/v1' })
  })

  it('sets the first configuration as default but preserves another selected provider', () => {
    const local = storage()
    expect(saveProviderConfig('custom', { modelId: 'first' }, '', local).shouldSetAsDefault).toBe(true)
    expect(saveProviderConfig('deepseek', { modelId: 'second' }, 'custom', local).shouldSetAsDefault).toBe(false)
  })

  it('reports storage failure without claiming a successful save', () => {
    const local = storage()
    saveProviderConfig('custom', { modelId: 'original' }, '', local)
    expect(() => saveProviderConfig('custom', { modelId: 'replacement' }, 'custom', {
      getItem: local.getItem,
      setItem: () => { throw new Error('storage full') }
    })).toThrow('storage full')
    expect(loadProviderConfig('custom', local).modelId).toBe('original')
  })
})
