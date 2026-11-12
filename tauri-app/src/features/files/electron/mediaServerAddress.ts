export type ServerHttpsMode = 'auto' | 'on' | 'off'

/** Automatic preserves an explicit URL scheme, or uses HTTPS for port 443. */
export function buildMediaServerAddress(address: string, port: string, path: string, mode: ServerHttpsMode) {
  const raw = address.trim()
  if (!raw || /\s/.test(raw)) throw new Error('Invalid host')
  const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
  const url = new URL(explicit ? raw : 'http://' + raw)
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error('Invalid address')
  const suppliedPort = port.trim()
  if (suppliedPort && (!/^\d+$/.test(suppliedPort) || Number(suppliedPort) < 1 || Number(suppliedPort) > 65535)) throw new Error('Invalid port')
  // A complete address takes precedence over the default port shown in the form.
  const effectivePort = url.port || (explicit ? '' : suppliedPort)
  const useHttps = mode === 'on' || (mode === 'auto' && (url.protocol === 'https:' || effectivePort === '443'))
  url.protocol = useHttps ? 'https:' : 'http:'
  url.port = effectivePort
  const inputPath = path.trim()
  if (inputPath) url.pathname = '/' + inputPath.replace(/^\/+/, '')
  const normalizedPath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  return { baseUrl: url.origin + normalizedPath, host: url.hostname, port: url.port, path: normalizedPath, useHttps }
}
