import { computed, onBeforeUnmount, provide, shallowRef } from 'vue'
import { liveQuery } from 'dexie'
import DBDown from './dbdown'
import useDowningStore from '../down/DowningStore'
import useDownedStore from '../down/DownedStore'
import { downloadTrackKey, musicDownloadStatesKey, musicDownloadStatus, type MusicDownloadStatus } from './musicDownloadStatus'
export function provideMusicDownloads() {
 const persisted = shallowRef<any[]>([]), downloading = useDowningStore(), downloaded = useDownedStore()
 const subscription = liveQuery(() => Promise.all([DBDown.idowned.toArray(), DBDown.idowning.toArray()])).subscribe({ next: groups => { persisted.value = groups.flat() }, error: error => { console.warn('Music download snapshot unavailable', error?.name) } })
 const states = computed(() => {
  const result: Record<string, MusicDownloadStatus> = {}
  for (const row of [...persisted.value, ...downloaded.ListDataRaw, ...downloading.ListDataRaw]) {
   const phase = row.Down.IsFailed ? 'failed' : row.Down.IsCompleted ? 'completed' : row.Down.IsDowning ? 'downloading' : row.Down.IsStop ? 'paused' : 'queued'
   result[downloadTrackKey(row.Info)] = musicDownloadStatus(phase, row.Down.DownSize, row.Info.size)
  }
  return result
 })
 provide(musicDownloadStatesKey, states); onBeforeUnmount(() => subscription.unsubscribe()); return states
}
