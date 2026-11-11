/**
 * Pinned music items (albums, playlists, songs) for the music library home.
 * There is no server-side pin backend, so pins live in localStorage like the
 * other music library preferences (pm.favs, pm.mode, local playlists).
 */
import type { IPageMusicTrack } from '../store/appstore'

export type MusicPinType = 'album' | 'playlist' | 'track'

export interface MusicPin {
  key: string
  type: MusicPinType
  title: string
  subtitle?: string
  /** Raw album/artist values for album pins (may be empty strings). */
  album?: string
  artist?: string
  playlistId?: string
  track?: IPageMusicTrack
  pinnedAt: number
}

export const MUSIC_PINS_KEY = 'pm.pins'

export function albumPinKey(artist: string | undefined, album: string | undefined): string {
  return `album:${artist || ''}\u0000${album || ''}`
}

export function playlistPinKey(id: string): string {
  return `playlist:${id}`
}

export function trackPinKey(trackKey: string): string {
  return `track:${trackKey}`
}

export function loadMusicPins(storage: Pick<Storage, 'getItem'> = localStorage): MusicPin[] {
  try {
    const parsed = JSON.parse(storage.getItem(MUSIC_PINS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((pin): pin is MusicPin => !!pin?.key && ['album', 'playlist', 'track'].includes(pin.type)) : []
  } catch {
    return []
  }
}

export function saveMusicPins(pins: MusicPin[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(MUSIC_PINS_KEY, JSON.stringify(pins)) } catch {}
}

/** Adds the pin at the front, or removes it when already pinned. */
export function toggleMusicPin(pins: MusicPin[], pin: Omit<MusicPin, 'pinnedAt'>, now = Date.now()): MusicPin[] {
  if (pins.some(item => item.key === pin.key)) return pins.filter(item => item.key !== pin.key)
  return [{ ...pin, pinnedAt: now }, ...pins]
}
