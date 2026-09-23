export type QuarkCookieLike = {
  name?: string
  value?: string
  domain?: string
}

const cookiePairs = (header = '') => header
  .split(';')
  .map((item) => item.trim())
  .filter((item) => item.includes('='))
  .map((item) => {
    const separator = item.indexOf('=')
    return [item.slice(0, separator).trim(), item.slice(separator + 1).trim()] as const
  })
  .filter(([name, value]) => !!name && !!value)

/** Combine Cookie headers without letting a fallback overwrite the active session. */
export const mergeQuarkCookieHeaders = (preferred = '', supplemental = '') => {
  const cookies = new Map<string, [string, string]>()
  for (const [name, value] of cookiePairs(supplemental)) cookies.set(name.toLowerCase(), [name, value])
  for (const [name, value] of cookiePairs(preferred)) cookies.set(name.toLowerCase(), [name, value])
  return Array.from(cookies.values(), ([name, value]) => `${name}=${value}`).join('; ')
}

/** Only include cookies that apply to the actual Quark request host. */
export const buildQuarkCookieHeader = (cookies: QuarkCookieLike[], targetUrl: string) => {
  let host = ''
  try {
    host = new URL(targetUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
  const applicable = cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => ({ ...cookie, normalizedDomain: String(cookie.domain || '').replace(/^\./, '').toLowerCase() }))
    .filter((cookie) => cookie.normalizedDomain === host || host.endsWith(`.${cookie.normalizedDomain}`))
    .sort((left, right) => left.normalizedDomain.length - right.normalizedDomain.length)
  const values = new Map<string, [string, string]>()
  for (const cookie of applicable) values.set(String(cookie.name).toLowerCase(), [String(cookie.name), String(cookie.value)])
  return Array.from(values.values(), ([name, value]) => `${name}=${value}`).join('; ')
}
