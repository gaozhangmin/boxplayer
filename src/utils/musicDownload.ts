import type { IAliGetFileModel } from '../aliapi/alimodels'
import type { IPageMusicTrack } from '../store/appstore'
import { musicTrackKey } from './musicPlayerStorage'

type DownloadableTrack = Pick<IPageMusicTrack, 'user_id' | 'drive_id' | 'file_id' | 'parent_file_id' | 'file_name'> & Partial<IPageMusicTrack>

/** Cloud-drive tracks can go through DownDAL; local imports and media-server streams cannot. */
export function isDownloadableMusicTrack(track: DownloadableTrack): boolean {
  if (!track.file_id || !track.drive_id || track.local_url || track.media_server_id) return false
  if ((track.user_id || '').startsWith('media-server:') || (track.drive_id || '').startsWith('media-server:')) return false
  return track.drive_id !== 'local' && track.user_id !== 'local'
}

export function musicTrackToDownloadFile(track: DownloadableTrack): IAliGetFileModel & { user_id: string } {
  const name = track.file_name || ''
  const dot = name.lastIndexOf('.')
  return {
    __v_skip: true,
    user_id: track.user_id || '',
    drive_id: track.drive_id,
    file_id: track.file_id,
    parent_file_id: track.parent_file_id || 'root',
    name,
    namesearch: name.toLowerCase(),
    ext: track.ext || (dot > 0 ? name.slice(dot + 1) : ''),
    mime_type: '',
    mime_extension: '',
    category: 'audio',
    icon: 'iconfile-audio',
    size: track.size || 0,
    sizeStr: '',
    time: 0,
    timeStr: '',
    starred: false,
    isDir: false,
    thumbnail: track.thumbnail || '',
    // DownDAL derives the encryption type from the description marker.
    description: track.encType || ''
  } as IAliGetFileModel & { user_id: string }
}

/** Splits a list into unique downloadable cloud files and the number of skipped tracks. */
export function planMusicDownload(tracks: DownloadableTrack[]): { files: (IAliGetFileModel & { user_id: string })[]; skipped: number } {
  const seen = new Set<string>()
  const files: (IAliGetFileModel & { user_id: string })[] = []
  let skipped = 0
  for (const track of tracks) {
    const key = musicTrackKey(track)
    if (seen.has(key)) continue
    seen.add(key)
    if (isDownloadableMusicTrack(track)) files.push(musicTrackToDownloadFile(track))
    else skipped += 1
  }
  return { files, skipped }
}
