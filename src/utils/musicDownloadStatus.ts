import { computed, inject, type InjectionKey, type Ref } from 'vue'
export type MusicDownloadStatus = { phase: 'downloading' | 'completed' | 'failed' | 'paused' | 'queued' | 'cancelled'; progress?: number }
export type DownloadTrack = { user_id: string; drive_id: string; file_id: string }
export const downloadTrackKey = (track: DownloadTrack) => JSON.stringify([track.user_id, track.drive_id, track.file_id])
export const musicDownloadStatesKey: InjectionKey<Ref<Record<string, MusicDownloadStatus>>> = Symbol('music-downloads')
export function useDownloadStatus(track: () => DownloadTrack | undefined) {
 const states = inject(musicDownloadStatesKey)
 return computed(() => { const item = track(); return item ? states?.value[downloadTrackKey(item)] : undefined })
}
export function musicDownloadStatus(phase: MusicDownloadStatus['phase'], received: number, total: number): MusicDownloadStatus {
 return { phase, progress: phase === 'completed' ? 1 : total > 0 && Number.isFinite(total) && Number.isFinite(received) ? Math.min(1, Math.max(0, received / total)) : undefined }
}
