import './music-head.js'
export interface HeadTags {
  durationSec?: number; sampleRate?: number; channels?: number; bitrate?: number; codec?: string
  title?: string; artists?: string[]; album?: string; albumArtists?: string[]; genres?: string[]
  trackNumber?: number; discNumber?: number; releaseDate?: string; lyrics?: string; artworkDataURL?: string
  musicBrainzRecordingID?: string; musicBrainzReleaseID?: string; isrc?: string[]; replayGainTrack?: number; replayGainAlbum?: number
}
export interface HeadResult { schemaVersion: number; status: 'parsed' | 'no-tags' | 'truncated' | 'unsupported' | 'error'; tags: HeadTags }
export const MUSIC_HEAD_BYTES = 1024 * 1024
export async function parseLocalMusicHead(base64: string): Promise<HeadResult> {
  const core = (globalThis as unknown as { BoxPlayerMusicHead: { parseBase64: (value: string) => Promise<HeadResult> } }).BoxPlayerMusicHead
  return core.parseBase64(base64)
}

export async function parseLocalMusicFile(size: number, name: string, read: (position: number, length: number) => Promise<string>): Promise<HeadResult> {
  const core = (globalThis as unknown as { BoxPlayerMusicHead: { parseLocalNative: (size: number, name: string, read: (position: number, length: number) => Promise<string>, callback: (json: string) => void) => void } }).BoxPlayerMusicHead
  return new Promise((resolve, reject) => core.parseLocalNative(size, name, read, json => {
    const result = JSON.parse(json) as HeadResult
    if (result.status === 'error') reject(new Error('Local music metadata parse failed')); else resolve(result)
  }))
}
