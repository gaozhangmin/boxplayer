export const CLOUD189_DATE_TRANSPORT_HEADER = 'X-Cloud189-Date'

type RequestHeaders = Record<string, string | string[] | undefined>

export function restoreCloud189DateHeader(url: string, headers: RequestHeaders): RequestHeaders {
  let hostname = ''
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return headers
  }
  if (hostname !== 'api.cloud.189.cn') return headers

  const transportEntry = Object.entries(headers).find(([name]) => name.toLowerCase() === CLOUD189_DATE_TRANSPORT_HEADER.toLowerCase())
  if (!transportEntry) return headers
  const date = Array.isArray(transportEntry[1]) ? transportEntry[1][0] : transportEntry[1]
  if (!date) return headers

  const restored = { ...headers }
  for (const name of Object.keys(restored)) {
    const normalized = name.toLowerCase()
    if (normalized === CLOUD189_DATE_TRANSPORT_HEADER.toLowerCase() || normalized === 'date') delete restored[name]
  }
  restored.Date = date
  return restored
}
