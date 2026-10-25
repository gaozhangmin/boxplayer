import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../boxplayerAuth', () => ({ getBoxPlayerAccessToken: vi.fn(async () => 'test-token') }))

import { getBoxPlayerMediaScrapeUrl, mapBoxPlayerCloudAIError, scrapeMediaWithBoxPlayerCloud } from '../boxplayerCloudAI'

afterEach(() => vi.unstubAllGlobals())

describe('BoxPlayer Cloud AI error mapping', () => {
  it('routes media scraping through the BoxPlayer resource API', () => {
    expect(getBoxPlayerMediaScrapeUrl()).toBe('https://boxplayer-api-673444103572.europe-west1.run.app/v2/media-scrape')
  })

  it('passes the caller abort signal through to the media scrape request', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({ outcome: 'complete', retryable: false, results: [], rejected: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await scrapeMediaWithBoxPlayerCloud([{ id: 'item-1', filename: 'movie.mkv' }], controller.signal)

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal })
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({ contractVersion: 2, items: [{ id: 'item-1', filename: 'movie.mkv' }] })
  })

  it('shows a useful monthly credit message for a worker quota response', () => {
    expect(mapBoxPlayerCloudAIError('monthly_ai_credit_quota_exceeded')).toContain('本月内置 AI 额度已用完')
  })

  it('shows an actionable message when the media scrape upstream times out', () => {
    expect(mapBoxPlayerCloudAIError('ai_upstream_timeout')).toContain('超时')
  })

  it('maps body-less 429 errors emitted by the PI streaming client', () => {
    expect(mapBoxPlayerCloudAIError('429 status code (no body)')).toContain('本月内置 AI 额度已用完')
  })

  it('does not mislabel a body-less Cloudflare 500 as a user quota error', () => {
    expect(mapBoxPlayerCloudAIError('500 status code (no body)')).toContain('模型服务执行失败')
  })
})
