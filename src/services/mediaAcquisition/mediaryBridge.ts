import type { IAliGetFileModel } from '../../aliapi/alimodels'
import type { MediaAcquisitionRunView } from '@shared/types/mediaAcquisition'
import type { MediaryRuntimeConfig } from '@shared/types/mediary'
import { resolveAgentModelEndpoint } from '@shared/agentModelTransport'
import Config from '../../config'
import UserDAL from '../../user/userdal'
import { getAIConfig } from '../../utils/bookAI'
import { getBoxPlayerAccessToken } from '../../utils/boxplayerAuth'
import { isBoxPlayerCloudProvider } from '../../utils/boxplayerCloudAI'
import { MediaScanner } from '../../utils/mediaScanner'
import { isPro } from '../../utils/usageLimit'
import { listMediaAcquisitionRuns } from './client'
import { deliverMediaAcquisitionTerminalNotification } from './notificationReporter'

/** Fired on window whenever main reports a task change, so open task lists can refresh. */
export const MEDIARY_CHANGED_EVENT = 'boxplayer:mediary-changed'
const HANDLED_KEY = 'mediary_handled_runs_v1'
const LANDED_STATUSES = new Set(['completed', 'partial'])
const TERMINAL_STATUSES = new Set(['completed', 'partial', 'no_coverage', 'failed', 'cancelled'])

let started = false
let refreshing: Promise<void> | undefined

/**
 * The mediary agent runs in the main process. The renderer supplies what only it holds
 * (the AI model setting and the BoxPlayer login) and, after a task lands files, scans
 * them into the media library.
 */
export function startMediaryBridge(): void {
  const ipc = window.Electron?.ipcRenderer
  if (started || !ipc) return
  started = true
  ipc.on('mediary:runtimeConfigRequest', async (_event: unknown, requestId: string) => {
    const config = await buildMediaryRuntimeConfig().catch(() => null)
    ipc.send('mediary:runtimeConfigReply', requestId, config)
  })
  ipc.on('mediary:changed', () => {
    window.dispatchEvent(new CustomEvent(MEDIARY_CHANGED_EVENT))
    void handleFinishedRuns()
  })
  ipc.on('mediary:driveTokenRefreshed', (_event: unknown, data: { userId: string; accessToken?: string; refreshToken?: string }) => {
    const token = UserDAL.GetUserToken(data.userId)
    if (!token?.user_id) return
    UserDAL.SaveUserToken({ ...token, ...(data.accessToken ? { access_token: data.accessToken } : {}), ...(data.refreshToken ? { refresh_token: data.refreshToken } : {}) })
  })
  // Runs that finished before this window opened were already handled (or predate it).
  void listMediaAcquisitionRuns(50).then(runs => markHandled(runs.filter(run => TERMINAL_STATUSES.has(run.status)).map(run => run.id))).catch(() => undefined)
}

export async function buildMediaryRuntimeConfig(): Promise<MediaryRuntimeConfig> {
  const ai = getAIConfig()
  let model: MediaryRuntimeConfig['model'] = null
  if (ai?.modelId) {
    if (isBoxPlayerCloudProvider(ai.providerName)) {
      if (isPro()) model = { baseURL: resolveAgentModelEndpoint({ providerName: 'boxplayer-cloud', endpoint: '', cloudBaseUrl: Config.BOXPLAYER_AI_API_URL }), apiKey: await getBoxPlayerAccessToken(), modelId: ai.modelId, providerName: ai.providerName }
    } else {
      model = { baseURL: resolveAgentModelEndpoint({ providerName: ai.providerName, endpoint: ai.endpoint, cloudBaseUrl: '', allowInsecureHttp: true }), apiKey: ai.apiKey, modelId: ai.modelId, providerName: ai.providerName }
    }
  }
  return { model, boxplayerApiBaseURL: Config.BOXPLAYER_API_URL.replace(/\/+$/, '') }
}

async function handleFinishedRuns(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const handled = readHandled()
    const runs = await listMediaAcquisitionRuns(20)
    for (const run of runs) {
      if (!TERMINAL_STATUSES.has(run.status) || handled.has(run.id)) continue
      markHandled([run.id])
      deliverMediaAcquisitionTerminalNotification(run)
      if (LANDED_STATUSES.has(run.status)) await scanIntoMediaLibrary(run).catch(error => console.warn('[mediary] 媒体库扫描失败', error))
    }
  })().finally(() => { refreshing = undefined })
  return refreshing
}

async function scanIntoMediaLibrary(run: MediaAcquisitionRunView): Promise<void> {
  const folderId = run.landingFolderId || run.target.targetParentFileId
  if (!folderId || !run.target.targetDriveId) return
  const folder = {
    __v_skip: true,
    drive_id: run.target.targetDriveId,
    file_id: folderId,
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
    description: '',
    // Scan the account that received the files, not whichever drive the UI shows now.
    user_id: run.target.targetUserId
  } as IAliGetFileModel
  await MediaScanner.getInstance().scanFolder(folder, run.target.targetDriveId, {
    incremental: !run.landingFolderId,
    silent: true,
    mediaHint: run.target.tmdbId ? { tmdbId: run.target.tmdbId, title: run.target.title, year: run.target.year, mediaType: run.target.mediaType } : undefined
  })
}

function readHandled(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HANDLED_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

function markHandled(ids: string[]): void {
  if (!ids.length) return
  const handled = readHandled()
  ids.forEach(id => handled.add(id))
  localStorage.setItem(HANDLED_KEY, JSON.stringify([...handled].slice(-300)))
}
