import { app, BrowserWindow } from 'electron'
import { createHash } from 'crypto'
import { join } from 'path'
import type { LanguageModel } from 'ai'
import { DEFAULT_ACCOUNT_ID } from '@mediary/domain'
import type { ResourceProvider, StorageExecutor } from '@mediary/ports'
import { createSqliteWorkflowRepository, type SqliteWorkflowRepository } from '@mediary/sqlite'
import { runQueuedMovieAcquisition, runQueuedSeriesInitialization, runQueuedType2Workflow, runScheduledType3Monitoring, type AccountWorkerContext, type ResolveAccountWorkerContext, type SeasonMetadataSync } from '@mediary/worker'
import { prepareTrackingTarget } from '@mediary/tmdb-provider'
import type { MediaryDriveTarget, MediaryRuntimeConfig } from '@shared/types/mediary'
import { normalizeBoxPlayerPlatform, providerFolderId } from './driveClients'
import { createMediaryMetadataProvider, createMediaryModel, createMediaryResourceProvider } from './resources'
import { requestMediaryRuntimeConfig } from './runtimeConfig'
import { createStorageExecutor, storageBrandForPlatform } from './storageExecutors'

const POLL_MS = 3000
const MAX_DRAINS_PER_TICK = 20
const TARGET_SETTING_PREFIX = 'boxplayer_drive_target:'
export const SWEEP_TIMES_SETTING = 'daily_sweep_times'
const SWEEP_CLAIMS_SETTING = 'boxplayer_sweep_claims'
export const LAST_SWEEP_SETTING = 'boxplayer_last_sweep_completed_at'
const DEFAULT_SWEEP_TIME = '06:00'
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

let repository: SqliteWorkflowRepository | undefined
const STARTUP_DELAY_MS = 15_000
let startupTimer: ReturnType<typeof setTimeout> | undefined
let timer: ReturnType<typeof setInterval> | undefined
let ticking = false

export function getMediaryRepository(): SqliteWorkflowRepository {
  repository ??= createSqliteWorkflowRepository({ path: join(app.getPath('userData'), 'mediary.db') })
  return repository
}

/** Folder ids are normalized so the same folder chosen twice maps to one connected storage. */
export function driveTargetId(target: Pick<MediaryDriveTarget, 'platform' | 'userId' | 'driveId' | 'folderId'>): string {
  const platform = normalizeBoxPlayerPlatform(target.platform)
  const key = [platform, target.userId, target.driveId, providerFolderId(platform, target.folderId)].join('|')
  return `bp_${createHash('sha256').update(key).digest('hex').slice(0, 20)}`
}

export async function saveDriveTarget(input: Omit<MediaryDriveTarget, 'id' | 'createdAt'>): Promise<MediaryDriveTarget> {
  const id = driveTargetId(input)
  const existing = await getDriveTarget(id)
  const target: MediaryDriveTarget = { ...input, platform: normalizeBoxPlayerPlatform(input.platform), id, createdAt: existing?.createdAt || Date.now() }
  await getMediaryRepository().setSetting(`${TARGET_SETTING_PREFIX}${id}`, JSON.stringify(target))
  return target
}

export async function getDriveTarget(id: string | null | undefined): Promise<MediaryDriveTarget | null> {
  if (!id) return null
  const raw = await getMediaryRepository().getSetting(`${TARGET_SETTING_PREFIX}${id}`)
  try {
    return raw ? JSON.parse(raw) as MediaryDriveTarget : null
  } catch {
    return null
  }
}

export function startMediaryHost(): void {
  if (timer || startupTimer) return
  // Keep app startup free of SQLite and agent work; resume queued runs once the window has settled.
  startupTimer = setTimeout(() => {
    startupTimer = undefined
    void getMediaryRepository().requeueRunningWorkflowRuns().catch(error => console.error('[mediary] orphan recovery failed', error))
    timer = setInterval(() => { void tick() }, POLL_MS)
    void tick()
  }, STARTUP_DELAY_MS)
}

export function stopMediaryHost(): void {
  if (startupTimer) clearTimeout(startupTimer)
  startupTimer = undefined
  if (timer) clearInterval(timer)
  timer = undefined
  repository?.close()
  repository = undefined
}

/** Run the queue now instead of on the next poll (after the user starts a task). */
export function wakeMediaryHost(): void {
  void tick()
}

/** Tell open windows that task state changed so their lists refresh. */
export function notifyMediaryChanged(workflowRunId?: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('mediary:changed', { workflowRunId })
  }
}

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    // Without a window there is no model config to hand the agent; queued runs simply wait.
    const config = await requestMediaryRuntimeConfig()
    if (!config) return
    const deps = workerDeps(config)
    for (let index = 0; index < MAX_DRAINS_PER_TICK; index++) {
      const result = await runNextQueued(deps)
      if (result.status === 'idle') break
      notifyMediaryChanged('workflowRunId' in result ? result.workflowRunId : undefined)
    }
    await runDueSweep(deps, config)
  } catch (error) {
    console.error('[mediary] worker tick failed', error)
  } finally {
    ticking = false
  }
}

interface WorkerDeps {
  repository: SqliteWorkflowRepository
  storage: StorageExecutor
  resourceProvider: ResourceProvider
  model: LanguageModel
  resolveAccountContext: ResolveAccountWorkerContext
}

function workerDeps(config: MediaryRuntimeConfig): WorkerDeps {
  return {
    repository: getMediaryRepository(),
    // Every run belongs to a drive target; these only satisfy the worker's signature.
    storage: unscopedStorage,
    resourceProvider: { search: async () => { throw new Error('媒体获取任务缺少目标网盘') } },
    model: lazyModel(config),
    resolveAccountContext: createAccountContextResolver(config)
  }
}

async function runNextQueued(deps: WorkerDeps): Promise<{ status: string; workflowRunId?: string }> {
  const type2 = await runQueuedType2Workflow({ ...deps, storageParentDirectoryId: '' })
  if (type2.status !== 'idle') return type2
  const series = await runQueuedSeriesInitialization({ ...deps, storageParentDirectoryId: '' })
  if (series.status !== 'idle') return series
  return runQueuedMovieAcquisition({ ...deps, moviesParentDirectoryId: '' })
}

/** Each run's drive target supplies its executor, sources, landing folder and preferences. */
export function createAccountContextResolver(config: MediaryRuntimeConfig): ResolveAccountWorkerContext {
  return async (_accountId, connectedStorageId): Promise<AccountWorkerContext> => {
    const target = await getDriveTarget(connectedStorageId)
    if (!target) return { storage: unscopedStorage }
    const brand = storageBrandForPlatform(target.platform)
    const folderId = providerFolderId(target.platform, target.folderId)
    const language = vendorLanguage(target.preferredLanguage)
    const quality = vendorQuality(target.preferredQuality)
    return {
      storage: createStorageExecutor(target),
      resourceProvider: createMediaryResourceProvider(config, brand),
      storageProvider: brand,
      storageParentDirectoryId: folderId,
      animeStorageParentDirectoryId: folderId,
      moviesParentDirectoryId: folderId,
      ...(language ? { preferredLanguage: language } : {}),
      ...(quality ? { qualityPreference: quality } : {})
    }
  }
}

/** mediary reads the subtitle preference as free text and looks for "中". */
export function vendorLanguage(value: string | undefined): string | undefined {
  const text = String(value || '').trim().toLowerCase()
  if (!text || text === 'auto') return undefined
  if (text.startsWith('zh') || text.includes('中') || text === 'chinese') return '中文字幕'
  return value
}

export function vendorQuality(value: string | undefined): 'high' | 'medium' | undefined {
  const text = String(value || '').trim().toLowerCase()
  if (!text || text === 'auto') return undefined
  return /2160|4k|uhd|high|remux/.test(text) ? 'high' : 'medium'
}

/**
 * The daily patrol, mirroring mediary's web host: each configured Beijing-time slot runs at
 * most once per day, a late start catches up once, and a failed sweep releases its claim.
 */
async function runDueSweep(deps: WorkerDeps, config: MediaryRuntimeConfig, force = false): Promise<boolean> {
  const repo = deps.repository
  const { date, hhmm } = beijingDateTime()
  let priorClaims: string[] = []
  let claimed: string[] = []
  if (!force) {
    const times = await sweepTimes()
    priorClaims = await readSweepClaims(date)
    claimed = times.filter(slot => hhmm >= slot && !priorClaims.includes(slot))
    if (!claimed.length) return false
    await repo.setSetting(SWEEP_CLAIMS_SETTING, JSON.stringify({ date, slots: [...new Set([...priorClaims, ...claimed])].sort() }))
  }
  try {
    await runScheduledType3Monitoring({ ...deps, storageParentDirectoryId: '', moviesParentDirectoryId: '', staleActiveRunTimeoutMs: 30 * 60 * 1000, syncSeasonMetadata: seasonMetadataSync(config) })
    await repo.setSetting(LAST_SWEEP_SETTING, new Date().toISOString())
    notifyMediaryChanged()
    return true
  } catch (error) {
    if (claimed.length) await repo.setSetting(SWEEP_CLAIMS_SETTING, JSON.stringify({ date, slots: priorClaims })).catch(() => undefined)
    throw error
  }
}

/** Run a patrol right now (the 追更 "立即巡检" button); scheduled slots are left untouched. */
export async function runMediaryPatrolNow(): Promise<void> {
  const config = await requestMediaryRuntimeConfig()
  if (!config) throw new Error('请保持 BoxPlayer 窗口打开后再巡检')
  await runDueSweep(workerDeps(config), config, true)
}

function seasonMetadataSync(config: MediaryRuntimeConfig): SeasonMetadataSync {
  const metadataProvider = createMediaryMetadataProvider(config)
  return async ({ tmdbId, seasonNumber }) => {
    const target = await prepareTrackingTarget({ tmdbId, mediaType: 'tv', seasonNumber, qualityPreference: '4K', metadataProvider })
    return { latestAiredEpisode: target.season.latestAiredEpisode, totalEpisodes: target.season.totalEpisodes }
  }
}

export async function sweepTimes(): Promise<string[]> {
  const raw = (await getMediaryRepository().getSetting(SWEEP_TIMES_SETTING))?.trim()
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) {
      const valid = [...new Set(parsed.filter((slot): slot is string => typeof slot === 'string' && HHMM.test(slot)))].sort().slice(0, 6)
      if (valid.length) return valid
    }
  } catch {}
  return [DEFAULT_SWEEP_TIME]
}

async function readSweepClaims(today: string): Promise<string[]> {
  const raw = (await getMediaryRepository().getSetting(SWEEP_CLAIMS_SETTING))?.trim()
  try {
    const parsed = raw ? JSON.parse(raw) as { date?: string; slots?: unknown[] } : null
    if (parsed?.date === today && Array.isArray(parsed.slots)) return parsed.slots.filter((slot): slot is string => typeof slot === 'string' && HHMM.test(slot))
  } catch {}
  return []
}

/** Epoch ms of the next daily patrol slot (slots are Beijing wall-clock times). */
export function nextSweepAt(times: string[], now = new Date()): number {
  const { hhmm } = beijingDateTime(now)
  const slot = times.find(time => time > hhmm) || times[0]
  const [hour, minute] = slot.split(':').map(Number)
  const beijingNow = new Date(now.getTime() + 8 * 3600_000)
  const next = Date.UTC(beijingNow.getUTCFullYear(), beijingNow.getUTCMonth(), beijingNow.getUTCDate(), hour, minute) - 8 * 3600_000
  return next > now.getTime() ? next : next + 24 * 3600_000
}

export function beijingDateTime(now = new Date()): { date: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hhmm: `${get('hour')}:${get('minute')}` }
}

/** Build the model only when an agent actually runs, so a missing model fails that run with a clear message. */
function lazyModel(config: MediaryRuntimeConfig): LanguageModel {
  let model: LanguageModel | undefined
  const resolve = () => model ??= createMediaryModel(config)
  return new Proxy({} as Exclude<LanguageModel, string>, {
    get(_target, property) {
      if (property === 'then') return undefined
      const value = (resolve() as unknown as Record<string | symbol, unknown>)[property]
      return typeof value === 'function' ? value.bind(resolve()) : value
    }
  })
}

const unscopedStorage: StorageExecutor = new Proxy({} as StorageExecutor, {
  get(_target, property) {
    if (property === 'then' || property === 'transferSubtitleUrl' || property === 'apiCallCount' || property === 'apiCallBudget') return undefined
    return async () => { throw new Error('媒体获取任务缺少目标网盘，请重新发起获取') }
  }
})

export { DEFAULT_ACCOUNT_ID }
