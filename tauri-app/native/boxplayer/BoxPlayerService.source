import { queueMovieAcquisition, queueSeriesInitialization, queueTrackingInitialization, reserveMovie } from '@mediary/commands'
import { DEFAULT_ACCOUNT_ID, episodePartsFromCode, isMovieUnreleased, type AgentStep, type NotificationEvent } from '@mediary/domain'
import type { PersistedWorkflowRunSnapshot, TrackedSeasonState } from '@mediary/repository'
import { prepareMovieTarget, prepareSeriesTarget, prepareTrackingTarget } from '@mediary/tmdb-provider'
import type { CreateMediaAcquisitionRunInput, MediaAcquisitionCandidate, MediaAcquisitionEvent, MediaAcquisitionNotification, MediaAcquisitionPhase, MediaAcquisitionRunKind, MediaAcquisitionRunStatus, MediaAcquisitionRunView, MediaAcquisitionState, MediaAcquisitionTrackingItem } from '@shared/types/mediaAcquisition'
import type { MediaryDriveTarget } from '@shared/types/mediary'
import { getDriveTarget, getMediaryRepository, LAST_SWEEP_SETTING, nextSweepAt, notifyMediaryChanged, runMediaryPatrolNow, saveDriveTarget, sweepTimes, wakeMediaryHost } from './MediaryHost'
import { createMediaryMetadataProvider } from './resources'
import { requestMediaryRuntimeConfig } from './runtimeConfig'
import { isMediaryPlatformSupported } from './storageExecutors'

const NOTIFICATIONS_SEEN_SETTING = 'boxplayer_notifications_seen_at'
const NOTIFICATIONS_CLEARED_SETTING = 'boxplayer_notifications_cleared_at'
const RUNS_CLEARED_SETTING = 'boxplayer_runs_cleared_at'
const RECENT_RUN_LIMIT = 50

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Start an acquisition from BoxPlayer's "获取" dialog. The chosen folder becomes the run's
 * connected storage; mediary creates `作品 (年份)/Season NN` beneath it.
 */
export async function createMediaryRun(input: CreateMediaAcquisitionRunInput): Promise<MediaAcquisitionRunView> {
  if (!input.tmdbId) throw new Error('需要先识别出 TMDB 作品，才能自动获取')
  if (!isMediaryPlatformSupported(input.targetPlatform)) throw new Error(`${input.targetPlatform} 暂不支持 AI 媒体获取`)
  const config = await requestMediaryRuntimeConfig()
  if (!config) throw new Error('无法读取 AI 模型和 BoxPlayer 服务配置，请稍后重试')
  const target = await saveDriveTarget({ platform: input.targetPlatform, userId: input.targetUserId, driveId: input.targetDriveId, folderId: input.targetParentFileId, preferredLanguage: input.preferredLanguage, preferredQuality: input.preferredQuality })
  const repository = getMediaryRepository()
  const metadataProvider = createMediaryMetadataProvider(config)
  const scope = { accountId: DEFAULT_ACCOUNT_ID, connectedStorageId: target.id }
  const seasonNumbers = [...new Set([...(input.seasonTargets || []).map(item => item.seasonNumber), ...(input.seasonNumber ? [input.seasonNumber] : [])])].filter(value => value > 0).sort((a, b) => a - b)

  const queue = async (): Promise<{ status: string; workflowRunId: string | null }> => {
    if (input.mediaType === 'movie') {
      const prepared = await prepareMovieTarget({ tmdbId: input.tmdbId!, qualityPreference: '4K', metadataProvider })
      return isMovieUnreleased(prepared.title.releaseDate, new Date().toISOString())
        ? reserveMovie({ title: prepared.title, repository, ...scope })
        : queueMovieAcquisition({ ...prepared, repository, ...scope })
    }
    if (seasonNumbers.length === 1) {
      const prepared = await prepareTrackingTarget({ tmdbId: input.tmdbId!, mediaType: 'tv', seasonNumber: seasonNumbers[0], qualityPreference: '4K', metadataProvider })
      return queueTrackingInitialization({ ...prepared, repository, ...scope })
    }
    const prepared = await prepareSeriesTarget({ tmdbId: input.tmdbId!, qualityPreference: '4K', metadataProvider })
    const seasons = seasonNumbers.length ? prepared.seasons.filter(season => seasonNumbers.includes(season.seasonNumber)) : prepared.seasons
    if (!seasons.length) throw new Error('TMDB 中没有所选的季')
    return queueSeriesInitialization({ title: prepared.title, seasons, keyword: prepared.keyword, repository, ...scope })
  }

  let result = await queue()
  if (result.status === 'already_tracked') {
    if (!input.force) throw new Error(`《${input.title}》该媒体已加入媒体库，不能重复获取；缺集会在每日巡检时自动补齐`)
    // A forced re-acquisition drops this drive's tracking record, then queues afresh; the agent re-reads the folder.
    const kind = input.mediaType === 'movie' ? 'movie' : 'tv'
    for (const seasonNumber of kind === 'movie' ? [undefined] : seasonNumbers.length ? seasonNumbers : [undefined]) {
      const outcome = await repository.untrackTitle(input.tmdbId, scope, kind, seasonNumber)
      if (outcome.status === 'in_flight') throw new Error('该作品正在获取中，请等任务结束后再试')
    }
    result = await queue()
  }
  if (!result.workflowRunId) throw new Error('未能创建获取任务')
  wakeMediaryHost()
  notifyMediaryChanged(result.workflowRunId)
  const view = await getMediaryRunView(result.workflowRunId)
  if (!view) throw new Error('获取任务已创建，但暂时无法读取任务状态')
  return view
}

export async function cancelMediaryRun(workflowRunId: string): Promise<MediaAcquisitionRunView | null> {
  const outcome = await getMediaryRepository().cancelQueuedWorkflowRun(workflowRunId)
  if (outcome.status !== 'cancelled') throw new Error('任务已开始执行，无法取消；可以等它结束后删除不需要的文件')
  notifyMediaryChanged(workflowRunId)
  return null
}

export async function retryMediaryRun(workflowRunId: string): Promise<MediaAcquisitionRunView | null> {
  const outcome = await getMediaryRepository().retryFailedWorkflowRun(workflowRunId)
  if (outcome.status !== 'retried') throw new Error('只有失败的任务可以重试')
  wakeMediaryHost()
  notifyMediaryChanged(workflowRunId)
  return getMediaryRunView(workflowRunId)
}

/** Stop tracking one season (or a movie) on the drive it was tracked on. */
export async function endMediaryTracking(trackingId: string): Promise<null> {
  const [seasonId, connectedStorageId] = trackingId.split('@')
  const state = (await getMediaryRepository().listAllTrackedSeasonStates()).find(item => item.season.id === seasonId && (item.connectedStorageId || '') === (connectedStorageId || ''))
  if (!state) return null
  const outcome = await getMediaryRepository().untrackTitle(state.title.tmdbId, { accountId: state.accountId, connectedStorageId: state.connectedStorageId }, state.title.type === 'movie' ? 'movie' : 'tv', state.title.type === 'movie' ? undefined : state.season.seasonNumber)
  if (outcome.status === 'in_flight') throw new Error('该作品正在获取中，请等任务结束后再取消追更')
  notifyMediaryChanged()
  return null
}

export async function runMediaryPatrol(): Promise<void> {
  await runMediaryPatrolNow()
}

export async function clearCompletedMediaryRuns(): Promise<number> {
  const before = (await listMediaryRunViews()).filter(run => run.finishedAt).length
  await getMediaryRepository().setSetting(RUNS_CLEARED_SETTING, new Date().toISOString())
  notifyMediaryChanged()
  return before
}

// ---------------------------------------------------------------------------
// Views for BoxPlayer's existing task / tracking / notification UI
// ---------------------------------------------------------------------------

export async function listMediaryRunViews(limit = RECENT_RUN_LIMIT): Promise<MediaAcquisitionRunView[]> {
  const repository = getMediaryRepository()
  const clearedAt = await repository.getSetting(RUNS_CLEARED_SETTING)
  const active = await repository.listActiveWorkflowRuns()
  const ids = new Set(active.map(run => run.workflowRun.id))
  const snapshots = [...active]
  // mediary keeps no run history list; recent notifications point at the finished runs.
  for (const entry of await repository.listRecentNotificationsWithAccount({ limit: 200 })) {
    if (ids.has(entry.notification.workflowRunId)) continue
    ids.add(entry.notification.workflowRunId)
    const snapshot = await repository.getWorkflowRunSnapshot(entry.notification.workflowRunId, { accountId: entry.accountId, connectedStorageId: entry.connectedStorageId })
    if (snapshot) snapshots.push(snapshot)
    if (snapshots.length >= limit) break
  }
  const views = await Promise.all(snapshots
    .filter(snapshot => !clearedAt || !snapshot.workflowRun.finishedAt || snapshot.workflowRun.finishedAt > clearedAt)
    .map(snapshot => toRunView(snapshot)))
  return views.sort((left, right) => right.startedAt - left.startedAt).slice(0, limit)
}

export async function getMediaryRunView(workflowRunId: string): Promise<MediaAcquisitionRunView | null> {
  const snapshot = await getMediaryRepository().getWorkflowRunSnapshot(workflowRunId)
  return snapshot ? toRunView(snapshot) : null
}

/** Lightweight per-title states for search-result badges. */
export async function listMediaryStates(): Promise<MediaAcquisitionState[]> {
  const repository = getMediaryRepository()
  const states: MediaAcquisitionState[] = []
  for (const run of await repository.listActiveWorkflowRuns()) states.push(toState(run, await getDriveTarget(run.connectedStorageId)))
  for (const tracked of await repository.listAllTrackedSeasonStates()) {
    if (states.some(state => state.mediaKey === mediaKey(tracked.title))) continue
    const target = await getDriveTarget(tracked.connectedStorageId)
    const missing = missingEpisodes(tracked)
    states.push({
      id: `${tracked.season.id}@${tracked.connectedStorageId || ''}`,
      status: missing.length ? 'partial' : 'completed',
      phase: 'finalize',
      progress: 100,
      activity: missing.length ? `已获取 ${obtainedEpisodes(tracked).length} 集，缺 ${missing.length} 集` : '已获取',
      mediaKey: mediaKey(tracked.title),
      title: tracked.title.title,
      mediaType: tracked.title.type,
      targetUserId: target?.userId || '',
      targetDriveId: target?.driveId || '',
      targetParentFileId: target?.folderId || ''
    })
  }
  return states
}

export async function listMediaryTracking(): Promise<MediaAcquisitionTrackingItem[]> {
  const repository = getMediaryRepository()
  const lastSweep = await repository.getSetting(LAST_SWEEP_SETTING)
  const nextCheckAt = nextSweepAt(await sweepTimes())
  return (await repository.listAllTrackedSeasonStates())
    .filter(state => state.title.type !== 'movie')
    .map(state => {
      const obtained = obtainedEpisodes(state)
      return {
        id: `${state.season.id}@${state.connectedStorageId || ''}`,
        targetId: targetIdFor(state.title.id, state.connectedStorageId),
        tmdbId: state.title.tmdbId,
        title: state.title.title,
        mediaType: state.title.type === 'anime' ? 'anime' : 'tv',
        seasonNumber: state.season.seasonNumber,
        totalEpisodes: state.season.totalEpisodes,
        latestAiredEpisode: state.season.latestAiredEpisode,
        obtainedEpisodes: obtained.length,
        obtainedEpisodeNumbers: obtained,
        providerAheadEpisodes: state.episodes.filter(episode => episode.obtained && episode.metadataStatus === 'provider_ahead').map(episode => episodePartsFromCode(episode.episodeCode).episodeNumber),
        missingEpisodes: missingEpisodes(state),
        status: state.season.status === 'completed' && !missingEpisodes(state).length ? 'complete' : 'tracking',
        nextCheckAt,
        ...(lastSweep ? { lastCheckedAt: Date.parse(lastSweep) } : {})
      } satisfies MediaAcquisitionTrackingItem
    })
}

export async function listMediaryNotifications(limit = 100): Promise<MediaAcquisitionNotification[]> {
  const repository = getMediaryRepository()
  const [seenAt, clearedAt] = await Promise.all([repository.getSetting(NOTIFICATIONS_SEEN_SETTING), repository.getSetting(NOTIFICATIONS_CLEARED_SETTING)])
  const read = new Set(JSON.parse((await repository.getSetting(`${NOTIFICATIONS_SEEN_SETTING}_ids`)) || '[]') as string[])
  return (await repository.listRecentNotificationsWithAccount({ limit }))
    .map(entry => entry.notification)
    .filter(notification => !clearedAt || notification.createdAt > clearedAt)
    .map(notification => toNotification(notification, read.has(notification.id) || (!!seenAt && notification.createdAt <= seenAt)))
}

export async function markMediaryNotificationsRead(ids?: string[]): Promise<void> {
  const repository = getMediaryRepository()
  if (!ids?.length) await repository.setSetting(NOTIFICATIONS_SEEN_SETTING, new Date().toISOString())
  else {
    const read = new Set(JSON.parse((await repository.getSetting(`${NOTIFICATIONS_SEEN_SETTING}_ids`)) || '[]') as string[])
    ids.forEach(id => read.add(id))
    await repository.setSetting(`${NOTIFICATIONS_SEEN_SETTING}_ids`, JSON.stringify([...read].slice(-500)))
  }
  notifyMediaryChanged()
}

export async function clearMediaryNotifications(): Promise<number> {
  const count = (await listMediaryNotifications()).length
  await getMediaryRepository().setSetting(NOTIFICATIONS_CLEARED_SETTING, new Date().toISOString())
  notifyMediaryChanged()
  return count
}

async function toRunView(snapshot: PersistedWorkflowRunSnapshot): Promise<MediaAcquisitionRunView> {
  const target = await getDriveTarget(snapshot.connectedStorageId)
  const steps = await getMediaryRepository().listAgentSteps(snapshot.workflowRun.id).catch(() => [] as AgentStep[])
  const run = snapshot.workflowRun
  const status = runStatus(snapshot)
  const notification = snapshot.notifications.at(-1)
  return {
    id: run.id,
    targetId: targetIdFor(snapshot.title.id, snapshot.connectedStorageId),
    kind: runKind(run.kind),
    status,
    phase: runPhase(snapshot),
    progress: status === 'queued' ? 0 : run.finishedAt ? 100 : Math.round(run.progress?.percent || 0),
    activity: run.progress?.activity || notification?.body || defaultActivity(status),
    attemptCount: run.autoRequeueCount || 0,
    searchAttemptCount: snapshot.resourceSnapshots.length,
    ...(run.nextAttemptAt ? { nextAttemptAt: Date.parse(run.nextAttemptAt) } : {}),
    startedAt: Date.parse(run.startedAt),
    ...(run.finishedAt ? { finishedAt: Date.parse(run.finishedAt) } : {}),
    ...(status === 'failed' && notification ? { errorMessage: notification.body } : {}),
    target: {
      id: targetIdFor(snapshot.title.id, snapshot.connectedStorageId),
      mediaKey: mediaKey(snapshot.title),
      tmdbId: snapshot.title.tmdbId,
      mediaType: snapshot.title.type,
      title: snapshot.title.title,
      alternativeTitles: snapshot.title.aliases,
      year: snapshot.title.year,
      ...(snapshot.title.type !== 'movie' ? { seasonNumber: snapshot.season.seasonNumber } : {}),
      targetUserId: target?.userId || '',
      targetDriveId: target?.driveId || '',
      targetPlatform: target?.platform || '',
      targetParentFileId: target?.folderId || '',
      ...(target?.preferredQuality ? { preferredQuality: target.preferredQuality } : {}),
      ...(target?.preferredLanguage ? { preferredLanguage: target.preferredLanguage } : {}),
      fetchSubtitles: false,
      trackingEnabled: snapshot.title.type !== 'movie',
      createdAt: target?.createdAt || Date.parse(run.startedAt)
    },
    ...(snapshot.season.storageDirectoryId ? { landingFolderId: snapshot.season.storageDirectoryId } : {}),
    events: [...steps.map(step => toEvent(run.id, step)), ...snapshot.notifications.map(item => notificationEvent(run.id, item))],
    candidates: toCandidates(snapshot)
  }
}

function toCandidates(snapshot: PersistedWorkflowRunSnapshot): MediaAcquisitionCandidate[] {
  const byId = new Map(snapshot.resourceSnapshots.flatMap(resource => resource.candidates).map(candidate => [candidate.id, candidate]))
  return snapshot.transferAttempts.map(attempt => {
    const candidate = byId.get(attempt.candidateId)
    const kind = candidate?.type === 'magnet' ? 'magnet' : 'share'
    return {
      id: attempt.id,
      runId: snapshot.workflowRun.id,
      kind,
      sourcePlatform: candidate?.type || '',
      title: candidate?.title || attempt.candidateId,
      ...(attempt.providerMessage ? { detail: attempt.providerMessage } : {}),
      status: attempt.status === 'succeeded' ? 'imported' : 'failed',
      ...(attempt.status !== 'succeeded' && attempt.providerMessage ? { lastError: attempt.providerMessage } : {}),
      createdAt: Date.parse(snapshot.workflowRun.startedAt)
    } satisfies MediaAcquisitionCandidate
  })
}

function toState(snapshot: PersistedWorkflowRunSnapshot, target: MediaryDriveTarget | null): MediaAcquisitionState {
  const status = runStatus(snapshot)
  return {
    id: snapshot.workflowRun.id,
    status,
    phase: runPhase(snapshot),
    progress: Math.round(snapshot.workflowRun.progress?.percent || 0),
    activity: snapshot.workflowRun.progress?.activity || defaultActivity(status),
    mediaKey: mediaKey(snapshot.title),
    title: snapshot.title.title,
    mediaType: snapshot.title.type,
    targetUserId: target?.userId || '',
    targetDriveId: target?.driveId || '',
    targetParentFileId: target?.folderId || ''
  }
}

function toEvent(runId: string, step: AgentStep): MediaAcquisitionEvent {
  return { id: `${runId}:step:${step.ordinal}`, runId, level: 'info', phase: phaseFor(step.phase), message: step.activity || step.toolName, data: { tool: step.toolName }, createdAt: Date.parse(step.at) }
}

function notificationEvent(runId: string, notification: NotificationEvent): MediaAcquisitionEvent {
  const failed = notification.kind.includes('fail')
  return { id: `${runId}:notification:${notification.id}`, runId, level: failed ? 'error' : 'info', phase: 'finalize', message: notification.body || notification.title, createdAt: Date.parse(notification.createdAt) }
}

function toNotification(notification: NotificationEvent, read: boolean): MediaAcquisitionNotification {
  return {
    id: notification.id,
    runId: notification.workflowRunId,
    mediaKey: notification.report?.tmdbId ? mediaKey({ type: notification.report.mediaType || 'tv', tmdbId: notification.report.tmdbId }) : notification.workflowRunId,
    title: notification.title,
    status: notificationStatus(notification),
    message: notification.body,
    read,
    createdAt: Date.parse(notification.createdAt)
  }
}

function notificationStatus(notification: NotificationEvent): MediaAcquisitionNotification['status'] {
  const status = notification.report?.status || notification.kind
  if (/fail|error/.test(status)) return 'failed'
  if (/no_coverage|not_found/.test(status)) return 'no_coverage'
  if (/partial|airing|missing/.test(status)) return 'partial'
  return 'completed'
}

function runStatus(snapshot: PersistedWorkflowRunSnapshot): MediaAcquisitionRunStatus {
  const run = snapshot.workflowRun
  if (run.status === 'succeeded') return 'completed'
  if (run.status === 'queued') return run.nextAttemptAt ? 'retry_wait' : 'queued'
  if (run.status !== 'running') return run.status
  const phase = run.progress?.phase
  if (phase === 'search') return 'searching'
  if (phase === 'pick') return 'selecting'
  if (phase === 'transfer') return 'transferring'
  if (phase === 'verify') return 'verifying'
  return phase ? 'organizing' : 'searching'
}

function runPhase(snapshot: PersistedWorkflowRunSnapshot): MediaAcquisitionPhase {
  const run = snapshot.workflowRun
  if (run.status === 'queued' || run.status === 'reserved') return 'queued'
  if (run.finishedAt) return 'finalize'
  return phaseFor(run.progress?.phase)
}

function phaseFor(phase: string | undefined): MediaAcquisitionPhase {
  if (phase === 'search') return 'search'
  if (phase === 'pick') return 'select'
  if (phase === 'transfer') return 'transfer'
  if (phase === 'verify') return 'verify'
  if (phase === 'organize' || phase === 'mark') return 'organize'
  if (phase === 'finalize') return 'finalize'
  return 'search'
}

function runKind(kind: string): MediaAcquisitionRunKind {
  if (kind === 'movie_init') return 'movie'
  if (kind === 'type3_monitor') return 'patrol'
  return 'season'
}

function defaultActivity(status: MediaAcquisitionRunStatus): string {
  const labels: Partial<Record<MediaAcquisitionRunStatus, string>> = { queued: '排队中', retry_wait: '网络暂时不可用，等待重试', reserved: '已预定，上映后自动获取', completed: '已完成', partial: '部分获取', no_coverage: '暂未找到可获取资源', failed: '获取失败' }
  return labels[status] || 'Agent 正在处理'
}

function obtainedEpisodes(state: TrackedSeasonState): number[] {
  return state.episodes.filter(episode => episode.obtained).map(episode => episodePartsFromCode(episode.episodeCode).episodeNumber).sort((a, b) => a - b)
}

function missingEpisodes(state: TrackedSeasonState): number[] {
  return state.episodes.filter(episode => !episode.obtained && episode.airStatus === 'aired').map(episode => episodePartsFromCode(episode.episodeCode).episodeNumber).sort((a, b) => a - b)
}

/** Same key the renderer builds from a TMDB result (`movie|tv:tmdb:<id>`); anime is a TMDB tv show. */
function mediaKey(title: { type: string; tmdbId: number }): string {
  return `${title.type === 'movie' ? 'movie' : 'tv'}:tmdb:${title.tmdbId}`
}

function targetIdFor(titleId: string, connectedStorageId: string | null): string {
  return `${titleId}@${connectedStorageId || ''}`
}
