import Config from '../config'
import { getBoxPlayerAccessToken } from './boxplayerAuth'

export type BoxPlayerCloudAIFeature = 'ai_search' | 'reader_chat' | 'reader_translate' | 'reader_tts' | 'document_analysis'

export interface BoxPlayerCloudAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface BoxPlayerCloudChatRequest {
  feature: BoxPlayerCloudAIFeature
  messages: BoxPlayerCloudAIMessage[]
}

export interface BoxPlayerCloudMediaScrapeItem {
  id?: string
  filename: string
  folderHint?: string
  pathHint?: string
}

export interface BoxPlayerCloudMediaScrapeResult {
  idx?: number
  id?: string | null
  type?: 'movie' | 'tv' | null
  title?: string | null
  year?: number | null
  tmdb_id?: number | null
  season?: number | null
  episode?: number | null
  confidence?: number | null
  alt_titles?: string[] | null
}

export interface BoxPlayerCloudStreamCallbacks {
  onToken: (text: string) => void
  onDone: () => void
  onError: (message: string) => void
}

const CLOUD_AI_BASE_URL = Config.BOXPLAYER_AI_API_URL

export function isBoxPlayerCloudProvider(providerName?: string): boolean {
  return providerName === 'boxplayer-cloud'
}

function apiUrl(path: string): string {
  return `${CLOUD_AI_BASE_URL.replace(/\/+$/, '')}${path}`
}

export function getBoxPlayerMediaScrapeUrl(): string {
  return `${Config.BOXPLAYER_API_URL.replace(/\/+$/, '')}/v1/media-scrape`
}

async function postCloudAI(path: string, body: unknown): Promise<Response> {
  const token = await getBoxPlayerAccessToken()
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

export async function streamBoxPlayerCloudChat(request: BoxPlayerCloudChatRequest, callbacks: BoxPlayerCloudStreamCallbacks): Promise<void> {
  try {
    const response = await postCloudAI('/v1/chat/completions', request)
    if (!response.ok) throw new Error(await readCloudAIError(response))
    if (!response.body) throw new Error('AI 没有返回内容')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let emitted = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) {
        const text = parseStreamLine(line)
        if (!text) continue
        emitted = true
        callbacks.onToken(text)
      }
    }

    const tail = parseStreamLine(buffer)
    if (tail) {
      emitted = true
      callbacks.onToken(tail)
    }
    if (!emitted) throw new Error('AI 没有返回内容')
    callbacks.onDone()
  } catch (error: any) {
    callbacks.onError(error?.message || 'AI 请求失败')
  }
}

export async function completeBoxPlayerCloudChat(request: BoxPlayerCloudChatRequest): Promise<string> {
  let text = ''
  await streamBoxPlayerCloudChat(request, {
    onToken: (chunk) => { text += chunk },
    onDone: () => {},
    onError: (message) => { throw new Error(message) }
  })
  return text
}

export async function scrapeMediaWithBoxPlayerCloud(items: BoxPlayerCloudMediaScrapeItem[], signal?: AbortSignal): Promise<BoxPlayerCloudMediaScrapeResult[]> {
  const token = await getBoxPlayerAccessToken()
  const response = await fetch(getBoxPlayerMediaScrapeUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    signal,
    body: JSON.stringify({ items })
  })
  if (!response.ok) throw new Error(await readCloudAIError(response))
  const data = await response.json() as { results?: BoxPlayerCloudMediaScrapeResult[] }
  if (!Array.isArray(data.results)) throw new Error('AI 刮削没有返回结果')
  return data.results
}

function detectSourceLang(text: string): string {
  if (!text) return 'auto'
  // 统计 CJK 字符占比，超过 30% 判定为中文
  let cjk = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext-A
      (code >= 0xf900 && code <= 0xfaff)    // CJK Compat
    ) {
      cjk++
    }
  }
  return cjk > 0 && cjk / text.length >= 0.3 ? 'zh' : 'auto'
}

export async function translateWithBoxPlayerCloud(text: string, targetLang: string): Promise<string> {
  const sourceLang = 'auto' // detectSourceLang(text)
  const response = await postCloudAI('/v1/translate', { text, targetLang })
  if (!response.ok) throw new Error(await readCloudAIError(response))
  const data = await response.json() as { text?: string }
  return data.text || ''
}

export interface BoxPlayerCloudTTSResult {
  audioUrl: string
  cleanup: () => void
}

export async function speakWithBoxPlayerCloud(text: string, lang: string, voice?: string, rate?: number): Promise<BoxPlayerCloudTTSResult> {
  const response = await postCloudAI('/v1/tts', { text, lang, voice, rate })
  if (!response.ok) throw new Error(await readCloudAIError(response))
  const data = await response.json() as { audio?: string; contentType?: string }
  if (!data.audio) throw new Error('云端 TTS 没有返回音频')
  const blob = base64ToBlob(data.audio, data.contentType || 'audio/mpeg')
  const audioUrl = URL.createObjectURL(blob)
  return { audioUrl, cleanup: () => URL.revokeObjectURL(audioUrl) }
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

async function readCloudAIError(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: string; message?: string }
    return mapBoxPlayerCloudAIError(data.error || data.message || `HTTP ${response.status}`)
  } catch {
    return `HTTP ${response.status}`
  }
}

export function mapBoxPlayerCloudAIError(error: unknown): string {
  const code = String(error || '')
  const messages: Record<string, string> = {
    missing_auth_token: '请先登录 BoxPlayer 账号',
    invalid_auth_token: '登录已过期，请重新登录',
    daily_request_quota_exceeded: '今日 AI 请求次数已用完',
    daily_char_quota_exceeded: '今日 AI 字符额度已用完',
    monthly_request_quota_exceeded: '本月 AI 请求次数已用完',
    monthly_char_quota_exceeded: '本月 AI 字符额度已用完',
    monthly_ai_credit_quota_exceeded: '本月内置 AI 额度已用完。你可以等待下月重置，或在设置中改用自己的 AI API Key。',
    ai_provider_quota_exceeded: 'Cloudflare Unified Billing 余额不足，请先充值后再试',
    ai_upstream_timeout: 'AI 刮削服务超时，请稍后重试',
    input_too_large: '输入内容过长',
    text_too_large: '文本过长'
  }
  for (const [key, message] of Object.entries(messages)) {
    if (code.includes(key)) return message
  }
  // Pi's OpenAI-compatible stream reports body-less HTTP failures as a status
  // string. The cloud worker reserves 429 exclusively for the monthly credit limit.
  if (/\b429\b/.test(code)) return '本月内置 AI 额度已用完。你可以等待下月重置，或在设置中改用自己的 AI API Key。'
  // A body-less 500 is an upstream model/bridge failure, not evidence that a
  // user's quota was exhausted. Quota exhaustion is always returned as a 429
  // or an explicit quota code by our Worker.
  if (/\b500 status code \(no body\)/.test(code)) return '内置 AI 模型服务执行失败，请稍后重试。'
  return code
}

function parseStreamLine(line: string): string {
  const trimmed = line.trim()
  if (!trimmed) return ''
  const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
  if (!payload || payload === '[DONE]') return ''
  try {
    const data = JSON.parse(payload)
    const delta = data?.choices?.[0]?.delta?.content || data?.choices?.[0]?.text || data?.response || data?.text
    return typeof delta === 'string' ? delta : ''
  } catch {
    return trimmed.startsWith('data:') ? payload : ''
  }
}
