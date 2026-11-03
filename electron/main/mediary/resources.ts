import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { createAgentProviderConfig } from '@mediary/agent-model'
import type { ResourceType } from '@mediary/domain'
import { PanSouResourceProvider } from '@mediary/pansou-provider'
import type { ResourceProvider } from '@mediary/ports'
import { allowedResourceTypesForKinds, getStorageBrand } from '@mediary/storage-brands'
import { TmdbMetadataProvider } from '@mediary/tmdb-provider'
import type { MediaryRuntimeConfig } from '@shared/types/mediary'
import { requestPanHub } from '../core/panHubRequest'

/** boxplayer-ai-api bills agent traffic under this feature (same as the AI search agent). */
const MODEL_FEATURE = 'ai_search'

export function createMediaryModel(config: MediaryRuntimeConfig): LanguageModel {
  if (!config.model) throw new Error('未配置 AI 模型。请在「设置 → AI 模型」中选择 BoxPlayer AI 或填写自己的模型')
  const { providerSettings, modelId } = createAgentProviderConfig({ ...config.model })
  const provider = createOpenAICompatible({
    ...providerSettings,
    fetch: async (input, init) => {
      if (typeof init?.body !== 'string') return fetch(input, init)
      try {
        return fetch(input, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), feature: MODEL_FEATURE }) })
      } catch {
        return fetch(input, init)
      }
    }
  })
  return provider(modelId)
}

/**
 * PanSou search through BoxPlayer's own PanSou deployment, filtered to the link types
 * the target drive can transfer. BoxPlayer's 115 login can only offline-download, so
 * 115 share links are hidden from its agent.
 */
export function createMediaryResourceProvider(config: MediaryRuntimeConfig, storageBrand: string): ResourceProvider {
  const allowedTypes: ResourceType[] = storageBrand === 'pan115' ? ['magnet'] : allowedResourceTypesForKinds(getStorageBrand(storageBrand).resourceProviderKinds)
  return new PanSouResourceProvider({
    baseURL: config.boxplayerApiBaseURL,
    allowedTypes,
    fetchJson: async (url, init) => {
      const result = await requestPanHub({ url, method: init.method, headers: init.headers, body: init.body })
      if (!result.ok) throw new Error(`PanSou search failed with HTTP ${result.status}`)
      return result.data
    }
  })
}

/** TMDB metadata through BoxPlayer's TMDB proxy, so no TMDB key is needed. */
export function createMediaryMetadataProvider(config: MediaryRuntimeConfig): TmdbMetadataProvider {
  return new TmdbMetadataProvider({ accesses: [{ baseURL: `${config.boxplayerApiBaseURL.replace(/\/+$/, '')}/api/tmdb/proxy` }], language: 'zh-CN' })
}
