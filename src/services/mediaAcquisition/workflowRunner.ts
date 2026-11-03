import type { IAliGetFileModel } from '../../aliapi/alimodels'
import AliFileCmd from '../../aliapi/filecmd'
import { MediaScanner } from '../../utils/mediaScanner'
import Config from '../../config'
import useSettingStore from '../../setting/settingstore'
import { getAIConfig } from '../../utils/bookAI'
import { runBoxPlayerAgent } from '../agent'
import { beginMediaAcquisitionV1Transfer, completeMediaAcquisitionV1Transfer, type MediaAcquisitionV1TransferTicket } from '../agent/agentV1AuditClient'
import { mediaTransferReceiptOutcome } from './transferReceipt'
import { z } from 'zod'
import type { MediaAcquisitionCandidate, MediaAcquisitionFileSnapshot, MediaAcquisitionRunView, MediaAcquisitionSeasonTarget, MediaAcquisitionTarget, MediaAcquisitionTrackingItem } from '@shared/types/mediaAcquisition'
import { searchAdditionalMediaAcquisitionCandidates, searchMediaAcquisitionCandidates } from './agent'
import { executeMediaAcquisitionHttpCandidate, executeMediaAcquisitionMagnetCandidate } from './magnetExecutor'
import { executeMediaAcquisitionShareCandidate } from './shareExecutor'
import { transferAutoChineseSubtitle, viewAutoChineseSubtitleSnapshot } from './subtitleExecutor'
import { addMediaAcquisitionEvent, beginMediaAcquisitionCandidateVerification, beginMediaAcquisitionOrganizing, claimRunnableMediaAcquisitionRun, completeMediaAcquisitionCandidate, completeMediaAcquisitionRun, continueMediaAcquisitionAfterPartial, createMediaAcquisitionRun, failMediaAcquisitionCandidate, failMediaAcquisitionRun, getMediaAcquisitionAgentSandbox, getMediaAcquisitionCandidateBaseline, getMediaAcquisitionProviderTransferStatus, getMediaAcquisitionTarget, listMediaAcquisitionRuns, listMediaAcquisitionTracking, markMediaAcquisitionNoCoverage, partialMediaAcquisitionCandidate, releaseMediaAcquisitionRunClaim, renewMediaAcquisitionRunClaim, retryMediaAcquisitionCandidate, saveMediaAcquisitionAgentSandbox, selectMediaAcquisitionCandidate, updateMediaAcquisitionExternalTaskProgress, upsertMediaAcquisitionTracking } from './client'
import { buildTrackingSnapshot, extractObtainedEpisodeNumbers, nextPatrolAt, readTrackingMetadata } from './tracking'
import { isPro } from '../../utils/usageLimit'
import { assessMediaAcquisitionEpisodeCoverage, canTryNextMediaAcquisitionCandidate, isMediaAcquisitionCandidateSupported, isSystemicMediaAcquisitionFailure, isTransientMediaAcquisitionFailure, mediaAcquisitionCandidateCoveragePlan, scoreMediaAcquisitionCandidate } from './candidatePolicy'
import { getMediaAcquisitionCapability, normalizeMediaAcquisitionPlatform } from './capabilities'
import { runHistoricalMediaLibraryGapScan } from './historicalLibraryScanner'
import { listMediaAcquisitionDirectoryEntries, listMediaAcquisitionTargetFiles, listMediaAcquisitionTargetLeafFiles, newMediaAcquisitionFiles, resolveMediaAcquisitionLeafFolder } from './targetSnapshot'
import { ensureMediaAcquisitionLeafFolder, ensureMediaAcquisitionSeasonFolder, organizeMediaAcquisitionFiles } from './organizer'
import { findMediaAcquisitionDuplicateEpisodes } from './duplicatePolicy'
import { isMediaAcquisitionMatchingSidecar, isMediaAcquisitionPrimaryVideoName, isMediaAcquisitionSubtitleName } from './organizerPolicy'
import { buildMediaAcquisitionSearchKeywords, normalizeSearchKeyword } from './searchGuard'
import { getMediaAcquisitionSearchEvidence } from './searchEvidence'
import { discardMediaAcquisitionStagingTarget } from './staging'

const POLL_INTERVAL_MS = 8_000
const INITIAL_TICK_DELAY_MS = 15_000

function buildTrustedAgentSelectionReason(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate, agentReason: string) {
  const coverage = run.target.mediaType === 'movie'
    ? '电影目标无需季集覆盖判断'
    : assessMediaAcquisitionEpisodeCoverage(run.target, candidate).reason
  return `Agent 在已观察快照中选择候选「${candidate.title}」：${agentReason}。系统仅记录候选标题证据（${coverage}），实际身份与覆盖仍以落盘后的暂存目录、目标目录核验为准。`
}
const AGENT_SEARCH_BUDGET = 8
const MOVIE_AGENT_SEARCH_BUDGET = 10
const SUBMISSION_RECOVERY_GRACE_MS = 5 * 60_000
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|3gp|rmvb|ts|m2ts|mts|vob)$/i
const SUBTITLE_EXT = /\.(srt|ass|ssa|sub|idx|vtt|sup|smi)$/i
const AGENT_SECRET_KEY = /authorization|cookie|token|password|secret|api[_-]?key|locator/i
const TERMINAL_RUN_STATUSES = new Set<MediaAcquisitionRunView['status']>(['completed', 'partial', 'no_coverage', 'failed', 'cancelled'])
type MediaAcquisitionSubtitleSnapshotCandidate = { id: string; name: string; language: string; score: number }
let timer: number | undefined
let initialTickTimer: number | undefined
let running = false
let completedMediaLibraryRepairStarted = false
const workflowWorkerId = `renderer-${crypto.randomUUID()}`
const offlineProgressTraceBucket = new Map<string, number>()

function redactAgentTrace(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]'
  if (Array.isArray(value)) return value.slice(0, 40).map(item => redactAgentTrace(item, depth + 1))
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.length > 2_000 ? `${value.slice(0, 2_000)}...[TRUNCATED]` : value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, AGENT_SECRET_KEY.test(key) ? '[REDACTED]' : redactAgentTrace(item, depth + 1)]))
}

function traceAgentDecision(runId: string, stage: string, data?: unknown): void {
  const prefix = `[MediaAcquisitionAgent][${runId}][${stage}]`
  if (data === undefined) console.info(prefix)
  else console.info(prefix, redactAgentTrace(data))
}

export function startMediaAcquisitionWorkflowRunner(): void {
  if (timer || !window.Electron?.ipcRenderer) return
  initialTickTimer = window.setTimeout(() => {
    initialTickTimer = undefined
    void tick()
  }, INITIAL_TICK_DELAY_MS)
  timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS)
}

export function wakeMediaAcquisitionWorkflowRunner(): void {
  void tick()
}

export function stopMediaAcquisitionWorkflowRunner(): void {
  if (initialTickTimer) window.clearTimeout(initialTickTimer)
  initialTickTimer = undefined
  if (timer) window.clearInterval(timer)
  timer = undefined
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => stopMediaAcquisitionWorkflowRunner())
}

export async function runMediaAcquisitionWorkflow(runId?: string): Promise<void> {
  if (!isPro()) {
    if (runId) throw new Error('Agent 获取资源和追更需购买 Pro 后使用')
    return
  }
  let claimed = await claimRunnableMediaAcquisitionRun(workflowWorkerId, runId)
  while (claimed) {
    const renewTimer = window.setInterval(() => void renewMediaAcquisitionRunClaim(claimed!.id, workflowWorkerId).catch(() => undefined), 30_000)
    try {
      await runOne(claimed)
    } finally {
      window.clearInterval(renewTimer)
      await releaseMediaAcquisitionRunClaim(claimed.id, workflowWorkerId)
      // A terminal transition must not depend on the next renderer tick to
      // reclaim its task-owned staging directory.
      await cleanupTerminalMediaAcquisitionStagingDirectories()
    }
    if (runId) return
    claimed = await claimRunnableMediaAcquisitionRun(workflowWorkerId)
  }
}

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    await repairCompletedMediaLibraryIndexes()
    await runHistoricalMediaLibraryGapScan()
    await runTrackingPatrol()
    await cleanupTerminalMediaAcquisitionStagingDirectories()
    await runMediaAcquisitionWorkflow()
  } catch (error) {
    console.warn('[media-acquisition] workflow tick failed', error)
  } finally {
    running = false
  }
}

export async function runMediaAcquisitionTrackingPatrol(options: { force?: boolean; trackingId?: string; trackingIds?: string[] } = {}): Promise<void> {
  if (!isPro()) {
    if (options.force) throw new Error('Agent 获取资源和追更需购买 Pro 后使用')
    return
  }
  const now = Date.now()
  const selectedIds = options.trackingIds?.length ? new Set(options.trackingIds) : undefined
  const due = (await listMediaAcquisitionTracking(100)).filter(item => item.status !== 'ended' && (!options.trackingId || item.id === options.trackingId) && (!selectedIds || selectedIds.has(item.id)) && (options.force || (item.status === 'tracking' && (!item.nextCheckAt || item.nextCheckAt <= now))))
  if (!due.length) return
  const targetNames = new Map<string, Promise<string[]>>()
  const failures: Error[] = []
  const plans = new Map<string, { target: MediaAcquisitionTarget; seasons: MediaAcquisitionSeasonTarget[] }>()
  for (const item of due) {
    try {
      const target = await getMediaAcquisitionTarget(item.targetId)
      if (!target?.tmdbId) continue
      const directoryKey = `${target.targetUserId}:${target.targetDriveId}:${target.targetParentFileId}`
      if (!targetNames.has(directoryKey)) targetNames.set(directoryKey, listTargetNames(target))
      const updated = await refreshTracking(target, item, now, await targetNames.get(directoryKey))
      if (!updated.missingEpisodes.length || updated.status !== 'tracking') continue
      const plan = plans.get(target.id) || { target, seasons: [] }
      plan.seasons.push({ seasonNumber: item.seasonNumber, missingEpisodes: updated.missingEpisodes })
      plans.set(target.id, plan)
    } catch (error: any) {
      console.warn('[media-acquisition] patrol create failed', error?.message || error)
      if (!/已有|进行中/.test(String(error?.message || ''))) failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  for (const { target, seasons } of plans.values()) {
    try {
      const normalized = seasons.sort((left, right) => left.seasonNumber - right.seasonNumber)
      const patrol = await createMediaAcquisitionRun({
        existingTargetId: target.id, kind: 'patrol', mediaLibraryItemId: target.mediaLibraryItemId, tmdbId: target.tmdbId, mediaType: target.mediaType, title: target.title, year: target.year, seasonNumber: normalized[0]?.seasonNumber, missingEpisodes: normalized[0]?.missingEpisodes, seasonTargets: normalized,
        targetUserId: target.targetUserId, targetDriveId: target.targetDriveId, targetPlatform: target.targetPlatform, targetParentFileId: target.targetParentFileId,
        preferredQuality: target.preferredQuality, fetchSubtitles: target.fetchSubtitles, preferredLanguage: target.preferredLanguage, trackingEnabled: true
      })
      await addMediaAcquisitionEvent(patrol.id, 'info', 'queued', `巡检确认 ${formatSeasonTargets(normalized)} 仍有缺集，Agent 将在同一 sandbox 内补齐。`)
    } catch (error: any) {
      console.warn('[media-acquisition] patrol create failed', error?.message || error)
      if (!/已有|进行中/.test(String(error?.message || ''))) failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  if (options.force && failures.length) throw failures[0]
}

async function runTrackingPatrol(): Promise<void> {
  await runMediaAcquisitionTrackingPatrol()
}

async function runOne(run: MediaAcquisitionRunView): Promise<void> {
  if (run.status === 'queued' || run.status === 'searching') {
    if (await completeIfRequestedEpisodesAlreadyExist(run)) return
    if (!run.candidates.length) {
      try {
        const count = await searchMediaAcquisitionCandidates(run)
        if (count) {
          const updated = (await listMediaAcquisitionRuns(200)).find(item => item.id === run.id)
          if (updated) await runOne(updated)
        } else {
          // The initial bare-title search is only a mediary-scout-style
          // pre-warm. An empty snapshot still enters the sandbox so the Agent
          // can deliberately search an alias or original title.
          const agentChoice = await runMediaAcquisitionSandbox(run)
          if (agentChoice.unavailableReason) await failMediaAcquisitionRun(run.id, agentChoice.unavailableReason)
          else if (agentChoice.noCoverageReason) await markMediaAcquisitionNoCoverage(run.id, agentChoice.noCoverageReason)
          else if (!agentChoice.transferSubmitted) await markMediaAcquisitionNoCoverage(run.id, 'Agent 未选择可执行候选，已停止自动转存')
        }
      } catch (error: any) {
        // A failed pre-warm must not prevent the Agent from using its own
        // sandbox search tool, which is the mediary-scout recovery path.
        await addMediaAcquisitionEvent(run.id, 'warning', 'search', `资源预热搜索失败，Agent 将在 sandbox 内决定是否重试：${error?.message || '未知错误'}`, { tool: 'primeRawSnapshot' })
        const agentChoice = await runMediaAcquisitionSandbox(run)
        if (agentChoice.unavailableReason) await failMediaAcquisitionRun(run.id, agentChoice.unavailableReason)
        else if (agentChoice.noCoverageReason) await markMediaAcquisitionNoCoverage(run.id, agentChoice.noCoverageReason)
        else if (!agentChoice.transferSubmitted) await markMediaAcquisitionNoCoverage(run.id, 'Agent 未选择可执行候选，已停止自动转存')
      }
      return
    }
    const agentChoice = await runMediaAcquisitionSandbox(run)
    if (agentChoice.unavailableReason) {
      await failMediaAcquisitionRun(run.id, agentChoice.unavailableReason)
      return
    }
    if (agentChoice.noCoverageReason) {
      await markMediaAcquisitionNoCoverage(run.id, agentChoice.noCoverageReason)
      return
    }
    if (agentChoice.transferSubmitted) return
    if (!agentChoice.candidate) await markMediaAcquisitionNoCoverage(run.id, 'Agent 未选择可执行候选，已停止自动转存')
    return
  }

  if (run.status === 'selecting') {
    // Match mediary-scout's transferCandidate coverage gate. A previous run can
    // finish while this candidate is waiting to execute; never create another
    // provider side effect after the requested episodes already landed.
    if (await completeIfRequestedEpisodesAlreadyExist(run)) return
    const agentChoice = await runMediaAcquisitionSandbox(run)
    if (agentChoice.unavailableReason) {
      await failMediaAcquisitionRun(run.id, agentChoice.unavailableReason)
      return
    }
    if (agentChoice.noCoverageReason) {
      await markMediaAcquisitionNoCoverage(run.id, agentChoice.noCoverageReason)
      return
    }
    if (!agentChoice.transferSubmitted) await addMediaAcquisitionEvent(run.id, 'warning', 'select', 'Agent 本轮未提交转存，保留已选候选等待下一轮受限工具执行。', { tool: 'transferCandidate' })
    return
  }

  if (run.status === 'retry_wait') {
    const candidate = activeCandidate(run)
    if (candidate) await verifyRun(run, candidate)
    else await markMediaAcquisitionNoCoverage(run.id, '重试任务缺少可核验的网盘任务')
    return
  }

  if (run.status === 'transferring') {
    const candidate = activeCandidate(run)
    if (!candidate) {
      await markMediaAcquisitionNoCoverage(run.id, '恢复转存任务失败：缺少候选资源')
      return
    }
    await beginMediaAcquisitionCandidateVerification(run.id, candidate.id, 'App 已恢复，正在核对入库目录')
    await verifyRun(run, candidate)
    return
  }

  if (run.status === 'verifying') {
    const candidate = activeCandidate(run)
    if (candidate) await verifyRun(run, candidate)
    else await failMediaAcquisitionRun(run.id, '恢复核验任务失败：缺少已提交候选')
    return
  }

  if (run.status === 'organizing') {
    const candidate = activeCandidate(run)
    if (!candidate) {
      await failMediaAcquisitionRun(run.id, '恢复整理任务失败：缺少已转存候选')
      return
    }
    if (await completeIfOrganizedTargetAlreadyCovered(run, candidate)) return
    await settleSandboxResult(run, await runMediaAcquisitionSandbox(run, candidate))
  }
}

async function completeIfOrganizedTargetAlreadyCovered(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate): Promise<boolean> {
  if (candidate.status !== 'imported') return false
  try {
    if (!(await isMediaAcquisitionSandboxCoverageMet(run))) return false
    const targetFolderId = [...run.events].reverse().find(event => {
      const tool = event.data?.tool
      return ['targetLandingGuard', 'moveToSeason', 'flattenMovie'].includes(typeof tool === 'string' ? tool : '') && typeof event.data?.folderId === 'string'
    })?.data?.folderId
    await scanIntoMediaLibrary(run, typeof targetFolderId === 'string' ? targetFolderId : undefined)
    await addMediaAcquisitionEvent(run.id, 'info', 'finalize', '真实目标目录已满足媒体覆盖要求，跳过剩余 Agent 整理循环。', { tool: 'organizingCoverageGuard' })
    await completeMediaAcquisitionCandidate(run.id, candidate.id, '入库完成，已加入媒体库')
    return true
  } catch (error: any) {
    await addMediaAcquisitionEvent(run.id, 'warning', 'verify', `目标目录完成兜底检查失败，继续交由 Agent 整理：${error?.message || '未知错误'}`, { tool: 'organizingCoverageGuard' })
    return false
  }
}

async function settleSandboxResult(run: MediaAcquisitionRunView, result: Awaited<ReturnType<typeof runMediaAcquisitionSandbox>>): Promise<void> {
  if (result.unavailableReason) {
    await failMediaAcquisitionRun(run.id, result.unavailableReason)
    return
  }
  if (result.noCoverageReason) {
    await markMediaAcquisitionNoCoverage(run.id, result.noCoverageReason)
    return
  }
  if (!result.transferSubmitted && !result.candidate && run.status === 'organizing') {
    await failMediaAcquisitionRun(run.id, '整理 sandbox 未完成且未返回可恢复候选')
  }
}

async function completeIfRequestedEpisodesAlreadyExist(run: MediaAcquisitionRunView): Promise<boolean> {
  const seasonTargets = mediaAcquisitionSeasonTargets(run.target).filter(target => target.missingEpisodes.length)
  if (!['missing', 'patrol'].includes(run.kind) || !['tv', 'anime'].includes(run.target.mediaType) || !seasonTargets.length) return false
  try {
    const coverages = []
    const coveredFolderIds: string[] = []
    for (const seasonTarget of seasonTargets) {
      const leaf = await resolveMediaAcquisitionLeafFolder({ ...run.target, seasonNumber: seasonTarget.seasonNumber })
      if (!leaf) {
        await addMediaAcquisitionEvent(run.id, 'info', 'search', `预检未找到第 ${seasonTarget.seasonNumber} 季目录，继续搜索缺集资源。`, { tool: 'preflightCoverage', seasonNumber: seasonTarget.seasonNumber, skipReason: 'TARGET_LEAF_NOT_FOUND' })
        return false
      }
      const files = await listMediaAcquisitionDirectoryEntries(run.target, leaf.id, leaf.path)
      const coverage = buildTargetDirectoryCoverage(run, files.filter(file => VIDEO_EXT.test(file.name)), seasonTarget.seasonNumber)
      coverages.push(coverage)
      if (coverage.stillMissingRequestedEpisodes.length) {
        await addMediaAcquisitionEvent(run.id, 'info', 'search', `预检第 ${seasonTarget.seasonNumber} 季：已存在 E${coverage.obtainedEpisodes.join('、E') || '无'}，仍缺 E${coverage.stillMissingRequestedEpisodes.join('、E')}。`, { tool: 'preflightCoverage', ...coverage })
        return false
      }
      coveredFolderIds.push(leaf.id)
    }
    if (!coverages.length) return false
    for (const folderId of [...new Set(coveredFolderIds)]) await scanIntoMediaLibrary(run, folderId)
    await syncTracking(run)
    const covered = coverages.map(coverage => `S${String(coverage.seasonNumber || 1).padStart(2, '0')} E${coverage.requestedMissingEpisodes.join('、E')}`).join('；')
    await completeMediaAcquisitionRun(run.id, `目标缺集已在目录中存在，跳过搜索和转存：${covered}`, { tool: 'preflightCoverage', skipReason: 'ALREADY_EXISTS', coverages })
    return true
  } catch (error: any) {
    await addMediaAcquisitionEvent(run.id, 'warning', 'search', `预检目标目录失败，继续按正常流程搜索：${error?.message || '未知错误'}`, { tool: 'preflightCoverage' })
    return false
  }
}

/** Durable task facts are the sandbox's resume boundary after an offline provider wakes the runner. */
function mediaAcquisitionSandboxState(run: MediaAcquisitionRunView): Record<string, unknown> {
  return {
    status: run.status,
    phase: run.phase,
    activity: run.activity
  }
}

function mediaAcquisitionAgentResultPreview(result: unknown): string {
  try {
    const text = JSON.stringify(result ?? null)
    return text.length > 6000 ? `${text.slice(0, 6000)}\n[Sandbox tool result truncated]` : text
  } catch {
    return String(result)
  }
}

/** Keep sandbox failures visible to the model so it can choose the next honest action. */
async function asMediaAcquisitionAgentEvidence<T>(action: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await action()
  } catch (error: any) {
    return { error: error?.message || '工具执行失败' }
  }
}

/**
 * The only Agent runtime entry point. Provider transfer may suspend the same
 * persisted TaskSandbox at awaiting_landing; when the worker wakes it, the raw
 * structured sandbox facts are restored and each invocation starts with fresh
 * model context before organization tools take over.
 */
async function runMediaAcquisitionSandbox(run: MediaAcquisitionRunView, candidate?: MediaAcquisitionCandidate, landedFiles: MediaAcquisitionFileSnapshot[] = []): Promise<{ candidate?: MediaAcquisitionCandidate; noCoverageReason?: string; unavailableReason?: string; selectionReason?: string; transferSubmitted?: boolean }> {
  const active = candidate || activeCandidate(run)
  if (run.status === 'organizing' && !active) return { unavailableReason: 'TaskSandbox 恢复失败：缺少已转存候选' }
  return runMediaAcquisitionSandboxSelection(run, active, landedFiles)
}

/**
 * One durable sandbox loop. Provider work may suspend it at awaiting_landing,
 * but every resume uses the same structured sandbox and complete tool surface.
 */
async function runMediaAcquisitionSandboxSelection(run: MediaAcquisitionRunView, initialCandidate?: MediaAcquisitionCandidate, landedFiles: MediaAcquisitionFileSnapshot[] = []): Promise<{ candidate?: MediaAcquisitionCandidate; noCoverageReason?: string; unavailableReason?: string; selectionReason?: string; transferSubmitted?: boolean }> {
  const config = getAIConfig()
  let candidates = agentVisibleCandidates(run)
  const failedCandidates = run.candidates.filter(candidate => candidate.status === 'failed').map(candidate => ({ id: candidate.id, title: candidate.title, kind: candidate.kind, error: candidate.lastError || '未知失败' }))
  if (!config) return { unavailableReason: 'Agent 选择服务未配置，未执行自动转存' }
  let noCoverageReason = ''
  let agentStopReason = ''
  let transferSubmitted = false
  let active = initialCandidate
  let organized: Awaited<ReturnType<typeof organizeLandedFiles>> | undefined
  const organizedFolders = new Map<number, Awaited<ReturnType<typeof organizeLandedFiles>>>()
  let targetVerified = false
  let stagingDiscarded = false
  let subtitleTransferred = false
  let finished = false
  let responseText = ''
  const markedCoverage = new Set<string>()
  const observedStagingFileIds = new Set<string>(landedFiles.map(file => file.id))
  const observedTargetFileIds = new Map<number, Set<string>>()
  const observedTargetCoverage = new Set<string>()
  const subtitleSnapshots = new Map<string, MediaAcquisitionSubtitleSnapshotCandidate[]>()
  const transferredSubtitleFileIds = new Set<string>()
  const observedCandidateSnapshots = new Map<string, Set<string>>()
  const mediaTransferTickets = new Map<string, MediaAcquisitionV1TransferTicket>()
  const targetSnapshots = new Map<number, Promise<MediaAcquisitionFileSnapshot[]>>()
  const searchEvidence = getMediaAcquisitionSearchEvidence(run.events)
  let additionalSearchCount = searchEvidence.agentKeywords.size
  let providerSearchEvidence = searchEvidence.providerKeywords.size > 0
  // The bare-title pre-warm is outside the Agent budget, like mediary-scout's
  // primeRawSnapshot(). Both provider snapshots and Agent searches remain
  // deduped when the runner restarts or selects another candidate.
  const additionalSearchKeywords = new Set([...searchEvidence.providerKeywords, normalizeSearchKeyword(run.target.title)])
  const searchBudget = run.target.mediaType === 'movie' ? MOVIE_AGENT_SEARCH_BUDGET : AGENT_SEARCH_BUDGET
  const transferUntilLandedAvailable = run.target.mediaType === 'movie' && normalizeMediaAcquisitionPlatform(run.target.targetPlatform) === '115' && !!getMediaAcquisitionCapability(run.target.targetPlatform)?.shareImport
  const selectionTools = ['listCandidates', 'viewResourceSnapshot', 'searchResources', 'inspectTargetDir', 'transferCandidate', ...(transferUntilLandedAvailable ? ['transferUntilLanded'] : []), 'reportNoCoverage']
  const organizingTools = ['inspectTargetDir', 'inspectStaging', 'moveToSeason', 'flattenMovie', 'deleteFiles', 'markObtained', 'viewSubtitleSnapshot', 'transferSubtitle', 'renameSubtitle', 'discardStaging', 'finish']
  const persistedSandbox = await getMediaAcquisitionAgentSandbox(run.id)
  for (const [snapshotId, candidateIds] of mediaAcquisitionSandboxSnapshots(persistedSandbox.candidateSnapshots)) observedCandidateSnapshots.set(snapshotId, new Set(candidateIds))
  for (const [snapshotId, candidates] of mediaAcquisitionSandboxSubtitleSnapshots(persistedSandbox.subtitleSnapshots)) subtitleSnapshots.set(snapshotId, candidates)
  for (const fileId of mediaAcquisitionSandboxStringArray(persistedSandbox.transferredSubtitleFileIds)) transferredSubtitleFileIds.add(fileId)
  for (const code of mediaAcquisitionSandboxStringArray(persistedSandbox.markedCoverage)) markedCoverage.add(code)
  targetVerified = persistedSandbox.targetVerified === true
  stagingDiscarded = persistedSandbox.stagingDiscarded === true
  subtitleTransferred = persistedSandbox.subtitleTransferred === true
  organized = mediaAcquisitionSandboxOrganized(persistedSandbox.organized)
  for (const item of mediaAcquisitionSandboxOrganizedFolders(persistedSandbox.organizedFolders)) {
    const season = Number(item.seasonNumber)
    if (Number.isInteger(season) && season > 0) organizedFolders.set(season, item.result)
  }
  traceAgentDecision(run.id, 'start', {
    target: run.target,
    activeCandidate: active && { id: active.id, kind: active.kind, sourcePlatform: active.sourcePlatform, title: active.title, status: active.status },
    candidates: sandboxCandidates(run, candidates).map(candidate => mediaAcquisitionAgentCandidateView(run, candidate)),
    failedCandidates,
    sandboxPhase: persistedSandbox.phase
  })
  try {
    await runBoxPlayerAgent({
      surface: 'ai_search',
      model: config,
      systemPrompt: `你是 BoxPlayer 媒体获取 Agent，在严格 sandbox 内按“观察 -> 决策 -> 行动 -> 核验”执行。每轮只调用一个当前必要的工具，等待结果后再决定下一步。只能使用系统提供的候选和工具，不得编造链接或尝试其它网盘操作。每个写操作前先列出证据、事实和最小行动；候选标题只是线索，暂存目录与目标目录的真实回读才是落盘事实。选择阶段必须先调用 viewResourceSnapshot 查看系统预热的裸标题快照；候选只能通过该工具或 searchResources 观察。先确认标题和年份；缺集任务优先覆盖缺失集。每次读取会返回 snapshotId，transferCandidate 必须携带该已读 snapshotId，不能使用未读或过期快照的候选。如果候选不足、不可靠或未覆盖缺集，可以使用 searchResources 追加搜索，但关键词必须包含目标标题且不要加入画质、字幕等噪声词；缺集、追更或疑似重复入库时应使用 inspectTargetDir 查看目标目录快照。分享导入、磁力离线和 HTTP 外链离线基础优先级相同，统一按用户画质、字幕语言、年份和季集覆盖证据排序。画质与语言只依据候选标题证据判断，不能声称标题未标明的能力。蓝光原盘、ISO、BDMV 不是优先的可播放视频。候选落盘后，先 inspectStaging；外挂字幕先进入同一暂存区，使用 renameSubtitle 批量改为与对应视频同名后，再与视频同批 moveToSeason；核验目标目录、markObtained、discardStaging 后才 finish。${transferUntilLandedAvailable ? '电影的多个同片 115 分享候选可用 transferUntilLanded 按你给出的顺序串行尝试；首个落盘或异步提交后必须停止。' : '当前目标网盘未开放 115 分享导入，不得调用 transferUntilLanded；只使用已开放的转存方式。'}其它情况调用 transferCandidate 提交一次受限转存并写明选择理由；转存工具会记录真实任务状态。只有所有已观察候选都明显不可靠、无法覆盖或确属其它作品时才调用 reportNoCoverage。reportNoCoverage 的理由只能引用当前目标「${run.target.title}」及当前候选证据，不能出现其它影视任务的标题。`,
      prompt: active ? `继续同一个 sandbox：候选「${active.title}」已提交或已落盘。禁止再选或转存其它候选；先 inspectStaging，随后完成整理、核验、清理和 finish。` : `为「${run.target.title}${run.target.year ? ` (${run.target.year})` : ''}」选择资源。${run.target.alternativeTitles?.length ? `可确认别名：${run.target.alternativeTitles.join('、')}。` : ''}${mediaAcquisitionSeasonTargets(run.target).length ? `覆盖计划：${mediaAcquisitionSeasonTargets(run.target).map(target => `S${String(target.seasonNumber).padStart(2, '0')}${target.missingEpisodes.length ? ` E${target.missingEpisodes.join('、E')}` : ''}`).join('；')}。候选可以先覆盖其中一季；每次落盘后必须依据逐季目录事实决定是否还需要下一个候选。` : ''}目标网盘：${run.target.targetPlatform}。画质偏好：${run.target.preferredQuality || 'auto'}；${run.target.fetchSubtitles ? `字幕语言偏好：${run.target.preferredLanguage || 'auto'}` : '用户未要求字幕'}。候选已按规则分数从高到低排列；请比较全部候选，必要时核对各季目标目录后选择。${failedCandidates.length ? '已有候选失败，请根据失败证据重新选择，不能机械地按原搜索顺序轮询。' : ''}`,
      untrustedContext: { sandboxState: mediaAcquisitionSandboxState(run) },
      tools: {
        listCandidates: {
          description: '列出当前任务可选择的候选资源。',
          inputSchema: z.object({}),
          allowErrorResult: true,
          permission: 'read',
          execute: () => {
            const snapshot = sandboxCandidates(run, candidates)
            const snapshotId = crypto.randomUUID()
            observedCandidateSnapshots.set(snapshotId, new Set(snapshot.map(candidate => candidate.id)))
            return { snapshotId, coveragePlan: mediaAcquisitionCandidateCoveragePlan(run.target, snapshot), candidates: snapshot.map(candidate => mediaAcquisitionAgentCandidateView(run, candidate)) }
          }
        },
        viewResourceSnapshot: {
          description: '查看本次资源搜索快照，包括搜索关键词、兼容候选摘要和候选排序依据。用于在选择候选前回看搜索过程。',
          inputSchema: z.object({}),
          allowErrorResult: true,
          permission: 'read',
          execute: async () => asMediaAcquisitionAgentEvidence(async () => {
            const latestRun = (await listMediaAcquisitionRuns(200)).find(item => item.id === run.id) || run
            candidates = agentVisibleCandidates(latestRun)
            const snapshot = sandboxCandidates(latestRun, candidates)
            const snapshotId = crypto.randomUUID()
            observedCandidateSnapshots.set(snapshotId, new Set(snapshot.map(candidate => candidate.id)))
            const searchSummary = latestRun.events.filter(event => event.phase === 'search').slice(-8).map(event => event.message)
            await addMediaAcquisitionEvent(run.id, 'info', 'select', `Agent 查看资源搜索快照：${candidates.length} 个候选。`, { tool: 'viewResourceSnapshot', candidateCount: candidates.length })
            return {
              target: {
                title: latestRun.target.title,
                alternativeTitles: latestRun.target.alternativeTitles || [],
                year: latestRun.target.year,
                mediaType: latestRun.target.mediaType,
                seasonTargets: mediaAcquisitionSeasonTargets(latestRun.target),
                targetPlatform: latestRun.target.targetPlatform,
                preferredQuality: latestRun.target.preferredQuality || 'auto',
                preferredLanguage: latestRun.target.fetchSubtitles ? latestRun.target.preferredLanguage || 'auto' : 'none'
              },
              searchSummary,
              snapshotId,
              coveragePlan: mediaAcquisitionCandidateCoveragePlan(latestRun.target, snapshot),
              candidates: snapshot.map(candidate => mediaAcquisitionAgentCandidateView(latestRun, candidate))
            }
          })
        },
        searchResources: {
          description: '当当前候选不足或不可靠时，使用一个仍然包含目标标题的关键词追加搜索资源。不要加入画质、字幕等噪声词；画质偏好只用于选择结果。',
          inputSchema: z.object({ keyword: z.string().min(1).max(120), reason: z.string().min(1).max(200) }),
          // Like mediary-scout, provider search is observational. Persisting its
          // result is an implementation detail, not a user-data side effect.
          permission: 'read',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: async (args) => asMediaAcquisitionAgentEvidence(async () => {
            const normalizedKeyword = normalizeSearchKeyword(args.keyword)
            if (additionalSearchKeywords.has(normalizedKeyword)) {
              await addMediaAcquisitionEvent(run.id, 'warning', 'search', `Agent 跳过重复追加搜索：${normalizedKeyword}`, { tool: 'searchResources', repeated: true })
              return { repeated: true, added: 0, remainingSearches: Math.max(0, searchBudget - additionalSearchCount) }
            }
            if (additionalSearchCount >= searchBudget) {
              await addMediaAcquisitionEvent(run.id, 'warning', 'search', `Agent 已达到本轮搜索上限（${searchBudget} 次）。`, { tool: 'searchResources', limit: searchBudget })
              return { limited: true, added: 0, remainingSearches: 0 }
            }
            additionalSearchKeywords.add(normalizedKeyword)
            additionalSearchCount++
            const added = await searchAdditionalMediaAcquisitionCandidates(run, args.keyword, args.reason)
            providerSearchEvidence = true
            const updated = (await listMediaAcquisitionRuns(200)).find(item => item.id === run.id)
            if (updated) candidates = agentVisibleCandidates(updated)
            const snapshot = sandboxCandidates(updated || run, candidates)
            const snapshotId = crypto.randomUUID()
            observedCandidateSnapshots.set(snapshotId, new Set(snapshot.map(candidate => candidate.id)))
            return {
              added,
              remainingSearches: Math.max(0, searchBudget - additionalSearchCount),
              reserve: run.target.mediaType === 'movie' && additionalSearchCount > AGENT_SEARCH_BUDGET,
              note: run.target.mediaType === 'movie' && additionalSearchCount > AGENT_SEARCH_BUDGET ? '已进入电影字幕兜底搜索保留区。请根据已有候选尽快选择可靠正片；不要继续发起无关搜索。' : undefined,
              snapshotId,
              coveragePlan: mediaAcquisitionCandidateCoveragePlan(run.target, snapshot),
              candidates: snapshot.map(candidate => mediaAcquisitionAgentCandidateView(run, candidate))
            }
          })
        },
        inspectTargetDir: {
          description: '读取目标入库目录快照。可传 season 查看指定季；多季任务不传时会逐季返回覆盖事实。',
          inputSchema: z.object({ season: z.number().int().positive().optional() }),
          allowErrorResult: true,
          permission: 'read',
          execute: async (args: { season?: number }) => asMediaAcquisitionAgentEvidence(async () => {
            const isMovie = run.target.mediaType === 'movie'
            const seasons = args.season ? [args.season] : mediaAcquisitionSeasonTargets(run.target).map(target => target.seasonNumber)
            const requestedSeasons = seasons.length ? seasons : [isMovie ? 0 : run.target.seasonNumber || 1]
            const inspected = []
            for (const season of requestedSeasons) {
              let files: MediaAcquisitionFileSnapshot[]
              if (isMovie) files = await listMediaAcquisitionTargetLeafFiles(run.target)
              else {
                if (!targetSnapshots.has(season)) targetSnapshots.set(season, readMediaAcquisitionTargetSeason(run, season))
                files = await targetSnapshots.get(season)!
              }
              const mediaFiles = files.filter(file => VIDEO_EXT.test(file.name))
              const coverage = buildTargetDirectoryCoverage(run, mediaFiles, season)
              observedTargetFileIds.set(season, new Set(files.map(file => file.id)))
              if (run.target.mediaType === 'movie' && mediaFiles.some(file => file.size === undefined || file.size > 0)) observedTargetCoverage.add('MOVIE')
              else {
                const seasonCode = String(season).padStart(2, '0')
                coverage.obtainedEpisodes.forEach(episode => observedTargetCoverage.add(`S${seasonCode}E${String(episode).padStart(2, '0')}`))
              }
              inspected.push({ season: isMovie ? undefined : season, fileCount: files.length, mediaFileCount: mediaFiles.length, coverage, mediaPreview: mediaFiles.slice(0, 40).map(file => ({ name: file.name, size: file.size, path: file.path })) })
            }
            await addMediaAcquisitionEvent(run.id, 'info', 'select', `Agent 检查目标目录：${inspected.map(item => `${isMovie ? '电影' : `S${String(item.season).padStart(2, '0')}`} ${item.mediaFileCount} 个媒体文件`).join('；')}。`, { tool: 'inspectTargetDir', seasons: inspected.map(item => ({ season: item.season, fileCount: item.fileCount, mediaFileCount: item.mediaFileCount, ...item.coverage })) })
            return { targetPlatform: run.target.targetPlatform, seasons: inspected }
          })
        },
        transferCandidate: {
          description: '在当前任务 sandbox 内提交一个已查看快照中的候选转存。必须携带已读 snapshotId 和选择理由。此操作只提交一次网盘任务，随后由系统轮询并把真实落盘结果交回后续 Agent 整理循环。',
          inputSchema: z.object({ snapshotId: z.string().min(1), candidateId: z.string().min(1), reason: z.string().min(1).max(300) }),
          permission: 'write',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: async (args: { snapshotId: string; candidateId: string; reason: string }, context) => {
            const ticket = context ? mediaTransferTickets.get(context.toolCallId) : undefined
            const result = await asMediaAcquisitionAgentEvidence(async () => {
            if (active) return { error: 'SANDBOX_AWAITING_LANDING：已有候选正在落盘或整理，禁止并行转存。' }
            if (transferSubmitted) return { error: 'SANDBOX_AWAITING_LANDING：本轮已提交一个候选，必须等待真实落盘后再继续。' }
            if (await isMediaAcquisitionSandboxCoverageMet(run)) return { error: 'SANDBOX_COVERAGE_ALREADY_MET：目标目录已满足本任务覆盖，拒绝继续转存。' }
            const candidate = sandboxCandidates(run, candidates).find(item => item.id === args.candidateId)
            if (!candidate || !observedCandidateSnapshots.get(args.snapshotId)?.has(candidate.id)) return { error: '候选不在本回合已观察的资源快照中，未提交转存。' }
            const trustedReason = buildTrustedAgentSelectionReason(run, candidate, args.reason)
            if (candidate.status === 'pending') {
              await selectMediaAcquisitionCandidate(run.id, candidate.id, trustedReason)
            }
            await addMediaAcquisitionEvent(run.id, 'info', 'select', `Agent 决策：${trustedReason}`, { candidateId: candidate.id, snapshotId: args.snapshotId, tool: 'transferCandidate' })
            const latest = (await listMediaAcquisitionRuns(200)).find(item => item.id === run.id)
            const selected = latest?.candidates.find(item => item.id === candidate.id)
            if (!latest || selected?.status !== 'selected') return { error: '候选已被其他安全事务处理，未提交新的网盘转存。' }
            try {
              if (selected.kind === 'magnet') await executeMediaAcquisitionMagnetCandidate(latest, selected.id, ticket)
              else if (selected.kind === 'http') await executeMediaAcquisitionHttpCandidate(latest, selected.id, ticket)
              else await executeMediaAcquisitionShareCandidate(latest, selected.id, ticket)
            } catch (error: any) {
              const message = error?.message || '网盘转存失败'
              // Executor 已负责记录候选失败和清理暂存。这里的职责是把账户、
              // 配额、登录态等全局阻塞明确传给 Agent 状态机，不能误报为无资源。
              if (isSystemicMediaAcquisitionFailure(message)) return { error: message, systemicBlock: { reason: message } }
              return { error: message }
            }
            const refreshed = (await listMediaAcquisitionRuns(200)).find(item => item.id === run.id)
            const transferred = refreshed?.candidates.find(item => item.id === selected.id)
            if (!transferred || !['transferring', 'imported'].includes(transferred.status)) {
              return { error: 'SANDBOX_TRANSFER_NOT_CLAIMED：网盘转存尚未确认接管该候选；未把它视为已提交。请等待下一轮恢复后重新观察任务状态。' }
            }
            const landing = refreshed && transferred ? await inspectLandedMediaFiles(refreshed, transferred) : undefined
            active = transferred
            landing?.current.forEach(file => observedStagingFileIds.add(file.id))
            transferSubmitted = true
            await addMediaAcquisitionEvent(run.id, 'info', 'transfer', 'Agent 已通过 sandbox 提交候选转存，等待网盘任务与真实落盘核验。', { tool: 'transferCandidate', candidateId: selected.id })
            return {
              submitted: true,
              candidateId: selected.id,
              taskStatus: transferred?.status,
              staging: landing ? {
                folderId: landing.snapshotFolderId,
                files: landing.current.map(file => ({ id: file.id, name: file.name, path: file.path, size: file.size })),
                primaryVideos: landing.landed.map(file => file.id)
              } : undefined
            }
          })
            if (ticket && context) {
              mediaTransferTickets.delete(context.toolCallId)
              const outcome = mediaTransferReceiptOutcome(result)
              await completeMediaAcquisitionV1Transfer(ticket, outcome.status, outcome.message)
            }
            return result
          }
        },
        transferUntilLanded: {
          description: '仅电影：按 Agent 已确认的优先顺序，依次提交同一影片的分享候选；每次都回读暂存目录，首个真实落盘或进入异步网盘任务后立即停止，绝不并行提交。',
          inputSchema: z.object({ snapshotId: z.string().min(1), candidateIds: z.array(z.string().min(1)).min(1).max(12), reason: z.string().min(1).max(300) }),
          permission: 'write',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: async (args: { snapshotId: string; candidateIds: string[]; reason: string }) => asMediaAcquisitionAgentEvidence(async () => {
            if (transferSubmitted) return { error: 'SANDBOX_AWAITING_LANDING：本轮已提交一个候选，必须等待真实落盘后再继续。' }
            if (run.target.mediaType !== 'movie') return { error: 'transferUntilLanded 仅用于电影；剧集请按覆盖需要逐个选择候选。' }
            if (normalizeMediaAcquisitionPlatform(run.target.targetPlatform) !== '115') return { error: 'transferUntilLanded 仅适用于 115 网盘分享；当前网盘请使用 transferCandidate。' }
            if (await isMediaAcquisitionSandboxCoverageMet(run)) return { error: 'SANDBOX_COVERAGE_ALREADY_MET：目标目录已满足本任务覆盖，拒绝继续转存。' }
            const observed = observedCandidateSnapshots.get(args.snapshotId)
            if (!observed) return { error: '资源快照未在当前 sandbox 中观察到，未提交转存。' }
            const candidateIds = [...new Set(args.candidateIds)]
            if (candidateIds.some(candidateId => !observed.has(candidateId))) return { error: '候选不在已观察资源快照中，未提交转存。' }
            const attempts: Array<{ candidateId: string; status: 'landed' | 'submitted' | 'failed'; message?: string }> = []
            for (const candidateId of candidateIds) {
              const latest = (await listMediaAcquisitionRuns(200)).find(item => item.id === run.id)
              const candidate = latest?.candidates.find(item => item.id === candidateId)
              if (!latest || !candidate || candidate.status === 'failed' || candidate.kind !== 'share' || normalizeMediaAcquisitionPlatform(candidate.sourcePlatform) !== '115') {
                attempts.push({ candidateId, status: 'failed', message: '候选不可执行或不是 115 分享导入候选' })
                continue
              }
              if (candidate.status === 'pending') await selectMediaAcquisitionCandidate(run.id, candidate.id, buildTrustedAgentSelectionReason(run, candidate, args.reason))
              try {
                await executeMediaAcquisitionShareCandidate(latest, candidate.id)
              } catch (error: any) {
                const message = error?.message || '分享导入失败'
                attempts.push({ candidateId, status: 'failed', message })
                if (isSystemicMediaAcquisitionFailure(message)) return { attempts, systemicBlock: { reason: message } }
                continue
              }
              const refreshed = (await listMediaAcquisitionRuns(200)).find(item => item.id === run.id)
              const refreshedCandidate = refreshed?.candidates.find(item => item.id === candidate.id)
              const landing = refreshed && refreshedCandidate ? await inspectLandedMediaFiles(refreshed, refreshedCandidate) : undefined
              transferSubmitted = true
              if (landing?.landed.length) {
                attempts.push({ candidateId, status: 'landed' })
                return { attempts, landed: landing.landed.map(file => ({ id: file.id, name: file.name, size: file.size, path: file.path })), transferredCandidateId: candidateId }
              }
              if (refreshedCandidate && ['transferring', 'imported'].includes(refreshedCandidate.status)) {
                attempts.push({ candidateId, status: 'submitted' })
                return { attempts, transferredCandidateId: candidateId, awaitingLanding: true }
              }
              attempts.push({ candidateId, status: 'failed', message: refreshedCandidate?.lastError || '网盘未落盘候选资源' })
            }
            return { attempts, transferredCandidateId: null }
          })
        },
        reportNoCoverage: {
          description: '当所有候选都不可靠、明显不匹配或无法覆盖目标缺集时，报告暂无可靠资源。调用后任务会进入暂无资源状态。',
          inputSchema: z.object({ reason: z.string().min(1).max(300) }),
          permission: 'write',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: async (args) => asMediaAcquisitionAgentEvidence(async () => {
            if (transferSubmitted) return { error: 'SANDBOX_AWAITING_LANDING：本轮已提交候选，不能在真实落盘前报告暂无资源。' }
            if (!providerSearchEvidence) return { error: '尚未获得真实资源搜索快照，不能报告暂无资源。请先查看或搜索资源。' }
            const normalizedReason = String(args.reason).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
            const targetTitles = [run.target.title, ...(run.target.alternativeTitles || [])].map(title => title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')).filter(title => title.length >= 2)
            if (targetTitles.length && !targetTitles.some(title => normalizedReason.includes(title))) return { error: `暂无资源理由必须引用当前目标「${run.target.title}」，不能使用其它任务的影视名称。` }
            noCoverageReason = `Agent 未找到可靠候选：${args.reason}`
            await addMediaAcquisitionEvent(run.id, 'warning', 'select', noCoverageReason, { tool: 'reportNoCoverage' })
            return { noCoverage: true }
          })
        },
        inspectStaging: {
          description: '读取当前候选暂存目录的真实新增文件。转存后必须先调用此工具，返回的文件 ID 才能用于整理。',
          inputSchema: z.object({}),
          allowErrorResult: true,
          permission: 'read',
          execute: () => asMediaAcquisitionAgentEvidence(async () => {
            if (!active) return { error: '当前尚未有已转存候选。请先选择并转存资源。' }
            const evidence = await inspectLandedMediaFiles(run, active)
            observedStagingFileIds.clear()
            evidence.added.forEach(file => observedStagingFileIds.add(file.id))
            return { folderId: evidence.snapshotFolderId, files: evidence.added.map(file => ({ id: file.id, name: file.name, path: file.path, size: file.size, parentId: file.parentId })), primaryVideos: evidence.landed.map(file => file.id), rejectedVideos: evidence.rejected.map(file => file.id) }
          })
        },
        moveToSeason: {
          description: '剧集或动画：一次提交完整的 files -> season 分发计划。每项必须指定目标季，视频与字幕必须位于同一季的 fileIds。',
          inputSchema: z.object({ moves: z.array(z.object({ season: z.number().int().positive(), fileIds: z.array(z.string()).min(1).max(500) })).min(1).max(20) }),
          permission: 'write',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: async (args: { moves: Array<{ season: number; fileIds: string[] }> }) => asMediaAcquisitionAgentEvidence(async () => {
            if (!active) return { error: '当前尚未有已转存候选。' }
            if (run.target.mediaType === 'movie') return { error: '电影任务请使用 flattenMovie。' }
            const fileIds = [...new Set(args.moves.flatMap(move => move.fileIds))]
            if (fileIds.length !== args.moves.reduce((count, move) => count + move.fileIds.length, 0)) return { error: '同一个文件不能分发到多个季目录。' }
            const unobserved = fileIds.filter(id => !observedStagingFileIds.has(id))
            if (unobserved.length) return { error: `文件不在本回合 inspectStaging 返回的快照中：${unobserved.join('、')}` }
            const [staging, resolved] = await Promise.all([
              inspectLandedMediaFiles(run, active),
              Promise.all(args.moves.map(async move => ({ move, leaf: await ensureMediaAcquisitionSeasonFolder(run.target, move.season) })))
            ])
            const stagingById = new Map(staging.added.map(file => [file.id, file]))
            const outOfScope = fileIds.filter(id => !stagingById.has(id))
            if (outOfScope.length) return { error: `文件已不在当前暂存目录中：${outOfScope.join('、')}` }
            for (const { move, leaf } of resolved) {
              const files = move.fileIds.map(id => stagingById.get(id)!)
              const subtitles = files.filter(file => transferredSubtitleFileIds.has(file.id) || isMediaAcquisitionSubtitleName(file.name))
              if (!subtitles.length) continue
              const videoNames = files.filter(file => VIDEO_EXT.test(file.name)).map(file => file.name)
              const targetVideoNames = videoNames.length ? [] : (await listMediaAcquisitionDirectoryEntries(run.target, leaf.id, leaf.path)).filter(file => !file.isDir && VIDEO_EXT.test(file.name)).map(file => file.name)
              const unmatched = subtitles.filter(file => !isMediaAcquisitionMatchingSidecar(file.name, [...videoNames, ...targetVideoNames]))
              if (unmatched.length) return { error: `外挂字幕必须与同季视频一起入库：${unmatched.map(file => file.name).join('、')}` }
            }
            await beginMediaAcquisitionOrganizing(run.id, 'Agent 正在整理已落盘文件')
            const distributions: Record<number, Awaited<ReturnType<typeof moveLandedFilesToTarget>>> = {}
            for (const { move } of resolved) {
              const result = await moveLandedFilesToTarget(run, active, [...new Set(move.fileIds)], move.season)
              if (!result.fullyMoved) return { error: result.message }
              distributions[move.season] = result
              organizedFolders.set(move.season, result)
            }
            const targetEntries = await Promise.all(Object.entries(distributions).map(async ([season, result]) => {
              targetSnapshots.delete(Number(season))
              const entries = await readMediaAcquisitionTargetSeason(run, Number(season))
              const present = new Set(entries.filter(file => !file.isDir).map(file => file.id))
              const missing = result.files.filter(file => !present.has(file.id))
              if (missing.length) throw new Error(`目标季 S${String(season).padStart(2, '0')} 尚未确认全部整理文件：${missing.map(file => file.name).join('、')}`)
              observedTargetFileIds.set(Number(season), present)
              recordObservedTargetCoverage(run, Number(season), entries, observedTargetCoverage)
              return [Number(season), entries] as const
            }))
            const requestedSeason = run.target.seasonNumber || 1
            organized = distributions[requestedSeason] || Object.values(distributions)[0]
            targetVerified = !!organized && targetEntries.length === Object.keys(distributions).length
            const refreshedStaging = await inspectLandedMediaFiles(run, active)
            observedStagingFileIds.clear()
            refreshedStaging.added.forEach(file => observedStagingFileIds.add(file.id))
            return { seasons: Object.fromEntries(targetEntries.map(([season, entries]) => [season, { folderId: distributions[season].folderId, folderPath: distributions[season].folderPath, files: entries.filter(file => !file.isDir).map(file => ({ id: file.id, name: file.name, path: file.path, size: file.size })) }])), staging: refreshedStaging.current.map(file => ({ id: file.id, name: file.name, path: file.path, size: file.size })) }
          })
        },
        flattenMovie: {
          description: '电影：将已落盘资源整理到电影最终目录并清理包装层。',
          inputSchema: z.object({}),
          permission: 'write',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: () => asMediaAcquisitionAgentEvidence(async () => {
            if (!active) return { error: '当前尚未有已转存候选。' }
            if (run.target.mediaType !== 'movie') return { error: '剧集或动画任务请使用 moveToSeason。' }
            await beginMediaAcquisitionOrganizing(run.id, 'Agent 正在整理电影最终目录')
            const evidence = await inspectLandedMediaFiles(run, active)
            organized = await organizeLandedFiles(run, evidence.added)
            if (!organized.fullyMoved) return { error: organized.message }
            targetVerified = await verifyOrganizedTarget(run, organized.folderId, organized.files)
            targetSnapshots.clear()
            return targetVerified ? { folderId: organized.folderId, folderPath: organized.folderPath, movedCount: organized.movedCount, files: organized.files.map(file => ({ id: file.id, name: file.name, path: file.path, size: file.size })) } : { error: '电影最终目录尚未确认全部整理文件。' }
          })
        },
        deleteFiles: {
          description: '删除当前 sandbox 已观察的暂存或季目录重复/无关文件。季目录删除必须指定 season。',
          inputSchema: z.object({ directory: z.enum(['staging', 'season']), season: z.number().int().positive().optional(), fileIds: z.array(z.string()).min(1).max(500) }),
          permission: 'destructive',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: async (args: { directory: 'staging' | 'season'; season?: number; fileIds: string[] }) => asMediaAcquisitionAgentEvidence(async () => {
            if (args.directory === 'season' && !args.season) return { error: '删除季目录文件必须提供 season。' }
            const observed = args.directory === 'staging' ? observedStagingFileIds : observedTargetFileIds.get(args.season!)
            if (!observed) return { error: '请先读取对应目录快照。' }
            const unobserved = args.fileIds.filter(id => !observed.has(id))
            if (unobserved.length) return { error: `文件不在本回合已观察快照中：${unobserved.join('、')}` }
            const deleted = await AliFileCmd.ApiTrashBatch(run.target.targetUserId, run.target.targetDriveId, args.fileIds)
            if (args.directory === 'season' && args.season) {
              targetSnapshots.delete(args.season)
              observedTargetFileIds.delete(args.season)
            } else {
              deleted.forEach(id => observedStagingFileIds.delete(id))
            }
            return { deleted }
          })
        },
        markObtained: {
          description: '在目标目录回读确认后标记实际获得的媒体。电影使用 MOVIE；剧集使用 S01E01 等集号。',
          inputSchema: z.object({ codes: z.array(z.string().min(1).max(16)).min(1).max(500) }),
          permission: 'write',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: async (args: { codes: string[] }) => asMediaAcquisitionAgentEvidence(async () => {
            if (!targetVerified) return { error: '请先完成整理并回读确认目标目录。' }
            const valid = args.codes.filter(code => run.target.mediaType === 'movie' ? code === 'MOVIE' : /^S\d{2,}E\d{2,}$/.test(code))
            const unobserved = valid.filter(code => !observedTargetCoverage.has(code))
            if (!valid.length || unobserved.length) return { error: unobserved.length ? `目标目录快照未确认这些媒体覆盖：${unobserved.join('、')}。请先调用 inspectTargetDir。` : '没有有效的媒体覆盖标记。' }
            valid.forEach(code => markedCoverage.add(code))
            return { confirmed: valid }
          })
        },
        discardStaging: {
          description: '在目标目录确认后，清理本候选专属暂存目录。',
          inputSchema: z.object({}),
          permission: 'destructive',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: () => asMediaAcquisitionAgentEvidence(async () => {
            if (!active) return { error: '当前尚未有已转存候选。' }
            if (!organized?.fullyMoved || !targetVerified) return { error: '请先完成整理并确认目标目录。' }
            if ([...transferredSubtitleFileIds].some(id => observedStagingFileIds.has(id))) return { error: '仍有已转存字幕留在暂存目录；请先与对应视频一起移动到目标季。' }
            stagingDiscarded = await cleanupCandidateStagingDirectory(run, active)
            return stagingDiscarded ? { discarded: true } : { error: '暂存目录未能回收，已保留供下一轮检查。' }
          })
        },
        viewSubtitleSnapshot: {
          description: '读取当前暂存视频可用的外挂中文字幕候选。字幕应先落到此暂存目录，再与视频一起分发到季目录。',
          inputSchema: z.object({}),
          allowErrorResult: true,
          permission: 'read',
          execute: () => asMediaAcquisitionAgentEvidence(async () => {
            if (!active || !observedStagingFileIds.size) return { error: '请先调用 inspectStaging，确认暂存视频后再查看字幕。' }
            const evidence = await inspectLandedMediaFiles(run, active)
            const snapshot = await viewAutoChineseSubtitleSnapshot(run, evidence.added)
            const snapshotId = crypto.randomUUID()
            subtitleSnapshots.set(snapshotId, snapshot.candidates)
            return { ...snapshot, snapshotId }
          })
        },
        transferSubtitle: {
          description: '将已观察字幕候选写入当前候选暂存目录。必须携带 viewSubtitleSnapshot 的 snapshotId。',
          inputSchema: z.object({ snapshotId: z.string().min(1), subtitleId: z.string().min(1) }),
          permission: 'write',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: (args: { snapshotId: string; subtitleId: string }) => asMediaAcquisitionAgentEvidence(async () => {
            if (!active || !observedStagingFileIds.size) return { error: '请先调用 inspectStaging，确认暂存视频后再转存字幕。' }
            const selectedSubtitle = subtitleSnapshots.get(args.snapshotId)?.find(item => item.id === args.subtitleId)
            if (!selectedSubtitle) return { error: '字幕候选不在当前 sandbox 已观察快照中。' }
            const evidence = await inspectLandedMediaFiles(run, active)
            const beforeIds = new Set(evidence.current.map(file => file.id))
            const message = await transferAutoChineseSubtitle(run, evidence.added, selectedSubtitle, { ...run.target, targetParentFileId: evidence.snapshotFolderId })
            subtitleTransferred = true
            const refreshed = await inspectLandedMediaFiles(run, active)
            refreshed.current.forEach(file => observedStagingFileIds.add(file.id))
            refreshed.current.filter(file => !beforeIds.has(file.id) && isMediaAcquisitionSubtitleName(file.name)).forEach(file => transferredSubtitleFileIds.add(file.id))
            return { submitted: true, message, staging: refreshed.current.map(file => ({ id: file.id, name: file.name, size: file.size, path: file.path })) }
          })
        },
        renameSubtitle: {
          description: '批量重命名当前暂存目录内的外挂字幕，使其与对应视频同名（仅扩展名不同）。每项只能是当前暂存目录中的字幕，名称不得包含路径。',
          inputSchema: z.object({ renames: z.array(z.object({ fileId: z.string().min(1), newName: z.string().min(1).max(255) })).min(1).max(500) }),
          permission: 'write',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: (args: { renames: Array<{ fileId: string; newName: string }> }) => asMediaAcquisitionAgentEvidence(async () => {
            if (!active) return { error: '当前尚未有已转存候选。' }
            const staging = await inspectLandedMediaFiles(run, active)
            const filesById = new Map(staging.current.map(file => [file.id, file]))
            const errors: Array<{ fileId: string; error: string }> = []
            const valid = args.renames.filter(item => {
              const file = filesById.get(item.fileId)
              if (!file) {
                errors.push({ fileId: item.fileId, error: '文件不在当前暂存目录中' })
                return false
              }
              if (!isMediaAcquisitionSubtitleName(file.name)) {
                errors.push({ fileId: item.fileId, error: '只允许重命名外挂字幕' })
                return false
              }
              if (/[\\/]/.test(item.newName) || !SUBTITLE_EXT.test(item.newName)) {
                errors.push({ fileId: item.fileId, error: '字幕名称必须是不含路径的字幕文件名' })
                return false
              }
              return true
            })
            if (valid.length) {
              const renamed = await AliFileCmd.ApiRenameBatch(run.target.targetUserId, run.target.targetDriveId, valid.map(item => item.fileId), valid.map(item => item.newName))
              const renamedNames = new Set(renamed.map(item => item.name))
              valid.filter(item => !renamedNames.has(item.newName)).forEach(item => errors.push({ fileId: item.fileId, error: '网盘未确认字幕重命名' }))
            }
            const refreshed = await inspectLandedMediaFiles(run, active)
            observedStagingFileIds.clear()
            refreshed.current.forEach(file => observedStagingFileIds.add(file.id))
            refreshed.current.filter(file => isMediaAcquisitionSubtitleName(file.name)).forEach(file => transferredSubtitleFileIds.add(file.id))
            return { renamed: valid.map(item => item.newName), ...(errors.length ? { errors } : {}), staging: refreshed.current.map(file => ({ id: file.id, name: file.name, size: file.size, path: file.path })) }
          })
        },
        finish: {
          description: '仅在真实文件已整理、目标目录已核验且暂存目录已处理后结束当前 sandbox 循环。',
          inputSchema: z.object({}),
          permission: 'write',
          executionMode: 'sequential',
          allowErrorResult: true,
          execute: () => asMediaAcquisitionAgentEvidence(async () => {
            if (!active) return { error: '当前尚未有已转存候选。' }
            if (!organized?.fullyMoved || !targetVerified) return { error: '尚未完成真实落盘整理与目标目录核验。' }
            if (!hasAgentMarkedProgress(run, markedCoverage)) return { error: `请先按真实目录内容调用 markObtained：${expectedAgentCoverageCodes(run).join('、')}` }
            if (!stagingDiscarded && run.target.mediaType !== 'movie') return { error: '请先清理本候选暂存目录。' }
            await completeOrganizedRun(run, active, organized, stagingDiscarded, [...organizedFolders.values()])
            finished = true
            return { finished: true, coverageMet: await isMediaAcquisitionSandboxCoverageMet(run) }
          })
        }
      },
      toolAllowlist: active ? organizingTools : selectionTools,
      // mediary-scout's agent is an observe -> decide -> act loop. Do not let a
      // model issue a search/inspection/selection batch concurrently.
      toolExecution: 'sequential',
      maxContextChars: 48_000,
      maxToolCallsPerTurn: 1,
      // A selection/organization turn is incomplete until it takes one of the
      // sandbox actions. Prose-only model output must not silently fail a run.
      requireToolCall: true,
      shouldStopAfterToolResult: ({ toolName, result, isError }) => {
        if (!result || typeof result !== 'object') return undefined
        const raw = result as Record<string, unknown>
        const value = raw.details && typeof raw.details === 'object' ? raw.details as Record<string, unknown> : raw
        const systemicBlock = value.systemicBlock
        if (systemicBlock && typeof systemicBlock === 'object' && typeof (systemicBlock as Record<string, unknown>).reason === 'string') {
          agentStopReason = `网盘账户或配额受阻：${(systemicBlock as Record<string, unknown>).reason}`
          return agentStopReason
        }
        if (isError) return undefined
        if ((toolName === 'transferCandidate' || toolName === 'transferUntilLanded') && value.submitted === true && !value.error) return 'Agent 已提交候选转存，后续交由网盘任务轮询与落盘核验。'
        if (toolName === 'reportNoCoverage' && value.noCoverage === true && !value.error) return 'Agent 已确认本轮无可靠资源，结束本轮 sandbox。'
        // finish 会立即把数据库状态推进为完成、部分完成或下一候选选择；继续沿用旧 sandbox
        // 会让模型在已经失效的候选上下文里反复整理。
        if (toolName === 'finish' && value.finished === true && !value.error) return value.coverageMet === true ? 'Agent 已确认目标目录覆盖完成，结束本轮 sandbox。' : 'Agent 已提交本轮已核验覆盖，交由任务状态机决定继续候选或以部分完成收敛。'
        return undefined
      },
      onEvent: async (event) => {
        if (event.type === 'text_delta') {
          responseText += event.text
        } else if (event.type === 'tool_start') {
          traceAgentDecision(run.id, 'tool_start', { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args })
          await addMediaAcquisitionEvent(run.id, 'info', active ? 'organize' : 'select', `Agent 调用工具：${event.toolName}`, { tool: event.toolName, toolCallId: event.toolCallId })
        } else if (event.type === 'tool_complete') {
          traceAgentDecision(run.id, 'tool_complete', { toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, result: event.result })
          await addMediaAcquisitionEvent(run.id, event.isError ? 'warning' : 'info', active ? 'organize' : 'select', `Agent 工具${event.isError ? '失败' : '完成'}：${event.toolName}`, { tool: event.toolName, toolCallId: event.toolCallId, isError: event.isError, result: mediaAcquisitionAgentResultPreview(event.result) })
        } else if (event.type === 'approval_required') {
          traceAgentDecision(run.id, 'approval', { toolName: event.request.toolName, permission: event.request.permission, args: event.request.args })
          await addMediaAcquisitionEvent(run.id, 'info', active ? 'organize' : 'select', `Agent 准备执行：${event.request.toolName}`, { tool: event.request.toolName, permission: event.request.permission })
        } else if (event.type === 'error') {
          traceAgentDecision(run.id, 'error', { message: event.message })
          await addMediaAcquisitionEvent(run.id, 'warning', active ? 'organize' : 'select', `Agent 运行事件：${event.message}`)
          if (/maximum agent turns|tool call limit|repeated tool call/i.test(event.message)) {
            agentStopReason = 'Agent 已达到本轮决策上限，未确认可靠候选，已停止自动转存。'
          } else if (/网盘账户或配额受阻/.test(event.message)) {
            agentStopReason = event.message
          }
        } else if (event.type === 'turn_end') {
          traceAgentDecision(run.id, 'model_response', { text: responseText.trim() })
          responseText = ''
        } else if (event.type === 'usage') {
          traceAgentDecision(run.id, 'usage', event.usage)
        } else if (event.type === 'end') {
          traceAgentDecision(run.id, 'agent_end', { activeCandidateId: active?.id, transferSubmitted, noCoverageReason, agentStopReason, finished })
        }
      },
      requestApproval: async request => {
        if (request.toolName === 'transferCandidate') {
          const args = request.args as { snapshotId?: string; candidateId?: string; reason?: string }
          const candidate = args.candidateId ? sandboxCandidates(run, candidates).find(item => item.id === args.candidateId) : undefined
          if (!candidate || !args.snapshotId || !observedCandidateSnapshots.get(args.snapshotId)?.has(candidate.id)) return false
          const transferKind = candidate.kind === 'share' ? '分享导入' : candidate.kind === 'magnet' ? '磁力离线下载' : 'HTTP 离线下载'
          const approved = window.confirm(`允许 BoxPlayer 提交候选转存吗？\n\n候选：${candidate.title}\n方式：${transferKind}\n目标：${run.target.targetPlatform} · ${run.target.title}\n\n提交后会先写入一次性执行票据，再由网盘回读核验实际落盘结果。`)
          if (!approved) {
            await addMediaAcquisitionEvent(run.id, 'info', 'select', '用户拒绝候选转存。', { tool: 'transferCandidate', candidateId: candidate.id })
            return false
          }
          const ticket = await beginMediaAcquisitionV1Transfer(run.id, candidate.id, String(args.reason || '用户确认候选转存'))
          if (ticket) mediaTransferTickets.set(request.toolCallId, ticket)
          return true
        }
        if (request.toolName === 'transferUntilLanded') {
          const args = request.args as { snapshotId?: string; candidateIds?: string[] }
          const observed = args.snapshotId ? observedCandidateSnapshots.get(args.snapshotId) : undefined
          const candidatesToTry = [...new Set(args.candidateIds || [])].map(candidateId => sandboxCandidates(run, candidates).find(item => item.id === candidateId)).filter((candidate): candidate is MediaAcquisitionCandidate => !!candidate && !!observed?.has(candidate.id))
          if (!candidatesToTry.length) return false
          return window.confirm(`允许 BoxPlayer 依序尝试 ${candidatesToTry.length} 个 115 分享候选吗？\n\n${candidatesToTry.map((candidate, index) => `${index + 1}. ${candidate.title}`).join('\n')}\n\n首个提交成功或检测到落盘后会立即停止。`)
        }
        // 其余写操作只能作用于本次已确认候选的暂存目录或目标目录，仍受
        // sandbox 的已观察文件 ID 与目标根目录约束，不会扩大候选转存授权。
        return true
      },
      maxTurns: 60,
      // Scout V2 的单轮硬上限为 60。maxTurns 已为 60，不能再用更小的
      // tool-call 上限提前截断一个仍在按快照核验的 Agent。
      maxToolCalls: 60,
      maxRepeatedToolCalls: 4
    })
    await saveMediaAcquisitionAgentSandbox(run.id, {
      ...persistedSandbox,
      phase: finished ? 'finished' : transferSubmitted ? 'awaiting_landing' : active ? 'organizing' : 'selecting',
      candidateSnapshots: Object.fromEntries([...observedCandidateSnapshots].map(([snapshotId, candidateIds]) => [snapshotId, [...candidateIds]])),
      subtitleSnapshots: Object.fromEntries([...subtitleSnapshots].map(([snapshotId, candidates]) => [snapshotId, candidates])),
      transferredSubtitleFileIds: [...transferredSubtitleFileIds],
      markedCoverage: [...markedCoverage],
      targetVerified,
      stagingDiscarded,
      subtitleTransferred,
      organized: organized || null,
      organizedFolders: [...organizedFolders.entries()].map(([seasonNumber, result]) => ({ seasonNumber, result }))
    })
  } catch (error: any) {
    const message = error?.message || '未知错误'
    traceAgentDecision(run.id, 'exception', { message, stack: error?.stack })
    if (transferSubmitted) return { transferSubmitted }
    if (agentStopReason) return agentStopReason.startsWith('网盘账户或配额受阻') || active ? { unavailableReason: agentStopReason } : { noCoverageReason: agentStopReason }
    const unavailableReason = `Agent 选择服务不可用，未执行自动转存：${message}`
    await addMediaAcquisitionEvent(run.id, 'warning', 'select', unavailableReason)
    return { unavailableReason }
  }
  if (noCoverageReason) {
    traceAgentDecision(run.id, 'no_coverage', { reason: noCoverageReason })
    return { noCoverageReason }
  }
  if (transferSubmitted) {
    traceAgentDecision(run.id, 'transfer_submitted', { candidateId: active?.id })
    return { transferSubmitted }
  }
  if (agentStopReason) {
    traceAgentDecision(run.id, 'stopped', { reason: agentStopReason, activeCandidateId: active?.id })
    // A bounded/aborted organizing loop has already found a resource.  It is
    // never evidence that the title has no coverage; fail it visibly instead
    // of leaving an endlessly-runnable organizing task or mislabeling it as
    // “no resource”.
    if (agentStopReason.startsWith('网盘账户或配额受阻') || active) return { unavailableReason: agentStopReason }
    return { noCoverageReason: agentStopReason }
  }
  if (active) {
    traceAgentDecision(run.id, 'active_candidate', { candidateId: active.id, title: active.title, status: active.status })
    return { candidate: active }
  }
  traceAgentDecision(run.id, 'empty_result', { candidateCount: candidates.length })
  return { unavailableReason: 'Agent 未给出明确候选选择，未执行自动转存' }
}

function scoreCandidate(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate): number {
  return scoreMediaAcquisitionCandidate(run.target, candidate)
}

/** Match mediary-scout's registry boundary: untrusted provider payload stays outside the model context. */
function mediaAcquisitionAgentCandidateView(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate): Record<string, unknown> {
  return {
    id: candidate.id,
    kind: candidate.kind,
    sourcePlatform: candidate.sourcePlatform,
    title: candidate.title,
    priorityScore: scoreCandidate(run, candidate),
    coverage: assessMediaAcquisitionEpisodeCoverage(run.target, candidate)
  }
}

/** The sandbox sees the complete task candidate set, as mediary-scout does. */
function agentVisibleCandidates(run: MediaAcquisitionRunView): MediaAcquisitionCandidate[] {
  return selectableCandidates(run)
    .filter(candidate => candidate.status === 'pending')
    .sort((left, right) => scoreCandidate(run, right) - scoreCandidate(run, left))
}

/** Agent tools may observe the currently selected candidate, but never candidates from another task. */
function sandboxCandidates(run: MediaAcquisitionRunView, visible: MediaAcquisitionCandidate[]): MediaAcquisitionCandidate[] {
  const selected = selectableCandidates(run).filter(candidate => candidate.status === 'selected')
  return [...visible, ...selected.filter(candidate => !visible.some(item => item.id === candidate.id))]
}

function selectableCandidates(run: MediaAcquisitionRunView): MediaAcquisitionCandidate[] {
  const capability = getMediaAcquisitionCapability(run.target.targetPlatform)
  if (!capability) return []
  // Episode coverage and transparent release metadata are ranking evidence,
  // not a recall filter. The sandbox inspects the chosen package before any
  // transfer, which is the only reliable way to validate opaque shares.
  return run.candidates.filter(candidate => isMediaAcquisitionCandidateSupported(run.target.targetPlatform, capability, candidate))
}

function activeCandidate(run: MediaAcquisitionRunView): MediaAcquisitionCandidate | undefined {
  // “selected” is only a durable intent.  A crash can happen after selecting
  // but before claimCandidateTransfer; treating it as an active landing forces
  // the resumed Agent into organize-only tools and makes the run unrecoverable.
  return run.candidates.find(item => item.status === 'imported' || item.status === 'transferring')
}

function mediaAcquisitionSeasonTargets(target: MediaAcquisitionTarget): Array<{ seasonNumber: number; missingEpisodes: number[] }> {
  if (target.mediaType === 'movie') return []
  const targets = target.seasonTargets?.length ? target.seasonTargets : target.seasonNumber ? [{ seasonNumber: target.seasonNumber, missingEpisodes: target.missingEpisodes || [] }] : []
  return targets.map(item => ({ seasonNumber: item.seasonNumber, missingEpisodes: [...new Set(item.missingEpisodes || [])].filter(episode => Number.isInteger(episode) && episode > 0).sort((left, right) => left - right) })).sort((left, right) => left.seasonNumber - right.seasonNumber)
}

function buildTargetDirectoryCoverage(run: MediaAcquisitionRunView, mediaFiles: MediaAcquisitionFileSnapshot[], seasonNumber = run.target.seasonNumber || 1): { seasonNumber?: number; obtainedEpisodes: number[]; requestedMissingEpisodes: number[]; stillMissingRequestedEpisodes: number[]; coverageSummary: string } {
  if (!['tv', 'anime'].includes(run.target.mediaType)) {
    return { obtainedEpisodes: [], requestedMissingEpisodes: [], stillMissingRequestedEpisodes: [], coverageSummary: '' }
  }
  const obtainedEpisodes = extractObtainedEpisodeNumbers(mediaFiles.map(file => file.name), seasonNumber)
  const requestedMissingEpisodes = mediaAcquisitionSeasonTargets(run.target).find(item => item.seasonNumber === seasonNumber)?.missingEpisodes || []
  const obtainedSet = new Set(obtainedEpisodes)
  const stillMissingRequestedEpisodes = requestedMissingEpisodes.filter(episode => !obtainedSet.has(episode))
  const parts = [
    obtainedEpisodes.length ? `已识别 S${String(seasonNumber).padStart(2, '0')} E${obtainedEpisodes.join('、E')}` : '未识别到明确集号',
    requestedMissingEpisodes.length ? (stillMissingRequestedEpisodes.length ? `目标缺集仍缺 E${stillMissingRequestedEpisodes.join('、E')}` : '目标缺集已在目录中出现') : ''
  ].filter(Boolean)
  return { seasonNumber, obtainedEpisodes, requestedMissingEpisodes, stillMissingRequestedEpisodes, coverageSummary: parts.join('；') }
}

async function isMediaAcquisitionSandboxCoverageMet(run: MediaAcquisitionRunView): Promise<boolean> {
  if (run.target.mediaType === 'movie') {
    const leaf = await resolveMediaAcquisitionLeafFolder(run.target)
    if (!leaf) return false
    const entries = await listMediaAcquisitionDirectoryEntries(run.target, leaf.id, leaf.path)
    return entries.some(file => !file.isDir && VIDEO_EXT.test(file.name) && (file.size === undefined || file.size > 0))
  }
  const declaredTargets = mediaAcquisitionSeasonTargets(run.target)
  const targets = declaredTargets.filter(target => target.missingEpisodes.length)
  if (!targets.length) {
    const seasons = declaredTargets.length ? declaredTargets.map(target => target.seasonNumber) : [run.target.seasonNumber || 1]
    for (const season of seasons) {
      const files = await readMediaAcquisitionTargetSeason(run, season)
      if (!files.some(file => !file.isDir && VIDEO_EXT.test(file.name) && (file.size === undefined || file.size > 0))) return false
    }
    return true
  }
  for (const target of targets) {
    const leaf = await resolveMediaAcquisitionLeafFolder({ ...run.target, seasonNumber: target.seasonNumber })
    if (!leaf) return false
    const files = await listMediaAcquisitionDirectoryEntries(run.target, leaf.id, leaf.path)
    if (buildTargetDirectoryCoverage(run, files.filter(file => VIDEO_EXT.test(file.name)), target.seasonNumber).stillMissingRequestedEpisodes.length) return false
  }
  return true
}

async function verifyRun(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate): Promise<void> {
  const traceKey = `${run.id}:${candidate.id}`
  const process = await getOfflineProcess(run, candidate)
  if (process.error) {
    if (await finalizeIfProviderAlreadyLanded(run, candidate, process.error)) return
    offlineProgressTraceBucket.delete(traceKey)
    await addMediaAcquisitionEvent(run.id, 'warning', 'verify', `网盘任务查询失败：${process.error}`, { tool: 'offlineProcess', candidateId: candidate.id, platform: normalizeMediaAcquisitionPlatform(run.target.targetPlatform), progress: process.progress })
    if (isTransientMediaAcquisitionFailure(process.error)) await retryOrFail(run, candidate, process.error)
    else await failCandidateOrContinue(run, candidate, process.error)
    return
  }
  if (process.failed) {
    if (await finalizeIfProviderAlreadyLanded(run, candidate, process.message || '网盘离线任务失败')) return
    offlineProgressTraceBucket.delete(traceKey)
    await addMediaAcquisitionEvent(run.id, 'error', 'verify', `网盘任务返回失败状态：${process.message || '未提供失败原因'}`, { tool: 'offlineProcess', candidateId: candidate.id, platform: normalizeMediaAcquisitionPlatform(run.target.targetPlatform), progress: process.progress })
    await failCandidateOrContinue(run, candidate, process.message || '网盘离线任务失败')
    return
  }
  if (!process.completed) {
    const progressBucket = Math.floor(Math.max(0, Math.min(99, process.progress)) / 25)
    if (offlineProgressTraceBucket.get(traceKey) !== progressBucket) {
      offlineProgressTraceBucket.set(traceKey, progressBucket)
      await addMediaAcquisitionEvent(run.id, 'info', 'verify', `网盘任务进度 ${process.progress}%${process.message ? `：${process.message}` : ''}`, { tool: 'offlineProcess', candidateId: candidate.id, platform: normalizeMediaAcquisitionPlatform(run.target.targetPlatform), progress: process.progress })
    }
    await updateMediaAcquisitionExternalTaskProgress(run.id, candidate.id, process.progress, process.message || `网盘正在处理（${process.progress}%）`)
    return
  }

  offlineProgressTraceBucket.delete(traceKey)
  await updateMediaAcquisitionExternalTaskProgress(run.id, candidate.id, 100, '网盘任务已完成，正在核对入库目录')

  const evidence = await inspectLandedMediaFiles(run, candidate)
  if (!evidence.landed.length) {
    const nonMediaFiles = evidence.added.filter(file => (file.size === undefined || file.size > 0) && !VIDEO_EXT.test(file.name))
    await addMediaAcquisitionEvent(run.id, 'warning', 'verify', evidence.rejected.length ? `网盘任务已完成，但暂存目录 ${evidence.snapshotFolderId} 中新增内容均为样片、预告或花絮，已保留并尝试下一个候选。` : `网盘任务已完成，但暂存目录 ${evidence.snapshotFolderId} 本轮未发现新增的非 0 字节媒体文件，等待目录索引同步后重试。`, {
      candidateId: candidate.id,
      snapshotFolderId: evidence.snapshotFolderId,
      baselineCount: evidence.baseline.length,
      currentCount: evidence.current.length,
      addedCount: evidence.added.length,
      addedPreview: evidence.added.slice(0, 10).map(file => ({ name: file.name, size: file.size, path: file.path })),
      rejectedPreview: evidence.rejected.slice(0, 10).map(file => ({ name: file.name, size: file.size, path: file.path }))
    })
    if (nonMediaFiles.length) {
      const message = `网盘任务仅落盘了非媒体文件：${nonMediaFiles.slice(0, 3).map(file => file.name).join('、')}`
      await failCandidateOrContinue(run, candidate, message)
      return
    }
    const noLandingMessage = evidence.rejected.length ? '网盘任务仅落盘了样片、预告或花絮' : '网盘任务已完成，但入库目录暂未发现新增的非 0 字节媒体文件'
    if (isSubmissionRecoveryPending(run, candidate)) {
      await retryMediaAcquisitionCandidate(run.id, candidate.id, '转存提交结果未持久化，保留同一候选等待网盘落盘确认', 30_000)
      return
    }
    await retryOrFail(run, candidate, noLandingMessage)
    return
  }
  await addMediaAcquisitionEvent(run.id, 'info', 'verify', `已在暂存目录 ${evidence.snapshotFolderId} 确认新增 ${evidence.landed.length} 个媒体文件。`, {
    candidateId: candidate.id,
    snapshotFolderId: evidence.snapshotFolderId,
    baselineCount: evidence.baseline.length,
    currentCount: evidence.current.length,
    files: evidence.landed.slice(0, 10).map(file => ({ name: file.name, size: file.size, path: file.path })),
    rejectedPreview: evidence.rejected.slice(0, 10).map(file => ({ name: file.name, size: file.size, path: file.path }))
  })
  await settleSandboxResult(run, await runMediaAcquisitionSandbox(run, candidate, evidence.added))
}

function isSubmissionRecoveryPending(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate): boolean {
  if (candidate.externalTaskId || candidate.externalFileId) return false
  const intent = [...run.events].reverse().find(event => event.data?.candidateId === candidate.id && event.data?.submissionIntent === true)
  return !!intent && Date.now() - intent.createdAt < SUBMISSION_RECOVERY_GRACE_MS
}

/**
 * The provider task status is only advisory. Quark and several offline engines
 * can report a failed query after the file tree has already materialized.
 * Match mediary-scout's landing-first rule before retrying or selecting again.
 */
async function finalizeIfProviderAlreadyLanded(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate, providerMessage: string): Promise<boolean> {
  try {
    const evidence = await inspectLandedMediaFiles(run, candidate)
    if (!evidence.landed.length) return false
    await addMediaAcquisitionEvent(run.id, 'warning', 'verify', `网盘任务返回「${providerMessage}」，但暂存目录已确认新增 ${evidence.landed.length} 个媒体文件；以实际落盘为准继续入库。`, {
      tool: 'materializedLandingRecovery',
      candidateId: candidate.id,
      snapshotFolderId: evidence.snapshotFolderId,
      files: evidence.landed.slice(0, 10).map(file => ({ name: file.name, size: file.size, path: file.path })),
      providerMessage
    })
    await settleSandboxResult(run, await runMediaAcquisitionSandbox(run, candidate, evidence.added))
    return true
  } catch (error: any) {
    await addMediaAcquisitionEvent(run.id, 'warning', 'verify', `网盘任务异常后的落盘核验失败，继续按任务状态处理：${error?.message || '未知错误'}`, { tool: 'materializedLandingRecovery', candidateId: candidate.id, providerMessage })
    return false
  }
}

function expectedAgentCoverageCodes(run: MediaAcquisitionRunView): string[] {
  if (run.target.mediaType === 'movie') return ['MOVIE']
  return mediaAcquisitionSeasonTargets(run.target).flatMap(target => target.missingEpisodes.map(episode => `S${String(target.seasonNumber).padStart(2, '0')}E${String(episode).padStart(2, '0')}`))
}

function mediaAcquisitionSandboxStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function mediaAcquisitionSandboxSnapshots(value: unknown): Array<[string, string[]]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).flatMap(([snapshotId, candidateIds]) => {
    const ids = mediaAcquisitionSandboxStringArray(candidateIds)
    return snapshotId && ids.length ? [[snapshotId, ids]] : []
  })
}

function mediaAcquisitionSandboxSubtitleSnapshots(value: unknown): Array<[string, MediaAcquisitionSubtitleSnapshotCandidate[]]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).flatMap(([snapshotId, candidates]) => {
    if (!Array.isArray(candidates)) return []
    const valid = candidates.flatMap(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const value = candidate as Record<string, unknown>
      return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.language === 'string' && typeof value.score === 'number' ? [{ id: value.id, name: value.name, language: value.language, score: value.score }] : []
    })
    return snapshotId && valid.length ? [[snapshotId, valid]] : []
  })
}

async function readMediaAcquisitionTargetSeason(run: MediaAcquisitionRunView, season: number) {
  const leaf = await resolveMediaAcquisitionLeafFolder({ ...run.target, seasonNumber: season })
  return leaf ? listMediaAcquisitionDirectoryEntries(run.target, leaf.id, leaf.path) : []
}

function recordObservedTargetCoverage(run: MediaAcquisitionRunView, season: number, entries: MediaAcquisitionFileSnapshot[], coverage: Set<string>): void {
  const mediaFiles = entries.filter(file => VIDEO_EXT.test(file.name))
  if (run.target.mediaType === 'movie') {
    if (mediaFiles.some(file => file.size === undefined || file.size > 0)) coverage.add('MOVIE')
    return
  }
  const seasonCode = String(season).padStart(2, '0')
  buildTargetDirectoryCoverage(run, mediaFiles, season).obtainedEpisodes.forEach(episode => coverage.add(`S${seasonCode}E${String(episode).padStart(2, '0')}`))
}

function mediaAcquisitionSandboxOrganized(value: unknown): Awaited<ReturnType<typeof organizeLandedFiles>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const organized = value as Record<string, unknown>
  if (typeof organized.movedCount !== 'number' || !Array.isArray(organized.files) || typeof organized.fullyMoved !== 'boolean' || typeof organized.message !== 'string') return undefined
  return organized as Awaited<ReturnType<typeof organizeLandedFiles>>
}

function mediaAcquisitionSandboxOrganizedFolders(value: unknown): Array<{ seasonNumber: number; result: Awaited<ReturnType<typeof organizeLandedFiles>> }> {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const result = mediaAcquisitionSandboxOrganized(row.result)
    const seasonNumber = Number(row.seasonNumber)
    return result && Number.isInteger(seasonNumber) && seasonNumber > 0 ? [{ seasonNumber, result }] : []
  })
}

function hasAgentMarkedProgress(run: MediaAcquisitionRunView, marked: Set<string>): boolean {
  const required = expectedAgentCoverageCodes(run)
  if (!required.length) return marked.size > 0
  if (run.target.mediaType === 'movie') return marked.has('MOVIE')
  // 允许 Agent 在已真实落盘的部分集数整理完成后结束当前 sandbox。外层
  // completeOrganizedRun 会依据目标目录的实际覆盖决定继续下一候选或标记 partial；
  // 这里要求全部缺集会使“已经导入一部分”的剧集永远无法收敛。
  return required.some(code => marked.has(code))
}

async function moveLandedFilesToTarget(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate, fileIds: string[], seasonNumber = run.target.seasonNumber || 1): Promise<{ movedCount: number; files: MediaAcquisitionFileSnapshot[]; folderId?: string; folderPath?: string; fullyMoved: boolean; message: string }> {
  const evidence = await inspectLandedMediaFiles(run, candidate)
  const byId = new Map(evidence.added.map(file => [file.id, file]))
  const uniqueIds = [...new Set(fileIds)]
  const invalidIds = uniqueIds.filter(id => !byId.has(id))
  if (invalidIds.length) return { movedCount: 0, files: [], fullyMoved: false, message: `文件不在本候选暂存目录作用域：${invalidIds.join('、')}` }
  const files = uniqueIds.map(id => byId.get(id)!).filter(file => file.size === undefined || file.size > 0)
  if (!files.length) return { movedCount: 0, files, fullyMoved: false, message: '没有可移动的非 0 字节文件' }
  const leaf = await ensureMediaAcquisitionSeasonFolder(run.target, seasonNumber)
  const needMove = files.filter(file => file.parentId !== leaf.id)
  if (!needMove.length) return { movedCount: 0, files, folderId: leaf.id, folderPath: leaf.path, fullyMoved: true, message: '所选文件已在目标季目录' }
  const movedIds = new Set(await AliFileCmd.ApiMoveBatch(run.target.targetUserId, run.target.targetDriveId, needMove.map(file => file.id), run.target.targetDriveId, leaf.id))
  const movedFiles = files.map(file => movedIds.has(file.id) ? { ...file, parentId: leaf.id, path: `${leaf.path}/${file.name}`.replace(/\/+/, '/') } : file)
  const fullyMoved = movedIds.size === needMove.length
  const message = fullyMoved ? `Agent 已移动 ${movedIds.size} 个文件到 ${leaf.path}` : `Agent 仅移动 ${movedIds.size}/${needMove.length} 个文件，暂存目录保留等待修正`
  await addMediaAcquisitionEvent(run.id, fullyMoved ? 'info' : 'warning', 'organize', message, { tool: 'moveToSeason', candidateId: candidate.id, seasonNumber, folderId: leaf.id, fileIds: uniqueIds, movedIds: [...movedIds] })
  return { movedCount: movedIds.size, files: movedFiles, folderId: leaf.id, folderPath: leaf.path, fullyMoved, message }
}

async function completeOrganizedRun(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate, organized: Awaited<ReturnType<typeof organizeLandedFiles>>, stagingDiscarded: boolean, organizedFolders: Array<Awaited<ReturnType<typeof organizeLandedFiles>>> = [organized]): Promise<void> {
  if (!stagingDiscarded) await cleanupCandidateStagingDirectory(run, candidate)
  await beginMediaAcquisitionOrganizing(run.id, '正在扫描媒体库')
  const organizedFolderIds = new Set(organizedFolders.map(item => item.folderId).filter((id): id is string => !!id))
  const requestedSeasonNumbers = mediaAcquisitionSeasonTargets(run.target).map(item => item.seasonNumber).filter(Boolean)
  const seasonNumbers = run.target.mediaType === 'movie' ? [run.target.seasonNumber || 1] : [...new Set(requestedSeasonNumbers.length ? requestedSeasonNumbers : [run.target.seasonNumber || 1])]
  const resolvedFolderIds = new Set<string>()
  for (const seasonNumber of seasonNumbers) {
    const leaf = await resolveMediaAcquisitionLeafFolder({ ...run.target, seasonNumber })
    if (leaf?.id) resolvedFolderIds.add(leaf.id)
  }
  const scanFolderIds = resolvedFolderIds.size ? resolvedFolderIds : organizedFolderIds
  if (!scanFolderIds.size) throw new Error('媒体已落盘，但无法解析媒体库刮削目录')
  for (const folderId of scanFolderIds) await scanIntoMediaLibrary(run, folderId)
  const verifiedCoverage = await verifyImportedEpisodeCoverage(run)
  const tracking = await syncTracking(run)
  const remainingSeasonTargets = verifiedCoverage?.seasonTargets || (tracking?.missingEpisodes.length ? [{ seasonNumber: run.target.seasonNumber || 1, missingEpisodes: tracking.missingEpisodes }] : [])
  // A successful move is not completion. The terminal state is allowed only
  // after the same real-directory coverage gate that blocks another transfer.
  const coverageMet = await isMediaAcquisitionSandboxCoverageMet(run)
  if (!coverageMet || remainingSeasonTargets.some(target => target.missingEpisodes.length)) {
    const missingSummary = formatSeasonTargets(remainingSeasonTargets)
    const message = missingSummary ? `已导入部分内容，但仍缺 ${missingSummary}` : '已完成目录整理，但真实目标目录尚未满足本任务覆盖要求'
    if (hasRemainingCandidate(run, candidate.id)) {
      await continueMediaAcquisitionAfterPartial(run.id, candidate.id, remainingSeasonTargets, `${message}，Agent 将继续尝试下一个候选。`)
      return
    }
    await partialMediaAcquisitionCandidate(run.id, candidate.id, message)
    return
  }
  await completeMediaAcquisitionCandidate(run.id, candidate.id, '入库完成，已加入媒体库')
}

async function cleanupCandidateStagingDirectory(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate): Promise<boolean> {
  const currentRun = (await listMediaAcquisitionRuns(200)).find(item => item.id === run.id) || run
  const event = [...currentRun.events].reverse().find(item => item.data?.tool === 'staging' && item.data?.candidateId === candidate.id)
  const folderId = typeof event?.data?.folderId === 'string' ? event.data.folderId : ''
  const folderName = typeof event?.data?.folderName === 'string' ? event.data.folderName : '任务暂存目录'
  if (event?.data?.isFinalTarget) return true
  if (!folderId) return false
  try {
    const result = await discardMediaAcquisitionStagingTarget(currentRun.target, folderId)
    if (result.removed) {
      await addMediaAcquisitionEvent(run.id, 'info', 'organize', `已回收暂存目录 ${folderName}${result.remainingEntries ? `（含 ${result.remainingEntries} 项已整理残留）` : ''}。`, { tool: 'stagingCleanup', folderId, folderName, remainingEntries: result.remainingEntries })
      return true
    }
    await addMediaAcquisitionEvent(run.id, 'warning', 'organize', `暂存目录 ${folderName} 回收未完成，已保留供检查。`, { tool: 'stagingCleanup', folderId, folderName, remainingEntries: result.remainingEntries })
    return false
  } catch (error: any) {
    await addMediaAcquisitionEvent(run.id, 'warning', 'organize', `暂存目录清理失败，已保留目录：${error?.message || '未知错误'}`, { tool: 'stagingCleanup', folderId, folderName })
    return false
  }
}

/**
 * A non-movie staging directory belongs solely to one candidate. Once that
 * candidate is terminal, keep only files that were verified and moved to the
 * library; discard every other staging residue just like mediary-scout.
 */
async function discardTerminalCandidateStagingDirectory(run: MediaAcquisitionRunView, candidateId: string): Promise<void> {
  const event = [...run.events].reverse().find(item => item.data?.tool === 'staging' && item.data?.candidateId === candidateId)
  const folderId = typeof event?.data?.folderId === 'string' ? event.data.folderId : ''
  const folderName = typeof event?.data?.folderName === 'string' ? event.data.folderName : '任务暂存目录'
  if (event?.data?.isFinalTarget) return
  if (!folderId) return
  try {
    const result = await discardMediaAcquisitionStagingTarget(run.target, folderId)
    if (result.removed) await addMediaAcquisitionEvent(run.id, 'info', 'transfer', `候选结束后已回收暂存目录 ${folderName}${result.remainingEntries ? `（丢弃 ${result.remainingEntries} 项未入库残留）` : ''}。`, { tool: 'stagingCleanup', folderId, folderName, candidateId, remainingEntries: result.remainingEntries, removed: true })
    else await addMediaAcquisitionEvent(run.id, 'warning', 'transfer', `候选结束后暂存目录 ${folderName} 回收未完成，已保留供检查。`, { tool: 'stagingCleanup', folderId, folderName, candidateId, remainingEntries: result.remainingEntries, removed: false })
  } catch (error: any) {
    await addMediaAcquisitionEvent(run.id, 'warning', 'transfer', `候选结束后的暂存目录清理失败，已保留目录：${error?.message || '未知错误'}`, { tool: 'stagingCleanup', folderId, folderName, candidateId })
  }
}

async function cleanupTerminalMediaAcquisitionStagingDirectories(): Promise<void> {
  const runs = (await listMediaAcquisitionRuns(200)).filter(run => TERMINAL_RUN_STATUSES.has(run.status) && run.events.some(event => event.data?.tool === 'staging'))
  for (const run of runs) {
    const cleanedFolderIds = new Set(run.events.filter(event => event.data?.tool === 'stagingCleanup' || event.data?.tool === 'terminalStagingCleanup').map(event => typeof event.data?.folderId === 'string' ? event.data.folderId : '').filter(Boolean))
    const stagingDirectories = new Map<string, { folderName: string; candidateId?: string }>()
    for (const event of run.events) {
      if (event.data?.tool !== 'staging' || typeof event.data.folderId !== 'string') continue
      if (event.data?.isFinalTarget) continue
      if (cleanedFolderIds.has(event.data.folderId)) continue
      stagingDirectories.set(event.data.folderId, { folderName: typeof event.data.folderName === 'string' ? event.data.folderName : '任务暂存目录', candidateId: typeof event.data.candidateId === 'string' ? event.data.candidateId : undefined })
    }
    for (const [folderId, staging] of stagingDirectories) {
      try {
        const result = await discardMediaAcquisitionStagingTarget(run.target, folderId)
        await addMediaAcquisitionEvent(run.id, result.removed ? 'info' : 'warning', 'organize', result.removed ? `已回收遗留暂存目录 ${staging.folderName}${result.remainingEntries ? `（丢弃 ${result.remainingEntries} 项未入库残留）` : ''}。` : `暂存目录 ${staging.folderName} 回收未完成，已保留供检查。`, { tool: 'terminalStagingCleanup', folderId, folderName: staging.folderName, candidateId: staging.candidateId, remainingEntries: result.remainingEntries, removed: result.removed })
      } catch (error: any) {
        await addMediaAcquisitionEvent(run.id, 'warning', 'organize', `遗留暂存目录清理失败，已保留目录：${error?.message || '未知错误'}`, { tool: 'terminalStagingCleanup', folderId, folderName: staging.folderName, candidateId: staging.candidateId })
      }
    }
  }
}

async function verifyImportedEpisodeCoverage(run: MediaAcquisitionRunView): Promise<{ seasonTargets: MediaAcquisitionSeasonTarget[]; coverages: Array<ReturnType<typeof buildTargetDirectoryCoverage>> } | undefined> {
  const requested = mediaAcquisitionSeasonTargets(run.target).filter(target => target.missingEpisodes.length)
  if (!['missing', 'patrol'].includes(run.kind) || !['tv', 'anime'].includes(run.target.mediaType) || !requested.length) return undefined
  try {
    const coverages = []
    for (const target of requested) {
      const leaf = await resolveMediaAcquisitionLeafFolder({ ...run.target, seasonNumber: target.seasonNumber })
      const files = leaf ? await listMediaAcquisitionDirectoryEntries(run.target, leaf.id, leaf.path) : []
      coverages.push(buildTargetDirectoryCoverage(run, files.filter(file => !file.isDir && VIDEO_EXT.test(file.name)), target.seasonNumber))
    }
    const seasonTargets = coverages.map(coverage => ({ seasonNumber: coverage.seasonNumber || 1, missingEpisodes: coverage.stillMissingRequestedEpisodes }))
    const remaining = seasonTargets.filter(target => target.missingEpisodes.length)
    await addMediaAcquisitionEvent(run.id, remaining.length ? 'warning' : 'info', 'verify', remaining.length ? `落盘集数核验：仍缺 ${formatSeasonTargets(remaining)}。` : `落盘集数核验通过：已覆盖 ${formatSeasonTargets(requested)}。`, { tool: 'postImportEpisodeCoverage', coverages, seasonTargets })
    return { seasonTargets, coverages }
  } catch (error: any) {
    await addMediaAcquisitionEvent(run.id, 'warning', 'verify', `落盘集数核验失败，继续使用追更同步结果：${error?.message || '未知错误'}`, { tool: 'postImportEpisodeCoverage' })
    return undefined
  }
}

function formatSeasonTargets(targets: Array<Pick<MediaAcquisitionSeasonTarget, 'seasonNumber' | 'missingEpisodes'>>): string {
  return targets.filter(target => target.missingEpisodes.length).map(target => `S${String(target.seasonNumber).padStart(2, '0')} E${target.missingEpisodes.join('、E')}`).join('；')
}

async function verifyOrganizedTarget(run: MediaAcquisitionRunView, folderId: string | undefined, files: MediaAcquisitionFileSnapshot[]): Promise<boolean> {
  if (!folderId || !files.length) return false
  try {
    const entries = (await listMediaAcquisitionDirectoryEntries(run.target, folderId)).filter(entry => !entry.isDir)
    const entryIds = new Set(entries.map(entry => entry.id))
    const missing = files.filter(file => !entryIds.has(file.id))
    if (missing.length) {
      await addMediaAcquisitionEvent(run.id, 'warning', 'verify', `目标目录尚缺 ${missing.length} 个刚整理文件，暂不清理暂存目录。`, { tool: 'targetLandingGuard', folderId, missing: missing.map(file => ({ id: file.id, name: file.name, size: file.size })) })
      return false
    }
    await addMediaAcquisitionEvent(run.id, 'info', 'verify', `目标目录已确认 ${files.length} 个整理文件，允许回收暂存目录。`, { tool: 'targetLandingGuard', folderId, fileCount: files.length })
    return true
  } catch (error: any) {
    await addMediaAcquisitionEvent(run.id, 'warning', 'verify', `目标目录复核失败，暂不清理暂存目录：${error?.message || '未知错误'}`, { tool: 'targetLandingGuard', folderId })
    return false
  }
}

async function organizeLandedFiles(run: MediaAcquisitionRunView, landedFiles: MediaAcquisitionFileSnapshot[]): Promise<{ movedCount: number; files: MediaAcquisitionFileSnapshot[]; folderId?: string; folderPath?: string; fullyMoved: boolean; message: string }> {
  if (!landedFiles.length) return { movedCount: 0, files: landedFiles, fullyMoved: false, message: '暂存目录没有可整理文件' }
  try {
    const result = await organizeMediaAcquisitionFiles(run, landedFiles)
    await addMediaAcquisitionEvent(run.id, result.movedCount ? 'info' : 'warning', 'organize', result.message, { movedCount: result.movedCount, folderId: result.folderId, folderPath: result.folderPath })
    await auditDuplicateEpisodes(run, result.folderId, result.folderPath)
    return { movedCount: result.movedCount, files: result.files, folderId: result.folderId, folderPath: result.folderPath, fullyMoved: result.fullyMoved, message: result.message }
  } catch (error: any) {
    await addMediaAcquisitionEvent(run.id, 'warning', 'organize', `入库整理失败，已继续扫描原目录：${error?.message || '未知错误'}`)
    return { movedCount: 0, files: landedFiles, fullyMoved: false, message: `入库整理失败：${error?.message || '未知错误'}` }
  }
}

async function auditDuplicateEpisodes(run: MediaAcquisitionRunView, folderId?: string, folderPath = ''): Promise<void> {
  if (!folderId || !['tv', 'anime'].includes(run.target.mediaType)) return
  try {
    const files = (await listMediaAcquisitionDirectoryEntries(run.target, folderId, folderPath)).filter(entry => !entry.isDir)
    const groups = findMediaAcquisitionDuplicateEpisodes(run.target, files)
    if (!groups.length) return
    await addMediaAcquisitionEvent(run.id, 'warning', 'organize', `发现 ${groups.length} 组重复集数，已按 mediary-scout 规则生成保留大文件建议，未自动删除。`, {
      tool: 'duplicateEpisodeAudit',
      groups: groups.map(group => ({
        episode: group.episode,
        keep: { id: group.keep.id, name: group.keep.name, size: group.keep.size, path: group.keep.path },
        deleteCandidates: group.deleteCandidates.map(file => ({ id: file.id, name: file.name, size: file.size, path: file.path }))
      }))
    })
  } catch (error: any) {
    await addMediaAcquisitionEvent(run.id, 'warning', 'organize', `重复集数审计失败，已跳过：${error?.message || '未知错误'}`, { tool: 'duplicateEpisodeAudit' })
  }
}

function hasRemainingCandidate(run: MediaAcquisitionRunView, candidateId: string): boolean {
  return selectableCandidates(run).some(candidate => candidate.id !== candidateId && (candidate.status === 'pending' || candidate.status === 'rejected'))
}

async function getOfflineProcess(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate): Promise<{ progress: number; completed: boolean; failed: boolean; message?: string; error?: string }> {
  return getMediaAcquisitionProviderTransferStatus(run.id, candidate.externalTaskId, candidate.externalFileId)
}

async function inspectLandedMediaFiles(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate): Promise<{ baseline: MediaAcquisitionFileSnapshot[]; current: MediaAcquisitionFileSnapshot[]; added: MediaAcquisitionFileSnapshot[]; landed: MediaAcquisitionFileSnapshot[]; rejected: MediaAcquisitionFileSnapshot[]; snapshotFolderId: string }> {
  const currentRun = (await listMediaAcquisitionRuns(200)).find(item => item.id === run.id) || run
  const stagingEvent = [...currentRun.events].reverse().find(item => item.data?.tool === 'staging' && item.data?.candidateId === candidate.id)
  const stagingFolderId = typeof stagingEvent?.data?.folderId === 'string' ? stagingEvent.data.folderId : ''
  const snapshotTarget = stagingFolderId
    ? { ...currentRun.target, targetParentFileId: stagingFolderId }
    : currentRun.events.some(item => item.data?.tool === 'pikpakRootImport' && item.data?.candidateId === candidate.id)
      ? { ...currentRun.target, targetParentFileId: 'pikpak_root' }
      : currentRun.target
  const [baseline, current] = await Promise.all([
    getMediaAcquisitionCandidateBaseline(run.id, candidate.id),
    listMediaAcquisitionTargetFiles(snapshotTarget)
  ])
  const added = baseline.length ? newMediaAcquisitionFiles(baseline, current) : current
  const videoFiles = added.filter(file => VIDEO_EXT.test(file.name) && (file.size === undefined || file.size > 0))
  const landed = videoFiles.filter(file => isMediaAcquisitionPrimaryVideoName(file.name))
  const rejected = videoFiles.filter(file => !isMediaAcquisitionPrimaryVideoName(file.name))
  return { baseline, current, added, landed, rejected, snapshotFolderId: snapshotTarget.targetParentFileId }
}

async function listTargetNames(target: MediaAcquisitionTarget): Promise<string[]> {
  return (await listMediaAcquisitionTargetFiles(target)).map(file => file.name)
}

async function syncTracking(run: MediaAcquisitionRunView): Promise<MediaAcquisitionTrackingItem | undefined> {
  if (!run.target.trackingEnabled || !run.target.tmdbId || !['tv', 'anime'].includes(run.target.mediaType)) return undefined
  try {
    const seasonNumber = run.target.seasonNumber || 1
    const existing = (await listMediaAcquisitionTracking(100)).find(item => item.targetId === run.target.id && item.seasonNumber === seasonNumber)
    const updated = await refreshTracking(run.target, existing)
    await addMediaAcquisitionEvent(run.id, 'info', 'organize', updated.totalEpisodes ? `追更已启用：第 ${seasonNumber} 季已获取 ${updated.obtainedEpisodes}/${updated.latestAiredEpisode}/${updated.totalEpisodes} 集（获取/已播/总集）。` : '追更已启用，等待 TMDB 季信息同步。')
    return updated
  } catch (error: any) {
    await addMediaAcquisitionEvent(run.id, 'warning', 'organize', `追更信息同步失败，已跳过：${error?.message || '未知错误'}`)
    return undefined
  }
}

async function refreshTracking(target: MediaAcquisitionTarget, existing: MediaAcquisitionTrackingItem | undefined, now = Date.now(), knownNames?: string[]): Promise<MediaAcquisitionTrackingItem> {
  if (!target.tmdbId) throw new Error('缺少 TMDB ID')
  const base = Config.BOXPLAYER_API_URL.replace(/\/+$/, '')
  const seasonNumber = existing?.seasonNumber || target.seasonNumber || 1
  const [tvResponse, seasonResponse] = await Promise.all([
    fetch(`${base}/api/tmdb/proxy/tv/${target.tmdbId}?language=zh-CN`),
    fetch(`${base}/api/tmdb/proxy/tv/${target.tmdbId}/season/${seasonNumber}?language=zh-CN`)
  ])
  if (!tvResponse.ok) throw new Error(`TMDB 剧集信息请求失败（${tvResponse.status}）`)
  const tv = await tvResponse.json()
  const season = seasonResponse.ok ? await seasonResponse.json() : undefined
  const metadata = readTrackingMetadata(tv, season, seasonNumber, now)
  const obtained = extractObtainedEpisodeNumbers(knownNames || await listTargetNames(target), seasonNumber)
  const snapshot = buildTrackingSnapshot(existing, metadata, obtained)
  const nextCheckAt = snapshot.status === 'tracking' ? nextPatrolAt(useSettingStore().mediaAcquisitionPatrolTimes, now) : undefined
  const updated = await upsertMediaAcquisitionTracking({
    targetId: target.id,
    seasonNumber,
    totalEpisodes: snapshot.totalEpisodes,
    latestAiredEpisode: snapshot.latestAiredEpisode,
    obtainedEpisodeNumbers: snapshot.obtainedEpisodeNumbers,
    missingEpisodes: snapshot.missingEpisodes,
    status: snapshot.status,
    nextCheckAt
  })
  if (!updated) throw new Error('追更记录不存在')
  return updated
}

async function scanIntoMediaLibrary(run: MediaAcquisitionRunView, folderId?: string): Promise<void> {
  const folder: IAliGetFileModel = {
    __v_skip: true,
    drive_id: run.target.targetDriveId,
    file_id: folderId || run.target.targetParentFileId,
    parent_file_id: '',
    name: run.target.title,
    isDir: true,
    category: '',
    icon: 'iconfile-folder',
    size: 0,
    sizeStr: '',
    time: Date.now(),
    timeStr: '',
    namesearch: run.target.title,
    ext: '',
    mime_type: '',
    mime_extension: '',
    starred: false,
    punish_flag: 0,
    thumbnail: '',
    description: ''
  }
  // The acquisition target already identifies the exact account that received
  // the files. Do not let MediaScanner infer the account from the current UI
  // drive, otherwise a second Quark account (or a different selected drive)
  // can make the post-import scrape read the wrong directory.
  ;(folder as any).user_id = run.target.targetUserId
  await MediaScanner.getInstance().scanFolder(folder, run.target.targetDriveId, {
    incremental: false,
    silent: true,
    // A task target is the authoritative media identity for every media type.
    // Passing the TMDB id through avoids a second title search for imported TV
    // and anime releases whose filenames only contain scene/release metadata.
    mediaHint: run.target.tmdbId ? { tmdbId: run.target.tmdbId, title: run.target.title, year: run.target.year, mediaType: run.target.mediaType } : undefined
  })
  await addMediaAcquisitionEvent(run.id, 'info', 'organize', '媒体库扫描已完成。', { tool: 'mediaLibraryScan', folderId: folder.file_id, scanStrategy: run.target.tmdbId ? 'target-hint-v3' : 'default-v2', scanQueueVersion: 2 })
}

async function repairCompletedMediaLibraryIndexes(): Promise<void> {
  if (completedMediaLibraryRepairStarted) return
  completedMediaLibraryRepairStarted = true
  try {
    const runs = await listMediaAcquisitionRuns(200)
    for (const run of runs.filter(item => item.status === 'completed')) {
      if (run.events.some(event => event.data?.tool === 'mediaLibraryScan' && event.data?.scanQueueVersion === 2)) continue
      const candidate = run.candidates.find(item => item.status === 'imported')
      if (!candidate) continue
      const targetFolderId = [...run.events].reverse().find(event => {
        const tool = event.data?.tool
        return ['targetLandingGuard', 'moveToSeason', 'flattenMovie'].includes(typeof tool === 'string' ? tool : '') && typeof event.data?.folderId === 'string'
      })?.data?.folderId
      await scanIntoMediaLibrary(run, typeof targetFolderId === 'string' ? targetFolderId : undefined)
    }
  } catch (error: any) {
    console.warn('[MediaAcquisition] completed media-library repair failed', error?.message || error)
  }
}

async function retryOrFail(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate | undefined, message: string): Promise<void> {
  if (!candidate) {
    await markMediaAcquisitionNoCoverage(run.id, message)
    return
  }
  // The scheduler records provider facts, but it must not keep replaying the
  // same candidate. A resumed sandbox Agent sees this failure in task history
  // and decides whether another observed candidate is worth attempting.
  await failCandidateOrContinue(run, candidate, message)
}

async function failCandidateOrContinue(run: MediaAcquisitionRunView, candidate: MediaAcquisitionCandidate, message: string): Promise<void> {
  const updated = await failMediaAcquisitionCandidate(run.id, candidate.id, message, canTryNextMediaAcquisitionCandidate(run.target, run.candidates, candidate.id, message))
  if (updated) await discardTerminalCandidateStagingDirectory(updated, candidate.id)
}
