import { describe, expect, it } from 'vitest'
import Config from '../../config'
import { requestPanHub, requestPanHubStream } from '../../../electron/main/core/panHubRequest'
import { extractPanHubMerged, searchPanHubStream } from '../panHubSearch'
import { createMediaryResourceProvider } from '../../../electron/main/mediary/resources'

// Explicit opt-in: these checks contact the deployed service and perform real searches.
describe.runIf(process.env.BOXPLAYER_PANSOU_LIVE === '1')('deployed PanSou integration', () => {
  const apiBase = `${Config.BOXPLAYER_API_URL}/api`
  const keyword = '流浪地球'

  it('uses the deployed container through the configured Electron API origin', async () => {
    const health = await requestPanHub({ url: `${apiBase}/health` })
    expect(health.status).toBe(200)
    expect(health.data).toMatchObject({ status: 'ok', plugins_enabled: true })
    expect((health.data as any).plugin_count).toBeGreaterThan(0)
    // This observation is emitted by the Go PanSou service, not the former API proxy.
    expect((health.data as any).tg).toBeDefined()

    const events: any[] = []
    const response = await requestPanHubStream({
      url: `${apiBase}/search/stream`, method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kw: keyword, src: 'all', res: 'merged_by_type' })
    }, event => events.push(event))
    expect(response).toEqual({ ok: true, status: 200 })
    expect(events.some(event => event.type === 'results')).toBe(true)
    const done = events.find(event => event.type === 'done')
    expect(done?.code).toBe(0)
    const merged = extractPanHubMerged(done.data)
    expect(Object.values(merged).flat().length).toBeGreaterThan(0)
    expect(merged.aliyun?.length).toBeGreaterThan(0)
  }, 90000)

  it('renders real streamed search payloads using the renderer search parser', async () => {
    const result = await searchPanHubStream({ apiBase, keyword })
    expect(result.total).toBeGreaterThan(0)
    expect(result.merged.aliyun?.length).toBeGreaterThan(0)
    expect(result.failedSources).toBe(0)
  }, 90000)

  it('supplies real Aliyun candidates to the Mediary resource provider', async () => {
    const provider = createMediaryResourceProvider({ model: null, boxplayerApiBaseURL: Config.BOXPLAYER_API_URL }, 'aliyun')
    const snapshot = await provider.search({ keyword })
    expect(snapshot.candidates.length).toBeGreaterThan(0)
    expect(snapshot.candidates.every(candidate => candidate.type === 'aliyun')).toBe(true)
  }, 180000)
})
