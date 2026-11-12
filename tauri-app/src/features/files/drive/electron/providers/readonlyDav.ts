import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {posixPath as path,createWebDavClient,requestAListApi,type ReadonlyDavStat as FileStat} from '../../readonlyDavPorts'
export interface WebDavConnectionConfig {
  id: string
  kind?: 'webdav' | 'alist'
  name: string
  url: string
  username: string
  password: string
  rootPath: string
  createdAt: string
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
  '.mpg', '.mpeg', '.3gp', '.rmvb', '.asf', '.divx', '.xvid', '.ts',
  '.m2ts', '.mts', '.vob', '.ogv', '.dv'
])

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

export const toAliModel = (config: WebDavConnectionConfig, stat: FileStat): IAliGetFileModel => {
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

export const getApiBaseUrl = (config: WebDavConnectionConfig): string => {
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

export const listWebDavDirectory = async (
  config: WebDavConnectionConfig,
  relativePath = '/'
): Promise<IAliGetFileModel[]> => {
  const normalizedRelativePath = normalizeWebDavPath(relativePath)
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
