import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IMusicTrack } from '../../types/music'
import { isScrapedMusicTrack, mergeMusicEnrichment, mergeRescannedMusicTrack, recentlyAddedMusicTracks } from '../musicTrackMerge'

const base = (patch: Partial<IMusicTrack> = {}): IMusicTrack => ({
  id: 't1', source_id: 's1', source_ids: ['s1'], user_id: 'u', drive_id: 'd', file_id: 'f', parent_file_id: 'p',
  file_name: '01 Song.mp3', ext: 'mp3', size: 1, category: 'audio', scanned_at: 1000, ...patch
} as IMusicTrack)

describe('music recently added uses the original add time', () => {
  it('keeps the first scanned_at when a track is rescanned', () => {
    const existing = base({ title: 'Song', enriched_at: 1500 })
    const merged = mergeRescannedMusicTrack(existing, base({ scanned_at: 9000, source_id: 's2', source_ids: ['s2'] }))
    expect(merged.scanned_at).toBe(1000)
    expect(merged.enriched_at).toBe(1500)
    expect(merged.source_ids).toEqual(['s1', 's2'])
  })

  it('does not bump scanned_at when scraped metadata is applied', () => {
    const merged = mergeMusicEnrichment(base(), { ...base({ scanned_at: 9000 }), artist: 'A', album: 'B' }, 5000)
    expect(merged.scanned_at).toBe(1000)
    expect(merged.enriched_at).toBe(5000)
    expect(merged.artist).toBe('A')
  })

  it('excludes every scraped track from recently added, newest add first', () => {
    const fresh = base({ id: 'fresh', scanned_at: 3000 })
    const attemptedNoMatch = base({ id: 'nomatch', scanned_at: 2000, enriched_at: 2500, metadata_source: 'filename' })
    const scraped = base({ id: 'scraped', scanned_at: 4000, metadata_source: 'online', metadata_provider: 'itunes' })
    const embeddedScraped = base({ id: 'emb', scanned_at: 5000, metadata_source: 'embedded', metadata_confidence: 0.95, artwork_origin: 'online' })
    expect(isScrapedMusicTrack(scraped)).toBe(true)
    expect(isScrapedMusicTrack(embeddedScraped)).toBe(true)
    expect(isScrapedMusicTrack(attemptedNoMatch)).toBe(false)
    expect(recentlyAddedMusicTracks([attemptedNoMatch, scraped, fresh, embeddedScraped]).map(t => t.id)).toEqual(['fresh', 'nomatch'])
    expect(recentlyAddedMusicTracks([scraped])).toEqual([])
  })

  it('every recently added surface uses the filter and hides when empty', () => {
    const store = readFileSync(resolve(__dirname, '../../store/musiclibrary.ts'), 'utf-8')
    const browser = readFileSync(resolve(__dirname, '../../layout/music/MusicLibraryBrowser.vue'), 'utf-8')
    const page = readFileSync(resolve(__dirname, '../../layout/PageMusicLibrary.vue'), 'utf-8')
    expect(store).toContain('recentlyAddedMusicTracks(tracks.value, 30)')
    expect(browser).toContain("tracks: recentlyAddedMusicTracks(props.tracks), destination: 'songs'")
    expect(browser).toContain(".filter(section => section.tracks.length)")
    expect(page).toContain('<section v-if="musicStore.recentlyAdded.length"')
  })

  it('store routes rescans and enrichment through the preserving merges', () => {
    const store = readFileSync(resolve(__dirname, '../../store/musiclibrary.ts'), 'utf-8')
    expect(store).toContain('mergeRescannedMusicTrack(existing, track)')
    expect(store).toContain('mergeMusicEnrichment(existing, patch)')
  })

  it('every library category can return to the home overview', () => {
    const browser = readFileSync(resolve(__dirname, '../../layout/music/MusicLibraryBrowser.vue'), 'utf-8')
    expect(browser).toContain("{ key: 'home', title: '音乐库' }")
    expect(browser).toContain('<header v-if="!isAlbumDetail" class="music-browser-toolbar">')
    expect(browser).toMatch(/v-if="isAlbumDetail"[^>]*@click="group = null"/)
    expect(browser).toContain("@click=\"switchTab('home')\"")
  })
})
