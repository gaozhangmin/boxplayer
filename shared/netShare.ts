// Shared (renderer + main) helpers for SMB / NFS / FTP network-share sources.
// Must stay free of Node imports: it is type-checked as renderer code too.

export type NetShareKind = 'smb' | 'nfs' | 'ftp'

export const NET_SHARE_KINDS: readonly NetShareKind[] = ['smb', 'nfs', 'ftp']

export const isNetShareKind = (kind?: string): kind is NetShareKind => kind === 'smb' || kind === 'nfs' || kind === 'ftp'

/** Connection settings the main process needs. `password` may be a `safe:` protected secret. */
export interface NetShareConfig {
  id: string
  kind: NetShareKind
  host: string
  port?: number
  /** SMB share name; empty means the root lists the server's disk shares. */
  share?: string
  domain?: string
  username?: string
  password?: string
  /** SMB guest / FTP anonymous login. */
  anonymous?: boolean
  /** NFS export path, e.g. /volume1/video */
  exportPath?: string
  /** Sub path inside the share / export / FTP server used as the source root. */
  rootPath: string
  /** FTP: explicit TLS (AUTH TLS). */
  secure?: boolean
  /** FTP: accept self-signed / untrusted TLS certificates. */
  allowUntrustedCert?: boolean
  /** FTP: passive mode (the only mode supported by the client library). */
  passive?: boolean
  /** FTP control-channel file name encoding, e.g. utf8, gbk, big5, shift_jis. */
  encoding?: string
}

export interface NetShareEntry {
  name: string
  /** Path relative to the source root, always starting with `/`. */
  path: string
  isDir: boolean
  size: number
  mtime: number
}

export const NET_SHARE_DEFAULT_PORTS: Record<NetShareKind, number> = { smb: 445, nfs: 2049, ftp: 21 }

export const normalizeSharePath = (value?: string): string => {
  const raw = String(value ?? '/').trim().replace(/\\/g, '/')
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { parts.pop(); continue }
    parts.push(part)
  }
  return '/' + parts.join('/')
}

export const joinSharePath = (...values: Array<string | undefined>): string => normalizeSharePath(values.filter(Boolean).join('/'))

export const shareBaseName = (value: string): string => {
  const normalized = normalizeSharePath(value)
  return normalized === '/' ? '' : normalized.slice(normalized.lastIndexOf('/') + 1)
}

export const shareDirName = (value: string): string => {
  const normalized = normalizeSharePath(value)
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '/' : normalized.slice(0, index)
}

/** Splits the effective SMB path (share + rootPath + relative) into share name and in-share path. */
export const resolveSmbPath = (config: Pick<NetShareConfig, 'share' | 'rootPath'>, relativePath: string): { share: string; path: string } => {
  const share = String(config.share || '').trim().replace(/^[\\/]+|[\\/]+$/g, '')
  const full = share ? joinSharePath(config.rootPath, relativePath) : joinSharePath(relativePath)
  if (share) return { share, path: full }
  const segments = full.split('/').filter(Boolean)
  return { share: segments[0] || '', path: '/' + segments.slice(1).join('/') }
}

export const describeNetShare = (config: Pick<NetShareConfig, 'kind' | 'host' | 'port' | 'share' | 'exportPath'>): string => {
  const host = String(config.host || '').trim()
  const port = config.port && config.port !== NET_SHARE_DEFAULT_PORTS[config.kind] ? `:${config.port}` : ''
  if (config.kind === 'smb') return `smb://${host}${port}${config.share ? '/' + config.share : ''}`
  if (config.kind === 'nfs') return `nfs://${host}${port}${normalizeSharePath(config.exportPath)}`
  return `ftp://${host}${port}`
}

export const sortShareEntries = <T extends { name: string; isDir: boolean }>(entries: T[]): T[] =>
  [...entries].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) : a.isDir ? -1 : 1))

// ---------- Local stream proxy URL ----------

const toBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string): string => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** `/netshare/<secret>/<connectionId>/<base64url(path)>/<file name>` — the trailing name keeps the extension visible to players. */
export const buildNetShareStreamPath = (secret: string, connectionId: string, relativePath: string): string => {
  const normalized = normalizeSharePath(relativePath)
  return `/netshare/${encodeURIComponent(secret)}/${encodeURIComponent(connectionId)}/${toBase64Url(normalized)}/${encodeURIComponent(shareBaseName(normalized) || 'file')}`
}

export const parseNetShareStreamPath = (pathname: string): { secret: string; connectionId: string; path: string } | undefined => {
  const match = /^\/netshare\/([^/]+)\/([^/]+)\/([A-Za-z0-9_-]+)(?:\/[^/]*)?$/.exec(pathname.split('?')[0])
  if (!match) return undefined
  try {
    return { secret: decodeURIComponent(match[1]), connectionId: decodeURIComponent(match[2]), path: normalizeSharePath(fromBase64Url(match[3])) }
  } catch {
    return undefined
  }
}

export type ByteRange = { start: number; end: number }

/**
 * Parses a single HTTP `Range: bytes=` header against a known size.
 * Returns undefined when absent/unsupported (serve the whole file), or 'unsatisfiable' for 416.
 */
export const parseByteRange = (header: string | undefined, size: number): ByteRange | 'unsatisfiable' | undefined => {
  if (!header) return undefined
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header)
  if (!match) return undefined // multi-range or malformed: fall back to a full response
  const [, startText, endText] = match
  if (!startText && !endText) return undefined
  if (size <= 0) return 'unsatisfiable'
  if (!startText) {
    const suffix = Number(endText)
    if (suffix <= 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startText)
  if (start >= size) return 'unsatisfiable'
  const end = endText ? Math.min(Number(endText), size - 1) : size - 1
  if (end < start) return 'unsatisfiable'
  return { start, end }
}
