import { request as httpsRequest } from 'https'
import { BOXPLAYER_API_ORIGIN } from '../../../shared/boxplayerApi'

const PANHUB_ALLOWED_ORIGINS = [BOXPLAYER_API_ORIGIN]
const PANHUB_REQUEST_TIMEOUT_MS = 45000

export interface PanHubRequestData {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface PanHubRequestResult {
  ok: boolean
  status: number
  data: unknown
}

export interface PanHubStreamResult {
  ok: boolean
  status: number
}

type PanHubFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

function validateRequest(data: PanHubRequestData): { url: URL; method: string } {
  const url = new URL(data.url)
  if (!PANHUB_ALLOWED_ORIGINS.includes(url.origin) || !url.pathname.startsWith('/api/')) throw new Error('不允许的 PanHub 请求地址')
  const method = (data.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'POST') throw new Error('不允许的 PanHub 请求方法')
  return { url, method }
}

function consumeNdjsonChunk(buffer: string, chunk: string, onEvent: (event: unknown) => void): string {
  const lines = `${buffer}${chunk}`.split('\n')
  const remaining = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    onEvent(JSON.parse(line))
  }
  return remaining
}

function requestWithHttps(url: URL, method: string, headers?: Record<string, string>, body?: string): Promise<PanHubRequestResult> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method, headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => {
        const status = response.statusCode || 500
        const text = Buffer.concat(chunks).toString('utf8')
        let responseData: unknown = null
        if (text) {
          try {
            responseData = JSON.parse(text)
          } catch {
            responseData = { message: text }
          }
        }
        resolve({ ok: status >= 200 && status < 300, status, data: responseData })
      })
    })
    request.setTimeout(PANHUB_REQUEST_TIMEOUT_MS, () => request.destroy(new Error('PanHub 请求超时')))
    request.on('error', reject)
    if (method === 'POST' && body) request.write(body)
    request.end()
  })
}

export async function requestPanHub(data: PanHubRequestData, fetchImpl?: PanHubFetch): Promise<PanHubRequestResult> {
  const { url, method } = validateRequest(data)

  if (!fetchImpl) return requestWithHttps(url, method, data.headers, data.body)

  const response = await fetchImpl(url, {
    method,
    headers: data.headers,
    body: method === 'POST' ? data.body : undefined
  })
  const text = await response.text()
  let responseData: unknown = null
  if (text) {
    try {
      responseData = JSON.parse(text)
    } catch {
      responseData = { message: text }
    }
  }
  return { ok: response.ok, status: response.status, data: responseData }
}

export function requestPanHubStream(data: PanHubRequestData, onEvent: (event: unknown) => void, signal?: AbortSignal, fetchImpl?: PanHubFetch): Promise<PanHubStreamResult> {
  const { url, method } = validateRequest(data)

  if (fetchImpl) {
    return fetchImpl(url, { method, headers: data.headers, body: method === 'POST' ? data.body : undefined, signal }).then(async (response) => {
      if (!response.ok) throw new Error(`PanHub 流式请求失败：HTTP ${response.status}`)
      if (!response.body) throw new Error('PanHub 流式响应为空')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer = consumeNdjsonChunk(buffer, decoder.decode(value, { stream: true }), onEvent)
      }
      const tail = `${buffer}${decoder.decode()}`.trim()
      if (tail) onEvent(JSON.parse(tail))
      return { ok: true, status: response.status }
    })
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const request = httpsRequest(url, { method, headers: data.headers }, (response) => {
      const status = response.statusCode || 500
      if (status < 200 || status >= 300) {
        response.resume()
        reject(new Error(`PanHub 流式请求失败：HTTP ${status}`))
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      response.on('data', (chunk) => {
        try {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          buffer = consumeNdjsonChunk(buffer, decoder.decode(bytes, { stream: true }), onEvent)
        } catch (error) {
          request.destroy(error as Error)
        }
      })
      response.on('end', () => {
        if (settled) return
        try {
          const tail = `${buffer}${decoder.decode()}`.trim()
          if (tail) onEvent(JSON.parse(tail))
          settled = true
          resolve({ ok: true, status })
        } catch (error) {
          settled = true
          reject(error)
        }
      })
    })
    const abort = () => request.destroy(new Error('PanHub 流式请求已取消'))
    signal?.addEventListener('abort', abort, { once: true })
    request.setTimeout(PANHUB_REQUEST_TIMEOUT_MS, () => request.destroy(new Error('PanHub 请求超时')))
    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    request.on('close', () => signal?.removeEventListener('abort', abort))
    if (method === 'POST' && data.body) request.write(data.body)
    request.end()
  })
}
