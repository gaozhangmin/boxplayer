import { app } from 'electron'
import { join } from 'path'
import type { CreateMediaAcquisitionCandidateInput, CreateMediaAcquisitionRunInput, CreateMediaAcquisitionTrackingInput, MediaAcquisitionEvent, MediaAcquisitionFileSnapshot, MediaAcquisitionNotification, MediaAcquisitionPhase, MediaAcquisitionRunView, MediaAcquisitionSeasonTarget, MediaAcquisitionState, MediaAcquisitionTarget, MediaAcquisitionTrackingItem } from '@shared/types/mediaAcquisition'
import { MediaAcquisitionDb } from './MediaAcquisitionDb'
import { mirrorMediaAcquisitionRun, settleMediaAcquisitionV1Transfer } from './MediaAcquisitionV1Bridge'

let db: MediaAcquisitionDb | null = null

function getDb(): MediaAcquisitionDb {
  if (!db) db = new MediaAcquisitionDb(join(app.getPath('userData'), 'media-acquisition.db'))
  return db
}

export function createMediaAcquisitionRun(input: CreateMediaAcquisitionRunInput): MediaAcquisitionRunView {
  validateCreateInput(input)
  const run = getDb().createRun(input)
  mirrorMediaRun(run)
  return run
}

export function listMediaAcquisitionRuns(limit?: number): MediaAcquisitionRunView[] {
  const runs = getDb().listRuns(Math.min(Math.max(limit || 50, 1), 200))
  runs.forEach(mirrorMediaRun)
  return runs
}

export function getMediaAcquisitionRun(runId: string): MediaAcquisitionRunView | null { return getDb().getRun(runId) }

export function listMediaAcquisitionStates(): MediaAcquisitionState[] { return getDb().listStates() }
export function listRunnableMediaAcquisitionRuns(limit?: number): MediaAcquisitionRunView[] { return getDb().listRunnableRuns(Math.min(Math.max(limit || 20, 1), 100)) }
export function claimRunnableMediaAcquisitionRun(workerId: string, runId?: string): MediaAcquisitionRunView | null { return getDb().claimRunnableRun(workerId, runId) }
export function releaseMediaAcquisitionRunClaim(runId: string, workerId: string): void { getDb().releaseRunClaim(runId, workerId) }
export function renewMediaAcquisitionRunClaim(runId: string, workerId: string): boolean { return getDb().renewRunClaim(runId, workerId) }
export function listMediaAcquisitionTracking(limit?: number): MediaAcquisitionTrackingItem[] { return getDb().listTracking(Math.min(Math.max(limit || 100, 1), 200)) }
export function createMediaAcquisitionTracking(input: CreateMediaAcquisitionTrackingInput): MediaAcquisitionTrackingItem {
  validateTrackingInput(input)
  return getDb().createTracking(input)
}
export function getMediaAcquisitionTarget(targetId: string): MediaAcquisitionTarget | null { return getDb().getTarget(targetId) }
export function endMediaAcquisitionTracking(trackingId: string): MediaAcquisitionTrackingItem | null { return getDb().endTracking(trackingId) }
export function upsertMediaAcquisitionTracking(targetId: string, seasonNumber: number, totalEpisodes: number, latestAiredEpisode: number, obtainedEpisodeNumbers: number[], missingEpisodes: number[], status: MediaAcquisitionTrackingItem['status'], nextCheckAt?: number): MediaAcquisitionTrackingItem | null {
  return getDb().upsertTracking(targetId, seasonNumber, totalEpisodes, latestAiredEpisode, obtainedEpisodeNumbers, missingEpisodes, status, nextCheckAt)
}
export function listMediaAcquisitionNotifications(limit?: number): MediaAcquisitionNotification[] { return getDb().listNotifications(Math.min(Math.max(limit || 100, 1), 200)) }
export function markMediaAcquisitionNotificationsRead(ids?: string[]): void { getDb().markNotificationsRead(ids) }
export function clearMediaAcquisitionNotifications(): number { return getDb().clearNotifications() }
export function clearCompletedMediaAcquisitionRuns(): number { return getDb().clearCompletedRuns() }
export function getMediaAcquisitionAgentSession(runId: string): unknown[] { return getDb().getAgentSession(runId) }
export function saveMediaAcquisitionAgentSession(runId: string, messages: unknown[]): void { getDb().saveAgentSession(runId, messages) }
export function getMediaAcquisitionAgentSandbox(runId: string): Record<string, unknown> { return getDb().getAgentSandbox(runId) }
export function saveMediaAcquisitionAgentSandbox(runId: string, state: Record<string, unknown>): void { getDb().saveAgentSandbox(runId, state) }

export function cancelMediaAcquisitionRun(runId: string): MediaAcquisitionRunView | null {
  return getDb().cancelRun(runId)
}

export function forceCancelMediaAcquisitionRun(runId: string): MediaAcquisitionRunView | null {
  return getDb().forceCancelRun(runId)
}

export function beginMediaAcquisitionSearch(runId: string): MediaAcquisitionRunView | null {
  return getDb().beginSearch(runId)
}

export function finishMediaAcquisitionSearchWithoutCandidates(runId: string): MediaAcquisitionRunView | null {
  return getDb().finishSearchWithoutCandidates(runId)
}

export function retryMediaAcquisitionSearch(runId: string, message: string, delayMs: number, maxRetries = 3): MediaAcquisitionRunView | null {
  return getDb().scheduleSearchRetry(runId, message, delayMs, maxRetries)
}

export function addMediaAcquisitionCandidate(runId: string, input: CreateMediaAcquisitionCandidateInput): MediaAcquisitionRunView | null {
  if (!runId || !input.title?.trim() || !input.locator?.trim()) throw new Error('候选资源信息不完整')
  if (!['share', 'magnet', 'http'].includes(input.kind)) throw new Error('不支持的候选资源类型')
  const run = getDb().addCandidate(runId, input)
  if (run) mirrorMediaRun(run)
  return run
}

export function getMediaAcquisitionCandidateLocator(runId: string, candidateId: string): { locator: string; password?: string } | null {
  return getDb().getCandidateLocator(runId, candidateId)
}

export function markMediaAcquisitionCandidateTransferring(runId: string, candidateId: string): MediaAcquisitionRunView | null {
  return getDb().claimCandidateTransfer(runId, candidateId)
}
export function recordMediaAcquisitionTransferIntent(runId: string, candidateId: string, activity: string): MediaAcquisitionRunView | null {
  return getDb().recordTransferIntent(runId, candidateId, activity)
}

export function selectMediaAcquisitionCandidate(runId: string, candidateId: string, reason: string): MediaAcquisitionRunView | null {
  return getDb().selectCandidate(runId, candidateId, reason || '与目标媒体、画质和字幕偏好匹配')
}

export function recordMediaAcquisitionExternalTask(runId: string, candidateId: string, externalTaskId: string | undefined, externalFileId: string | undefined, activity: string): MediaAcquisitionRunView | null {
  return getDb().recordExternalTask(runId, candidateId, externalTaskId, externalFileId, activity)
}

export function recordMediaAcquisitionCandidateBaseline(runId: string, candidateId: string, files: MediaAcquisitionFileSnapshot[]): MediaAcquisitionRunView | null {
  return getDb().recordCandidateBaseline(runId, candidateId, files)
}

export function getMediaAcquisitionCandidateBaseline(runId: string, candidateId: string): MediaAcquisitionFileSnapshot[] {
  return getDb().getCandidateBaseline(runId, candidateId)
}

export function updateMediaAcquisitionExternalTaskProgress(runId: string, candidateId: string, progress: number, activity: string): MediaAcquisitionRunView | null {
  return getDb().updateExternalTaskProgress(runId, candidateId, progress, activity)
}

export function retryMediaAcquisitionCandidate(runId: string, candidateId: string, message: string, delayMs = 60_000): MediaAcquisitionRunView | null {
  return getDb().markRetry(runId, candidateId, message, Date.now() + delayMs)
}

export function markMediaAcquisitionNoCoverage(runId: string, reason: string): MediaAcquisitionRunView | null {
  return getDb().markNoCoverage(runId, reason)
}

export function failMediaAcquisitionRun(runId: string, message: string): MediaAcquisitionRunView | null {
  return getDb().failRun(runId, message)
}

export function beginMediaAcquisitionCandidateVerification(runId: string, candidateId: string, activity: string): MediaAcquisitionRunView | null {
  return getDb().beginVerifyingCandidate(runId, candidateId, activity)
}

export function beginMediaAcquisitionOrganizing(runId: string, activity?: string): MediaAcquisitionRunView | null {
  return getDb().beginOrganizing(runId, activity)
}

export function completeMediaAcquisitionCandidate(runId: string, candidateId: string, message: string): MediaAcquisitionRunView | null {
  const run = getDb().completeCandidate(runId, candidateId, message)
  if (run?.status === 'completed') settleTransfer(runId, candidateId, 'succeeded', message)
  return run
}

export function completeMediaAcquisitionRun(runId: string, message: string, data?: Record<string, unknown>): MediaAcquisitionRunView | null {
  return getDb().completeRun(runId, message, data)
}

export function partialMediaAcquisitionCandidate(runId: string, candidateId: string, message: string): MediaAcquisitionRunView | null {
  const run = getDb().partialCandidate(runId, candidateId, message)
  if (run?.status === 'partial') settleTransfer(runId, candidateId, 'succeeded', message)
  return run
}

export function continueMediaAcquisitionAfterPartial(runId: string, candidateId: string, seasonTargets: MediaAcquisitionSeasonTarget[], message: string): MediaAcquisitionRunView | null {
  const run = getDb().continueAfterPartialCandidate(runId, candidateId, seasonTargets, message)
  if (run?.status === 'selecting') settleTransfer(runId, candidateId, 'succeeded', message)
  return run
}

export function failMediaAcquisitionCandidate(runId: string, candidateId: string, message: string, continueWithAlternatives = false): MediaAcquisitionRunView | null {
  const run = getDb().failCandidate(runId, candidateId, message, continueWithAlternatives)
  if (run?.candidates.find(item => item.id === candidateId)?.status === 'failed') settleTransfer(runId, candidateId, 'failed', message)
  return run
}

/** These calls follow a readback of the target drive, so they settle a transfer receipt left pending or unknown. */
function settleTransfer(runId: string, candidateId: string, status: 'succeeded' | 'failed', message: string): void {
  try {
    settleMediaAcquisitionV1Transfer(runId, candidateId, status, message)
  } catch (error: any) {
    console.warn(`[Agent V1 media] 核对转存回执失败：${error?.message || error}`)
  }
}

export function addMediaAcquisitionEvent(runId: string, level: MediaAcquisitionEvent['level'], phase: MediaAcquisitionPhase, message: string, data?: Record<string, unknown>): MediaAcquisitionRunView | null {
  return getDb().addEvent(runId, level, phase, message, data)
}

export function destroyMediaAcquisitionDb(): void {
  db?.close()
  db = null
}

function validateCreateInput(input: CreateMediaAcquisitionRunInput): void {
  if (!input.title?.trim()) throw new Error('媒体标题不能为空')
  if (!input.targetUserId || !input.targetDriveId || !input.targetPlatform || !input.targetParentFileId) throw new Error('请先选择目标网盘和保存目录')
  if (!['movie', 'season', 'missing', 'patrol'].includes(input.kind)) throw new Error('不支持的媒体获取任务类型')
  if (!['movie', 'tv', 'anime'].includes(input.mediaType)) throw new Error('不支持的媒体类型')
}

function validateTrackingInput(input: CreateMediaAcquisitionTrackingInput): void {
  if (!input.title?.trim() || !input.tmdbId) throw new Error('追更媒体信息不完整')
  if (!Number.isInteger(input.seasonNumber) || input.seasonNumber <= 0) throw new Error('请选择要追更的季')
  if (!input.targetUserId || !input.targetDriveId || !input.targetPlatform || !input.targetParentFileId) throw new Error('请先选择目标网盘和保存目录')
  if (!['tv', 'anime'].includes(input.mediaType)) throw new Error('只有电视剧和动漫支持追更')
}

function mirrorMediaRun(run: MediaAcquisitionRunView): void {
  try {
    mirrorMediaAcquisitionRun(run)
  } catch (error) {
    // Agent V1 is an opt-in shadow path; it must not interrupt legacy acquisition.
    console.warn('[Agent V1] media acquisition mirror failed', error)
  }
}
