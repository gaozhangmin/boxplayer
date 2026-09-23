export type PlaybackHeaders = Record<string, string>

export const ALIYUN_MPV_PLAYBACK_HEADERS: PlaybackHeaders = {
  Origin: 'https://www.aliyundrive.com',
  Referer: 'https://www.aliyundrive.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0'
}

export function hasPlaybackHeaders(headers?: PlaybackHeaders): boolean {
  return !!headers && Object.entries(headers).some(([key, value]) => Boolean(key.trim() && String(value || '').trim()))
}

/**
 * Merge download headers without allowing an empty quality-level object to hide
 * the provider-level authentication headers. Header names are case-insensitive;
 * later sources override earlier ones while preserving the latest spelling.
 */
export function mergePlaybackHeaders(...sources: Array<PlaybackHeaders | undefined>): PlaybackHeaders | undefined {
  const merged = new Map<string, { key: string; value: string }>()

  for (const source of sources) {
    for (const [rawKey, rawValue] of Object.entries(source || {})) {
      const key = rawKey.trim()
      const value = String(rawValue || '').trim()
      if (!key || !value) continue
      merged.set(key.toLowerCase(), { key, value })
    }
  }

  if (!merged.size) return undefined
  return Object.fromEntries([...merged.values()].map(({ key, value }) => [key, value]))
}

export function mergeMpvPlaybackHeaders(provider: string, ...sources: Array<PlaybackHeaders | undefined>): PlaybackHeaders | undefined {
  return mergePlaybackHeaders(provider === 'aliyun' ? ALIYUN_MPV_PLAYBACK_HEADERS : undefined, ...sources)
}
