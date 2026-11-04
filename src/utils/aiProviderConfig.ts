export interface ProviderConfig { apiKey: string; modelId: string; embeddingModelId: string; baseUrl: string }

type ConfigStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadProviderConfig(provider: string, storage: ConfigStorage = localStorage): ProviderConfig {
  try {
    const raw = storage.getItem(`ai_provider_config_${provider}`)
    if (raw) return { apiKey: '', modelId: '', embeddingModelId: '', baseUrl: '', ...JSON.parse(raw) }
  } catch {}
  return { apiKey: '', modelId: '', embeddingModelId: '', baseUrl: '' }
}

export function saveProviderConfig(provider: string, fields: Partial<ProviderConfig>, currentDefault: string, storage: ConfigStorage = localStorage) {
  const config = { ...loadProviderConfig(provider, storage), ...fields }
  // Let storage errors reach the UI before updating the default or showing success.
  storage.setItem(`ai_provider_config_${provider}`, JSON.stringify(config))
  return { config, shouldSetAsDefault: !currentDefault || currentDefault === provider }
}
