import type { EmbeddedMpvLoadRequest } from './embeddedMpvBridge'

// loadfile parses key/value options before http-header-fields parses its list.
// Protect the entire value so commas survive the outer parser. libmpv counts
// UTF-8 bytes, rather than JavaScript UTF-16 characters.
const quoteMpvOption = (value: string) => `%${Buffer.byteLength(value, 'utf8')}%${value}`

const escapeMpvHeaderValue = (value: unknown) => String(value).replace(/\\/g, '\\\\').replace(/,/g, '\\,')

export function buildMpvLoadOptions(request: EmbeddedMpvLoadRequest): string {
  const options: string[] = []
  if (request.audioOnly) options.push('vid=no', 'sid=no')
  if (Number.isFinite(request.startPosition) && request.startPosition! > 0) options.push(`start=${request.startPosition}`)

  const headers = Object.entries(request.headers || {})
    .filter(([key, value]) => key && value != null && String(value))
  const userAgent = headers.find(([key]) => key.toLowerCase() === 'user-agent')?.[1]
  const referrer = headers.find(([key]) => key.toLowerCase() === 'referer' || key.toLowerCase() === 'referrer')?.[1]
  const headerFields = headers
    .filter(([key]) => !['user-agent', 'referer', 'referrer'].includes(key.toLowerCase()))
    .map(([key, value]) => `${key}: ${escapeMpvHeaderValue(value)}`)

  if (userAgent) options.push(`user-agent=${quoteMpvOption(String(userAgent))}`)
  if (referrer) options.push(`referrer=${quoteMpvOption(String(referrer))}`)
  if (headerFields.length) options.push(`http-header-fields=${quoteMpvOption(headerFields.join(','))}`)
  return options.join(',')
}
