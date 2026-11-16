import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IMusicTrack } from '../../types/music'
import { applyMusicCatalogMatch, musicCatalogHints, shouldEnrichMusic, MUSIC_METADATA_VERSION } from '../musicCatalog'
const mocks = vi.hoisted(() => ({ candidates: vi.fn(), update: vi.fn(), post: vi.fn(), all: vi.fn() }))
vi.mock('../../store/musiclibrary', () => ({ default: () => ({ getEnrichmentCandidates: mocks.candidates, updateTrackEnrichment: mocks.update }) }))
vi.mock('../db', () => ({ default: { imusic_track: { toArray: mocks.all } } }))
vi.mock('../../config', () => ({ default: { BOXPLAYER_API_URL: 'https://catalog.example' } }))
vi.mock('axios', () => ({ default: { post: mocks.post } }))
vi.mock('../debuglog', () => ({ default: { mSaveWarning: vi.fn() } }))
import { enrichMusicLibrary } from '../musicEnrichment'
const track = (patch: Partial<IMusicTrack> = {}) => ({ id: '1', file_name: '01.可爱女人.flac', parent_path: '/周杰伦无损音乐集合/2000.11.07 - Jay', ...patch } as IMusicTrack)

describe('Shared music catalogue contract', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.all.mockResolvedValue([]); mocks.post.mockResolvedValue({ data: { matches: [], retryableFailureIDs: [] } }) })
  it('derives artist and album from ancestor folders without treating a date as an artist', () => {
    expect(musicCatalogHints(track())).toMatchObject({ title: '可爱女人', artist: '周杰伦', album: 'Jay', trackNumber: 1 })
    expect(musicCatalogHints(track({ file_name: '周杰伦-01.可爱女人.wma' }))).toMatchObject({ title: '可爱女人', artist: '周杰伦', trackNumber: 1 })
  })
  it('revisits incomplete metadata despite having a cover, with 1 day / 7 day intervals', () => {
    const now = 10 * 86400000
    const incomplete = track({ cover_url: 'cover', metadata_version: MUSIC_METADATA_VERSION, enriched_at: now - 86400000 })
    expect(shouldEnrichMusic(incomplete, now)).toBe(true)
    expect(shouldEnrichMusic({ ...incomplete, artist: 'Artist', album: 'Album', release_date: '2000' }, now)).toBe(false)
    expect(shouldEnrichMusic({ ...incomplete, metadata_version: 12, enriched_at: now }, now)).toBe(true)
  })
  it('rejects low confidence and preserves embedded or manual fields', () => {
    const match = { id: '0', title: 'Remote', artist: 'Artist', album: 'Album', provider: 'catalog', confidence: .87 }
    expect(applyMusicCatalogMatch(track(), match)).toEqual({})
    expect(applyMusicCatalogMatch(track({ metadata_source: 'manual' }), { ...match, confidence: .99 })).toEqual({})
    expect(applyMusicCatalogMatch(track({ title: 'Embedded', metadata_source: 'embedded' }), { ...match, confidence: .99 })).toMatchObject({ album: 'Album', artist: 'Artist' })
    expect(applyMusicCatalogMatch(track({ title: 'Embedded', metadata_source: 'embedded' }), { ...match, confidence: .99 })).not.toHaveProperty('title')
  })
  it('sends 13 same-directory tracks as 11 + 2 with Apple request keys', async () => {
    mocks.candidates.mockResolvedValue(Array.from({ length: 13 }, (_, i) => track({ id: String(i), file_name: `${i + 1}.歌曲${i}.flac` })))
    expect(await enrichMusicLibrary()).toBe(13)
    expect(mocks.post.mock.calls.map(call => call[1].tracks.length)).toEqual([11, 2])
    expect(mocks.post.mock.calls[0][0]).toBe('https://catalog.example/api/music/metadata')
    expect(mocks.post.mock.calls[0][1].tracks[0]).toMatchObject({ id: '0', artist: '周杰伦', album: 'Jay', trackNumber: 1 })
    expect(mocks.post.mock.calls[0][2]).toEqual({ timeout: 45000 })
  })
  it('persists the first API batch while the next batch is still pending', async () => {
    mocks.candidates.mockResolvedValue(Array.from({ length: 13 }, (_, i) => track({ id: String(i), file_name: `${i + 1}.歌曲${i}.flac` })))
    let release!: (response: unknown) => void
    mocks.post.mockResolvedValueOnce({ data: { matches: [], retryableFailureIDs: [] } })
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const running = enrichMusicLibrary()
    try {
      await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2))
      expect(mocks.update).toHaveBeenCalledTimes(11)
    } finally { release({ data: { matches: [], retryableFailureIDs: [] } }) }
    expect(await running).toBe(13)
    expect(mocks.update).toHaveBeenCalledTimes(13)
  })
  it('stamps transport failures so store notifications cannot create a retry loop', async () => {
    mocks.candidates.mockResolvedValue([track()]); mocks.post.mockRejectedValue(new Error('timeout'))
    expect(await enrichMusicLibrary()).toBe(1)
    expect(mocks.update).toHaveBeenCalledWith('1', expect.objectContaining({ metadata_version: MUSIC_METADATA_VERSION, enriched_at: expect.any(Number) }))
  })
  it('does not query an ambiguous title-only singleton', async () => {
    mocks.candidates.mockResolvedValue([track({ parent_path: '/音乐' })])
    await enrichMusicLibrary()
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it('persists shared-service fields and artwork aliases', async () => {
    mocks.candidates.mockResolvedValue([track()])
    mocks.post.mockResolvedValue({ data: { matches: [{ id: '0', title: '可爱女人', artist: '周杰伦', album: 'Jay', releaseDate: '2000', artworkUrl: 'https://cover.example/a.jpg', provider: 'itunes', confidence: .99 }] } })
    await enrichMusicLibrary()
    expect(mocks.update).toHaveBeenCalledWith('1', expect.objectContaining({ album: 'Jay', release_date: '2000', cover_url: 'https://cover.example/a.jpg', metadata_provider: 'itunes' }))
  })
})

it('retries a transient catalog failure in a minute rather than a day', async () => {
  mocks.candidates.mockResolvedValue([track()])
  mocks.post.mockResolvedValue({ data: { matches: [], retryableFailureIDs: ['0'] }, headers: { 'retry-after': '120' } })
  const before = Date.now()
  await enrichMusicLibrary()
  const patch = mocks.update.mock.calls.at(-1)![1]
  expect(patch.metadata_retry_at).toBeGreaterThanOrEqual(before + 120000)
  expect(shouldEnrichMusic({ ...track(), ...patch }, before + 1000)).toBe(false)
  expect(shouldEnrichMusic({ ...track(), ...patch }, before + 121000)).toBe(true)
})

it('catalogue scraping finishes with API requests only and never reads audio bytes', async () => {
  vi.clearAllMocks()
  const read = vi.fn()
  vi.stubGlobal('window', { WebReadMusicHead: read })
  mocks.candidates.mockResolvedValue([track({ artist: '周杰伦', title: '可爱女人' })])
  mocks.all.mockResolvedValue([])
  mocks.post.mockResolvedValue({ data: { matches: [], retryableFailureIDs: [] } })
  try {
    expect(await enrichMusicLibrary()).toBe(1)
    expect(mocks.post).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})
