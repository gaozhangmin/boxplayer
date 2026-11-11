import path from 'path'
import fsPromises from 'fs/promises'
import { createClient, type FileStat } from 'webdav'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import { describeNetShare, isNetShareKind, normalizeSharePath, type NetShareConfig, type NetShareEntry, type NetShareKind } from '@shared/netShare'

const STORAGE_KEY = 'MediaLibrary_WebDavConnections'
const aListTokenCache = new Map<string, string>()

export type RemoteSourceKind = 'webdav' | 'alist' | NetShareKind

export interface WebDavConnectionConfig {
  id: string
  kind?: RemoteSourceKind
  name: string
  /** WebDAV/AList endpoint; for SMB/NFS/FTP a display-only `smb://host/share` style address. */
  url: string
  username: string
  /** WebDAV/AList: plaintext (legacy). SMB/NFS/FTP: `safe:` value encrypted by the main process when secure storage is available. */
  password: string
  rootPath: string
  createdAt: string
  host?: string
  port?: number
  share?: string
  domain?: string
  anonymous?: boolean
  exportPath?: string
  secure?: boolean
  allowUntrustedCert?: boolean
  passive?: boolean
  encoding?: string
}

export const isNetShareConnection = (config?: Pick<WebDavConnectionConfig, 'kind'>): config is WebDavConnectionConfig & { kind: NetShareKind } => isNetShareKind(config?.kind)

export const getRemoteSourceLabel = (kind?: string) => {
  switch (kind) {
    case 'alist': return 'AList'
    case 'smb': return 'SMB'
    case 'nfs': return 'NFS'
    case 'ftp': return 'FTP'
    default: return 'WebDAV'
  }
}

export const toNetShareConfig = (config: WebDavConnectionConfig): NetShareConfig => ({
  id: config.id,
  kind: config.kind as NetShareKind,
  host: String(config.host || '').trim(),
  port: config.port || undefined,
  share: config.share || '',
  domain: config.domain || '',
  username: config.username || '',
  password: config.password || '',
  anonymous: !!config.anonymous,
  exportPath: config.exportPath || '',
  rootPath: normalizeSharePath(config.rootPath),
  secure: !!config.secure,
  allowUntrustedCert: !!config.allowUntrustedCert,
  passive: config.passive !== false,
  encoding: config.encoding || 'utf8'
})

const netShareInvoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const ipc = typeof window !== 'undefined' ? (window as any).Electron?.ipcRenderer : undefined
  if (!ipc?.invoke) throw new Error('网络共享仅在桌面客户端中可用')
  try {
    return await ipc.invoke(channel, ...args)
  } catch (error: any) {
    // Electron prefixes remote errors with "Error invoking remote method '…': Error: "
    throw new Error(String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
  }
}

export const protectNetShareSecret = (plain: string) => plain ? netShareInvoke<string>('NetShare:protectSecret', plain) : Promise.resolve('')
export const listNetShareShares = (config: WebDavConnectionConfig) => netShareInvoke<string[]>('NetShare:listShares', toNetShareConfig(config))
export const getNetShareStreamUrl = (config: WebDavConnectionConfig, relativePath: string) => netShareInvoke<string>('NetShare:streamUrl', toNetShareConfig(config), normalizeSharePath(relativePath))

export interface NetShareConnectionInput {
  kind: NetShareKind
  name: string
  host: string
  port?: number | string
  share?: string
  domain?: string
  username?: string
  password?: string
  anonymous?: boolean
  exportPath?: string
  rootPath?: string
  secure?: boolean
  allowUntrustedCert?: boolean
  passive?: boolean
  encoding?: string
}

/** Normalises a user-entered host: strips scheme (smb://, ftp://), credentials, path and brackets around IPv6. */
export const normalizeNetShareHost = (value: string) => {
  let host = String(value || '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\\\\/, '')
  host = host.replace(/^[^@/]*@/, '').split(/[/\\]/)[0]
  if (/^\[.*\](:\d+)?$/.test(host)) return host.replace(/^\[(.*)\](:\d+)?$/, '$1')
  const colon = host.split(':')
  return colon.length === 2 && /^\d+$/.test(colon[1]) ? colon[0] : host
}

export const createNetShareConnection = (input: NetShareConnectionInput, existing?: WebDavConnectionConfig): WebDavConnectionConfig => {
  const host = normalizeNetShareHost(input.host)
  const portNumber = Number(input.port)
  const port = Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536 ? portNumber : undefined
  const share = String(input.share || '').trim().replace(/^[\\/]+|[\\/]+$/g, '')
  const anonymous = input.kind === 'nfs' ? true : !!input.anonymous
  const base = {
    kind: input.kind,
    host,
    port,
    share: input.kind === 'smb' ? share : '',
    domain: input.kind === 'smb' ? String(input.domain || '').trim() : '',
    username: anonymous ? '' : String(input.username || '').trim(),
    password: anonymous ? '' : String(input.password || ''),
    anonymous,
    exportPath: input.kind === 'nfs' ? normalizeSharePath(input.exportPath || '/') : '',
    rootPath: normalizeSharePath(input.rootPath || '/'),
    secure: input.kind === 'ftp' ? !!input.secure : false,
    allowUntrustedCert: input.kind === 'ftp' ? !!input.allowUntrustedCert : false,
    passive: input.kind === 'ftp' ? input.passive !== false : undefined,
    encoding: input.kind === 'ftp' ? (String(input.encoding || 'utf8').trim() || 'utf8') : undefined
  }
  const timestamp = Date.now().toString()
  const id = existing?.id || btoa(encodeURIComponent(`${input.kind}|${host}|${port || ''}|${base.share}${base.exportPath}|${base.username}|${base.rootPath}|${timestamp}`)).replace(/[^a-zA-Z0-9]/g, '').slice(-24)
  const url = describeNetShare({ kind: input.kind, host, port, share: base.share, exportPath: base.exportPath })
  return {
    ...base,
    id,
    name: String(input.name || '').trim() || (input.kind === 'smb' && base.share ? `${base.share} (${host})` : host),
    url,
    createdAt: existing?.createdAt || new Date().toISOString()
  }
}

const netShareEntryToModel = (config: WebDavConnectionConfig, entry: NetShareEntry, parentPath: string): IAliGetFileModel => {
  const ext = entry.isDir ? '' : path.extname(entry.name).replace('.', '').toLowerCase()
  const iconInfo = entry.isDir ? ['folder', 'iconfile-folder'] : getFileIcon(VIDEO_EXTENSIONS.has(`.${ext}`) ? 'video' : 'others', ext, ext, '', entry.size)
  return {
    __v_skip: true,
    drive_id: `webdav:${config.id}`,
    file_id: entry.path,
    parent_file_id: parentPath,
    name: entry.name,
    namesearch: entry.name.toLowerCase(),
    path: entry.path,
    ext,
    mime_type: '',
    mime_extension: ext,
    category: iconInfo[0],
    icon: iconInfo[1],
    size: entry.size,
    sizeStr: '',
    time: entry.mtime || Date.now(),
    timeStr: '',
    starred: false,
    isDir: entry.isDir,
    thumbnail: '',
    description: ''
  }
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
  '.mpg', '.mpeg', '.3gp', '.rmvb', '.asf', '.divx', '.xvid', '.ts',
  '.m2ts', '.mts', '.vob', '.ogv', '.dv'
])

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '')

const getAListDavUrl = (url: string) => {
  const normalized = normalizeUrl(url)
  return normalized.endsWith('/dav') ? normalized : `${normalized}/dav`
}

export const normalizeWebDavPath = (value: string) => {
  const trimmed = (value || '/').trim()
  if (!trimmed || trimmed === '/') return '/'
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

const joinDavPath = (basePath: string, nextPath: string) => {
  const normalizedBase = normalizeWebDavPath(basePath)
  const normalizedNext = normalizeWebDavPath(nextPath)
  if (normalizedBase === '/') return normalizedNext
  if (normalizedNext === '/') return normalizedBase
  return normalizeWebDavPath(`${normalizedBase}/${normalizedNext.slice(1)}`)
}

const createWebDavClient = (config: WebDavConnectionConfig) => {
  return createClient(config.url, {
    username: config.username,
    password: config.password
  })
}

const getDavBasePath = (config: WebDavConnectionConfig) => {
  const currentUrl = new URL(config.url.endsWith('/') ? config.url : `${config.url}/`)
  return normalizeWebDavPath(currentUrl.pathname || '/')
}

const stripPathPrefix = (value: string, prefix: string) => {
  const normalizedValue = normalizeWebDavPath(value)
  const normalizedPrefix = normalizeWebDavPath(prefix)
  if (normalizedPrefix !== '/' && normalizedValue.startsWith(normalizedPrefix)) {
    return normalizeWebDavPath(normalizedValue.slice(normalizedPrefix.length) || '/')
  }
  return normalizedValue
}

const getRelativeDavPath = (filename: string, config: WebDavConnectionConfig) => {
  let normalizedFilename = normalizeWebDavPath(filename)
  normalizedFilename = stripPathPrefix(normalizedFilename, getDavBasePath(config))
  normalizedFilename = stripPathPrefix(normalizedFilename, config.rootPath)
  return normalizedFilename
}

const toAliModel = (config: WebDavConnectionConfig, stat: FileStat): IAliGetFileModel => {
  const relativePath = getRelativeDavPath(stat.filename, config)
  const name = stat.basename || path.posix.basename(relativePath) || config.name
  const isDir = stat.type === 'directory'
  const ext = isDir ? '' : path.extname(name).replace('.', '').toLowerCase()
  const size = Number(stat.size || 0)
  const mimeType = stat.mime || ''
  const updatedAt = stat.lastmod
  const time = updatedAt ? new Date(updatedAt).getTime() : Date.now()
  const driveId = `webdav:${config.id}`
  const iconInfo = isDir ? ['folder', 'iconfile-folder'] : getFileIcon(isDir ? 'folder' : (VIDEO_EXTENSIONS.has(`.${ext}`) ? 'video' : 'others'), ext, ext, mimeType, size)

  return {
    __v_skip: true,
    drive_id: driveId,
    file_id: relativePath,
    parent_file_id: normalizeWebDavPath(path.posix.dirname(relativePath)),
    name,
    namesearch: name.toLowerCase(),
    path: relativePath,
    ext,
    mime_type: mimeType,
    mime_extension: ext,
    category: iconInfo[0],
    icon: iconInfo[1],
    size,
    sizeStr: '',
    time,
    timeStr: '',
    starred: false,
    isDir,
    thumbnail: '',
    description: '',
    media_duration: undefined,
    media_height: undefined
  }
}

export const isWebDavDrive = (driveId?: string, driveServerId?: string) => {
  return (driveId || '').startsWith('webdav:') || driveServerId === 'webdav'
}

export const getWebDavConnectionId = (driveId?: string) => {
  if (!driveId || !driveId.startsWith('webdav:')) return ''
  return driveId.slice('webdav:'.length)
}

export const getWebDavConnections = (): WebDavConnectionConfig[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('读取 WebDAV 连接配置失败:', error)
    return []
  }
}

const saveWebDavConnections = (connections: WebDavConnectionConfig[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connections))
}

export const saveWebDavConnection = (config: WebDavConnectionConfig) => {
  const list = getWebDavConnections()
  const index = list.findIndex(item => item.id === config.id)
  if (index >= 0) {
    list[index] = config
  } else {
    list.unshift(config)
  }
  saveWebDavConnections(list)
  aListTokenCache.delete(config.id)
}

export const removeWebDavConnection = (id: string) => {
  const removed = getWebDavConnection(id)
  const list = getWebDavConnections().filter(item => item.id !== id)
  saveWebDavConnections(list)
  aListTokenCache.delete(id)
  if (isNetShareConnection(removed)) void netShareInvoke('NetShare:forget', id).catch(() => undefined)
}

export const getWebDavConnection = (id: string) => {
  return getWebDavConnections().find(item => item.id === id)
}

export const createWebDavConnection = (input: {
  name: string
  url: string
  username: string
  password: string
  rootPath?: string
}): WebDavConnectionConfig => {
  const normalizedUrl = normalizeUrl(input.url)
  const normalizedRoot = normalizeWebDavPath(input.rootPath || '/')
  const timestamp = Date.now().toString()
  const idSeed = `${normalizedUrl}|${input.username}|${normalizedRoot}|${timestamp}`
  const id = btoa(encodeURIComponent(idSeed)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)
  return {
    id,
    kind: 'webdav',
    name: input.name.trim() || new URL(normalizedUrl).host,
    url: normalizedUrl,
    username: input.username.trim(),
    password: input.password,
    rootPath: normalizedRoot,
    createdAt: new Date().toISOString()
  }
}

export const createAListConnection = (input: {
  name: string
  url: string
  username: string
  password: string
  rootPath?: string
}): WebDavConnectionConfig => {
  const normalizedUrl = getAListDavUrl(input.url)
  const normalizedRoot = normalizeWebDavPath(input.rootPath || '/')
  const timestamp = Date.now().toString()
  const idSeed = `alist|${normalizedUrl}|${input.username}|${normalizedRoot}|${timestamp}`
  const id = btoa(encodeURIComponent(idSeed)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)
  return {
    id,
    kind: 'alist',
    name: input.name.trim() || new URL(normalizedUrl).host,
    url: normalizedUrl,
    username: input.username.trim(),
    password: input.password,
    rootPath: normalizedRoot,
    createdAt: new Date().toISOString()
  }
}

export const buildWebDavDownloadUrl = (config: WebDavConnectionConfig, relativePath: string): string => {
  const requestPath = joinDavPath(config.rootPath, relativePath)
  const baseUrl = new URL(config.url.endsWith('/') ? config.url : `${config.url}/`)
  const fullPath = joinDavPath(baseUrl.pathname || '/', requestPath)
  const encodedPath = fullPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  baseUrl.pathname = `/${encodedPath}`
  if (config.username) baseUrl.username = config.username
  if (config.password) baseUrl.password = config.password
  const urlString =  baseUrl.toString()
  return urlString
}

const getApiBaseUrl = (config: WebDavConnectionConfig): string => {
  const currentUrl = new URL(config.url.endsWith('/') ? config.url : `${config.url}/`)
  const pathSegments = currentUrl.pathname.split('/').filter(Boolean)
  if (pathSegments.length > 0) {
    currentUrl.pathname = '/' + pathSegments.slice(0, -1).join('/')
  } else {
    currentUrl.pathname = '/'
  }
  if (!currentUrl.pathname.endsWith('/')) currentUrl.pathname += '/'
  currentUrl.search = ''
  currentUrl.hash = ''
  return currentUrl.toString()
}

const fetchWebDavApiToken = async (config: WebDavConnectionConfig, force = false): Promise<string> => {
  if (!force) {
    const cached = aListTokenCache.get(config.id)
    if (cached) return cached
  }
  const loginUrl = new URL('api/auth/login', getApiBaseUrl(config)).toString()
  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: config.username,
      password: config.password || ''
    })
  })
  if (!response.ok) throw new Error(`WebDAV 登录失败 (${response.status})`)
  const payload = await response.json().catch(() => null) as any
  const token = payload?.data?.token
  if (!token) throw new Error(payload?.message || '获取 WebDAV token 失败')
  aListTokenCache.set(config.id, token)
  return token
}

const requestAListApi = async <T>(config: WebDavConnectionConfig, endpoint: string, body: Record<string, unknown>): Promise<T> => {
  const request = async (forceToken: boolean) => {
    const token = await fetchWebDavApiToken(config, forceToken)
    return fetch(new URL(endpoint.replace(/^\//, ''), getApiBaseUrl(config)).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify(body)
    })
  }
  let response = await request(false)
  if (response.status === 401) response = await request(true)
  if (!response.ok) throw new Error(`AList 请求失败 (${response.status})`)
  const payload = await response.json().catch(() => null) as any
  if (!payload || (payload.code !== 200 && payload.code !== 0)) throw new Error(payload?.message || 'AList 请求失败')
  return payload.data as T
}

const getWebDavStoragePath = (config: WebDavConnectionConfig, relativePath: string) => {
  const requestPath = joinDavPath(config.rootPath, relativePath)
  return stripPathPrefix(requestPath, getDavBasePath(config))
}

export const getWebDavPlayUrl = async (config: WebDavConnectionConfig, relativePath: string): Promise<string> => {
  const requestPath = getWebDavStoragePath(config, relativePath)
  const data = await requestAListApi<{ raw_url?: string }>(config, '/api/fs/get', { path: requestPath, password: '' })
  const rawUrl = data?.raw_url
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('获取 AList 播放地址失败')
  }
  return new URL(rawUrl, getApiBaseUrl(config)).toString()
}

export const getWebDavDownloadUrl = async (config: WebDavConnectionConfig, relativePath: string): Promise<string> => {
  if (isNetShareConnection(config)) return getNetShareStreamUrl(config, relativePath)
  if (config.kind !== 'alist') return buildWebDavDownloadUrl(config, relativePath)
  try {
    return await getWebDavPlayUrl(config, relativePath)
  } catch (error) {
    console.warn('获取 WebDAV 播放地址失败，回退直链:', error)
    return buildWebDavDownloadUrl(config, relativePath)
  }
}

export const listWebDavDirectory = async (
  config: WebDavConnectionConfig,
  relativePath = '/'
): Promise<IAliGetFileModel[]> => {
  const normalizedRelativePath = normalizeWebDavPath(relativePath)
  if (isNetShareConnection(config)) {
    const entries = await netShareInvoke<NetShareEntry[]>('NetShare:list', toNetShareConfig(config), normalizedRelativePath)
    return entries.map(entry => netShareEntryToModel(config, entry, normalizedRelativePath))
  }
  const requestPath = joinDavPath(config.rootPath, normalizedRelativePath)
  if (config.kind === 'alist') {
    const data = await requestAListApi<{ content?: Array<{
      id?: string
      path?: string
      name?: string
      size?: number
      is_dir?: boolean
      modified?: string
      created?: string
      thumb?: string
      type?: number
      hash_info?: { md5?: string } | null
    }> }>(config, '/api/fs/list', { path: requestPath, password: '', page: 1, per_page: 0, refresh: false })
    return (data?.content || []).map((item) => {
      const name = item.name || path.posix.basename(item.path || '') || '未命名'
      const itemRequestPath = normalizeWebDavPath(`${requestPath}/${name}`)
      const relativeItemPath = stripPathPrefix(itemRequestPath, config.rootPath)
      const ext = item.is_dir ? '' : path.extname(name).replace('.', '').toLowerCase()
      const size = Number(item.size || 0)
      const iconInfo = item.is_dir ? ['folder', 'iconfile-folder'] : getFileIcon(VIDEO_EXTENSIONS.has(`.${ext}`) ? 'video' : 'others', ext, ext, '', size)
      const updatedAt = item.modified || item.created
      return {
        __v_skip: true,
        drive_id: `webdav:${config.id}`,
        file_id: relativeItemPath,
        parent_file_id: normalizedRelativePath,
        name,
        namesearch: name.toLowerCase(),
        path: relativeItemPath,
        ext,
        mime_type: '',
        mime_extension: ext,
        category: iconInfo[0],
        icon: iconInfo[1],
        size,
        sizeStr: '',
        time: updatedAt ? new Date(updatedAt).getTime() : Date.now(),
        timeStr: '',
        starred: false,
        isDir: !!item.is_dir,
        thumbnail: item.thumb ? new URL(item.thumb, getApiBaseUrl(config)).toString() : '',
        description: item.hash_info?.md5 ? `md5:${item.hash_info.md5}` : '',
        content_hash: item.hash_info?.md5 || ''
      } as IAliGetFileModel
    })
  }
  const client = createWebDavClient(config)
  const stats = await client.getDirectoryContents(requestPath) as FileStat[]
  return stats
    .filter((stat) => normalizeWebDavPath(stat.filename) !== normalizeWebDavPath(requestPath))
    .map((stat) => toAliModel(config, stat))
}


const assertWritable = (config: WebDavConnectionConfig) => {
  if (isNetShareConnection(config)) throw new Error(`${getRemoteSourceLabel(config.kind)} 文件来源为只读，不支持修改文件`)
}

export const statWebDavPath = async (config: WebDavConnectionConfig, relativePath: string) => {
  if (isNetShareConnection(config)) {
    const stat = await netShareInvoke<{ isDir: boolean; size: number; mtime: number }>('NetShare:stat', toNetShareConfig(config), normalizeWebDavPath(relativePath))
    const normalized = normalizeWebDavPath(relativePath)
    return { filename: normalized, basename: path.posix.basename(normalized), lastmod: new Date(stat.mtime || Date.now()).toUTCString(), size: stat.size, type: stat.isDir ? 'directory' : 'file', etag: null } as FileStat
  }
  const client = createWebDavClient(config)
  const requestPath = joinDavPath(config.rootPath, relativePath)
  return await client.stat(requestPath) as FileStat
}

export const copyWebDavPath = async (config: WebDavConnectionConfig, sourcePath: string, targetPath: string) => {
  assertWritable(config)
  const client = createWebDavClient(config)
  await client.copyFile(joinDavPath(config.rootPath, sourcePath), joinDavPath(config.rootPath, targetPath))
}

export const moveWebDavPath = async (config: WebDavConnectionConfig, sourcePath: string, targetPath: string) => {
  assertWritable(config)
  const client = createWebDavClient(config)
  await client.moveFile(joinDavPath(config.rootPath, sourcePath), joinDavPath(config.rootPath, targetPath))
}

export const renameWebDavPath = async (config: WebDavConnectionConfig, sourcePath: string, newName: string) => {
  const normalizedSource = normalizeWebDavPath(sourcePath)
  const targetPath = normalizeWebDavPath(`${path.posix.dirname(normalizedSource)}/${newName}`)
  await moveWebDavPath(config, normalizedSource, targetPath)
  return targetPath
}

export const deleteWebDavPath = async (config: WebDavConnectionConfig, relativePath: string) => {
  assertWritable(config)
  const client = createWebDavClient(config)
  await client.deleteFile(joinDavPath(config.rootPath, relativePath))
}

export const createWebDavDirectory = async (config: WebDavConnectionConfig, relativePath: string) => {
  assertWritable(config)
  const client = createWebDavClient(config)
  await client.createDirectory(joinDavPath(config.rootPath, relativePath), { recursive: true })
}

const uploadWebDavEntry = async (client: ReturnType<typeof createWebDavClient>, localPath: string, remotePath: string) => {
  const stat = await fsPromises.stat(localPath)
  if (stat.isDirectory()) {
    await client.createDirectory(remotePath, { recursive: true })
    const children = await fsPromises.readdir(localPath)
    for (const child of children) {
      const childLocalPath = path.join(localPath, child)
      const childRemotePath = normalizeWebDavPath(`${remotePath}/${child}`)
      await uploadWebDavEntry(client, childLocalPath, childRemotePath)
    }
    return
  }

  const content = await fsPromises.readFile(localPath)
  await client.putFileContents(remotePath, content, { overwrite: true })
}

export const uploadWebDavLocalPaths = async (config: WebDavConnectionConfig, parentRelativePath: string, localPaths: string[]) => {
  assertWritable(config)
  const client = createWebDavClient(config)
  const parentRemotePath = joinDavPath(config.rootPath, parentRelativePath)
  await client.createDirectory(parentRemotePath, { recursive: true })
  for (const localPath of localPaths) {
    const baseName = path.basename(localPath)
    const remotePath = normalizeWebDavPath(`${parentRemotePath}/${baseName}`)
    await uploadWebDavEntry(client, localPath, remotePath)
  }
}

export const testWebDavConnection = async (config: WebDavConnectionConfig) => {
  if (isNetShareConnection(config)) {
    await netShareInvoke('NetShare:test', toNetShareConfig(config))
    return
  }
  await listWebDavDirectory(config, '/')
}
