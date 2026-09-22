import { EMBEDDED_MPV_LIBRARY_BY_PLATFORM, isEmbeddedMpvTarget } from './embeddedMpvNativeAddon'

export type EmbeddedMpvStatus = 'available' | 'disabled' | 'unsupported-platform'

export interface EmbeddedMpvCapability {
  status: EmbeddedMpvStatus
  enabled: boolean
  platform: NodeJS.Platform | string
  electronVersion: string
  requirements: string[]
  reason?: string
}

export const MACOS_EMBEDDED_MPV_REQUIREMENTS = [
  'Electron sharedTexture API',
  'macOS libmpv native addon',
  'bundled libmpv.dylib and transitive dylibs'
]

const PLATFORM_NAME: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export function getEmbeddedMpvCapability(options: {
  platform?: NodeJS.Platform | string
  arch?: string
  electronVersion?: string
  featureFlag?: string
  nativeAddonAvailable?: boolean
  nativeAddonError?: string
  nativeResourcesComplete?: boolean
  nativeResourcesMissing?: string[]
  rendererAvailable?: boolean
} = {}): EmbeddedMpvCapability {
  const platform = options.platform || process.platform
  const arch = options.arch || process.arch
  const electronVersion = options.electronVersion || process.versions.electron || ''
  const nativeAddonAvailable = options.nativeAddonAvailable === true
  const nativeResourcesComplete = options.nativeResourcesComplete === true
  const platformName = PLATFORM_NAME[platform] || platform
  const base = {
    platform,
    electronVersion,
    requirements: platform === 'darwin' ? MACOS_EMBEDDED_MPV_REQUIREMENTS : [
      'Electron sharedTexture API',
      `${platformName} libmpv native addon and texture renderer`,
      `bundled ${EMBEDDED_MPV_LIBRARY_BY_PLATFORM[platform as NodeJS.Platform] || 'libmpv'} and dependencies`
    ]
  }

  if (!isEmbeddedMpvTarget(platform, arch)) {
    return {
      ...base,
      status: 'unsupported-platform',
      enabled: false,
      reason: `内嵌 libmpv 尚未规划 ${platformName} ${arch}。`
    }
  }

  if (!nativeAddonAvailable) {
    const missingBundle = options.nativeResourcesMissing?.length && options.nativeResourcesMissing.every((item) => item.endsWith('.node'))
    return {
      ...base,
      status: 'disabled',
      enabled: false,
      reason: missingBundle
        ? `缺少 ${platformName} ${arch} 版 libmpv 原生模块；当前架构不能使用其他架构的资源包。`
        : options.nativeAddonError
          ? `${platformName} ${arch} libmpv 原生模块不可加载：${options.nativeAddonError}`
          : `${platformName} ${arch} libmpv 原生模块尚未接入或不可加载。`
    }
  }

  if (!nativeResourcesComplete) {
    return {
      ...base,
      status: 'disabled',
      enabled: false,
      reason: `${platformName} libmpv 资源包不完整，尚不能启用内嵌 MPV。`
    }
  }

  // A matching bundle alone must never advertise working playback without a
  // corresponding renderer (shared texture on macOS, software on Win/Linux).
  if (options.rendererAvailable === false || (platform !== 'darwin' && options.rendererAvailable !== true)) {
    return {
      ...base,
      status: 'disabled',
      enabled: false,
      reason: `${platformName} ${arch} libmpv 画面渲染桥尚未接入。`
    }
  }

  return {
    ...base,
    status: 'available',
    enabled: true
  }
}
