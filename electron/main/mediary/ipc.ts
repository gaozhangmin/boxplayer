import { ipcMain } from 'electron'
import type { CreateMediaAcquisitionRunInput } from '@shared/types/mediaAcquisition'
import { cancelMediaryRun, clearCompletedMediaryRuns, clearMediaryNotifications, createMediaryRun, endMediaryTracking, getMediaryRunView, listMediaryNotifications, listMediaryRunViews, listMediaryStates, listMediaryTracking, markMediaryNotificationsRead, retryMediaryRun, runMediaryPatrol } from './MediaryService'

/** Renderer-facing media acquisition API. Candidate links, tokens and the agent stay in main. */
export function registerMediaryIpc(): void {
  ipcMain.handle('mediary:createRun', (_event, input: CreateMediaAcquisitionRunInput) => createMediaryRun(input))
  ipcMain.handle('mediary:listRuns', (_event, limit?: number) => listMediaryRunViews(limit))
  ipcMain.handle('mediary:getRun', (_event, workflowRunId: string) => getMediaryRunView(workflowRunId))
  ipcMain.handle('mediary:cancelRun', (_event, workflowRunId: string) => cancelMediaryRun(workflowRunId))
  ipcMain.handle('mediary:retryRun', (_event, workflowRunId: string) => retryMediaryRun(workflowRunId))
  ipcMain.handle('mediary:clearCompletedRuns', () => clearCompletedMediaryRuns())
  ipcMain.handle('mediary:listStates', () => listMediaryStates())
  ipcMain.handle('mediary:listTracking', () => listMediaryTracking())
  ipcMain.handle('mediary:endTracking', (_event, trackingId: string) => endMediaryTracking(trackingId))
  ipcMain.handle('mediary:runPatrol', () => runMediaryPatrol())
  ipcMain.handle('mediary:listNotifications', (_event, limit?: number) => listMediaryNotifications(limit))
  ipcMain.handle('mediary:markNotificationsRead', (_event, ids?: string[]) => markMediaryNotificationsRead(ids))
  ipcMain.handle('mediary:clearNotifications', () => clearMediaryNotifications())
}
