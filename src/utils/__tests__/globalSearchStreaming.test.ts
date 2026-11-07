import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  servers: ['slow', 'fast', 'failed', 'queued'].map(id => ({ id, name: id, type: 'jellyfin', accessToken: 'test-token' })),
  search: vi.fn()
}))
vi.mock('../../user/userdal', () => ({ default: { GetUserList: () => [], GetUserListFromDB: async () => [] } }))
vi.mock('../../store/mediaServerRegistry', () => ({ default: () => ({ servers: mocks.servers, ensureLoaded: vi.fn() }) }))
vi.mock('../../media-server/contentGateway', () => ({ getMediaServerSearch: mocks.search }))
vi.mock('../../services/agent/providerCapabilities', () => ({ supportsProviderSearch: () => true }))

import { searchAllDrives, type GlobalSearchResult } from '../globalSearch'

describe('global search streaming integration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('publishes each server before the slowest finishes and forwards cancellation to HTTP', async () => {
    let release!: (value: { items: Array<{ id: string; title: string; kind: string }> }) => void
    const slow = new Promise<{ items: Array<{ id: string; title: string; kind: string }> }>(resolve => { release = resolve })
    mocks.search.mockImplementation(async (config: { id: string }) => {
      if (config.id === 'slow') return slow
      if (config.id === 'failed') throw new Error('offline')
      return { items: [{ id: 'hit', title: config.id, kind: 'movie' }] }
    })
    const controller = new AbortController()
    const updates: GlobalSearchResult[][] = []
    let complete = false
    const run = searchAllDrives('keyword', { signal: controller.signal, onUpdate: items => updates.push(items) }).then(items => { complete = true; return items })
    await vi.waitFor(() => expect(updates.some(items => items.some(item => item.name === 'fast'))).toBe(true))
    expect(complete).toBe(false)
    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ id: 'fast', requestSignal: controller.signal }), 'keyword')
    release({ items: [{ id: 'hit', title: 'slow', kind: 'movie' }] })
    expect((await run).map(item => item.name)).toEqual(['slow', 'fast', 'queued'])
  })
})
