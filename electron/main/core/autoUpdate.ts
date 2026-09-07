import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import is from 'electron-is'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const UPDATE_CHECK_DELAY_MS = 1000
const GITHUB_UPDATE_FEED_URL = 'https://github.com/gaozhangmin/boxplayer/releases/latest/download/'

type AutoUpdateLogger = Pick<typeof console, 'info' | 'warn' | 'error'>
type AutoUpdateDialog = Pick<typeof dialog, 'showMessageBox'>
type AutoUpdaterPort = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  setFeedURL(options: string): void
  checkForUpdates(): Promise<unknown> | null
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: any[]) => void): unknown
}
type UpdateProxyPreferences = {
  enabled: boolean
  url: string
  autoCheckOnLaunch?: boolean
}
export type AutoUpdateState = {
  status: 'idle' | 'checking' | 'downloading' | 'downloaded' | 'up-to-date' | 'error' | 'unsupported'
  version?: string
  message?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
}
type AutoUpdateControllerOptions = {
  updater: AutoUpdaterPort
  dialog: AutoUpdateDialog
  logger: AutoUpdateLogger
  currentVersion: string
  isPackaged: boolean
  isMas?: boolean
  updateProxy?: UpdateProxyPreferences
  updateStatePath?: string
  onStateChange?: (state: AutoUpdateState) => void
}

export function createAutoUpdateController(options: AutoUpdateControllerOptions) {
  const { updater, dialog, logger, currentVersion, isPackaged, isMas = false, updateProxy = { enabled: false, url: '', autoCheckOnLaunch: true }, updateStatePath, onStateChange } = options

  let state: AutoUpdateState = { status: isMas || !isPackaged ? 'unsupported' : 'idle' }
  const getState = () => ({ ...state })
  const setState = (nextState: AutoUpdateState) => {
    state = nextState
    onStateChange?.(getState())
  }
  if (isMas || !isPackaged) return { getState, checkNow: async () => getState(), installNow: () => false }

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = currentVersion.includes('-')
  const updateFeeds = [buildProxyUpdateFeed(updateProxy), GITHUB_UPDATE_FEED_URL]
  let updateFeedIndex = 0
  updater.setFeedURL(updateFeeds[updateFeedIndex])
  const checkForUpdates = async () => {
    setState({ status: 'checking' })
    updater.setFeedURL(updateFeeds[updateFeedIndex])
    await updater.checkForUpdates()
    return getState()
  }

  let downloadInProgress = false
  let hasDownloaded = false
  let hasPromptedRestart = false
  let hasStartedFallback = false
  let hasChecked = false
  let activeCheck: Promise<AutoUpdateState> | null = null
  const readPendingVersion = () => {
    if (!updateStatePath || !existsSync(updateStatePath)) return ''
    try { return String(JSON.parse(readFileSync(updateStatePath, 'utf8'))?.version || '') } catch { return '' }
  }
  const clearPendingVersion = () => {
    if (updateStatePath) unlinkSync(updateStatePath, { force: true })
  }
  const pendingVersion = readPendingVersion()
  if (pendingVersion && pendingVersion === currentVersion) clearPendingVersion()

  const checkNow = async (force = false) => {
    if (state.status === 'checking' && activeCheck) return activeCheck
    if (state.status === 'downloading' || state.status === 'downloaded') return getState()
    if (hasChecked && !force) return getState()
    hasChecked = true
    activeCheck = (async () => {
      try {
        return await checkForUpdates()
      } catch (err: unknown) {
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        logger.warn('[auto-update] check failed', err)
        fallbackToNextFeed(err)
        return getState()
      } finally {
        activeCheck = null
      }
    })()
    return activeCheck
  }

  const fallbackToNextFeed = (reason: unknown) => {
    if (hasStartedFallback || updateFeedIndex + 1 >= updateFeeds.length || hasDownloaded) return false
    hasStartedFallback = true
    downloadInProgress = false
    updateFeedIndex += 1
    logger.info('[auto-update] retrying with fallback feed', updateFeeds[updateFeedIndex], reason)
    Promise.resolve(checkForUpdates()).catch((fallbackError: unknown) => {
      setState({ status: 'error', message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) })
      logger.warn('[auto-update] fallback check failed', fallbackError)
    })
    return true
  }

  updater.on('update-available', (info: UpdateInfo) => {
    if (downloadInProgress || hasDownloaded || (pendingVersion && pendingVersion === info.version)) {
      logger.info('[auto-update] update already downloaded, skipping duplicate download', info.version)
      return
    }
    downloadInProgress = true
    setState({ status: 'downloading', version: info.version, percent: 0 })
    logger.info('[auto-update] update available, downloading in background', info.version)
    updater.downloadUpdate().catch((err: unknown) => {
      logger.warn('[auto-update] download failed', err)
      downloadInProgress = false
      fallbackToNextFeed(err)
    })
  })

  updater.on('download-progress', (progress: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => {
    if (hasDownloaded) return
    setState({
      status: 'downloading',
      version: state.version,
      percent: Math.max(0, Math.min(100, progress.percent)),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    })
  })

  updater.on('update-downloaded', (info: UpdateInfo) => {
    hasDownloaded = true
    downloadInProgress = false
    setState({ status: 'downloaded', version: info.version, percent: 100 })
    if (updateStatePath) {
      try { writeFileSync(updateStatePath, JSON.stringify({ version: info.version, downloadedAt: Date.now() })) } catch (err) { logger.warn('[auto-update] unable to persist downloaded version', err) }
    }
    if (hasPromptedRestart) return
    hasPromptedRestart = true
    dialog.showMessageBox({
      type: 'info',
      title: '更新已下载',
      message: `新版本 ${info.version} 已在后台下载完成`,
      detail: '重启 App 即可完成更新安装。',
      buttons: ['重启安装', '稍后'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) updater.quitAndInstall(false, true)
    }).catch((err: unknown) => {
      logger.warn('[auto-update] restart prompt failed', err)
    })
  })

  updater.on('update-not-available', (info: UpdateInfo) => {
    setState({ status: 'up-to-date', version: info.version })
  })

  updater.on('error', (err: unknown) => {
    setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    logger.warn('[auto-update] updater error', err)
    fallbackToNextFeed(err)
  })

  if (updateProxy.autoCheckOnLaunch !== false) {
    setTimeout(() => {
      void checkNow()
    }, UPDATE_CHECK_DELAY_MS)
  }

  const installNow = () => {
    if (!hasDownloaded) return false
    updater.quitAndInstall(false, true)
    return true
  }

  return { getState, checkNow, installNow }
}

export function readUpdateProxyPreferences(userDataPath: string): UpdateProxyPreferences {
  try {
    const value = JSON.parse(readFileSync(join(userDataPath, 'setting.config'), 'utf8'))
    return {
      enabled: value?.uiUpdateProxyEnable === true,
      url: typeof value?.uiUpdateProxyUrl === 'string' ? value.uiUpdateProxyUrl.trim() : '',
      autoCheckOnLaunch: value?.uiLaunchAutoCheckUpdate === true
    }
  } catch {
    return { enabled: false, url: '', autoCheckOnLaunch: false }
  }
}

function buildProxyUpdateFeed(preferences: UpdateProxyPreferences) {
  const configuredProxy = preferences.enabled ? normalizeUpdateProxyUrl(preferences.url) : ''
  return configuredProxy ? `${configuredProxy}/${GITHUB_UPDATE_FEED_URL}` : GITHUB_UPDATE_FEED_URL
}

function normalizeUpdateProxyUrl(url: string) {
  try {
    const proxy = new URL(url)
    return ['http:', 'https:'].includes(proxy.protocol) ? proxy.toString().replace(/\/+$/, '') : ''
  } catch {
    return ''
  }
}

export function registerAutoUpdate() {
  const updateStatePath = join(app.getPath('userData'), 'pending-update.json')
  const controller = createAutoUpdateController({
    updater: autoUpdater,
    dialog,
    logger: console,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    isMas: is.mas(),
    updateStatePath,
    updateProxy: readUpdateProxyPreferences(app.getPath('userData')),
    onStateChange: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('AutoUpdate:StateChanged', state)
      }
    }
  })
  ipcMain.removeHandler('AutoUpdate:GetState')
  ipcMain.removeHandler('AutoUpdate:Check')
  ipcMain.removeHandler('AutoUpdate:Install')
  ipcMain.handle('AutoUpdate:GetState', () => controller.getState())
  ipcMain.handle('AutoUpdate:Check', (_event, force?: boolean) => controller.checkNow(force === true))
  ipcMain.handle('AutoUpdate:Install', () => controller.installNow())
}
