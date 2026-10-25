import { describe, expect, it, vi } from 'vitest'
import { TmdbService, TmdbTransientError } from '../tmdb'

describe('TMDB scrape error classification', () => {
  it('keeps a transient API failure distinct from a confirmed no-match result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 503, data: null, msg: 'upstream unavailable' })
    })))

    await expect(TmdbService.getInstance().searchMovie('Arrival')).rejects.toBeInstanceOf(TmdbTransientError)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('treats the API no-match response as a normal miss', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 404, data: null, msg: 'No movie found' })
    })))

    await expect(TmdbService.getInstance().searchMovie('Not A Real Movie')).resolves.toBeNull()
    vi.unstubAllGlobals()
  })

  it('backs off according to Retry-After before retrying a 429 response', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'retry-after': '1' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { id: 1, title: 'Arrival', certification: 'PG-13' } }) })
      vi.stubGlobal('fetch', fetchMock)

      const result = TmdbService.getInstance().searchMovie('Arrival')
      await vi.advanceTimersByTimeAsync(1000)

      await expect(result).resolves.toMatchObject({ id: 1, title: 'Arrival' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('times out a stalled response body and preserves a retryable outcome', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      })))
      const result = expect(TmdbService.getInstance().searchMovie('Arrival')).rejects.toBeInstanceOf(TmdbTransientError)
      await vi.advanceTimersByTimeAsync(45_000)
      await result
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  })

  it('does not retry a definite HTTP failure such as 404', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, headers: new Headers() })
    vi.stubGlobal('fetch', fetchMock)

    await expect(TmdbService.getInstance().searchMovie('Not A Real Movie')).rejects.toBeInstanceOf(TmdbTransientError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
