import { existsSync } from 'node:fs'
import { getAsarPath, getStaticPath } from '../utils/mainfile'
import { BrowserWindow, SharedTextureHandle, WebContents, sharedTexture } from 'electron'
import { EmbeddedMpvCapability, getEmbeddedMpvCapability } from './embeddedMpvCapability'
import { EmbeddedMpvNativeAddonLoadResult, EmbeddedMpvNativeInstance, EmbeddedMpvNativeResourceStatus, EmbeddedMpvStatus, EmbeddedMpvTextureInfo, getEmbeddedMpvNativeResourceStatus, loadEmbeddedMpvNativeAddon } from './embeddedMpvNativeAddon'
import type { EmbeddedMpvControlRequest, EmbeddedMpvControlResult, EmbeddedMpvLoadRequest, EmbeddedMpvLoadResult } from './embeddedMpvBridge'
import { buildMpvLoadOptions } from './embeddedMpvLoadOptions'

export interface EmbeddedMpvTextureBridgeOptions {
  nativeAddonAvailable?: boolean
}

export class EmbeddedMpvTextureBridge {
  private window: BrowserWindow | null = null
  private readonly observedWindows = new WeakSet<BrowserWindow>()
  private initialized = false
  private initializing: Promise<boolean> | null = null
  private sessionId = ''
  private generation = 0
  private closing: Promise<void> = Promise.resolve()
  private statusPushTimer: ReturnType<typeof setTimeout> | null = null
  private frameIndex = 0
  private sendingFrame = false
  private pendingFrame: EmbeddedMpvTextureInfo | null = null
  private softwareFrameInFlight = false
  private softwareAck: { sessionId: string; index: number } | null = null
  private pendingSoftwareFrame: EmbeddedMpvTextureInfo | null = null
  private nativeLoadResult: EmbeddedMpvNativeAddonLoadResult | null = null
  private nativeResourceStatus: EmbeddedMpvNativeResourceStatus | null = null
  private mpv: EmbeddedMpvNativeInstance | null = null
  private latestStatus: EmbeddedMpvStatus | null = null
  private lastNativeError = ''
  private consecutiveFrameErrors = 0
  private frameStats = { received: 0, dropped: 0, sent: 0, errors: 0, importMs: 0, sendMs: 0, sendCount: 0 }
  private frameStatsTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: EmbeddedMpvTextureBridgeOptions = {}) {}

  private async readTrackStatus() {
    return this.mpv?.getTrackStatus?.()
  }

  private publishStatus(): void {
    if (this.statusPushTimer) return
    this.statusPushTimer = setTimeout(() => {
      this.statusPushTimer = null
      if (!this.window || this.window.isDestroyed() || !this.mpv) return
      this.window.webContents.send('MpvEmbedded:status', {
        ok: true, sessionId: this.sessionId, status: this.mpv.getStatus(),
        trackStatus: this.mpv.getTrackStatus?.(), error: this.lastNativeError || undefined
      })
    }, 100)
  }

  private loadNativeAddon(): EmbeddedMpvNativeAddonLoadResult {
    if (!this.nativeLoadResult) this.nativeLoadResult = loadEmbeddedMpvNativeAddon()
    return this.nativeLoadResult
  }

  private getNativeResourceStatus(): EmbeddedMpvNativeResourceStatus {
    if (!this.nativeResourceStatus) {
      const nativeLoadResult = this.loadNativeAddon()
      this.nativeResourceStatus = getEmbeddedMpvNativeResourceStatus(nativeLoadResult.addonPath && nativeLoadResult.addon ? [nativeLoadResult.addonPath] : nativeLoadResult.searchedPaths)
    }
    return this.nativeResourceStatus
  }

  getCapability(): EmbeddedMpvCapability {
    const nativeLoadResult = this.loadNativeAddon()
    const nativeResourceStatus = this.getNativeResourceStatus()
    return getEmbeddedMpvCapability({
      nativeAddonAvailable: this.options.nativeAddonAvailable === true || Boolean(nativeLoadResult.addon),
      nativeAddonError: nativeLoadResult.error,
      nativeResourcesComplete: nativeResourceStatus.complete,
      nativeResourcesMissing: nativeResourceStatus.missing,
      rendererAvailable: ['software', 'texture'].includes(nativeLoadResult.addon?.mpvTexture.renderMode || '')
    })
  }

  private bindWindow(window: BrowserWindow): void {
    this.window = window
    if (this.observedWindows.has(window)) return
    this.observedWindows.add(window)
    window.once('closed', () => {
      if (this.window === window) this.destroy()
    })
  }

  async initialize(window: BrowserWindow): Promise<boolean> {
    if (this.initializing) {
      await this.initializing
      if (this.initialized) return true
    }
    if (window.isDestroyed()) return false
    const initialization = this.initializeNative(window)
    this.initializing = initialization
    try {
      return await initialization
    } finally {
      if (this.initializing === initialization) this.initializing = null
    }
  }

  private async initializeNative(window: BrowserWindow): Promise<boolean> {
    await this.closing
    const generation = ++this.generation
    console.error('[mpv] initialize: checking capability')
    const capability = this.getCapability()
    if (!capability.enabled) return false
    console.error('[mpv] initialize: loading addon')
    const nativeLoadResult = this.loadNativeAddon()
    if (!nativeLoadResult.addon) return false
    this.bindWindow(window)
    this.mpv = nativeLoadResult.addon.mpvTexture
    try {
      console.error('[mpv] initialize: creating native context')
      // The software renderer cannot import GPU surfaces directly, but mpv's
      // copy-back decoder can use the GPU and return frames in system memory.
      // Unsupported GPUs/codecs automatically fall back to software decode.
      const fontsDir = [getStaticPath('fonts'), getAsarPath('src/assets/fonts')].find(directory => existsSync(directory))
      await this.mpv.create({ ...(process.platform === 'darwin' ? {} : { headless: false, width: 1280, height: 720, hwdec: 'auto' }), fontsDir })
      if (generation !== this.generation || window.isDestroyed()) {
        await nativeLoadResult.addon.mpvTexture.destroy()
        return false
      }
      console.error('[mpv] initialize: native context created')
    } catch (error) {
      console.error('[mpv] native addon create failed:', error)
      this.mpv = null
      return false
    }
    this.mpv.onFrame((textureInfo) => {
      if (generation !== this.generation) { textureInfo.release?.(); return }
      this.handleFrame(textureInfo)
    })
    this.mpv.onStatus((status) => {
      if (generation !== this.generation) return
      this.latestStatus = status
      this.publishStatus()
    })
    this.mpv.onError((error) => {
      if (generation !== this.generation) return
      this.lastNativeError = String(error || 'MPV native error')
      this.publishStatus()
      console.error('[mpv] native addon error:', error)
    })
    this.initialized = true
    console.error('[mpv] initialize: callbacks installed')
    this.frameStatsTimer = setInterval(() => {
      if (this.frameStats.received === 0) return
      const averageImport = this.frameStats.sendCount > 0 ? (this.frameStats.importMs / this.frameStats.sendCount).toFixed(1) : '?'
      const averageSend = this.frameStats.sendCount > 0 ? (this.frameStats.sendMs / this.frameStats.sendCount).toFixed(1) : '?'
      const mode = process.platform === 'darwin' ? 'texture' : 'software'
      console.log(`[mpv] ${mode} frames sent:${this.frameStats.sent} dropped:${this.frameStats.dropped} received:${this.frameStats.received} errors:${this.frameStats.errors} import:${averageImport}ms send:${averageSend}ms`)
      this.frameStats = { received: 0, dropped: 0, sent: 0, errors: 0, importMs: 0, sendMs: 0, sendCount: 0 }
    }, 2000)
    return true
  }

  async load(window: BrowserWindow, request: EmbeddedMpvLoadRequest): Promise<EmbeddedMpvLoadResult> {
    this.sessionId = request.sessionId || String(Date.now())
    const sessionId = this.sessionId
    console.error('[mpv] load: entered')
    if (process.env.BOXPLAYER_E2E === '1') {
      try {
        const mediaUrl = new URL(request.url || '')
        // Signing dates and lifetimes are safe to report; URLs, signatures,
        // account identifiers and request headers must never enter CI logs.
        console.error('[mpv] load expiry metadata', {
          ossDate: mediaUrl.searchParams.get('x-oss-date'),
          ossExpires: mediaUrl.searchParams.get('x-oss-expires'),
          ossV4: mediaUrl.searchParams.get('x-oss-signature-version') === 'OSS4-HMAC-SHA256'
        })
      } catch { /* Local file paths do not have signed URL metadata. */ }
    }
    const capability = this.getCapability()
    if (!capability.enabled) {
      return {
        ok: false,
        capability,
        error: capability.reason || '内嵌 MPV 尚未启用。'
      }
    }

    if (!this.initialized && !(await this.initialize(window))) {
      return {
        ok: false,
        capability,
        error: '内嵌 MPV 初始化失败。'
      }
    }

    if (sessionId !== this.sessionId) return { ok: false, capability, error: '播放已切换' }

    // sbtlTV owns one fixed main window. BoxPlayer creates a new preview
    // window for each video, so the singleton bridge must follow the current
    // sender instead of keeping the first window's mainFrame forever.
    if (this.window !== window) {
      this.bindWindow(window)
      this.pendingFrame?.release?.()
      this.pendingFrame = null
      this.pendingSoftwareFrame = null
      this.softwareFrameInFlight = false
    this.softwareAck = null
      this.frameIndex = 0
    }

    this.clearTexture()
    this.pendingFrame?.release?.()
    this.pendingFrame = null
    this.pendingSoftwareFrame = null
    this.softwareFrameInFlight = false
    this.softwareAck = null
    this.latestStatus = null
    this.lastNativeError = ''
    try {
      console.error('[mpv] load: invoking native load')
      console.info('[播放][MPV] native 加载链接', {
        source: /^https?:\/\//i.test(request.url || '') ? 'remote' : 'local',
        startPosition: request.startPosition || 0,
        hasAuthorization: Object.keys(request.headers || {}).some((key) => key.toLowerCase() === 'authorization'),
        userAgent: Object.entries(request.headers || {}).find(([key]) => key.toLowerCase() === 'user-agent')?.[1] || ''
      })
      await this.mpv?.load(request.url || '', buildMpvLoadOptions(request))
      console.error('[mpv] load: native load returned')
    } catch (error: any) {
      return {
        ok: false,
        capability,
        error: error?.message || 'MPV 加载视频失败。'
      }
    }

    return {
      ok: true,
      capability
    }
  }

  async control(request: EmbeddedMpvControlRequest): Promise<EmbeddedMpvControlResult> {
    const capability = this.getCapability()
    if (!capability.enabled || !this.initialized || !this.mpv) {
      return {
        ok: false,
        capability,
        error: capability.reason || '内嵌 MPV 尚未初始化。'
      }
    }

    const sessionId = this.sessionId
    const generation = this.generation
    if (request.sessionId && request.sessionId !== sessionId) return { ok: false, capability, error: '播放已切换' }
    const mpv = this.mpv
    try {
      switch (request.action) {
        case 'play':
          await mpv.play()
          break
        case 'pause':
          await mpv.pause()
          break
        case 'stop':
          await mpv.stop()
          this.clearTexture()
          break
        case 'seek':
          if (typeof request.value !== 'number') return { ok: false, capability, error: 'seek 需要数字位置。' }
          await mpv.seek(request.value)
          break
        case 'setVolume':
          if (typeof request.value !== 'number') return { ok: false, capability, error: 'setVolume 需要数字音量。' }
          await mpv.setVolume(request.value)
          break
        case 'setSpeed':
          if (typeof request.value !== 'number' || !Number.isFinite(request.value) || request.value < 0.25 || request.value > 4) return { ok: false, capability, error: '倍速必须在 0.25–4 倍之间。' }
          if (!mpv.setSpeed) return this.getUnsupportedOptionalControlResult(capability, '当前 sbtlTV MPV 内核尚未暴露倍速控制。')
          await mpv.setSpeed(request.value)
          break
        case 'setAudioTrack':
          if (typeof request.value !== 'number') return { ok: false, capability, error: 'setAudioTrack 需要数字轨道 ID。' }
          if (!mpv.setAudioTrack) return this.getUnsupportedOptionalControlResult(capability, '当前 sbtlTV MPV 内核尚未暴露音轨控制。')
          await mpv.setAudioTrack(request.value)
          break
        case 'setSubtitleTrack':
          if (typeof request.value !== 'number') return { ok: false, capability, error: 'setSubtitleTrack 需要数字轨道 ID。' }
          if (!mpv.setSubtitleTrack) return this.getUnsupportedOptionalControlResult(capability, '当前 sbtlTV MPV 内核尚未暴露字幕轨控制。')
          await mpv.setSubtitleTrack(request.value)
          break
        case 'setSubtitleStyle':
          if (!request.style) return { ok: false, capability, error: 'setSubtitleStyle 需要字幕样式。' }
          if (!mpv.setSubtitleStyle) return this.getUnsupportedOptionalControlResult(capability, '当前 MPV 内核尚未暴露字幕样式控制。')
          await mpv.setSubtitleStyle(request.style)
          break
        case 'setVideoProperty':
          if (!request.property || request.propertyValue == null) return { ok: false, capability, error: 'setVideoProperty 参数不完整。' }
          if (!mpv.setVideoProperty) return this.getUnsupportedOptionalControlResult(capability, '当前 MPV 内核尚未暴露视频属性控制。')
          await mpv.setVideoProperty(request.property, String(request.propertyValue))
          break
        case 'addAudio':
          if (!request.url) return { ok: false, capability, error: 'addAudio 需要音频文件路径。' }
          if (!mpv.addAudio) return this.getUnsupportedOptionalControlResult(capability, '当前 MPV 内核尚未暴露外置音频控制。')
          await mpv.addAudio(request.url, request.title || '')
          break
        case 'addSubtitle':
          if (!request.url) return { ok: false, capability, error: 'addSubtitle 需要字幕 URL。' }
          if (!mpv.addSubtitle) return this.getUnsupportedOptionalControlResult(capability, '当前 sbtlTV MPV 内核尚未暴露外挂字幕控制。')
          await mpv.addSubtitle(request.url, request.title || '')
          break
        default:
          return { ok: false, capability, error: '未知的内嵌 MPV 控制命令。' }
      }

    } catch (error) {
      return { ok: false, capability, sessionId, error: error instanceof Error ? error.message : 'MPV 控制失败' }
    }
    if (generation !== this.generation || sessionId !== this.sessionId) return { ok: false, capability, sessionId, error: '播放已切换' }
    const trackStatus = await this.readTrackStatus()
    return {
      ok: true,
      sessionId,
      capability,
      status: mpv.getStatus?.() || this.latestStatus,
      trackStatus
    }
  }

  private getUnsupportedOptionalControlResult(capability: EmbeddedMpvCapability, warning: string): EmbeddedMpvControlResult {
    return {
      ok: false,
      capability,
      error: warning
    }
  }

  async getStatus(): Promise<EmbeddedMpvControlResult> {
    const capability = this.getCapability()
    if (!capability.enabled || !this.initialized || !this.mpv) {
      return {
        ok: false,
        capability,
        error: capability.reason || '内嵌 MPV 尚未初始化。'
      }
    }

    return {
      ok: true,
      capability,
      status: this.mpv.getStatus?.() || this.latestStatus,
      trackStatus: await this.readTrackStatus(),
      presentedFrames: this.frameIndex,
      sessionId: this.sessionId,
      error: this.lastNativeError || undefined
    }
  }

  private handleFrame(textureInfo: EmbeddedMpvTextureInfo): void {
    if (!this.window || !this.mpv) { textureInfo.release?.(); return }
    if (textureInfo.pixels) {
      this.frameStats.received++
      if (this.softwareFrameInFlight) {
        if (this.pendingSoftwareFrame) this.frameStats.dropped++
        this.pendingSoftwareFrame = textureInfo
        return
      }
      this.sendSoftwareFrame(textureInfo)
      return
    }
    this.frameStats.received++
    if (this.sendingFrame) this.frameStats.dropped++
    this.pendingFrame?.release?.()
    this.pendingFrame = textureInfo
    if (!this.sendingFrame) void this.sendFrameLoop()
  }

  private sendSoftwareFrame(textureInfo: EmbeddedMpvTextureInfo): void {
    if (!this.window || this.window.isDestroyed() || !textureInfo.pixels) return
    this.softwareFrameInFlight = true
    this.softwareAck = { sessionId: this.sessionId, index: this.frameIndex }
    this.frameStats.sent++
    this.window.webContents.send('MpvEmbedded:softwareFrame', {
        transformed: textureInfo.transformed,
        sessionId: this.sessionId,
        pixels: textureInfo.pixels,
        width: textureInfo.width,
        height: textureInfo.height,
        index: this.frameIndex++
      })
  }

  acknowledgeSoftwareFrame(sender: WebContents, ack?: { sessionId?: string; index?: number }): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents !== sender) return
    if (ack && (ack.sessionId !== this.softwareAck?.sessionId || ack.index !== this.softwareAck?.index)) return
    this.softwareFrameInFlight = false
    this.softwareAck = null
    const next = this.pendingSoftwareFrame
    this.pendingSoftwareFrame = null
    if (next) this.sendSoftwareFrame(next)
  }

  private async sendFrameLoop(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return
    this.sendingFrame = true
    while (this.pendingFrame && this.window && !this.window.isDestroyed()) {
      const textureInfo = this.pendingFrame
      this.pendingFrame = null
      const generation = this.generation
      let imported: ReturnType<typeof sharedTexture.importSharedTexture> | null = null
      try {
        let handle: SharedTextureHandle
        const handleBuffer = Buffer.alloc(8)
        handleBuffer.writeBigUInt64LE(textureInfo.handle)
        handle = textureInfo.nativePixmap ? { nativePixmap: textureInfo.nativePixmap }
          : process.platform === 'darwin' ? { ioSurface: handleBuffer } : { ntHandle: handleBuffer }
        const startImport = performance.now()
        imported = sharedTexture.importSharedTexture({
          allReferencesReleased: () => textureInfo.release?.(),
          textureInfo: {
            handle,
            codedSize: { width: textureInfo.width, height: textureInfo.height },
            visibleRect: { x: 0, y: 0, width: textureInfo.width, height: textureInfo.height },
            pixelFormat: textureInfo.format as Electron.SharedTextureImportTextureInfo['pixelFormat']
          }
        })
        const startSend = performance.now()
        await sharedTexture.sendSharedTexture(
          {
            frame: this.window.webContents.mainFrame,
            importedSharedTexture: imported
          },
          this.frameIndex++, this.sessionId
        )
        this.frameStats.importMs += startSend - startImport
        this.frameStats.sendMs += performance.now() - startSend
        this.frameStats.sendCount++
        this.frameStats.sent++
        this.consecutiveFrameErrors = 0
      } catch (error) {
        this.frameStats.errors++
        this.consecutiveFrameErrors++
        if (generation === this.generation && this.consecutiveFrameErrors >= 5) {
          if (this.mpv?.useSoftwareReadback) void this.mpv.useSoftwareReadback()
          else this.lastNativeError = '视频画面传输失败，请重新打开视频。'
          this.publishStatus()
        }
        if (this.consecutiveFrameErrors === 1 || this.consecutiveFrameErrors === 5) console.error(`[mpv] sharedTexture send failed (${this.consecutiveFrameErrors} consecutive):`, error)
      } finally {
        if (imported) imported.release()
        else textureInfo.release?.()
      }
    }

    this.sendingFrame = false
  }

  clearTexture(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send('MpvEmbedded:clearTexture')
  }

  destroy(): void {
    ++this.generation
    this.sessionId = ''
    if (this.statusPushTimer) clearTimeout(this.statusPushTimer)
    this.statusPushTimer = null
    if (this.frameStatsTimer) {
      clearInterval(this.frameStatsTimer)
      this.frameStatsTimer = null
    }
    this.clearTexture()
    this.pendingFrame?.release?.()
    this.pendingFrame = null
    this.pendingSoftwareFrame = null
    this.softwareFrameInFlight = false
    this.softwareAck = null
    this.latestStatus = null
    this.lastNativeError = ''
    const mpv = this.mpv
    this.closing = Promise.resolve(mpv?.destroy()).catch((error) => console.error('[mpv] destroy failed', error))
    this.mpv = null
    this.window = null
    this.initialized = false
  }
}
