import type { HeadTags, HeadResult } from '../module/music-head/client'
import type { IMusicTrack } from '../types/music'

let worker: Worker | undefined
let serial = 0
const callbacks = new Map<number, { resolve: (result: HeadResult) => void; reject: (error: Error) => void; readLocal?: (position:number,length:number)=>Promise<string> }>()
export function parseHeadInBackground(base64: string): Promise<HeadResult> {
  if (!worker) {
    worker = new Worker(new URL('./musicHead.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event) => {
      const pending = callbacks.get(event.data.id)
      if (event.data.mode === 'local-range') {
        void pending?.readLocal?.(event.data.position,event.data.length)
          .then(base64 => worker?.postMessage({mode:'range-result',requestId:event.data.requestId,base64}))
          .catch(() => worker?.postMessage({mode:'range-result',requestId:event.data.requestId,error:true}))
        return
      }
      callbacks.delete(event.data.id)
      if (event.data.error) pending?.reject(new Error(event.data.error)); else pending?.resolve(event.data.result)
    }
    worker.onerror = () => { for (const pending of callbacks.values()) pending.reject(new Error('Music worker failed')); callbacks.clear(); worker?.terminate(); worker = undefined }
  }
  const id = ++serial
  return new Promise((resolve, reject) => { callbacks.set(id, { resolve, reject }); worker!.postMessage({ id, base64 }) })
}
export function parseLocalFileInBackground(size:number,name:string,readLocal:(position:number,length:number)=>Promise<string>):Promise<HeadResult> {
  // Initializes the worker without sending file bytes through the UI thread.
  if (!worker) {
    worker = new Worker(new URL('./musicHead.worker.ts',import.meta.url),{type:'module'})
    worker.onmessage = event => {
      const pending = callbacks.get(event.data.id)
      if (event.data.mode === 'local-range') {
        void pending?.readLocal?.(event.data.position,event.data.length)
          .then(base64 => worker?.postMessage({mode:'range-result',requestId:event.data.requestId,base64}))
          .catch(() => worker?.postMessage({mode:'range-result',requestId:event.data.requestId,error:true}))
      } else {
        callbacks.delete(event.data.id)
        if (event.data.error) pending?.reject(new Error(event.data.error)); else pending?.resolve(event.data.result)
      }
    }
    worker.onerror = () => { for (const pending of callbacks.values()) pending.reject(new Error('Music worker failed'));callbacks.clear();worker?.terminate();worker=undefined }
  }
  const id = ++serial
  return new Promise((resolve,reject)=>{callbacks.set(id,{resolve,reject,readLocal});worker!.postMessage({mode:'local',id,size,name})})
}
type PlaybackSource = { url: string; headers?: Record<string, string> }
export function headTagsPatch(tags: HeadTags): Partial<IMusicTrack> {
  const patch: Partial<IMusicTrack> = { head_tag_version: 1 }
  const fields = { title: tags.title, artist: tags.artists?.join(' & '), artists: tags.artists, album: tags.album, album_artist: tags.albumArtists?.join(' & '), album_artists: tags.albumArtists,
    genre: tags.genres?.join(' / '), track_number: tags.trackNumber, disc_number: tags.discNumber, release_date: tags.releaseDate,
    musicbrainz_recording_id: tags.musicBrainzRecordingID, musicbrainz_release_id: tags.musicBrainzReleaseID, isrc: tags.isrc,
    replaygain_track: tags.replayGainTrack, replaygain_album: tags.replayGainAlbum, lyric_text: tags.lyrics } as const
  for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== '') Object.assign(patch, { [key]: value })
  if (Object.keys(patch).length > 1) patch.metadata_source = 'embedded'
  if (Number.isFinite(tags.durationSec) && tags.durationSec! > 0) patch.duration_ms = tags.durationSec! * 1000
  if (tags.artworkDataURL) { patch.cover_url = tags.artworkDataURL; patch.artwork_origin = 'embedded' }
  return patch
}
/** A local identity is required in addition to a disk/loopback locator. */
export function isLocalAudioURL(value: string): boolean {
  if (/^(?:blob:|[a-z]:[\\/])/i.test(value) || (value.startsWith('/') && !value.startsWith('//'))) return true
  try {
    const url = new URL(value)
    if (url.protocol === 'file:') return !url.hostname || url.hostname === 'localhost'
    if (url.protocol === 'mediafile:') return true
    return ['http:', 'https:'].includes(url.protocol) && ['mediafile.localhost', '127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch { return false }
}
const localReads = new Map<string, Promise<HeadResult>>()
let localReadTail: Promise<unknown> = Promise.resolve()
function readLocalHead(source: PlaybackSource, name = source.url): Promise<HeadResult> {
  const existing = localReads.get(source.url)
  if (existing) return existing
  const job = localReadTail.then(async () => {
    const read = window.WebReadMusicLocal
    if (!read) throw new Error('Full local music reader unavailable')
    const info = await read({url:source.url})
    const result = await parseLocalFileInBackground(info.size,name, async (offset,length) => {
      const range = await read({url:source.url,offset,length,version:info.version})
      return range.base64 || ''
    })
    await read({url:source.url,version:info.version})
    return result
  })
  localReads.set(source.url, job)
  localReadTail = job.catch(() => {})
  void job.finally(() => localReads.delete(source.url)).catch(() => {})
  return job
}

export async function readTrackHead(track: IMusicTrack, source?: PlaybackSource): Promise<Partial<IMusicTrack>> {
  if (track.metadata_source === 'manual' || typeof window === 'undefined' || !source?.url) return {}
  if (track.user_id === 'local' && isLocalAudioURL(source.url)) {
    if (track.local_tag_version === 1) return {}
    return {...headTagsPatch((await readLocalHead(source,track.file_name)).tags),local_tag_version:1}
  }
  // Network audio is never opened for metadata, including during playback.
  return {}
}

const pending = new Set<string>()
/** Detached from catalogue batches. Re-read the current row before applying a patch. */
export function scheduleTrackHeads(tracks: IMusicTrack[], source?: PlaybackSource) {
  for (const track of tracks) {
    if (pending.has(track.id) || (track.user_id === 'local' ? track.local_tag_version === 1 : track.head_tag_version === 1)) continue
    pending.add(track.id)
    setTimeout(() => { void (async () => {
      try {
        const { default: DB } = await import('./db')
        const before = await DB.getMusicTrackById(track.id)
        if (!before || before.metadata_source === 'manual' || (before.user_id === 'local' ? before.local_tag_version === 1 : before.head_tag_version === 1)) return
        const patch = await readTrackHead(before, source)
        if (!Object.keys(patch).length) return
        const { default: useStore } = await import('../store/musiclibrary')
        const current = await DB.getMusicTrackById(track.id)
        if (!current || current.metadata_source === 'manual' || current.scanned_at !== before.scanned_at) return
        await useStore().updateTrackEnrichment(track.id, patch)
      } catch { /* Retry only on a future user playback request; account cooldown remains enforced. */ }
      finally { pending.delete(track.id) }
    })() }, 0)
  }
}

/** Called only after this song starts playback; never resolves another download URL. */
export function enrichPlayingTrack(track: import('../store/appstore').IPageMusicTrack, source: PlaybackSource) {
  if (track.user_id !== 'local' || !isLocalAudioURL(source.url) || track.media_server_id || (track.user_id === 'local' ? track.local_tag_version === 1 : track.head_tag_version === 1) || !source.url) return
  setTimeout(() => { void (async () => {
    if (track.library_track_id) {
      const { default: DB } = await import('./db')
      const row = await DB.getMusicTrackById(track.library_track_id)
      if (row) scheduleTrackHeads([row], source)
      return
    }
    if ((track.metadata_source === 'embedded' && track.user_id !== 'local') || track.metadata_source === 'manual') return
    const patch = await readTrackHead({ ...track, id: `${track.user_id}|${track.drive_id}|${track.file_id}` } as IMusicTrack, source)
    Object.assign(track, { local_tag_version:patch.local_tag_version, duration_ms:patch.duration_ms || track.duration_ms, head_tag_version: patch.head_tag_version, title: patch.title || track.title, artist: patch.artist || track.artist, album: patch.album || track.album,
      lyric_text: patch.lyric_text || track.lyric_text, thumbnail: patch.cover_url || track.thumbnail, metadata_source: patch.metadata_source || track.metadata_source })
  })().catch(() => { /* Playback and existing metadata remain usable. */ }) }, 0)
}

/** Local files alone may be read automatically after import/catalogue completion. */
export function scheduleLocalTrackHeads(tracks: import('../store/appstore').IPageMusicTrack[]) {
  setTimeout(() => { void (async () => {
    for (const track of tracks) {
      const url = track.local_url
      if (track.user_id !== 'local' || !url || !isLocalAudioURL(url) || track.media_server_id || track.local_tag_version === 1 || track.metadata_source === 'manual') continue
      try {
        if (track.library_track_id) {
          const { default: DB } = await import('./db')
          const row = await DB.getMusicTrackById(track.library_track_id)
          if (row?.user_id === 'local' && row.file_id === track.file_id) scheduleTrackHeads([row], { url })
          continue
        }
        const patch = await readTrackHead({ ...track, id: `${track.user_id}|${track.file_id}` } as IMusicTrack, { url })
        if (track.local_url !== url || track.metadata_source === 'manual') continue
        Object.assign(track, { local_tag_version:patch.local_tag_version, duration_ms:patch.duration_ms || track.duration_ms, head_tag_version: patch.head_tag_version, title: patch.title || track.title,
          artist: patch.artist || track.artist, album: patch.album || track.album,
          lyric_text: patch.lyric_text || track.lyric_text, thumbnail: patch.cover_url || track.thumbnail,
          metadata_source: patch.metadata_source || track.metadata_source })
      } catch { /* Keep this song usable and continue with the remaining local files. */ }
    }
  })().catch(() => {}) }, 0)
}
