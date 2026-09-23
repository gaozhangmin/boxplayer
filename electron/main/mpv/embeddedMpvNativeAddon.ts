import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { getResourcesPath, getStaticPath } from '../utils/mainfile'
import { createLinuxMpvHost } from './embeddedMpvLinuxHost'

export interface EmbeddedMpvTextureInfo {
  handle: bigint
  width: number
  height: number
  format: 'rgba' | 'bgra' | 'nv12' | string
  pixels?: Buffer
}

export interface EmbeddedMpvStatus {
  playing?: boolean
  paused?: boolean
  position?: number
  duration?: number
  volume?: number
  speed?: number
  width?: number
  height?: number
}

export interface EmbeddedMpvTrack {
  id: number
  type: string
  title?: string
  language?: string
  codec?: string
  selected?: boolean
  external?: boolean
}

export interface EmbeddedMpvTrackStatus {
  audioId?: number
  subtitleId?: number
  tracks?: EmbeddedMpvTrack[]
}

export interface EmbeddedMpvSubtitleStyle {
  fontSize?: number
  color?: string
  position?: number
  bold?: boolean
  italic?: boolean
}

export interface EmbeddedMpvNativeInstance {
  renderMode?: 'texture' | 'software'
  create(config?: Record<string, unknown>): void
  load(url: string, options?: string): Promise<void> | void
  play(): Promise<void> | void
  pause(): Promise<void> | void
  stop(): Promise<void> | void
  seek(position: number): Promise<void> | void
  setVolume(volume: number): Promise<void> | void
  setSpeed?: (speed: number) => Promise<void> | void
  setAudioTrack?: (id: number) => Promise<void> | void
  setSubtitleTrack?: (id: number) => Promise<void> | void
  setSubtitleStyle?: (style: EmbeddedMpvSubtitleStyle) => Promise<void> | void
  setVideoProperty?: (name: string, value: string) => Promise<void> | void
  addAudio?: (url: string, title?: string) => Promise<void> | void
  addSubtitle?: (url: string, title?: string) => Promise<void> | void
  pollEvents?: () => void
  getStatus(): EmbeddedMpvStatus
  getTrackStatus?: () => EmbeddedMpvTrackStatus
  refreshTrackStatus?: () => Promise<EmbeddedMpvTrackStatus>
  destroy(): void
  onFrame(callback: (textureInfo: EmbeddedMpvTextureInfo) => void): void
  onStatus(callback: (status: EmbeddedMpvStatus) => void): void
  onError(callback: (error: string) => void): void
  releaseFrame?: () => void
  isInitialized?: () => boolean
}

export interface EmbeddedMpvNativeAddon {
  mpvTexture: EmbeddedMpvNativeInstance
}

export interface EmbeddedMpvNativeAddonLoadResult {
  addon?: EmbeddedMpvNativeAddon
  addonPath?: string
  error?: string
  searchedPaths: string[]
}

export interface EmbeddedMpvNativeResourceStatus {
  complete: boolean
  directory?: string
  missing: string[]
  error?: string
}

const requireNative = createRequire(import.meta.url)

export const EMBEDDED_MPV_LIBRARY_BY_PLATFORM: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'libmpv.dylib',
  win32: 'libmpv-2.dll',
  linux: 'libmpv.so.2'
}

export function isEmbeddedMpvTarget(platform: string, arch: string): boolean {
  return (platform === 'darwin' || platform === 'linux') && (arch === 'x64' || arch === 'arm64') || platform === 'win32' && arch === 'x64'
}

export function getEmbeddedMpvNativeAddonRelativePaths(platform = process.platform, arch = process.arch): string[] {
  if (!isEmbeddedMpvTarget(platform, arch)) return []
  const sbtlRelativePath = path.join('engine', platform, arch, 'mpv-texture', 'mpv_texture.node')
  const legacyRelativePath = path.join('engine', platform, arch, 'mpv-texture', 'boxplayer-mpv-texture.node')
  return [sbtlRelativePath, legacyRelativePath]
}

export function getEmbeddedMpvNativeAddonCandidates(platform = process.platform, arch = process.arch): string[] {
  const [sbtlRelativePath, legacyRelativePath] = getEmbeddedMpvNativeAddonRelativePaths(platform, arch)
  if (!sbtlRelativePath || !legacyRelativePath) return []
  return [
    getResourcesPath(sbtlRelativePath),
    getStaticPath(sbtlRelativePath),
    getResourcesPath(legacyRelativePath),
    getStaticPath(legacyRelativePath)
  ]
}

export function getEmbeddedMpvNativeResourceStatus(candidates = getEmbeddedMpvNativeAddonCandidates(), platform = process.platform): EmbeddedMpvNativeResourceStatus {
  const missing: string[] = []
  let firstIncomplete: EmbeddedMpvNativeResourceStatus | undefined
  const libraryName = EMBEDDED_MPV_LIBRARY_BY_PLATFORM[platform as NodeJS.Platform]
  if (!libraryName) return { complete: false, missing: [], error: `不支持 ${platform} 的 libmpv 资源包。` }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      missing.push(candidate)
      continue
    }

    const directory = path.dirname(candidate)
    const libmpvPath = path.join(directory, libraryName)
    const manifestPath = path.join(directory, 'mpv-bundle-manifest.json')
    const directoryMissing = [libmpvPath, manifestPath, ...(platform === 'linux' ? [path.join(directory, 'mpv-node-host'), path.join(directory, 'mpv-host.cjs')] : [])].filter((filePath) => !existsSync(filePath))
    if (directoryMissing.length > 0) {
      firstIncomplete ||= {
        complete: false,
        directory,
        missing: directoryMissing
      }
      continue
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const files = Array.isArray(manifest?.files) ? manifest.files : []
      const hasNode = files.some((file: any) => file?.name === path.basename(candidate))
      const hasLibmpv = files.some((file: any) => file?.name === libraryName)
      const hasHost = platform !== 'linux' || (files.some((file: any) => file?.name === 'mpv-node-host') && files.some((file: any) => file?.name === 'mpv-host.cjs'))
      if (!hasNode || !hasLibmpv || !hasHost) {
        firstIncomplete ||= {
          complete: false,
          directory,
          missing: [
            ...(hasNode ? [] : [`mpv-bundle-manifest.json:${path.basename(candidate)}`]),
            ...(hasLibmpv ? [] : [`mpv-bundle-manifest.json:${libraryName}`]),
            ...(hasHost ? [] : ['mpv-bundle-manifest.json:mpv-host.cjs/mpv-node-host'])
          ]
        }
        continue
      }
    } catch (error: any) {
      firstIncomplete ||= {
        complete: false,
        directory,
        missing: [],
        error: error?.message || 'MPV resource manifest 读取失败。'
      }
      continue
    }

    return {
      complete: true,
      directory,
      missing: []
    }
  }

  if (firstIncomplete) return firstIncomplete
  return {
    complete: false,
    missing
  }
}

function hasSbtlMpvTextureShape(mpvTexture: any): mpvTexture is EmbeddedMpvNativeInstance {
  return Boolean(
    mpvTexture &&
      typeof mpvTexture.create === 'function' &&
      typeof mpvTexture.load === 'function' &&
      typeof mpvTexture.play === 'function' &&
      typeof mpvTexture.pause === 'function' &&
      typeof mpvTexture.stop === 'function' &&
      typeof mpvTexture.seek === 'function' &&
      typeof mpvTexture.setVolume === 'function' &&
      typeof mpvTexture.getStatus === 'function' &&
      typeof mpvTexture.destroy === 'function' &&
      typeof mpvTexture.onFrame === 'function' &&
      typeof mpvTexture.onStatus === 'function' &&
      typeof mpvTexture.onError === 'function'
  )
}

function normalizeMpvStatus(status: EmbeddedMpvStatus | undefined, fallbackSpeed = 1): EmbeddedMpvStatus {
  const playing = Boolean(status?.playing)
  return {
    ...(status || {}),
    playing,
    paused: typeof status?.paused === 'boolean' ? status.paused : !playing,
    speed: typeof status?.speed === 'number' ? status.speed : fallbackSpeed
  }
}

function toEmbeddedMpvNativeAddon(value: any): EmbeddedMpvNativeAddon | null {
  const mpvTexture = hasSbtlMpvTextureShape(value?.mpvTexture) ? value.mpvTexture : hasSbtlMpvTextureShape(value) ? value : null
  if (!mpvTexture) return null
  let requestedSpeed = 1
  return {
    mpvTexture: {
      ...mpvTexture,
      load(url: string, options?: string) {
        return mpvTexture.load(url, options)
      },
      getStatus() {
        return normalizeMpvStatus(mpvTexture.getStatus?.(), requestedSpeed)
      },
      getTrackStatus() {
        return mpvTexture.getTrackStatus?.() || { audioId: -1, subtitleId: -1, tracks: [] }
      },
      onStatus(callback: (status: EmbeddedMpvStatus) => void) {
        mpvTexture.onStatus((status) => callback(normalizeMpvStatus(status, requestedSpeed)))
      },
      setSpeed: typeof mpvTexture.setSpeed === 'function' || typeof mpvTexture.setVideoProperty === 'function'
        ? (speed: number) => {
            if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new RangeError('MPV 倍速必须在 0.25–4 倍之间。')
            if (typeof mpvTexture.setSpeed === 'function') mpvTexture.setSpeed(speed)
            else mpvTexture.setVideoProperty('speed', String(speed))
            requestedSpeed = speed
          }
        : undefined,
      setAudioTrack: mpvTexture.setAudioTrack,
      setSubtitleTrack: mpvTexture.setSubtitleTrack,
      setSubtitleStyle: mpvTexture.setSubtitleStyle,
      setVideoProperty: mpvTexture.setVideoProperty,
      addAudio: mpvTexture.addAudio,
      addSubtitle: mpvTexture.addSubtitle,
      pollEvents: mpvTexture.pollEvents,
      releaseFrame: mpvTexture.releaseFrame
    }
  }
}

export function loadEmbeddedMpvNativeAddon(candidates = getEmbeddedMpvNativeAddonCandidates()): EmbeddedMpvNativeAddonLoadResult {
  const failures: string[] = []
  let failedPath: string | undefined
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const addon = process.platform === 'linux'
        ? { mpvTexture: createLinuxMpvHost(candidate) }
        : toEmbeddedMpvNativeAddon(requireNative(candidate))
      if (!addon) {
        failedPath ||= candidate
        failures.push(`${path.basename(candidate)}: MPV native addon 接口不完整。`)
        continue
      }
      return {
        addon,
        addonPath: candidate,
        searchedPaths: candidates
      }
    } catch (error: any) {
      failedPath ||= candidate
      failures.push(`${path.basename(candidate)}: ${error?.message || 'MPV native addon 加载失败。'}`)
    }
  }

  return {
    addonPath: failedPath,
    error: failures.length > 0 ? failures.join('；') : '未找到 MPV native addon。',
    searchedPaths: candidates
  }
}
