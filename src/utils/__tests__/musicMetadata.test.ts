import { beforeEach, describe, expect, it, vi } from 'vitest'
const post = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { post } }))
vi.mock('../../config', () => ({ default: { BOXPLAYER_API_URL: 'https://api.example' } }))
vi.mock('../debuglog', () => ({ default: { mSaveWarning: vi.fn() } }))
import { clearMusicMetaCache, fetchMusicMetadata, guessArtistTitle, parseLrc } from '../musicMetadata'

describe('shared music metadata', () => {
  beforeEach(() => {
    clearMusicMetaCache(); post.mockReset()
    post.mockImplementation(async (url: string) => ({ data: url.endsWith('/lyrics')
      ? { lyrics: '[00:01.00]hello\n[00:03.00]world', provider: 'lrclib' }
      : { matches: [{ id: 'playback', title: 'Song', artist: 'Artist', album: 'Album', artworkURL: 'https://img/cover.jpg', provider: 'qq', confidence: 1 }], retryableFailureIDs: [] } }))
  })
  it('uses only the shared API for catalog and lyrics', async () => {
    const meta = await fetchMusicMetadata({ filename: 'Artist - Song.mp3', durationSec: 256 })
    expect(meta).toMatchObject({ title: 'Song', artist: 'Artist', album: 'Album', cover: 'https://img/cover.jpg' })
    expect(meta.lines.map(line => line.text)).toEqual(['hello', 'world'])
    expect(post.mock.calls.map(call => call[0])).toEqual(['https://api.example/api/music/metadata', 'https://api.example/api/music/lyrics'])
    expect(post.mock.calls[1][1]).toMatchObject({ durationSec: 256 })
  })
  it('retains embedded tags and lyrics over online fields', async () => {
    const meta = await fetchMusicMetadata({ filename: 'bad.mp3', titleHint: 'Local', artistHint: 'Singer', albumHint: 'Local Album', coverHint: 'data:image/png;base64,AA==', lyricHint: '[00:01]local lyric', preserveHints: true })
    expect(meta).toMatchObject({ title: 'Local', artist: 'Singer', album: 'Local Album', lrc: '[00:01]local lyric', cover: 'data:image/png;base64,AA==' })
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('does not search a title without a reliable artist', async () => {
    expect(await fetchMusicMetadata({ filename: 'Song.mp3' })).toMatchObject({ title: 'Song', artist: '', cover: '' })
    expect(post).not.toHaveBeenCalled()
  })
  it('skips lyrics during background metadata enrichment', async () => {
    expect((await fetchMusicMetadata({ filename: 'Artist - Song.mp3', includeLyrics: false })).lines).toEqual([])
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('keeps upstream failures retryable for background jobs', async () => {
    post.mockResolvedValueOnce({ data: { matches: [], retryableFailureIDs: ['playback'] } })
    await expect(fetchMusicMetadata({ filename: 'Artist - Song.mp3', includeLyrics: false })).rejects.toMatchObject({ name: 'MusicMetadataTransientError' })
  })
  it('does not accept a low confidence response', async () => {
    post.mockResolvedValueOnce({ data: { matches: [{ id: 'playback', title: 'Wrong', artist: 'Wrong', confidence: 0.5 }], retryableFailureIDs: [] } })
    expect(await fetchMusicMetadata({ filename: 'Artist - Song.mp3', includeLyrics: false })).toMatchObject({ title: 'Song', artist: 'Artist', cover: '' })
  })
  it('separates cache entries by album', async () => {
    await fetchMusicMetadata({ filename: 'Artist - Song.mp3', albumHint: 'First', includeLyrics: false })
    await fetchMusicMetadata({ filename: 'Artist - Song.mp3', albumHint: 'Second', includeLyrics: false })
    expect(post).toHaveBeenCalledTimes(2)
  })
  it('parses KRC timestamps and global offsets', () => {
    expect(parseLrc('[1234,2800]hello<200,300>world\n[4567,1200]next')).toEqual([{ time: 1.234, text: 'helloworld' }, { time: 4.567, text: 'next' }])
    expect(parseLrc('[offset:1500]\n[00:01.00]hello')).toEqual([{ time: 2.5, text: 'hello' }])
  })
  it('displays plain lyrics and strips filename track numbers', () => {
    expect(parseLrc('one\ntwo\nthree', 90)).toEqual([{ time: 0, text: 'one' }, { time: 30, text: 'two' }, { time: 60, text: 'three' }])
    expect(guessArtistTitle('03. 周杰倫 - 星晴.flac')).toEqual({ artist: '周杰倫', title: '星晴' })
    expect(guessArtistTitle('周杰伦 - 晴天 (Live).flac')).toEqual({ artist: '周杰伦', title: '晴天 (Live)' })
  })
})
