import { describe, expect, it, vi } from 'vitest'
import { buildPanHubSearchUrls, createPanHubFetch, discoverPanHubSources, extractPanHubMerged, mergePanHubMerged, searchPanHubSources, searchPanHubStream } from '../panHubSearch'

describe('PanHub source search', () => {
  it('splits a blocking all-source search into plugin and Telegram batch requests', () => {
    const urls = buildPanHubSearchUrls('https://example.com/api', '流浪地球', {
      plugins: ['panta', 'hunhepan'],
      channels: ['channel-a', 'channel-b', 'channel-c'],
      concurrency: 2,
      pluginTimeoutMs: 5000
    })

    expect(urls).toHaveLength(4)
    expect(urls.every((url) => !url.includes('src=all'))).toBe(true)
    expect(urls.filter((url) => url.includes('src=plugin'))).toHaveLength(2)
    expect(urls.filter((url) => url.includes('src=tg'))).toHaveLength(2)
    expect(urls[0]).toContain('plugins=panta')
    expect(urls[2]).toContain('channels=channel-a%2Cchannel-b')
  })

  it('extracts fallback result shapes used by the reference implementation', () => {
    expect(extractPanHubMerged({
      results: [{ title: '电影', datetime: '2026-01-01', channel: 'test', links: [{ type: 'quark', url: 'https://example.com/1', password: '1234' }] }]
    })).toEqual({
      quark: [{ url: 'https://example.com/1', password: '1234', note: '电影', datetime: '2026-01-01', source: 'tg:test' }]
    })
  })

  it('keeps successful source results when another source fails and merges incrementally', async () => {
    const onProgress = vi.fn()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('plugins=broken')) throw new Error('timeout')
      return {
        ok: true,
        json: async () => ({ code: 0, data: { merged_by_type: { aliyun: [{ url: 'https://example.com/a', password: '', note: 'A', datetime: '' }] } } })
      } as Response
    })

    const result = await searchPanHubSources({
      apiBase: 'https://example.com/api',
      keyword: '流浪地球',
      plugins: ['working', 'broken'],
      channels: [],
      concurrency: 2,
      pluginTimeoutMs: 5000,
      fetchImpl,
      onProgress
    })

    expect(result.merged.aliyun).toHaveLength(1)
    expect(result.total).toBe(1)
    expect(result.failedSources).toBe(1)
    expect(onProgress).toHaveBeenCalledWith(result.merged, 1)
  })

  it('discovers the currently enabled server sources from the health endpoint', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ plugins: ['panta'], channels: ['channel-a', 'channel-b'] })
    }) as Response)

    await expect(discoverPanHubSources('https://example.com/api', fetchImpl)).resolves.toEqual({
      plugins: ['panta'],
      channels: ['channel-a', 'channel-b']
    })
  })

  it('routes renderer requests through the Electron main process when IPC is available', async () => {
    const invoke = vi.fn(async () => ({ ok: true, status: 200, data: { code: 0, data: { total: 1 } } }))
    const fetchImpl = createPanHubFetch(invoke)

    const response = await fetchImpl('https://api.xbyvideohub.com/api/search?kw=test')

    expect(invoke).toHaveBeenCalledWith('PanHub:request', {
      url: 'https://api.xbyvideohub.com/api/search?kw=test',
      method: 'GET',
      headers: undefined,
      body: undefined
    })
    expect(response.ok).toBe(true)
    await expect(response.json()).resolves.toEqual({ code: 0, data: { total: 1 } })
  })

  it('deduplicates matching URLs while merging sources', () => {
    const item = { url: 'https://example.com/a', password: '', note: 'A', datetime: '' }
    expect(mergePanHubMerged({ aliyun: [item] }, { aliyun: [item] })).toEqual({ aliyun: [item] })
  })

  it('merges streamed result events before the final response', async () => {
    const encoder = new TextEncoder()
    const onProgress = vi.fn()
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'results', source: 'plugin', sourceName: 'test', data: { results: [{ title: 'A', datetime: '', channel: 'test', links: [{ type: 'quark', url: 'https://example.com/a', password: '' }] }] } })}\n`))
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'done', code: 0, data: { total: 1, merged_by_type: { quark: [{ url: 'https://example.com/a', password: '', note: 'A', datetime: '' }] } } })}\n`))
        controller.close()
      }
    }), { status: 200 }))

    const result = await searchPanHubStream({
      apiBase: 'https://example.com/api',
      keyword: 'test',
      plugins: [],
      channels: [],
      concurrency: 2,
      pluginTimeoutMs: 5000,
      fetchImpl,
      onProgress
    })

    expect(result.total).toBe(1)
    expect(result.merged.quark).toHaveLength(1)
    expect(onProgress).toHaveBeenCalledWith(expect.any(Object), 1)
  })
})
