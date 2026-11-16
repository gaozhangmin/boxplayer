import type { IMusicTrack } from '../types/music'

// Shared contract with Apple MusicLibraryMetadataScraper and Android MusicMetadataScraper.
export const MUSIC_METADATA_VERSION = 14
const DAY = 24 * 60 * 60 * 1000
const date = /^\s*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*$/
const release = /^\s*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*[-–—]\s*(.+)$/
const albumHint = (value = '') => /^(其他单曲|单曲|singles?|others?|misc)$/i.test(value.replace(/\s/g, '')) ? '' : value.trim()
const folderHint = (value: string) => value.split(/ [–—-] /).map(s => s.trim())

export function musicCatalogHints(track: IMusicTrack) {
  let title = track.file_name.replace(/\.[^.]+$/, '').trim()
  let artist = ''
  let trackNumber: number | undefined
  const compact = title.match(/^(.+?)[-–—]\s*(\d{1,3})\s*[._、-]+\s*(.+)$/)
  if (compact) {
    artist = compact[1].trim(); trackNumber = Number(compact[2]); title = compact[3]
  } else {
    const prefix = title.match(/^(?:(?:disc|cd)\s*\d+\s*[-_. ]+)?(\d{1,3})\s*[-_. 、]+/i)
    if (prefix) { trackNumber = Number(prefix[1]); title = title.slice(prefix[0].length) }
    title = title.replace(/^(?:\d{1,3}[.\s_-]+)+/, '')
    const parts = title.split(/ - | – |—| -|- /)
    if (parts.length > 1) { artist = parts.shift()!.trim(); title = parts.join(' - ') }
  }
  title = title.replace(/[([（【][^\])）】]*(?:official|mv|hd|hq|hi[- ]?res|lossless|flac|wav|m4a|aac|mp3|高清|无损|完整版)[^\])）】]*[\])）】]/gi, ' ')
    .replace(/\s*-\s*(official|mv|hd|hq|lossless|高清|无损|完整版)\s*$/i, '')
    .replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim()
  const filenameArtist = artist
  const folders = (track.parent_path || '').replace(/\\/g, '/').split('/').filter(Boolean)
  const context = folders.at(-1) || ''
  let album = ''
  const current = folderHint(context)
  if (current.length >= 2 && current[0].length >= 2 && !date.test(current[0])) {
    artist ||= current[0]; album = albumHint(current.slice(1).join(' - '))
  }
  for (const folder of [...folders].reverse()) {
    album ||= albumHint(folder.match(release)?.[1])
  }
  for (const folder of [...folders].reverse()) {
    if (artist || release.test(folder)) continue
    const name = folder.replace(/^\s*\d{1,3}[.\s_-]+/, '').trim()
    const candidate = name.replace(/\s+\d+\s*(?:张|CD).*$/i, '').replace(/(?:无损|高品质|精选)?音乐(?:合集|集合|专辑|歌曲|作品).*$/, '').trim()
    if (candidate !== name && candidate.length >= 2 && !date.test(candidate)) artist = candidate
  }
  for (const folder of [...folders].reverse()) {
    if (artist) break
    const hint = folderHint(folder)
    if (hint.length >= 2 && hint[0].length >= 2 && !date.test(hint[0])) {
      artist = hint[0]; album ||= albumHint(hint.slice(1).join(' - '))
    }
  }
  return { title, artist, album, context, trackNumber, filenameArtist }
}

export function shouldEnrichMusic(track: IMusicTrack, now = Date.now()) {
  const title = (track.title || musicCatalogHints(track).title).trim()
  if (title.length < 2 || /^\d+$/.test(title) || track.metadata_source === 'manual') return false
  if (track.metadata_retry_at && now < track.metadata_retry_at) return false
  if (track.metadata_retry_at && now >= track.metadata_retry_at) return true
  const incomplete = !track.cover_url || !(track.artist || track.album_artist) || !track.album || !track.release_date?.trim()
  if (track.metadata_source === 'embedded' && !incomplete) return false
  return track.metadata_version !== MUSIC_METADATA_VERSION || !track.enriched_at || now - track.enriched_at >= (incomplete ? DAY : 7 * DAY)
}

export function musicCohortKey(track: IMusicTrack) {
  const hint = musicCatalogHints(track)
  return [track.user_id, track.drive_id, track.parent_path || track.parent_file_id, track.artist || hint.artist].join('|')
}

export interface MusicCatalogMatch {
  id: string; title: string; artist: string; album?: string; albumArtist?: string; genre?: string
  trackNumber?: number; discNumber?: number; releaseDate?: string
  artworkURL?: string; artworkUrl?: string; artwork_url?: string
  musicBrainzRecordingID?: string; musicBrainzReleaseID?: string; provider: string; confidence: number
}

export function applyMusicCatalogMatch(track: IMusicTrack, match?: MusicCatalogMatch): Partial<IMusicTrack> {
  if (!match || !Number.isFinite(match.confidence) || match.confidence < 0.88 || track.metadata_source === 'manual') return {}
  const patch: Partial<IMusicTrack> = { metadata_confidence: match.confidence }
  const fields = { title: match.title, artist: match.artist, album: match.album, album_artist: match.albumArtist, genre: match.genre, track_number: match.trackNumber, disc_number: match.discNumber, release_date: match.releaseDate } as const
  for (const [key, value] of Object.entries(fields)) {
    if (value && (track.metadata_source !== 'embedded' || !track[key as keyof IMusicTrack])) Object.assign(patch, { [key]: value })
  }
  if (track.metadata_source !== 'embedded') { patch.metadata_source = 'online'; patch.metadata_provider = match.provider }
  const cover = match.artworkURL || match.artworkUrl || match.artwork_url
  if (cover && (cover !== track.artwork_failed_url || Date.now() - (track.artwork_failed_at || 0) >= 300000) && track.artwork_origin !== 'embedded') { patch.cover_url = cover; patch.artwork_origin = 'online' }
  if (match.musicBrainzRecordingID) patch.musicbrainz_recording_id = match.musicBrainzRecordingID
  if (match.musicBrainzReleaseID) patch.musicbrainz_release_id = match.musicBrainzReleaseID
  return patch
}
