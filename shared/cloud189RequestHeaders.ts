export const CLOUD189_DATE_TRANSPORT_HEADER = 'X-Cloud189-Date'

type RequestHeaders = Record<string, string | string[] | undefined>

export function restoreCloud189DateHeader(url: string, headers: RequestHeaders): RequestHeaders {
  const transportEntry = Object.entries(headers).find(([name]) => name.toLowerCase() === CLOUD189_DATE_TRANSPORT_HEADER.toLowerCase())
  if (!transportEntry) return headers
  const date = Array.isArray(transportEntry[1]) ? transportEntry[1][0] : transportEntry[1]
  if (!date || Number.isNaN(Date.parse(date))) return headers

  // Chromium blocks the Date request header. Cloud189's multipart data URL
  // may use a provider-controlled OSS hostname, so trust only this explicit,
  // valid-date transport marker instead of relying on a hostname allowlist.
  try { new URL(url) } catch { return headers }

  const restored = { ...headers }
  for (const name of Object.keys(restored)) {
    const normalized = name.toLowerCase()
    if (normalized === CLOUD189_DATE_TRANSPORT_HEADER.toLowerCase() || normalized === 'date') delete restored[name]
  }
  restored.Date = date
  return restored
}
