import type { CreateMediaAcquisitionRunInput, CreateMediaAcquisitionTrackingInput, MediaAcquisitionNotification, MediaAcquisitionRunView, MediaAcquisitionState, MediaAcquisitionTrackingItem } from '@shared/types/mediaAcquisition'
import { requireMediaAcquisitionPro } from '../../utils/usageLimit'

// The mediary-scout workflow runs in the main process (electron/main/mediary); these calls
// only start tasks and read their state.

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const ipc = window.Electron?.ipcRenderer
  if (!ipc) return Promise.reject(new Error('媒体获取功能仅支持桌面客户端'))
  return ipc.invoke(channel, ...args) as Promise<T>
}

function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createMediaAcquisitionRun(input: CreateMediaAcquisitionRunInput): Promise<MediaAcquisitionRunView> {
  requireMediaAcquisitionPro()
  return invoke('mediary:createRun', toIpcPayload(input))
}

/** Tracking a season is mediary's season acquisition: it fetches what has aired, then keeps patrolling. */
export function createMediaAcquisitionTracking(input: CreateMediaAcquisitionTrackingInput): Promise<MediaAcquisitionRunView> {
  return createMediaAcquisitionRun({ ...input, kind: 'season', trackingEnabled: true })
}

export function listMediaAcquisitionRuns(limit?: number): Promise<MediaAcquisitionRunView[]> { return invoke('mediary:listRuns', limit) }
export function getMediaAcquisitionRun(runId: string): Promise<MediaAcquisitionRunView | null> { return invoke('mediary:getRun', runId) }
export function listMediaAcquisitionStates(): Promise<MediaAcquisitionState[]> { return invoke('mediary:listStates') }
export async function listMediaAcquisitionTracking(limit?: number): Promise<MediaAcquisitionTrackingItem[]> {
  const items = await invoke<MediaAcquisitionTrackingItem[]>('mediary:listTracking')
  return limit ? items.slice(0, limit) : items
}
export function endMediaAcquisitionTracking(trackingId: string): Promise<null> { return invoke('mediary:endTracking', trackingId) }
export function runMediaAcquisitionTrackingPatrol(): Promise<void> { return invoke('mediary:runPatrol') }
export function cancelMediaAcquisitionRun(runId: string): Promise<null> { return invoke('mediary:cancelRun', runId) }
export function retryMediaAcquisitionRun(runId: string): Promise<MediaAcquisitionRunView | null> { return invoke('mediary:retryRun', runId) }
export function clearCompletedMediaAcquisitionRuns(): Promise<number> { return invoke('mediary:clearCompletedRuns') }
export function listMediaAcquisitionNotifications(limit?: number): Promise<MediaAcquisitionNotification[]> { return invoke('mediary:listNotifications', limit) }
export function markMediaAcquisitionNotificationsRead(ids?: string[]): Promise<void> { return invoke('mediary:markNotificationsRead', ids) }
export function clearMediaAcquisitionNotifications(): Promise<number> { return invoke('mediary:clearNotifications') }
