import type { IMusicTrack } from '../types/music'

/**
 * Merge a freshly scanned track into the record already stored in the library.
 * A rescan (e.g. after metadata scraping) must never move a track back into
 * "Recently added", so the first-seen `scanned_at` always wins.
 */
export function mergeRescannedMusicTrack(existing: IMusicTrack, track: IMusicTrack): IMusicTrack {
  const sourceIds = Array.from(new Set([...(existing.source_ids || (existing.source_id ? [existing.source_id] : [])), ...(track.source_ids || (track.source_id ? [track.source_id] : []))]))
  return {
    ...existing,
    ...track,
    source_ids: sourceIds,
    source_id: sourceIds[0],
    artist: existing.artist || track.artist,
    title: existing.title || track.title,
    album: existing.album || track.album,
    cover_url: existing.cover_url || track.cover_url,
    duration_ms: existing.duration_ms || track.duration_ms,
    lyric_source: existing.lyric_source || track.lyric_source,
    metadata_source: existing.metadata_source || track.metadata_source,
    enriched_at: existing.enriched_at,
    scanned_at: existing.scanned_at || track.scanned_at
  }
}

/** Apply scraped metadata without touching the original add time. */
export function mergeMusicEnrichment(existing: IMusicTrack, patch: Partial<IMusicTrack>, now = Date.now()): IMusicTrack {
  return {
    ...existing,
    ...patch,
    id: existing.id,
    scanned_at: existing.scanned_at || patch.scanned_at || 0,
    enriched_at: now
  }
}

/**
 * True when online scraping actually wrote metadata/artwork onto the track.
 * `enriched_at` alone is not used: it is stamped on every enrichment attempt,
 * including ones that found no catalogue match.
 */
export function isScrapedMusicTrack(track: Pick<IMusicTrack, 'metadata_source' | 'metadata_provider' | 'metadata_confidence' | 'artwork_origin'>): boolean {
  return track.metadata_source === 'online' || track.metadata_source === 'itunes' || !!track.metadata_provider || track.metadata_confidence !== undefined || track.artwork_origin === 'online'
}

/** Recently added: never-scraped tracks only, ordered by original add time. */
export function recentlyAddedMusicTracks<T extends IMusicTrack>(tracks: readonly T[], limit = Infinity): T[] {
  return tracks.filter(track => !isScrapedMusicTrack(track)).sort((a, b) => (b.scanned_at || 0) - (a.scanned_at || 0)).slice(0, limit)
}
