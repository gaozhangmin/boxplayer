export interface VideoQualitySwitchPlaybackState {
  shouldResume: boolean
  position: number
}

export interface VideoQualityCandidate {
  url: string
  html?: string
  quality?: string
  type?: string
  width?: number
  height?: number
  label?: string
  value?: string
  name?: string
  default?: boolean
  headers?: Record<string, string>
}

const ORIGIN_QUALITY_ALIASES = new Set(['origin', '100', '原画', '原始文件'])

const TRANSCODED_QUALITY_TIERS: Record<string, number> = {
  qhd: 5, '5': 5, '4k': 5, '2160p': 5, '2560p': 5, 超高清: 5,
  fhd: 4, '4': 4, '1080p': 4, 全高清: 4,
  hd: 3, '3': 3, '2': 2.5, '720p': 3, 高清: 3, 超清: 3,
  sd: 2, '540p': 2, 标清: 2,
  ld: 1, '1': 1, '480p': 1, 流畅: 1, 低清: 1
}

const normalizeQualityToken = (value?: string | number) => String(value || '').trim().toLowerCase()

export const isOriginVideoQuality = (quality?: Partial<VideoQualityCandidate>): boolean => {
  if (!quality) return false
  return [quality.quality, quality.html, quality.label, quality.value, quality.name]
    .map(normalizeQualityToken)
    .some((token) => ORIGIN_QUALITY_ALIASES.has(token))
}

const qualityResolutionScore = (quality: Partial<VideoQualityCandidate>): number => {
  const width = Number(quality.width || 0)
  const height = Number(quality.height || 0)
  if (width > 0 && height > 0) return width * height
  if (height > 0) return (height * height * 16) / 9
  if (width > 0) return (width * width * 9) / 16
  return 0
}

const qualityTierScore = (quality: Partial<VideoQualityCandidate>): number => {
  const tokens = [quality.quality, quality.value, quality.label, quality.html, quality.name].map(normalizeQualityToken)
  for (const token of tokens) {
    if (token in TRANSCODED_QUALITY_TIERS) return TRANSCODED_QUALITY_TIERS[token]
    for (const [alias, rank] of Object.entries(TRANSCODED_QUALITY_TIERS)) {
      if (alias.length >= 2 && token.includes(alias)) return rank
    }
  }
  return 0
}

export const findOriginFallbackTranscodedQuality = <T extends VideoQualityCandidate>(
  qualities: T[],
  isHlsStream: (item: T) => boolean
): T | undefined => {
  const candidates = qualities.filter((item) => Boolean(item?.url) && !isOriginVideoQuality(item) && isHlsStream(item))
  if (candidates.length === 0) return undefined
  return [...candidates].sort((a, b) => {
    const resDiff = qualityResolutionScore(b) - qualityResolutionScore(a)
    if (resDiff !== 0) return resDiff
    return qualityTierScore(b) - qualityTierScore(a)
  })[0]
}

export const captureVideoQualitySwitchPlaybackState = (playing: boolean, position: number): VideoQualitySwitchPlaybackState => ({
  shouldResume: Boolean(playing),
  position: Number.isFinite(position) && position > 0 ? position : 0
})
