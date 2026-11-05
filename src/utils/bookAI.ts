import { createGateway, generateText, streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { getAIProvider } from '../services/ai/providers'
import type { AISettings } from '../services/ai/types'
import { DEFAULT_AI_SETTINGS } from '../services/ai/constants'
import { aiStore } from '../services/ai/storage/aiStore'
import { withRetryAndTimeout, AI_TIMEOUTS } from '../services/ai/utils/retry'
import { chunkSection, SIZE_PER_PAGE } from '../services/ai/utils/chunker'
import useSettingStore from '../setting/settingstore'
import { isPro } from './usageLimit'
import { completeBoxPlayerCloudChat, isBoxPlayerCloudProvider, streamBoxPlayerCloudChat } from './boxplayerCloudAI'

// ── re‑exports for backward compat ──────────────────────────────────
export type { AISettings as BookAISettings } from '../services/ai/types'
export type { TextChunk, ScoredChunk } from '../services/ai/types'
export { chunkSection, SIZE_PER_PAGE } from '../services/ai/utils/chunker'
export { aiStore } from '../services/ai/storage/aiStore'
export { withRetryAndTimeout, AI_TIMEOUTS } from '../services/ai/utils/retry'

// ── bridge types (unchanged from original bookAI) ───────────────────
export type BookAIMode = 'ask' | 'chat'

export interface AIModelConfig {
  endpoint: string
  modelId: string
  apiKey: string
  providerName: string
}

export interface BookAIChapterSnapshot {
  index: number; title: string; text: string; href?: string
}

export interface BookAIContextSource {
  bookId: string; sourceHash?: string; title: string; author?: string
  chapters: BookAIChapterSnapshot[]; currentPosition?: unknown
  visibleText?: string; chapterText?: string
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface BookAIRequestInput {
  mode: BookAIMode; question: string; history: ChatMessage[]
  bookName: string; chapterTitle: string; chapterText?: string
  ragContext?: import('../services/ai/types').ScoredChunk[]
  spoilerProtection?: boolean
}

export interface BookAIRequest { system: string; messages: ChatMessage[] }

// ── settings bridge ─────────────────────────────────────────────────
const PROVIDER_ENDPOINTS: Record<string, string> = {
  'boxplayer-cloud': '',
  ollama: 'http://127.0.0.1:11434',
  'ai-gateway': '',
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  moonshot: 'https://api.moonshot.cn/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  openrouter: 'https://openrouter.ai/api/v1',
}

interface StoredAIProviderConfig {
  apiKey?: string
  modelId?: string
  baseUrl?: string
}

function findSoleStoredBYOKConfig(): AIModelConfig | null {
  if (typeof localStorage === 'undefined') return null
  const prefix = 'ai_provider_config_'
  const configs: AIModelConfig[] = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      const provider = key.slice(prefix.length)
      if (!provider || isBoxPlayerCloudProvider(provider)) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const config = JSON.parse(raw) as StoredAIProviderConfig
      const modelId = config.modelId?.trim() || ''
      const apiKey = config.apiKey?.trim() || ''
      if (!modelId || (provider !== 'ollama' && !apiKey)) continue
      configs.push({ endpoint: config.baseUrl?.trim() || PROVIDER_ENDPOINTS[provider] || '', modelId, apiKey, providerName: provider })
    }
  } catch {
    return null
  }
  return configs.length === 1 ? configs[0] : null
}

function buildAISettings(): AISettings {
  const store = useSettingStore()
  const savedProvider = (store.apiAIModelProvider as string) || ''
  const effectiveConfig = getAIConfig()
  const provider = effectiveConfig?.providerName || ''
  // Pro uses the built-in provider when no provider was explicitly saved.
  const baseUrl = savedProvider ? store.apiAIBaseUrl || PROVIDER_ENDPOINTS[provider] || '' : effectiveConfig?.endpoint || PROVIDER_ENDPOINTS[provider] || ''
  return {
    provider: provider as any,
    ollamaUrl: baseUrl || DEFAULT_AI_SETTINGS.ollamaUrl,
    ollamaModel: store.apiAIModelId || DEFAULT_AI_SETTINGS.ollamaModel,
    ollamaEmbeddingModel: store.apiAIEmbeddingModelId || DEFAULT_AI_SETTINGS.ollamaEmbeddingModel,
    aiGatewayApiKey: effectiveConfig?.apiKey || '',
    aiGatewayModel: effectiveConfig?.modelId || DEFAULT_AI_SETTINGS.aiGatewayModel,
    aiGatewayEmbeddingModel: store.apiAIEmbeddingModelId || DEFAULT_AI_SETTINGS.aiGatewayEmbeddingModel,
    openRouterApiKey: effectiveConfig?.apiKey || '',
    openRouterBaseUrl: baseUrl,
    openRouterModel: effectiveConfig?.modelId || DEFAULT_AI_SETTINGS.openRouterModel,
    openRouterEmbeddingModel: store.apiAIEmbeddingModelId || DEFAULT_AI_SETTINGS.openRouterEmbeddingModel,
    spoilerProtection: store.apiAISpoilerProtection,
    maxContextChunks: store.apiAIMaxContextChunks || 10,
    indexingMode: (store.apiAIIndexingMode as any) || 'on-demand',
    reedy: { enabled: isBoxPlayerCloudProvider(provider) ? true : store.apiAIReedyEnabled, runtime: store.apiAIReedyRuntime || 'pi-agent' },
  }
}

export function getAIConfig(): AIModelConfig | null {
  const store = useSettingStore()
  const provider = store.apiAIModelProvider
  if (!provider) {
    if (isPro()) return { endpoint: '', modelId: 'deepseek/deepseek-v4-pro', apiKey: '', providerName: 'boxplayer-cloud' }
    return findSoleStoredBYOKConfig()
  }
  if (isBoxPlayerCloudProvider(provider)) return { endpoint: '', modelId: store.apiAIModelId || 'deepseek/deepseek-v4-pro', apiKey: '', providerName: provider }
  if (!store.apiAIModelId || (provider !== 'ollama' && !store.apiAIModelKey)) return null
  return { endpoint: store.apiAIBaseUrl || PROVIDER_ENDPOINTS[provider] || '', modelId: store.apiAIModelId, apiKey: store.apiAIModelKey || '', providerName: provider }
}

export function migrateSoleSavedBYOKAsDefault(): boolean {
  const store = useSettingStore()
  if (store.apiAIModelProvider || isPro()) return false
  const config = findSoleStoredBYOKConfig()
  if (!config) return false
  let embeddingModelId = ''
  try {
    const raw = localStorage.getItem(`ai_provider_config_${config.providerName}`)
    if (raw) embeddingModelId = (JSON.parse(raw) as { embeddingModelId?: string }).embeddingModelId || ''
  } catch {}
  store.updateStore({
    apiAIModelProvider: config.providerName,
    apiAIModelKey: config.apiKey,
    apiAIModelId: config.modelId,
    apiAIEmbeddingModelId: embeddingModelId,
    apiAIBaseUrl: config.endpoint
  })
  return true
}

export function isAIConfigured(): boolean { return !!getAIConfig() }

export function createBookAISettings(overrides: Partial<AISettings> = {}): AISettings {
  return { ...buildAISettings(), ...overrides }
}

// ── model factory (kept for backward compat) ────────────────────────
function createAIModel(config: AIModelConfig) {
  if (config.providerName === 'ai-gateway') return createGateway({ apiKey: config.apiKey })(config.modelId)
  const provider = createOpenAI({ name: config.providerName || 'openai-compatible', apiKey: config.apiKey, baseURL: config.endpoint })
  return provider.chat(config.modelId)
}

export function resolveAIProviderConfig(providerOverride = ''): AIModelConfig | null {
  const store = useSettingStore()
  const provider = providerOverride || store.apiAIModelProvider
  if (!provider) return getAIConfig()
  if (isBoxPlayerCloudProvider(provider)) {
    return { endpoint: '', modelId: store.apiAIModelId || 'deepseek/deepseek-v4-pro', apiKey: '', providerName: provider }
  }
  let modelId = store.apiAIModelId
  let apiKey = store.apiAIModelKey
  let baseUrl = store.apiAIBaseUrl
  if (providerOverride && providerOverride !== store.apiAIModelProvider) {
    try {
      const raw = localStorage.getItem(`ai_provider_config_${providerOverride}`)
      if (raw) {
        const cfg = JSON.parse(raw) as { apiKey: string; modelId: string; embeddingModelId: string; baseUrl: string }
        apiKey = cfg.apiKey
        modelId = cfg.modelId
        baseUrl = cfg.baseUrl
      }
    } catch {}
  }
  if (!modelId) return null
  if (provider !== 'ollama' && !apiKey) return null
  return { endpoint: baseUrl || PROVIDER_ENDPOINTS[provider] || '', modelId, apiKey, providerName: provider }
}

// ── prompt builder ──────────────────────────────────────────────────
export function buildBookAIRequest(input: BookAIRequestInput): BookAIRequest {
  const bookName = input.bookName || '未知书籍'
  const chapterTitle = input.chapterTitle || '未知章节'
  const history = input.history.filter((m) => !(m.role === 'user' && m.content.startsWith('你是阅读助手')))
  const prompt = input.question.trim()
  const ragPassages = (input.ragContext || []).slice(0, 8)
    .map((c, i) => `[${i + 1}] ${c.chapterTitle || '未知章节'} · p.${c.pageNumber + 1}\n${c.text}`)
    .join('\n\n')
  const askContext = ragPassages || (input.chapterText || '').slice(0, 5000)
  const spoilerRule = input.spoilerProtection === false ? '' : '\n只根据已提供的章节内容或检索片段回答。不要使用训练知识剧透后续情节；如果上下文不足，请明确说明需要更多已读内容。'
  const system = input.mode === 'ask'
    ? `你是阅读助手，帮助用户理解正在阅读的书籍。关于本章节的问题，简洁精准，引用原文时注明出处。${spoilerRule}\n\n当前书籍：《${bookName}》\n当前章节：${chapterTitle}\n\n可用内容：\n${askContext}`
    : `你是阅读助手，与用户讨论书籍《${bookName}》。当前正在阅读章节「${chapterTitle}」。`
  return { system, messages: [...history, { role: 'user', content: prompt }] }
}

// ── streaming chat (unchanged core logic) ───────────────────────────
interface SSECallback { onToken: (text: string) => void; onDone: () => void; onError: (err: string) => void }

export async function chatStreamCompletion(
  config: AIModelConfig, request: BookAIRequest, callback: SSECallback, options: { idleTimeoutMs?: number } = {}
): Promise<void> {
  if (isBoxPlayerCloudProvider(config.providerName)) {
    await streamBoxPlayerCloudChat({
      feature: 'reader_chat',
      messages: [{ role: 'system', content: request.system }, ...request.messages]
    }, callback)
    return
  }

  const model = createAIModel(config)
  try {
    const result = streamText({ model, system: request.system, messages: request.messages })
    let hasText = false
    for await (const part of result.textStream) {
      if (part) { hasText = true; callback.onToken(part) }
    }
    if (!hasText) {
      const { generateText } = await import('ai')
      const { text } = await generateText({ model, system: request.system, messages: request.messages })
      if (!text.trim()) throw new Error('AI 没有返回内容')
      callback.onToken(text)
    }
    callback.onDone()
  } catch (e: any) {
    callback.onError(e?.message || '请求失败')
  }
}

export async function generateAIText(config: AIModelConfig, prompt: string, maxOutputTokens = 3000): Promise<string> {
  if (isBoxPlayerCloudProvider(config.providerName)) {
    return completeBoxPlayerCloudChat({
      feature: 'reader_chat',
      messages: [{ role: 'user', content: prompt }]
    })
  }

  const { generateText } = await import('ai')
  const result = await generateText({ model: createAIModel(config), prompt, maxOutputTokens })
  return result.text
}

// ── test connection (uses new provider healthCheck) ─────────────────
export async function testAIConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const s = buildAISettings()
    const store = useSettingStore()

    // Validate config
    const modelId = store.apiAIModelId
    if (!modelId) return { ok: false, message: '请先选择或输入 AI 模型' }
    if (isBoxPlayerCloudProvider(s.provider)) {
      const { isPro } = await import('../utils/usageLimit')
      if (!isPro()) return { ok: false, message: '内置 AI 需购买 Pro 后使用' }
      await completeBoxPlayerCloudChat({
        feature: 'reader_chat',
        messages: [{ role: 'user', content: '请只回复 OK' }]
      })
      return { ok: true, message: '连接成功' }
    }
    if (s.provider !== 'ollama' && !store.apiAIModelKey) return { ok: false, message: '请先填写 API Key' }

    const provider = getAIProvider(s)
    const result = await provider.healthCheck()

    if (result.ok) return { ok: true, message: '连接成功' }

    if (result.error) return { ok: false, message: result.error }

    // Check basic connectivity
    const available = await provider.isAvailable()
    if (!available) return { ok: false, message: s.provider === 'ollama' ? '无法连接 Ollama，请确认服务已启动' : '无法连接到 API 端点，请检查 Base URL 和网络' }

    return { ok: false, message: 'API 已连通但模型调用失败，请检查 Model ID 是否正确' }
  } catch (e: any) {
    return { ok: false, message: e?.message || '连接失败' }
  }
}

// ── RAG helpers (delegated to services/ai) ──────────────────────────
export { default as DB } from './db'

export function hashBookAISettings(settings: AISettings): string {
  return [settings.provider, settings.aiGatewayModel || settings.ollamaModel, settings.aiGatewayEmbeddingModel || settings.ollamaEmbeddingModel, settings.maxContextChunks, settings.spoilerProtection ? 'sp' : 'ns'].join('|')
}

export function hashBookAISource(source: BookAIContextSource): string {
  return source.sourceHash || `${source.bookId}:${source.chapters.length}:${source.chapters.reduce((s, c) => s + c.text.length, 0)}`
}

export async function migrateLegacyAIHistory(
  bookId: string, mode: BookAIMode, storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage
): Promise<void> {
  const key = `bookAI.history.${bookId || 'global'}.${mode}`
  const raw = storage.getItem(key)
  if (!raw) return
  try {
    const messages = JSON.parse(raw) as ChatMessage[]
    if (Array.isArray(messages) && messages.length) {
      const conversationId = `${bookId || 'global'}:${mode}`
      await aiStore.ensureConversationIndex(conversationId)
      await aiStore.saveMessagesBatch(messages.map((msg, i) => ({
        id: `${conversationId}:${Date.now()}:${i}`,
        conversationId,
        role: msg.role,
        content: msg.content,
        createdAt: Date.now() + i,
      })))
    }
  } finally { storage.removeItem(key) }
}

export async function loadAIConversationMessages(bookId: string, mode: BookAIMode): Promise<ChatMessage[]> {
  const msgs = await aiStore.getMessages(`${bookId || 'global'}:${mode}`)
  return msgs.map((m) => ({ role: m.role, content: m.content }))
}

export async function replaceAIConversationMessages(bookId: string, mode: BookAIMode, messages: ChatMessage[]): Promise<void> {
  const conversationId = `${bookId || 'global'}:${mode}`
  await aiStore.deleteMessages(conversationId)
  if (messages.length) {
    await aiStore.saveMessagesBatch(messages.map((msg, i) => ({
      id: `${conversationId}:${Date.now()}:${i}`,
      conversationId,
      role: msg.role,
      content: msg.content,
      createdAt: Date.now() + i,
    })))
  }
}

// ── RAG retrieval (delegates to LegacyIdbBackend) ───────────────────
import { LegacyIdbBackend } from '../services/ai/adapters'

export function createBookAISettings2(overrides: Partial<AISettings> = {}): AISettings {
  return createBookAISettings(overrides)
}

export function createLegacyRetrievalBackend() {
  const settings = buildAISettings()
  const backend = new LegacyIdbBackend(settings)
  return {
    id: 'legacy-idb' as const,
    indexBook: async (source: BookAIContextSource, settings: AISettings, onProgress?: (p: any) => void) => {
      const sourceHash = hashBookAISource(source)
      if (await backend.isIndexed(sourceHash)) return
      const sections = source.chapters.map((ch) => ({ index: ch.index, title: ch.title || `章节 ${ch.index + 1}`, text: ch.text }))
      await backend.indexBook(sourceHash, sections, settings, { onProgress })
    },
    search: async (query: string, options: { bookId: string; sourceHash?: string; settings: AISettings; topK?: number; maxPage?: number }) => {
      const sourceHash = options.sourceHash || hashBookAISource({ bookId: options.bookId, chapters: [], title: '', sourceHash: options.sourceHash })
      return backend.searchForSystemPrompt(query, sourceHash, options.settings, options.topK || options.settings.maxContextChunks || 6, options.maxPage)
    },
    clearBookIndex: async (bookId: string, sourceHash: string, settings: AISettings) => backend.clearBook(sourceHash),
    isBookIndexed: async (bookId: string, sourceHash: string, settings: AISettings) => backend.isIndexed(sourceHash),
  }
}

export function selectRetrievalBackend(settings = buildAISettings()) {
  if (settings.reedy?.enabled) {
    return { id: 'reedy' as const, settings }
  }
  return createLegacyRetrievalBackend()
}

// ── markdown renderer ───────────────────────────────────────────────
const MARKDOWN_RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/\*\*(.+?)\*\*/g, (m) => `<strong>${m[1]}</strong>`],
  [/__(.+?)__/g, (m) => `<strong>${m[1]}</strong>`],
  [/\*(.+?)\*/g, (m) => `<em>${m[1]}</em>`],
  [/\b_(.+?)_\b/g, (m) => `<em>${m[1]}</em>`],
  [/`([^`]+)`/g, (m) => `<code>${m[1]}</code>`],
]

function convertInlineMarkdown(line: string): string {
  return MARKDOWN_RULES.reduce((text, [re, fn]) => text.replace(re, (sub, ...args) => fn([sub, ...args] as unknown as RegExpMatchArray)), line)
}

export function renderAIMarkdown(text: string): string {
  if (!text) return ''
  const lines = text.split('\n')
  const result: string[] = []
  let inCodeBlock = false, inList = false, inOrderedList = false
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) { result.push('</code></pre>'); inCodeBlock = false }
      else { result.push('<pre><code>'); inCodeBlock = true }
      continue
    }
    if (inCodeBlock) { result.push(raw + '\n'); continue }
    const h = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (h) { if (inList) { result.push('</ul>'); inList = false }; if (inOrderedList) { result.push('</ol>'); inOrderedList = false }; result.push(`<h${Math.min(h[1].length + 2, 5)}>${convertInlineMarkdown(h[2])}</h${Math.min(h[1].length + 2, 5)}>`); continue }
    const ul = trimmed.match(/^[-*+]\s+(.+)$/)
    if (ul) { if (inOrderedList) { result.push('</ol>'); inOrderedList = false }; if (!inList) { result.push('<ul>'); inList = true }; result.push(`<li>${convertInlineMarkdown(ul[1])}</li>`); continue }
    const ol = trimmed.match(/^\d+\.\s+(.+)$/)
    if (ol) { if (inList) { result.push('</ul>'); inList = false }; if (!inOrderedList) { result.push('<ol>'); inOrderedList = true }; result.push(`<li>${convertInlineMarkdown(ol[1])}</li>`); continue }
    if (inList) { result.push('</ul>'); inList = false }
    if (inOrderedList) { result.push('</ol>'); inOrderedList = false }
    if (/^[-*_]{3,}$/.test(trimmed)) { result.push('<hr>'); continue }
    if (!trimmed) { result.push('<br>'); continue }
    const converted = convertInlineMarkdown(trimmed).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    result.push(`<p>${converted}</p>`)
  }
  if (inCodeBlock) result.push('</code></pre>')
  if (inList) result.push('</ul>')
  if (inOrderedList) result.push('</ol>')
  return result.join('\n')
}

export function extractTextFromHtml(html: string): string {
  if (!html) return ''
  if (typeof document !== 'undefined') {
    const template = document.createElement('template')
    template.innerHTML = html
    template.content.querySelectorAll('script, style, noscript, nav, header, footer').forEach((el) => el.remove())
    return (template.content.textContent || '').replace(/\s+/g, ' ').trim()
  }
  return html.replace(/<(script|style|noscript|nav|header|footer)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function chunkPlainTextSection(opts: { bookId: string; sectionIndex: number; chapterTitle: string; text: string; cumulativeSizeBeforeSection?: number }): Array<{ bookId: string; sectionIndex: number; chapterTitle: string; text: string; pageNumber: number }> {
  const { bookId, sectionIndex, chapterTitle, text, cumulativeSizeBeforeSection = 0 } = opts
  const chunks = chunkSection(text, sectionIndex, chapterTitle, bookId, cumulativeSizeBeforeSection)
  return chunks.map(c => ({ bookId: c.bookHash, sectionIndex: c.sectionIndex, chapterTitle: c.chapterTitle, text: c.text, pageNumber: c.pageNumber }))
}

export { getAIProvider as resolveBookAIProvider } from '../services/ai/providers'

export async function saveAIConversationMessages(bookId: string, mode: BookAIMode, messages: ChatMessage[]): Promise<void> {
  const conversationId = `${bookId || 'global'}:${mode}`
  const existing = await aiStore.getMessages(conversationId)
  if (!existing.length) {
    await aiStore.saveMessagesBatch(messages.map((msg, i) => ({
      id: `${conversationId}:${Date.now()}:${i}`,
      conversationId,
      role: msg.role,
      content: msg.content,
      createdAt: Date.now() + i,
    })))
  }
}
