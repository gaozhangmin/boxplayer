import Electron, { ipcRenderer, webUtils } from 'electron'

window.Electron = Electron
process.noAsar = true
window.platform = process.platform
window.WebIsE2E = process.env.BOXPLAYER_E2E === '1'
window.WebE2EAllowTransfers = process.env.BOXPLAYER_E2E_TRANSFERS === '1'
window.WebGetPathForFile = function(file: File) {
  try {
    return webUtils.getPathForFile(file)
  } catch {
    return ''
  }
}

window.WebToElectron = function(data: any) {
  try {
    ipcRenderer.send('WebToElectron', data)
  } catch {
  }
}

window.WebToWindow = function(data: any, callback: any) {
  try {
    const backData = ipcRenderer.sendSync('WebToWindow', data)
    callback && callback(backData)
  } catch {
  }
}

window.WebToElectronCB = function(data: any, callback: any) {
  try {
    const backData = ipcRenderer.sendSync('WebToElectronCB', data)
    callback(backData)
  } catch {
  }
}

ipcRenderer.on('MainSendToken', function(event, arg) {
  try {
    window.postMessage(arg)
  } catch {
  }
})

window.WebSpawnSync = function(data: any, callback: any) {
  try {
    const backData = ipcRenderer.sendSync('WebSpawnSync', data)
    callback(backData)
  } catch {
  }
}
window.WebExecSync = function(data: any, callback: any) {
  try {
    const backData = ipcRenderer.sendSync('WebExecSync', data)
    callback(backData)
  } catch {
  }
}
window.WebShowOpenDialogSync = function(config: any, callback: any) {
  try {
    const backData = ipcRenderer.sendSync('WebShowOpenDialogSync', config)
    callback(backData)
  } catch {
  }
}
window.WebShowOpenDialog = function(config: any) {
  return ipcRenderer.invoke('WebShowOpenDialog', config)
}

window.WebShowSaveDialogSync = function(config: any, callback: any) {
  try {
    const backData = ipcRenderer.sendSync('WebShowSaveDialogSync', config)
    callback(backData)
  } catch {
  }
}
window.WebShowItemInFolder = function(fullPath: string) {
  try {
    ipcRenderer.send('WebShowItemInFolder', fullPath)
  } catch {
  }
}

window.WebPlatformSync = function(callback: any) {
  try {
    const backData = ipcRenderer.sendSync('WebPlatformSync')
    callback(backData)
  } catch {
  }
}

window.WebClearCookies = function(data: any) {
  try {
    ipcRenderer.send('WebClearCookies', data)
  } catch {
  }
}
window.WebClearCache = function(data: any) {
  try {
    ipcRenderer.send('WebClearCache', data)
  } catch {
  }
}
window.WebUserToken = function(data: any) {
  try {
    ipcRenderer.send('WebUserToken', data)
  } catch {
  }
}
window.WebSaveTheme = function(data: any) {
  try {
    ipcRenderer.send('WebSaveTheme', data)
  } catch {
  }
}

window.WebReload = function(data: any) {
  try {
    ipcRenderer.send('WebReload', data)
  } catch {
  }
}
window.WebRelaunch = function(data: any) {
  try {
    ipcRenderer.send('WebRelaunch', data)
  } catch {
  }
}
window.WebRelaunchAria = async function() {
  try {
    return await ipcRenderer.invoke('WebRelaunchAria')
  } catch {
    return 0
  }
}
window.AutoUpdateGetState = async function() {
  try {
    return await ipcRenderer.invoke('AutoUpdate:GetState')
  } catch {
    return { status: 'unsupported' }
  }
}
window.AutoUpdateCheck = async function(force = false) {
  try {
    return await ipcRenderer.invoke('AutoUpdate:Check', force)
  } catch {
    return { status: 'error' }
  }
}
window.AutoUpdateInstall = async function() {
  try {
    return await ipcRenderer.invoke('AutoUpdate:Install')
  } catch {
    return false
  }
}
window.AutoUpdateOnStateChanged = function(callback: (state: any) => void) {
  const listener = (_event: Electron.IpcRendererEvent, state: any) => callback(state)
  ipcRenderer.on('AutoUpdate:StateChanged', listener)
  return () => ipcRenderer.removeListener('AutoUpdate:StateChanged', listener)
}
window.WebSetProgressBar = function(data: any) {
  try {
    ipcRenderer.send('WebSetProgressBar', data)
  } catch {
  }
}
window.WebGetCookies = async function(data: any) {
  try {
    return await ipcRenderer.invoke('WebGetCookies', data)
  } catch {
  }
}
window.WebQuarkAccountInfo = async function(data: any) {
  try {
    return await ipcRenderer.invoke('WebQuarkAccountInfo', data)
  } catch {
  }
}
window.WebQuarkFileList = async function(data: any) {
  try {
    return await ipcRenderer.invoke('WebQuarkFileList', data)
  } catch {
  }
}
window.WebQuarkDownloadUrl = async function(data: any) {
  try {
    return await ipcRenderer.invoke('WebQuarkDownloadUrl', data)
  } catch {
  }
}
window.WebSetCookies = async function(cookies: any) {
  try {
    return await ipcRenderer.invoke('WebSetCookies', cookies)
  } catch {
  }
}

window.WebOpenWindow = function(data: any) {
  try {
    ipcRenderer.send('WebOpenWindow', data)
  } catch {
  }
}
window.WebOpenLyric = function() {
  try {
    ipcRenderer.send('WebOpenLyric')
  } catch {
  }
}
window.WebSendLyric = function(data: any) {
  try {
    ipcRenderer.send('WebSendLyric', data)
  } catch {
  }
}
window.WebCloseLyric = function() {
  try {
    ipcRenderer.send('WebCloseLyric')
  } catch {
  }
}
window.WebConfigureGlobalHotkeys = async function(data: any) {
  try {
    return await ipcRenderer.invoke('WebConfigureGlobalHotkeys', data)
  } catch {
    return { ok: false, error: 'global hotkey ipc failed' }
  }
}
window.WebOnGlobalHotkey = function(callback: any) {
  try {
    const listener = (_event: any, data: any) => callback?.(data)
    ipcRenderer.on('WebGlobalHotkey', listener)
    return () => ipcRenderer.removeListener('WebGlobalHotkey', listener)
  } catch {
    return () => {}
  }
}
window.WebOpenUrl = function(data: any) {
  try {
    ipcRenderer.send('WebOpenUrl', data)
  } catch {
  }
}
window.WebShutDown = function(data: any) {
  try {
    ipcRenderer.send('WebShutDown', data)
  } catch {
  }
}
window.WebSetProxy = function(data: { proxyUrl: string }) {
  try {
    ipcRenderer.send('WebSetProxy', data)
  } catch {
  }
}

window.WebMpvEmbeddedCapability = async function() {
  try {
    return await ipcRenderer.invoke('MpvEmbedded:getCapability')
  } catch (error: any) {
    return { enabled: false, status: 'disabled', reason: error?.message || 'mpv embedded capability ipc failed' }
  }
}

function normalizeMpvEmbeddedLoadData(data: any) {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(data?.headers || {})) {
    if (!key || value == null) continue
    headers[String(key)] = String(value)
  }
  return {
    url: String(data?.url || ''),
    headers,
    title: String(data?.title || ''),
    startPosition: typeof data?.startPosition === 'number' ? data.startPosition : Number(data?.startPosition || 0)
  }
}

window.WebMpvEmbeddedLoad = async function(data: any) {
  try {
    return await ipcRenderer.invoke('MpvEmbedded:load', normalizeMpvEmbeddedLoadData(data))
  } catch (error: any) {
    return { ok: false, error: error?.message || 'mpv embedded load ipc failed' }
  }
}

window.WebMpvEmbeddedControl = async function(data: any) {
  try {
    return await ipcRenderer.invoke('MpvEmbedded:control', data)
  } catch (error: any) {
    return { ok: false, error: error?.message || 'mpv embedded control ipc failed' }
  }
}

window.WebMpvEmbeddedStatus = async function() {
  try {
    return await ipcRenderer.invoke('MpvEmbedded:getStatus')
  } catch (error: any) {
    return { ok: false, error: error?.message || 'mpv embedded status ipc failed' }
  }
}

window.WebMpvSharedTextureCapability = function() {
  if (process.platform !== 'darwin') {
    return { available: false, platform: process.platform, reason: 'sharedTexture receiver is only planned for macOS embedded MPV' }
  }
  try {
    const sharedTexture = (require('electron') as any).sharedTexture
    return {
      available: Boolean(sharedTexture?.setSharedTextureReceiver),
      platform: process.platform,
      reason: sharedTexture ? undefined : 'macOS 内嵌 MPV 渲染桥接尚未启用'
    }
  } catch (error: any) {
    return { available: false, platform: process.platform, reason: error?.message || 'macOS 内嵌 MPV 渲染桥接检测失败' }
  }
}

let mpvSharedTextureFrameCallback: ((videoFrame: VideoFrame, index: number) => void) | null = null
let mpvSharedTextureClearCallback: (() => void) | null = null
let mpvSharedTextureReceiverReady = false

ipcRenderer.on('MpvEmbedded:clearTexture', () => {
  mpvSharedTextureClearCallback?.()
})

const registerMpvSharedTextureReceiver = (): boolean => {
  try {
    const sharedTexture = (require('electron') as any).sharedTexture
    if (process.platform !== 'darwin' || !sharedTexture?.setSharedTextureReceiver) return false
    sharedTexture.setSharedTextureReceiver(async (data: { importedSharedTexture?: { getVideoFrame: () => VideoFrame; release: () => void } }, ...args: unknown[]) => {
      const imported = data?.importedSharedTexture
      try {
        if (imported && mpvSharedTextureFrameCallback) {
          const frameIndex = typeof args[0] === 'number' ? args[0] : 0
          const videoFrame = imported.getVideoFrame()
          mpvSharedTextureFrameCallback(videoFrame, frameIndex)
        }
      } catch (error) {
        console.error('[mpv] sharedTexture receiver error:', error)
      } finally {
        try { imported?.release() } catch {}
      }
    })
    mpvSharedTextureReceiverReady = true
    console.log('[mpv] sharedTexture receiver registered')
    return true
  } catch (error) {
    mpvSharedTextureReceiverReady = false
    console.warn('[mpv] sharedTexture receiver is not available:', error)
    return false
  }
}

// Match sbtlTV's lifecycle: Electron's receiver belongs to the preload
// renderer process, while the UI component only owns the frame callback.
registerMpvSharedTextureReceiver()

window.WebMpvSharedTexture = {
  isAvailable: () => mpvSharedTextureReceiverReady,
  onFrame: (callback: (videoFrame: VideoFrame, index: number) => void) => {
    mpvSharedTextureFrameCallback = callback
  },
  removeFrameListener: () => {
    mpvSharedTextureFrameCallback = null
  },
  onClear: (callback: () => void) => {
    mpvSharedTextureClearCallback = callback
  },
  removeClearListener: () => {
    mpvSharedTextureClearCallback = null
  }
}

window.MsImageCacheSyncConfig = function(configs: any[]) {
  try {
    ipcRenderer.send('MsImageCache:syncConfig', configs)
  } catch {}
}

window.MsImageCacheStats = async function() {
  try {
    return await ipcRenderer.invoke('MsImageCache:stats')
  } catch {
    return { totalBytes: 0, servers: [] }
  }
}

window.MsImageCacheClear = async function(serverId?: string) {
  try {
    return await ipcRenderer.invoke('MsImageCache:clear', serverId ? { serverId } : {})
  } catch {
    return { cleared: 0 }
  }
}

window.TvBoxInvoke = async function(channel: string, data: unknown) {
  try {
    return await ipcRenderer.invoke(channel, data)
  } catch (e: unknown) {
    throw e
  }
}

window.ReedyInvoke = async function(channel: string, ...args: any[]) {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (e: unknown) {
    throw e
  }
}

window.DocumentReadingExtractPdf = async function(input: any, onProgress?: (progress: any) => void) {
  const requestId = Math.random().toString(36).slice(2)
  const listener = (_event: Electron.IpcRendererEvent, id: string, progress: any) => {
    if (id === requestId) onProgress?.(progress)
  }
  ipcRenderer.on('documentReading:pdfProgress', listener)
  try {
    // Functions cannot cross Electron's structured-clone IPC boundary.
    // Progress returns through the event listener above instead.
    return await ipcRenderer.invoke('documentReading:extractPdf', { requestId, url: input.url, headers: input.headers })
  } finally {
    ipcRenderer.removeListener('documentReading:pdfProgress', listener)
  }
}

function createRightMenu() {
  window.addEventListener('contextmenu', (e) => {
      if (e) e.preventDefault()
      const target = e.target as HTMLElement
      // 检查页面是否是有选择的文本 这里显示复制和剪切选项是否可见
      const selectText = !!window.getSelection().toString()
      if (selectText || isEleEditable(target)) {
        // 读取剪切板是否有文本 这里传递粘贴选项是否可见
        const showPaste = !!navigator.clipboard.readText()
        // 判断ReadOnly
        const isReadOnly = target.hasAttribute('readonly')
        // 发送给主进程让它显示菜单
        ipcRenderer.send('show-context-menu', {
          showPaste: !isReadOnly && showPaste,
          showCopy: selectText,
          showCut: !isReadOnly && selectText
        })
      }
    }
  )
}

function isEleEditable(e: any): boolean {
  if (!e) return false
  if (e.tagName === 'TEXTAREA'
    || (e.tagName === 'INPUT' && e.type !== 'checkbox')
    || e.contentEditable == 'true') {
    return true
  } else {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return isEleEditable(e.parentNode)
  }
}

createRightMenu()

window.onExternalDownloadOpen = (callback: (payload: string) => void) => {
  ipcRenderer.on('external-download:open', (_event, payload: string) => callback(payload))
}

const pendingExternalFilePayloads: Array<{ filePath: string; fileUrl: string }> = []
const externalFileCallbacks = new Set<(payload: { filePath: string; fileUrl: string }) => void>()
ipcRenderer.on('external-file:open', (_event, payload: { filePath: string; fileUrl: string }) => {
  if (!externalFileCallbacks.size) {
    pendingExternalFilePayloads.push(payload)
    return
  }
  externalFileCallbacks.forEach((callback) => callback(payload))
})
window.onExternalFileOpen = (callback: (payload: { filePath: string; fileUrl: string }) => void) => {
  externalFileCallbacks.add(callback)
  while (pendingExternalFilePayloads.length) callback(pendingExternalFilePayloads.shift()!)
}

// fix: new-windows event
ipcRenderer.on('webview-new-window', (e, webContentsId, details) => {
  const webview = document.getElementById('webview') as any
  const evt = new Event('new-window', { bubbles: true, cancelable: false })
  webview.dispatchEvent(Object.assign(evt, details))
})

ipcRenderer.on('webview-redirect', (e, webContentsId, url) => {
  const webview = document.getElementById('webview') as any
  const evt = new Event('will-redirect', { bubbles: true, cancelable: false })
  webview.dispatchEvent(Object.assign(evt, { url }))
})
