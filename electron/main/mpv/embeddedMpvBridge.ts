import { BrowserWindow, WebContents } from 'electron'
import { EmbeddedMpvCapability, getEmbeddedMpvCapability } from './embeddedMpvCapability'
import { EmbeddedMpvTextureBridge } from './embeddedMpvTextureBridge'
import type { EmbeddedMpvStatus, EmbeddedMpvSubtitleStyle, EmbeddedMpvTrackStatus } from './embeddedMpvNativeAddon'

export interface EmbeddedMpvLoadRequest {
  url?: string
  headers?: Record<string, string>
  title?: string
  startPosition?: number
}

export interface EmbeddedMpvLoadResult {
  ok: boolean
  capability: EmbeddedMpvCapability
  error?: string
}

export type EmbeddedMpvControlAction = 'play' | 'pause' | 'stop' | 'seek' | 'setVolume' | 'setSpeed' | 'setAudioTrack' | 'setSubtitleTrack' | 'setSubtitleStyle' | 'setVideoProperty' | 'addAudio' | 'addSubtitle'

export interface EmbeddedMpvControlRequest {
  action?: EmbeddedMpvControlAction
  value?: number
  url?: string
  title?: string
  style?: EmbeddedMpvSubtitleStyle
  property?: string
  propertyValue?: string | number | boolean
}

export interface EmbeddedMpvControlResult {
  ok: boolean
  capability: EmbeddedMpvCapability
  status?: EmbeddedMpvStatus
  trackStatus?: EmbeddedMpvTrackStatus
  error?: string
  warning?: string
}

export interface EmbeddedMpvBridge {
  getCapability(): EmbeddedMpvCapability
  load(request: EmbeddedMpvLoadRequest, sender?: WebContents): Promise<EmbeddedMpvLoadResult>
  control(request: EmbeddedMpvControlRequest): Promise<EmbeddedMpvControlResult>
  getStatus(): Promise<EmbeddedMpvControlResult>
  acknowledgeSoftwareFrame?(sender: WebContents): void
}

export class DisabledEmbeddedMpvBridge implements EmbeddedMpvBridge {
  getCapability(): EmbeddedMpvCapability {
    return getEmbeddedMpvCapability()
  }

  async load(_request: EmbeddedMpvLoadRequest, _sender?: WebContents): Promise<EmbeddedMpvLoadResult> {
    const capability = this.getCapability()
    return {
      ok: false,
      capability,
      error: capability.reason || 'macOS 内嵌 MPV 尚未启用；当前版本不会尝试加载 native libmpv。'
    }
  }

  async control(_request: EmbeddedMpvControlRequest): Promise<EmbeddedMpvControlResult> {
    const capability = this.getCapability()
    return {
      ok: false,
      capability,
      error: capability.reason || 'macOS 内嵌 MPV 尚未启用。'
    }
  }

  async getStatus(): Promise<EmbeddedMpvControlResult> {
    const capability = this.getCapability()
    return {
      ok: false,
      capability,
      error: capability.reason || 'macOS 内嵌 MPV 尚未启用。'
    }
  }

}

export class RoutedEmbeddedMpvBridge implements EmbeddedMpvBridge {
  private readonly textureBridge = new EmbeddedMpvTextureBridge()

  getCapability(): EmbeddedMpvCapability {
    return this.textureBridge.getCapability()
  }

  acknowledgeSoftwareFrame(sender: WebContents): void {
    this.textureBridge.acknowledgeSoftwareFrame(sender)
  }

  async load(request: EmbeddedMpvLoadRequest, sender?: WebContents): Promise<EmbeddedMpvLoadResult> {
    const window = sender ? BrowserWindow.fromWebContents(sender) : null
    if (!window) {
      const capability = this.getCapability()
      return {
        ok: false,
        capability,
        error: '找不到用于承载 macOS 内嵌 MPV 的窗口。'
      }
    }
    return this.textureBridge.load(window, request)
  }

  async control(request: EmbeddedMpvControlRequest): Promise<EmbeddedMpvControlResult> {
    return this.textureBridge.control(request)
  }

  async getStatus(): Promise<EmbeddedMpvControlResult> {
    return this.textureBridge.getStatus()
  }

}

export const embeddedMpvBridge: EmbeddedMpvBridge = new RoutedEmbeddedMpvBridge()
