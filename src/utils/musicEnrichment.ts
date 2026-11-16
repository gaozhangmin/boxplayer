import axios from 'axios'
import { retryAfterMs } from './musicAccountQueue'
import Config from '../config'
import useMusicLibraryStore from '../store/musiclibrary'
import DB from './db'
import DebugLog from './debuglog'
import { applyMusicCatalogMatch, musicCatalogHints, musicCohortKey, MUSIC_METADATA_VERSION, type MusicCatalogMatch } from './musicCatalog'
import type { IMusicTrack } from '../types/music'

let running = false
let stopRequested = false
export function isMusicEnrichmentRunning() { return running }
export function stopMusicEnrichment() { stopRequested = true }

// Same catalogue endpoint, cohort size, confidence and retry stamps as Apple.
export async function enrichMusicLibrary(maxItems = 60): Promise<number> {
  if (running) return 0
  running = true
  stopRequested = false
  let attempted = 0
  try {
    const store = useMusicLibraryStore()
    const candidates = await store.getEnrichmentCandidates(maxItems, Date.now())
    const cohorts = new Map<string, IMusicTrack[]>()
    for (const track of candidates) {
      const hint = musicCatalogHints(track)
      const repaired = { ...track }
      if (track.metadata_version !== MUSIC_METADATA_VERSION && ['itunes', 'online'].includes(track.metadata_source || '') && !hint.filenameArtist) {
        Object.assign(repaired, { title: hint.title, artist: '', album: '', album_artist: '', genre: '', release_date: undefined, track_number: hint.trackNumber, disc_number: undefined, cover_url: track.artwork_origin === 'embedded' ? track.cover_url : '', metadata_source: 'filename', metadata_provider: undefined, metadata_confidence: undefined, musicbrainz_recording_id: undefined, musicbrainz_release_id: undefined })
      }
      if (!repaired.metadata_source || repaired.metadata_source === 'filename') repaired.title = hint.title
      const key = musicCohortKey(repaired)
      const group = cohorts.get(key) || []
      group.push(repaired); cohorts.set(key, group)
    }
    for (const cohort of cohorts.values()) {
      while (cohort.length && !stopRequested) {
        const count = cohort.length > 12 && cohort.length % 12 === 1 ? 11 : Math.min(12, cohort.length)
        const batch = cohort.splice(0, count)
        const titleCount = new Set(batch.map(t => t.title)).size
        const requests = batch.flatMap((track, index) => {
          const hint = musicCatalogHints(track)
          const artist = track.artist || track.album_artist || hint.artist
          if (!artist && (titleCount < 2 || hint.context.length < 2)) return []
          return [{ id: String(index), title: track.title || hint.title, artist: artist || undefined, album: track.album || hint.album || undefined, context: artist ? undefined : hint.context, trackNumber: track.track_number || hint.trackNumber }]
        })
        let matches: MusicCatalogMatch[] = []
        const retryable = new Set<string>()
        let transportFailed = false
        let retryDelay = 60000
        if (requests.length) {
          try {
            const response = await axios.post(`${Config.BOXPLAYER_API_URL.replace(/\/+$/, '')}/api/music/metadata`, { tracks: requests }, { timeout: 45000 })
            if (!Array.isArray(response.data?.matches)) throw new Error('Invalid music metadata response')
            retryDelay = Math.max(60000, retryAfterMs(response.headers?.['retry-after']))
            matches = response.data.matches
            for (const id of response.data.retryableFailureIDs || []) retryable.add(String(id))
          } catch (error) {
            transportFailed = true
            retryDelay = Math.max(60000, retryAfterMs((error as any)?.response?.headers?.['retry-after']))
            DebugLog.mSaveWarning('Music catalogue enrichment failed: ' + (error as Error).message)
          }
        }
        if (stopRequested) break
        const updated = batch.map((track, index) => ({ ...track, ...applyMusicCatalogMatch(track, matches.find(m => m.id === String(index))), enriched_at: Date.now(), metadata_retry_at: transportFailed || retryable.has(String(index)) ? Date.now() + retryDelay : !matches.some(m => m.id === String(index) && m.confidence >= 0.88) ? Date.now() + 3600000 : undefined, metadata_version: MUSIC_METADATA_VERSION }))
        const library = await DB.imusic_track.toArray()
        const normalize = (s = '') => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
        const key = (t: IMusicTrack) => t.album && (t.album_artist || t.artist) ? `${normalize(t.album)}|${normalize(t.album_artist || t.artist)}` : ''
        const covers = new Map<string, Set<string>>()
        const updatedIDs = new Set(updated.map(t => t.id))
        for (const track of [...library.filter(t => !updatedIDs.has(t.id)), ...updated]) {
          const album = key(track)
          if (!album || !track.cover_url) continue
          const values = covers.get(album) || new Set<string>()
          values.add(track.cover_url); covers.set(album, values)
        }
        for (const track of updated) {
          const artwork = covers.get(key(track))
          if (!track.cover_url && artwork?.size === 1 && [...artwork][0] !== track.artwork_failed_url) { track.cover_url = [...artwork][0]; track.artwork_origin = 'album' }
          if (!track.cover_url && track.artwork_failed_url && Date.now() - (track.artwork_failed_at || 0) < 300000) track.metadata_retry_at = (track.artwork_failed_at || Date.now()) + 300000
          await store.updateTrackEnrichment(track.id, track)
          attempted++
        }
      }
      if (stopRequested) break
    }
  } finally { running = false; stopRequested = false }
  return attempted
}
