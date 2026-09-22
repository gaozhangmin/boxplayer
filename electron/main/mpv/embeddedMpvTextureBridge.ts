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
  private initialized = false
  private frameIndex = 0
  private sendingFrame = false
  private pendingFrame: EmbeddedMpvTextureInfo | null = null
  private softwareFrameInFlight = false
  private pendingSoftwareFrame: EmbeddedMpvTextureInfo | null = null
  private nativeLoadResult: EmbeddedMpvNativeAddonLoadResult | null = null
  private nativeResourceStatus: EmbeddedMpvNativeResourceStatus | null = null
  private mpv: EmbeddedMpvNativeInstance | null = null
  private latestStatus: EmbeddedMpvStatus | null = null
  private consecutiveFrameErrors = 0
  private frameStats = { received: 0, dropped: 0, sent: 0, errors: 0, importMs: 0, sendMs: 0, sendCount: 0 }
  private frameStatsTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: EmbeddedMpvTextureBridgeOptions = {}) {}

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
      rendererAvailable: process.platform === 'darwin' || nativeLoadResult.addon?.mpvTexture.renderMode === 'software'
    })
  }

  async initialize(window: BrowserWindow): Promise<boolean> {
    console.error('[mpv] initialize: checking capability')
    const capability = this.getCapability()
    if (!capability.enabled) return false
    console.error('[mpv] initialize: loading addon')
    const nativeLoadResult = this.loadNativeAddon()
    if (!nativeLoadResult.addon) return false
    this.window = window
    window.once('closed', () => {
      if (this.window === window) this.destroy()
    })
    this.mpv = nativeLoadResult.addon.mpvTexture
    try {
      console.error('[mpv] initialize: creating native context')
      // The software renderer cannot import hardware-decoded GPU surfaces.
      this.mpv.create(process.platform === 'darwin' ? {} : { headless: false, width: 640, height: 360, hwdec: 'no' })
      console.error('[mpv] initialize: native context created')
    } catch (error) {
      console.error('[mpv] native addon create failed:', error)
      this.mpv = null
      return false
    }
    this.mpv.onFrame((textureInfo) => this.handleFrame(textureInfo))
    this.mpv.onStatus((status) => {
      this.latestStatus = status
    })
    this.mpv.onError((error) => console.error('[mpv] native addon error:', error))
    this.initialized = true
    console.error('[mpv] initialize: callbacks installed')
    this.frameStatsTimer = setInterval(() => {
      if (this.frameStats.received === 0) return
      const averageImport = this.frameStats.sendCount > 0 ? (this.frameStats.importMs / this.frameStats.sendCount).toFixed(1) : '?'
      const averageSend = this.frameStats.sendCount > 0 ? (this.frameStats.sendMs / this.frameStats.sendCount).toFixed(1) : '?'
      console.log(`[mpv] texture frames sent:${this.frameStats.sent} dropped:${this.frameStats.dropped} received:${this.frameStats.received} errors:${this.frameStats.errors} import:${averageImport}ms send:${averageSend}ms`)
      this.frameStats = { received: 0, dropped: 0, sent: 0, errors: 0, importMs: 0, sendMs: 0, sendCount: 0 }
    }, 2000)
    return true
  }

  async load(window: BrowserWindow, request: EmbeddedMpvLoadRequest): Promise<EmbeddedMpvLoadResult> {
    console.error('[mpv] load: entered')
    const capability = this.getCapability()
    if (!capability.enabled) {
      return {
        ok: false,
        capability,
        error: capability.reason || 'macOS 内嵌 MPV 尚未启用。'
      }
    }

    if (!this.initialized && !(await this.initialize(window))) {
      return {
        ok: false,
        capability,
        error: 'macOS 内嵌 MPV 初始化失败。'
      }
    }

    // sbtlTV owns one fixed main window. BoxPlayer creates a new preview
    // window for each video, so the singleton bridge must follow the current
    // sender instead of keeping the first window's mainFrame forever.
    if (this.window !== window) {
      this.window = window
      this.pendingFrame = null
      this.pendingSoftwareFrame = null
      this.softwareFrameInFlight = false
      this.frameIndex = 0
    }

    this.clearTexture()
    this.pendingFrame = null
    this.pendingSoftwareFrame = null
    this.softwareFrameInFlight = false
    this.latestStatus = null
    try {
      console.error('[mpv] load: invoking native load')
      console.info('[播放][MPV] native 加载链接', {
        url: request.url || '',
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
        error: capability.reason || 'macOS 内嵌 MPV 尚未初始化。'
      }
    }

    switch (request.action) {
      case 'play':
        await this.mpv.play()
        break
      case 'pause':
        await this.mpv.pause()
        break
      case 'stop':
        await this.mpv.stop()
        this.clearTexture()
        break
      case 'seek':
        if (typeof request.value !== 'number') return { ok: false, capability, error: 'seek 需要数字位置。' }
        await this.mpv.seek(request.value)
        break
      case 'setVolume':
        if (typeof request.value !== 'number') return { ok: false, capability, error: 'setVolume 需要数字音量。' }
        await this.mpv.setVolume(request.value)
        break
      case 'setSpeed':
        if (typeof request.value !== 'number' || !Number.isFinite(request.value) || request.value < 0.25 || request.value > 4) return { ok: false, capability, error: '倍速必须在 0.25–4 倍之间。' }
        if (!this.mpv.setSpeed) return this.getUnsupportedOptionalControlResult(capability, '当前 sbtlTV MPV 内核尚未暴露倍速控制。')
        await this.mpv.setSpeed(request.value)
        break
      case 'setAudioTrack':
        if (typeof request.value !== 'number') return { ok: false, capability, error: 'setAudioTrack 需要数字轨道 ID。' }
        if (!this.mpv.setAudioTrack) return this.getUnsupportedOptionalControlResult(capability, '当前 sbtlTV MPV 内核尚未暴露音轨控制。')
        await this.mpv.setAudioTrack(request.value)
        break
      case 'setSubtitleTrack':
        if (typeof request.value !== 'number') return { ok: false, capability, error: 'setSubtitleTrack 需要数字轨道 ID。' }
        if (!this.mpv.setSubtitleTrack) return this.getUnsupportedOptionalControlResult(capability, '当前 sbtlTV MPV 内核尚未暴露字幕轨控制。')
        await this.mpv.setSubtitleTrack(request.value)
        break
      case 'setSubtitleStyle':
        if (!request.style) return { ok: false, capability, error: 'setSubtitleStyle 需要字幕样式。' }
        if (!this.mpv.setSubtitleStyle) return this.getUnsupportedOptionalControlResult(capability, '当前 MPV 内核尚未暴露字幕样式控制。')
        await this.mpv.setSubtitleStyle(request.style)
        break
      case 'setVideoProperty':
        if (!request.property || request.propertyValue == null) return { ok: false, capability, error: 'setVideoProperty 参数不完整。' }
        if (!this.mpv.setVideoProperty) return this.getUnsupportedOptionalControlResult(capability, '当前 MPV 内核尚未暴露视频属性控制。')
        await this.mpv.setVideoProperty(request.property, String(request.propertyValue))
        break
      case 'addAudio':
        if (!request.url) return { ok: false, capability, error: 'addAudio 需要音频文件路径。' }
        if (!this.mpv.addAudio) return this.getUnsupportedOptionalControlResult(capability, '当前 MPV 内核尚未暴露外置音频控制。')
        await this.mpv.addAudio(request.url, request.title || '')
        break
      case 'addSubtitle':
        if (!request.url) return { ok: false, capability, error: 'addSubtitle 需要字幕 URL。' }
        if (!this.mpv.addSubtitle) return this.getUnsupportedOptionalControlResult(capability, '当前 sbtlTV MPV 内核尚未暴露外挂字幕控制。')
        {
          let lastError: unknown
          for (const delay of [0, 250, 750]) {
            if (delay > 0) await waitForMpvCommand(delay)
            try {
              await this.mpv.addSubtitle(request.url, request.title || '')
              lastError = undefined
              break
            } catch (error) {
              lastError = error
            }
          }
          if (lastError) {
            const message = lastError instanceof Error ? lastError.message : 'MPV 添加外挂字幕失败。'
            return { ok: false, capability, error: `字幕加载失败：${message}` }
          }
        }
        break
      default:
        return { ok: false, capability, error: '未知的 macOS 内嵌 MPV 控制命令。' }
    }

    return {
      ok: true,
      capability,
      status: this.mpv.getStatus?.() || this.latestStatus,
      trackStatus: this.mpv.getTrackStatus?.()
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
        error: capability.reason || 'macOS 内嵌 MPV 尚未初始化。'
      }
    }

    return {
      ok: true,
      capability,
      status: this.mpv.getStatus?.() || this.latestStatus,
      trackStatus: this.mpv.getTrackStatus?.()
    }
  }

  private handleFrame(textureInfo: EmbeddedMpvTextureInfo): void {
    if (!this.window || !this.mpv) return
    if (textureInfo.pixels) {
      if (this.softwareFrameInFlight) {
        this.pendingSoftwareFrame = textureInfo
        return
      }
      this.sendSoftwareFrame(textureInfo)
      return
    }
    this.frameStats.received++
    if (this.sendingFrame) this.frameStats.dropped++
    this.pendingFrame = textureInfo
    if (!this.sendingFrame) void this.sendFrameLoop()
  }

  private sendSoftwareFrame(textureInfo: EmbeddedMpvTextureInfo): void {
    if (!this.window || this.window.isDestroyed() || !textureInfo.pixels) return
    this.softwareFrameInFlight = true
    this.window.webContents.send('MpvEmbedded:softwareFrame', {
        pixels: textureInfo.pixels,
        width: textureInfo.width,
        height: textureInfo.height,
        index: this.frameIndex++
      })
  }

  acknowledgeSoftwareFrame(sender: WebContents): void {
    if (!this.window || this.window.isDestroyed() || this.window.webContents !== sender) return
    this.softwareFrameInFlight = false
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
      let imported: ReturnType<typeof sharedTexture.importSharedTexture> | null = null
      try {
        let handle: SharedTextureHandle
        const handleBuffer = Buffer.alloc(8)
        handleBuffer.writeBigUInt64LE(textureInfo.handle)
        handle = process.platform === 'darwin' ? { ioSurface: handleBuffer } : { ntHandle: handleBuffer }
        const startImport = performance.now()
        imported = sharedTexture.importSharedTexture({
          textureInfo: {
            handle,
            codedSize: { width: textureInfo.width, height: textureInfo.height },
            visibleRect: { x: 0, y: 0, width: textureInfo.width, height: textureInfo.height },
            pixelFormat: textureInfo.format === 'nv12' ? 'rgba' : textureInfo.format
          }
        })
        const startSend = performance.now()
        await sharedTexture.sendSharedTexture(
          {
            frame: this.window.webContents.mainFrame,
            importedSharedTexture: imported
          },
          this.frameIndex++
        )
        this.frameStats.importMs += startSend - startImport
        this.frameStats.sendMs += performance.now() - startSend
        this.frameStats.sendCount++
        this.frameStats.sent++
        this.consecutiveFrameErrors = 0
      } catch (error) {
        this.frameStats.errors++
        this.consecutiveFrameErrors++
        if (this.consecutiveFrameErrors === 1 || this.consecutiveFrameErrors === 5) console.error(`[mpv] sharedTexture send failed (${this.consecutiveFrameErrors} consecutive):`, error)
      } finally {
        imported?.release()
      }
    }

    this.sendingFrame = false
  }

  clearTexture(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send('MpvEmbedded:clearTexture')
  }

  destroy(): void {
    if (this.frameStatsTimer) {
      clearInterval(this.frameStatsTimer)
      this.frameStatsTimer = null
    }
    this.clearTexture()
    this.pendingFrame = null
    this.pendingSoftwareFrame = null
    this.softwareFrameInFlight = false
    this.latestStatus = null
    this.mpv?.destroy()
    this.mpv = null
    this.window = null
    this.initialized = false
  }
}

function waitForMpvCommand(delay: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay))
}
