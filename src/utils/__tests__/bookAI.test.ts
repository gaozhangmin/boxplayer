import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildBookAIRequest,
  chatStreamCompletion,
  chunkPlainTextSection,
  createBookAISettings,
  createLegacyRetrievalBackend,
  generateAIText,
  getAIConfig,
  migrateSoleSavedBYOKAsDefault,
  migrateLegacyAIHistory,
  resolveAIProviderConfig,
  resolveBookAIProvider,
  saveAIConversationMessages,
  loadAIConversationMessages,
  withRetryAndTimeout,
  type ChatMessage
} from '../bookAI'

const entitlement = vi.hoisted(() => ({ pro: false }))
vi.mock('../usageLimit', () => ({ isPro: () => entitlement.pro }))

const settingStore = {
  apiAIModelProvider: 'deepseek',
  apiAIModelKey: 'test-key',
  apiAIModelId: 'deepseek-chat',
  apiAIBaseUrl: '',
  apiAIEmbeddingModelId: '',
  apiAIRagEnabled: true,
  apiAISpoilerProtection: true,
  apiAIMaxContextChunks: 4,
  apiAIIndexingMode: 'on-demand',
  apiAIReedyEnabled: false,
  updateStore(fields: Record<string, unknown>) { Object.assign(this, fields) }
}

const { streamText, generateText, embed, embedMany, createGateway, createOpenAI, dbStore } = vi.hoisted(() => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
  embed: vi.fn(),
  embedMany: vi.fn(),
  createGateway: vi.fn(),
  createOpenAI: vi.fn(),
  dbStore: {
    chunks: [] as any[],
    meta: [] as any[],
    bm25: [] as any[],
    conversations: [] as any[],
    messages: [] as any[],
  },
}))

vi.mock('../../setting/settingstore', () => ({
  default: () => settingStore,
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI,
}))

vi.mock('ai', () => ({
  streamText,
  generateText,
  embed,
  embedMany,
  createGateway,
}))

vi.mock('../db', () => ({
  default: {
    ibook_ai_chunk: {
      where: vi.fn((field: string) => ({
        equals: vi.fn((value: string) => ({
          toArray: vi.fn(async () => dbStore.chunks.filter((item) => item[field] === value)),
          delete: vi.fn(async () => {
            dbStore.chunks = dbStore.chunks.filter((item) => item[field] !== value)
          }),
        })),
      })),
      bulkPut: vi.fn(async (items: any[]) => { dbStore.chunks = items }),
    },
    ibook_ai_meta: {
      get: vi.fn(async (id: string) => dbStore.meta.find((item) => item.id === id)),
      put: vi.fn(async (item: any) => {
        dbStore.meta = dbStore.meta.filter((old) => old.id !== item.id).concat(item)
      }),
      where: vi.fn((field: string) => ({
        equals: vi.fn((value: string) => ({
          delete: vi.fn(async () => {
            dbStore.meta = dbStore.meta.filter((item) => item[field] !== value && item.id !== value)
          }),
        })),
      })),
    },
    ibook_ai_bm25: {
      put: vi.fn(async (item: any) => { dbStore.bm25 = [item] }),
      get: vi.fn(async (id: string) => dbStore.bm25.find((item) => item.id === id)),
      where: vi.fn((field: string) => ({
        equals: vi.fn((value: string) => ({
          delete: vi.fn(async () => {
            dbStore.bm25 = dbStore.bm25.filter((item) => item[field] !== value && item.id !== value)
          }),
        })),
      })),
    },
    ibook_ai_conversation: {
      put: vi.fn(async (item: any) => {
        dbStore.conversations = dbStore.conversations.filter((old) => old.id !== item.id).concat(item)
      }),
    },
    ibook_ai_message: {
      where: vi.fn((field: string) => ({
        equals: vi.fn((value: string) => ({
          toArray: vi.fn(async () => dbStore.messages.filter((item) => item[field] === value)),
          delete: vi.fn(async () => {
            dbStore.messages = dbStore.messages.filter((item) => item[field] !== value)
          }),
        })),
      })),
      bulkPut: vi.fn(async (items: any[]) => { dbStore.messages = dbStore.messages.concat(items) }),
    },
  },
}))

describe('bookAI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    entitlement.pro = false
    settingStore.apiAIModelProvider = 'deepseek'
    settingStore.apiAIModelKey = 'test-key'
    settingStore.apiAIModelId = 'deepseek-chat'
    settingStore.apiAIBaseUrl = ''
    settingStore.apiAIEmbeddingModelId = ''
    settingStore.apiAIRagEnabled = true
    settingStore.apiAISpoilerProtection = true
    settingStore.apiAIMaxContextChunks = 4
    settingStore.apiAIIndexingMode = 'on-demand'
    settingStore.apiAIReedyEnabled = false
    dbStore.chunks = []
    dbStore.meta = []
    dbStore.bm25 = []
    dbStore.conversations = []
    dbStore.messages = []
    createOpenAI.mockImplementation(() => Object.assign(
      (modelId: string) => ({ responsesModelId: modelId }),
      {
        chat: (modelId: string) => ({ chatModelId: modelId }),
        embedding: (modelId: string) => ({ embeddingModelId: modelId }),
      }
    ))
    createGateway.mockReturnValue((modelId: string) => ({ gatewayModelId: modelId }))
  })

  it('uses built-in AI for Pro without a saved default in every renderer', () => {
    entitlement.pro = true
    settingStore.apiAIModelProvider = ''
    settingStore.apiAIModelId = ''
    settingStore.apiAIModelKey = ''
    expect(getAIConfig()).toMatchObject({ providerName: 'boxplayer-cloud', apiKey: '' })
    expect(createBookAISettings()).toMatchObject({ provider: 'boxplayer-cloud', reedy: { enabled: true } })
    expect(resolveAIProviderConfig()).toEqual(getAIConfig())
    expect(migrateSoleSavedBYOKAsDefault()).toBe(false)
    expect(settingStore.apiAIModelProvider).toBe('')
  })

  it('preserves an explicitly selected BYOK model for Pro', () => {
    entitlement.pro = true
    expect(getAIConfig()).toMatchObject({ providerName: 'deepseek', modelId: 'deepseek-chat' })
    expect(createBookAISettings().provider).toBe('deepseek')
  })

  it('accepts built-in AI without requiring a manually saved model ID', () => {
    settingStore.apiAIModelProvider = 'boxplayer-cloud'
    settingStore.apiAIModelId = ''
    expect(getAIConfig()).toMatchObject({ providerName: 'boxplayer-cloud' })
  })

  it('resolves global and overridden OpenAI-compatible providers', () => {
    expect(getAIConfig()).toEqual({
      endpoint: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat',
      apiKey: 'test-key',
      providerName: 'deepseek',
    })

    expect(resolveAIProviderConfig('qwen')).toEqual({
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      modelId: 'deepseek-chat',
      apiKey: 'test-key',
      providerName: 'qwen',
    })
  })

  it('does not treat default Ollama settings as configured until a provider and model are saved', () => {
    settingStore.apiAIModelProvider = ''
    settingStore.apiAIModelKey = ''
    settingStore.apiAIModelId = ''

    expect(getAIConfig()).toBeNull()
  })

  it('uses the only complete saved BYOK model when an older config has no default provider', () => {
    settingStore.apiAIModelProvider = ''
    settingStore.apiAIModelKey = ''
    settingStore.apiAIModelId = ''
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const values = new Map<string, string>([[
      'ai_provider_config_deepseek',
      JSON.stringify({ apiKey: 'saved-key', modelId: 'deepseek-v4-pro', embeddingModelId: '', baseUrl: '' })
    ]])
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() { return values.size },
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null
      }
    })

    try {
      expect(getAIConfig()).toEqual({
        endpoint: 'https://api.deepseek.com/v1',
        modelId: 'deepseek-v4-pro',
        apiKey: 'saved-key',
        providerName: 'deepseek'
      })
      expect(migrateSoleSavedBYOKAsDefault()).toBe(true)
      expect(settingStore).toMatchObject({
        apiAIModelProvider: 'deepseek',
        apiAIModelKey: 'saved-key',
        apiAIModelId: 'deepseek-v4-pro',
        apiAIBaseUrl: 'https://api.deepseek.com/v1'
      })
    } finally {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
      else delete (globalThis as { localStorage?: Storage }).localStorage
    }
  })

  it('builds reader assistant messages without leaking system context into visible history', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '上一问' },
      { role: 'assistant', content: '上一答' },
      { role: 'user', content: '你是阅读助手，旧版本误存的系统消息' },
    ]

    const request = buildBookAIRequest({
      mode: 'ask',
      question: '总结一下',
      history,
      bookName: '三体',
      chapterTitle: '第一章',
      chapterText: '章节正文'.repeat(3000),
    })

    expect(request.system).toContain('当前书籍：《三体》')
    expect(request.system).toContain('当前章节：第一章')
    expect(request.system.length).toBeLessThan(5300)
    expect(request.messages).toEqual([
      { role: 'user', content: '上一问' },
      { role: 'assistant', content: '上一答' },
      { role: 'user', content: '总结一下' },
    ])
  })

  it('streams chat text through Vercel AI SDK', async () => {
    streamText.mockReturnValue({
      textStream: (async function* () {
        yield '你'
        yield '好'
      })(),
    })

    const tokens: string[] = []
    await chatStreamCompletion(
      {
        endpoint: 'https://api.deepseek.com/v1',
        apiKey: 'test-key',
        modelId: 'deepseek-chat',
        providerName: 'deepseek',
      },
      { system: 'system prompt', messages: [{ role: 'user', content: 'hi' }] },
      {
        onToken: (token) => tokens.push(token),
        onDone: vi.fn(),
        onError: vi.fn(),
      }
    )

    expect(createOpenAI).toHaveBeenCalledWith({
      name: 'deepseek',
      apiKey: 'test-key',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(streamText).toHaveBeenCalledWith({
      model: { chatModelId: 'deepseek-chat' },
      system: 'system prompt',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(tokens).toEqual(['你', '好'])
  })

  it('falls back to non-streaming text when the chat stream does not yield text in time', async () => {
    vi.useFakeTimers()
    streamText.mockReturnValue({
      textStream: (async function* () {
        await new Promise(() => {})
      })(),
    })
    generateText.mockResolvedValue({ text: '兜底回答' })

    const onToken = vi.fn()
    const onDone = vi.fn()
    const completion = chatStreamCompletion(
      {
        endpoint: 'https://api.deepseek.com/v1',
        apiKey: 'test-key',
        modelId: 'deepseek-chat',
        providerName: 'deepseek',
      },
      { system: 'system prompt', messages: [{ role: 'user', content: 'hi' }] },
      {
        onToken,
        onDone,
        onError: vi.fn(),
      },
      { idleTimeoutMs: 25 }
    )

    await vi.advanceTimersByTimeAsync(30)
    await completion

    expect(generateText).toHaveBeenCalledWith({
      model: { chatModelId: 'deepseek-chat' },
      system: 'system prompt',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(onToken).toHaveBeenCalledWith('兜底回答')
    expect(onDone).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('generates one-shot AI text through Vercel AI SDK', async () => {
    generateText.mockResolvedValue({ text: '释义结果' })

    await expect(
      generateAIText(
        {
          endpoint: 'https://api.deepseek.com/v1',
          apiKey: 'test-key',
          modelId: 'deepseek-chat',
          providerName: 'deepseek',
        },
        '解释 gravity'
      )
    ).resolves.toBe('释义结果')

    expect(generateText).toHaveBeenCalledWith({
      model: { chatModelId: 'deepseek-chat' },
      prompt: '解释 gravity',
      maxOutputTokens: 3000,
    })
  })

  it('creates Readest-compatible settings and supports Ollama without an API key', () => {
    settingStore.apiAIModelProvider = 'ollama'
    settingStore.apiAIModelKey = ''
    settingStore.apiAIModelId = 'llama3.2'
    settingStore.apiAIBaseUrl = 'http://127.0.0.1:11434/v1'
    settingStore.apiAIEmbeddingModelId = 'nomic-embed-text'

    const settings = createBookAISettings()
    const config = getAIConfig()

    expect(settings).toMatchObject({
      provider: 'ollama',
      modelId: 'llama3.2',
      embeddingModelId: 'nomic-embed-text',
      ragEnabled: true,
      spoilerProtection: true,
    })
    expect(config?.endpoint).toBe('http://127.0.0.1:11434/v1')
    expect(resolveBookAIProvider(settings).requiresAuth).toBe(false)
  })

  it('resolves Vercel AI Gateway models through the AI SDK gateway provider', () => {
    const settings = createBookAISettings({
      provider: 'ai-gateway',
      aiGatewayApiKey: 'gateway-key',
      aiGatewayModel: 'google/gemini-2.5-flash-lite',
    })

    const provider = resolveBookAIProvider(settings)
    expect(provider.getModel()).toEqual({ gatewayModelId: 'google/gemini-2.5-flash-lite' })
    expect(createGateway).toHaveBeenCalledWith({ apiKey: 'gateway-key' })
  })

  it('resolves OpenAI-compatible chat models through chat completions instead of responses', () => {
    const settings = createBookAISettings({
      provider: 'deepseek',
      openRouterApiKey: 'test-key',
      openRouterModel: 'deepseek-chat',
    })

    expect(resolveBookAIProvider(settings).getModel()).toEqual({ chatModelId: 'deepseek-chat' })
  })

  it('chunks plain reader sections with Readest page and overlap defaults', () => {
    const chunks = chunkPlainTextSection({
      bookId: 'book-1',
      sectionIndex: 0,
      chapterTitle: '第一章',
      text: `${'第一段内容。'.repeat(70)} ${'第二段内容。'.repeat(70)}`,
      cumulativeSizeBeforeSection: 1500,
    })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({
      bookId: 'book-1',
      sectionIndex: 0,
      chapterTitle: '第一章',
      pageNumber: 1,
    })
    expect(chunks[0].text.length).toBeLessThanOrEqual(550)
  })

  it('indexes reader snapshots and falls back to keyword search when embeddings are unavailable', async () => {
    embedMany.mockRejectedValue(new Error('embedding offline'))
    embed.mockRejectedValue(new Error('embedding offline'))
    const backend = createLegacyRetrievalBackend()
    const settings = createBookAISettings()

    await backend.indexBook({
      bookId: 'book-1',
      sourceHash: 'source-a',
      title: '测试书',
      author: '作者',
      chapters: [
        { index: 0, title: '第一章', text: '苹果 香蕉 梨子 '.repeat(80) },
        { index: 1, title: '第二章', text: '火星 飞船 宇宙 '.repeat(80) },
      ],
    }, settings)

    const results = await backend.search('飞船', {
      bookId: 'book-1',
      sourceHash: 'source-a',
      settings,
      topK: 3,
    })

    expect(await backend.isBookIndexed('book-1', 'source-a', settings)).toBe(true)
    expect(results[0].chapterTitle).toBe('第二章')
    expect(results[0].searchMethod).toBe('bm25')
  })

  it('persists chat history and migrates legacy localStorage messages once', async () => {
    const storage = new Map<string, string>()
    const localStorageLike = {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    }
    storage.set('bookAI.history.book-1.ask', JSON.stringify([
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧答案' },
    ]))

    await migrateLegacyAIHistory('book-1', 'ask', localStorageLike)
    await saveAIConversationMessages('book-1', 'ask', [
      { role: 'user', content: '新问题' },
    ])

    const messages = await loadAIConversationMessages('book-1', 'ask')
    expect(storage.get('bookAI.history.book-1.ask')).toBeUndefined()
    expect(messages.map((item) => item.content)).toEqual(['旧问题', '旧答案', '新问题'])
  })

  it('rejects operations that exceed the retry timeout', async () => {
    vi.useFakeTimers()
    const observed = vi.fn()
    const pending = withRetryAndTimeout(() => new Promise<string>(() => {}), 25, { maxRetries: 0 })
    pending.catch(observed)

    await vi.advanceTimersByTimeAsync(30)
    await Promise.resolve()

    expect(observed).toHaveBeenCalledWith(expect.any(Error))
    vi.useRealTimers()
  })
})
