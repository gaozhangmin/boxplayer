const getStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined
  } catch {
    return undefined
  }
}

const normalizeVideoDriveId = (driveId: string) => {
  if (driveId === '115') return 'drive115'
  return driveId
}

export const videoProgressStorageKey = (userId: string, driveId: string, fileId: string) =>
  `boxplayer:video-progress:${userId}:${normalizeVideoDriveId(driveId)}:${fileId}`

export const getLocalVideoProgress = (userId: string, driveId: string, fileId: string): number => {
  const storage = getStorage()
  if (!storage || !userId || !driveId || !fileId) return 0
  const values = [
    storage.getItem(videoProgressStorageKey(userId, driveId, fileId)),
    // Read the pre-normalization key once so existing progress is preserved.
    storage.getItem(`boxplayer:video-progress:${userId}:${driveId}:${fileId}`),
    storage.getItem(`boxplayer:video-progress:shared:${userId}:${fileId}`)
  ].map(value => Number(value || 0))
  const progress = Math.max(...values.filter(value => Number.isFinite(value) && value > 0), 0)
  return Math.floor(progress)
}

export const saveLocalVideoProgress = (userId: string, driveId: string, fileId: string, position: number) => {
  const storage = getStorage()
  if (!storage || !userId || !driveId || !fileId || !Number.isFinite(position) || position <= 0) return
  try {
    const value = String(Math.floor(position))
    storage.setItem(videoProgressStorageKey(userId, driveId, fileId), value)
  } catch {
  }
}

// File-browser positions are independent of provider and media-library progress.
export const directVideoHistoryKey = 'boxplayer:direct-video-history.v1'

export type DirectVideoFile = {
  user_id: string
  drive_id: string
  file_id: string
  parent_file_id: string
  file_name: string
}

export type DirectVideoResume = DirectVideoFile & {
  position: number
  duration: number
  updatedAt: number
}

function directIdentity(file: DirectVideoFile) {
  return JSON.stringify([file.user_id, normalizeVideoDriveId(file.drive_id), file.file_id])
}

export function readDirectVideoHistory(): DirectVideoResume[] {
  try {
    const value = JSON.parse(getStorage()?.getItem(directVideoHistoryKey) || '[]')
    return Array.isArray(value) ? value.filter(item =>
      item && typeof item.user_id === 'string' && typeof item.drive_id === 'string'
      && typeof item.file_id === 'string' && typeof item.file_name === 'string'
      && Number.isFinite(item.position) && Number.isFinite(item.duration)
      && item.position > 0 && item.duration > item.position
    ) : []
  } catch {
    return []
  }
}

export function directVideoPosition(file: DirectVideoFile): number {
  return readDirectVideoHistory().find(entry => directIdentity(entry) === directIdentity(file))?.position || 0
}

export function saveDirectVideoProgress(file: DirectVideoFile, position: number, duration: number, finished = false) {
  if (!file.user_id || !file.drive_id || !file.file_id) return
  if (!finished && (!Number.isFinite(position) || !Number.isFinite(duration) || position <= 0 || duration <= 0)) return
  const records = readDirectVideoHistory().filter(entry => directIdentity(entry) !== directIdentity(file))
  if (!finished && position / duration < 0.99) {
    const { user_id, drive_id, file_id, parent_file_id, file_name } = file
    records.unshift({ user_id, drive_id, file_id, parent_file_id, file_name, position, duration, updatedAt: Date.now() })
  }
  try {
    getStorage()?.setItem(directVideoHistoryKey, JSON.stringify(records.slice(0, 100)))
  } catch { /* Progress persistence must not interrupt playback. */ }
}
