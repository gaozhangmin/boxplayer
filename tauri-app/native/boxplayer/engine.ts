import type {LanguageModel} from 'ai'
import {DEFAULT_ACCOUNT_ID} from './upstream/domain'
import type {ResourceProvider,StorageExecutor} from './upstream/ports'
import type {SqliteWorkflowRepository} from './upstream/sqlite'
import {runQueuedMovieAcquisition,runQueuedSeriesInitialization,runQueuedType2Workflow,runScheduledType3Monitoring,type AccountWorkerContext,type ResolveAccountWorkerContext,type SeasonMetadataSync} from './upstream/worker'
import {prepareTrackingTarget} from './upstream/tmdb-provider'
import type {BoxPlayerDriveTarget,BoxPlayerRuntimeConfig} from './boxplayer'
import {normalizeBoxPlayerPlatform,providerFolderId} from './driveIdentity'
import {createBoxPlayerMetadataProvider,createBoxPlayerModel,createBoxPlayerResourceProvider} from './resources'
import {requestBoxPlayerRuntimeConfig,createStorageExecutor} from './runtimeBindings'
import {storageBrandForPlatform} from './storagePolicy'
import {getBoxPlayerRepository,getDriveTarget,LAST_SWEEP_SETTING,notifyBoxPlayerChanged,sweepTimes,beijingDateTime} from './host'
const POLL_MS=3000
const MAX_DRAINS_PER_TICK=20
const SWEEP_CLAIMS_SETTING='boxplayer_sweep_claims'
const HHMM=/^([01]\d|2[0-3]):[0-5]\d$/
const STARTUP_DELAY_MS=15_000
let startupTimer:ReturnType<typeof setTimeout>|undefined
let timer:ReturnType<typeof setInterval>|undefined
let ticking=false
export function startBoxPlayerHost(): void {
  if (timer || startupTimer) return
  // Keep app startup free of SQLite and agent work; resume queued runs once the window has settled.
  startupTimer = setTimeout(() => {
    startupTimer = undefined
    timer = setInterval(() => { void tick() }, POLL_MS)
    void tick()
  }, STARTUP_DELAY_MS)
}

export function stopBoxPlayerHost(): void {
  if (startupTimer) clearTimeout(startupTimer)
  startupTimer = undefined
  if (timer) clearInterval(timer)
  timer = undefined
}

/** Run the queue now instead of on the next poll (after the user starts a task). */
export function wakeBoxPlayerHost(): void {
  void tick()
}

export async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    // Without a window there is no model config to hand the agent; queued runs simply wait.
    const config = await requestBoxPlayerRuntimeConfig()
    if (!config) return
    const deps = workerDeps(config)
    for (let index = 0; index < MAX_DRAINS_PER_TICK; index++) {
      const result = await runNextQueued(deps)
      if (result.status === 'idle') break
      notifyBoxPlayerChanged('workflowRunId' in result ? result.workflowRunId : undefined)
    }
    await runDueSweep(deps, config)
  } catch (error) {
    console.error('[boxplayer] worker tick failed', error)
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

function workerDeps(config: BoxPlayerRuntimeConfig): WorkerDeps {
  return {
    repository: getBoxPlayerRepository(),
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
export function createAccountContextResolver(config: BoxPlayerRuntimeConfig): ResolveAccountWorkerContext {
  return async (_accountId, connectedStorageId): Promise<AccountWorkerContext> => {
    const target = await getDriveTarget(connectedStorageId)
    if (!target) return { storage: unscopedStorage }
    const brand = storageBrandForPlatform(target.platform)
    const folderId = providerFolderId(target.platform, target.folderId)
    const language = vendorLanguage(target.preferredLanguage)
    const quality = vendorQuality(target.preferredQuality)
    return {
      storage: createStorageExecutor(target),
      resourceProvider: createBoxPlayerResourceProvider(config, brand),
      storageProvider: brand,
      storageParentDirectoryId: folderId,
      animeStorageParentDirectoryId: folderId,
      moviesParentDirectoryId: folderId,
      ...(language ? { preferredLanguage: language } : {}),
      ...(quality ? { qualityPreference: quality } : {})
    }
  }
}

/** boxplayer reads the subtitle preference as free text and looks for "中". */
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
 * The daily patrol, mirroring boxplayer's web host: each configured Beijing-time slot runs at
 * most once per day, a late start catches up once, and a failed sweep releases its claim.
 */
async function runDueSweep(deps: WorkerDeps, config: BoxPlayerRuntimeConfig, force = false): Promise<boolean> {
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
    notifyBoxPlayerChanged()
    return true
  } catch (error) {
    if (claimed.length) await repo.setSetting(SWEEP_CLAIMS_SETTING, JSON.stringify({ date, slots: priorClaims })).catch(() => undefined)
    throw error
  }
}

/** Run a patrol right now (the 追更 "立即巡检" button); scheduled slots are left untouched. */
export async function runBoxPlayerPatrolNow(): Promise<void> {
  const config = await requestBoxPlayerRuntimeConfig()
  if (!config) throw new Error('请保持 BoxPlayer 窗口打开后再巡检')
  await runDueSweep(workerDeps(config), config, true)
}

function seasonMetadataSync(config: BoxPlayerRuntimeConfig): SeasonMetadataSync {
  const metadataProvider = createBoxPlayerMetadataProvider(config)
  return async ({ tmdbId, seasonNumber }) => {
    const target = await prepareTrackingTarget({ tmdbId, mediaType: 'tv', seasonNumber, qualityPreference: '4K', metadataProvider })
    return { latestAiredEpisode: target.season.latestAiredEpisode, totalEpisodes: target.season.totalEpisodes }
  }
}

async function readSweepClaims(today: string): Promise<string[]> {
  const raw = (await getBoxPlayerRepository().getSetting(SWEEP_CLAIMS_SETTING))?.trim()
  try {
    const parsed = raw ? JSON.parse(raw) as { date?: string; slots?: unknown[] } : null
    if (parsed?.date === today && Array.isArray(parsed.slots)) return parsed.slots.filter((slot): slot is string => typeof slot === 'string' && HHMM.test(slot))
  } catch {}
  return []
}

/** Build the model only when an agent actually runs, so a missing model fails that run with a clear message. */
function lazyModel(config: BoxPlayerRuntimeConfig): LanguageModel {
  let model: LanguageModel | undefined
  const resolve = () => model ??= createBoxPlayerModel(config)
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
