import {normalizeBoxPlayerPlatform} from './driveIdentity'
/** The boxplayer storage brand for a BoxPlayer drive platform. */
export function storageBrandForPlatform(platform: string): string {
  const normalized = normalizeBoxPlayerPlatform(platform)
  if (normalized === '115') return 'pan115'
  if (['quark', 'guangya', 'cloud123', 'aliyun', 'pikpak'].includes(normalized)) return normalized
  throw new Error(`${platform} 暂不支持 AI 媒体获取`)
}

export function isBoxPlayerPlatformSupported(platform: string): boolean {
  try {
    storageBrandForPlatform(platform)
    return true
  } catch {
    return false
  }
}

