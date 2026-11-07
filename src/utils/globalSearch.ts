import { incrementalSearch } from './incrementalSearch'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import type { ITokenInfo } from '../user/userstore'
import type { MediaServerConfig } from '../types/mediaServer'
import type { MediaServerLibraryNode } from '../types/mediaServerContent'
import { supportsProviderSearch } from '../services/agent/providerCapabilities'

export interface GlobalSearchResult {
  id: string
  name: string
  ext: string
  size: number
  isDir: boolean
  file_id: string
  parent_file_id: string
  drive_id: string
  user_id: string
  source: 'cloud' | 'media_server'
  provider: string
  providerName: string
  userName: string
  icon: string
  mediaServerId?: string
  itemType?: string
  poster?: string
  path?: string
}

export interface GlobalSearchDriveTarget {
  userId: string
  driveId: string
}

function cloudResult(
  item: IAliGetFileModel,
  provider: string,
  providerName: string,
  userName: string,
  userId: string
): GlobalSearchResult {
  return {
    id: `${provider}:${userId}:${item.file_id}`,
    name: item.name,
    ext: item.ext,
    size: item.size || 0,
    isDir: !!item.isDir,
    file_id: item.file_id || '',
    parent_file_id: item.parent_file_id || '',
    drive_id: item.drive_id || '',
    user_id: userId,
    source: 'cloud',
    provider,
    providerName,
    userName,
    icon: item.icon,
    path: item.path || ''
  }
}

function mediaServerResult(
  node: MediaServerLibraryNode,
  server: MediaServerConfig
): GlobalSearchResult {
  return {
    id: `ms:${server.id}:${node.id}`,
    name: node.title,
    ext: '',
    size: 0,
    isDir: node.kind === 'folder',
    file_id: node.id,
    parent_file_id: '',
    drive_id: 'media_server',
    user_id: server.id,
    source: 'media_server',
    provider: server.type,
    providerName: server.name || server.type,
    userName: '',
    icon: 'media',
    mediaServerId: server.id,
    itemType: node.kind,
    poster: node.poster || node.images?.primary || node.images?.thumb
  }
}

function driveLabel(token: ITokenInfo): string {
  if (token.tokenfrom === 'cloud123') return '123 网盘'
  if (token.tokenfrom === '115') return '115 网盘'
  if (token.tokenfrom === 'baidu') return '百度网盘'
  if (token.tokenfrom === 'quark') return '夸克网盘'
  if (token.tokenfrom === 'onedrive') return 'OneDrive'
  if (token.tokenfrom === 'dropbox') return 'Dropbox'
  if (token.tokenfrom === 'box') return 'Box'
  if (token.tokenfrom === '139') return '139 云盘'
  if (token.tokenfrom === '189') return '天翼云盘'
  if (token.tokenfrom === 'guangya') return '光鸭云盘'
  if (token.tokenfrom === 'pikpak') return 'PikPak'
  if (token.tokenfrom === 'google') return 'Google Drive'
  return '阿里云盘'
}

function userName(token: ITokenInfo): string {
  return token.nick_name || token.user_name || token.name || token.user_id
}

async function searchAliyun(token: ITokenInfo, keyword: string, allowedDriveIds: string[] = []): Promise<GlobalSearchResult[]> {
  const { default: AliDirFileList } = await import('../aliapi/dirfilelist')
  const drives = [...new Set([token.default_drive_id, token.resource_drive_id, token.backup_drive_id, token.pic_drive_id].filter(Boolean))]
  const selectedDrives = allowedDriveIds.length ? drives.filter(driveId => allowedDriveIds.includes(driveId)) : drives

  const label = driveLabel(token)
  const uname = userName(token)

  const results: GlobalSearchResult[] = []
  for (const driveId of selectedDrives) {
    try {
      const items = await AliDirFileList.ApiSearchByName(token.user_id, driveId, keyword, 30)
      for (const item of items) {
        results.push(cloudResult(item, 'aliyun', label, uname, token.user_id))
      }
    } catch {}
  }
  return results
}

async function searchCloud123(token: ITokenInfo, keyword: string): Promise<GlobalSearchResult[]> {
  try {
    const { apiCloud123FileList, mapCloud123FileToAliModel } = await import('../cloud123/dirfilelist')
    const items = await apiCloud123FileList(token.user_id, '0', 30, false, keyword, 0)
    const label = driveLabel(token)
    const uname = userName(token)
    return items.map((item) => cloudResult(mapCloud123FileToAliModel(item), 'cloud123', label, uname, token.user_id))
  } catch {
    return []
  }
}

async function searchCloud115(token: ITokenInfo, keyword: string): Promise<GlobalSearchResult[]> {
  try {
    const { apiDrive115Search, mapDrive115SearchToAliModel } = await import('../cloud115/dirfilelist')
    const data = await apiDrive115Search(token.user_id, keyword, 30, 0)
    const label = driveLabel(token)
    const uname = userName(token)
    return data.items.map((item) => cloudResult(mapDrive115SearchToAliModel(item, token.default_drive_id || '0'), '115', label, uname, token.user_id))
  } catch {
    return []
  }
}

async function searchBaidu(token: ITokenInfo, keyword: string): Promise<GlobalSearchResult[]> {
  try {
    const { apiBaiduSearch, mapBaiduFileToAliModel } = await import('../cloudbaidu/dirfilelist')
    const items = await apiBaiduSearch(token.user_id, keyword, '/', true)
    const label = driveLabel(token)
    const uname = userName(token)
    return items.slice(0, 30).map((item) => {
      const parentPath = item.path
        ? item.path.substring(0, item.path.lastIndexOf('/') + 1) || '/'
        : '/'
      return cloudResult(mapBaiduFileToAliModel(item, token.default_drive_id || 'baidu', parentPath), 'baidu', label, uname, token.user_id)
    })
  } catch {
    return []
  }
}

async function searchQuark(token: ITokenInfo, keyword: string): Promise<GlobalSearchResult[]> {
  try {
    const { apiQuarkSearch, mapQuarkFileToAliModel } = await import('../quark/dirfilelist')
    const { readQuarkCookieStringFromElectron } = await import('../quark/auth')
    const { default: UserDAL } = await import('../user/userdal')

    const cookieString = await readQuarkCookieStringFromElectron().catch(() => '')
    const hasAuth = /(?:^|;\s*)(?:__uid|__kps|__pus|__puus)=/.test(cookieString)
    if (hasAuth && cookieString !== token.access_token) {
      token.access_token = cookieString
      UserDAL.SaveUserToken(token)
    }

    const items = await apiQuarkSearch(token.user_id, keyword, 30, true)
    const label = driveLabel(token)
    const uname = userName(token)
    return items.map((item) => cloudResult(mapQuarkFileToAliModel(item, token.default_drive_id || 'quark', ''), 'quark', label, uname, token.user_id))
  } catch {
    return []
  }
}

async function searchOneDrive(token: ITokenInfo, keyword: string): Promise<GlobalSearchResult[]> {
  try {
    const { apiOneDriveSearch, mapOneDriveSearchItems } = await import('../onedrive/search')
    const items = await apiOneDriveSearch(token.user_id, keyword)
    const label = driveLabel(token)
    const uname = userName(token)
    const mapped = mapOneDriveSearchItems(items.slice(0, 30), token.default_drive_id || 'onedrive')
    return mapped.map((item) => cloudResult(item, 'onedrive', label, uname, token.user_id))
  } catch {
    return []
  }
}

async function searchDropbox(token: ITokenInfo, keyword: string): Promise<GlobalSearchResult[]> {
  try {
    const { apiDropboxSearch } = await import('../dropbox/search')
    const { mapDropboxFileToAliModel } = await import('../dropbox/dirfilelist')
    const items = await apiDropboxSearch(token.user_id, keyword, 30)
    const label = driveLabel(token)
    const uname = userName(token)
    const driveId = token.default_drive_id || 'dropbox'
    return items.map((item) => {
      const parentId = item.path_display ? item.path_display.split('/').slice(0, -1).join('/') : 'dropbox_root'
      return cloudResult(mapDropboxFileToAliModel(item, driveId, parentId || 'dropbox_root'), 'dropbox', label, uname, token.user_id)
    })
  } catch {
    return []
  }
}

async function searchBox(token: ITokenInfo, keyword: string): Promise<GlobalSearchResult[]> {
  try {
    const { apiBoxSearch, mapBoxSearchItems } = await import('../box/search')
    const items = await apiBoxSearch(token.user_id, keyword, 30)
    const label = driveLabel(token)
    const uname = userName(token)
    const mapped = mapBoxSearchItems(items, token.default_drive_id || 'box')
    return mapped.map((item) => cloudResult(item, 'box', label, uname, token.user_id))
  } catch {
    return []
  }
}

async function searchGuangya(token: ITokenInfo, keyword: string): Promise<GlobalSearchResult[]> {
  try {
    const { apiGuangyaSearch } = await import('../guangya/search')
    const items = await apiGuangyaSearch(token.user_id, keyword, 30)
    const label = driveLabel(token)
    const uname = userName(token)
    return items.map((item) => cloudResult(item, 'guangya', label, uname, token.user_id))
  } catch {
    return []
  }
}

async function searchGoogle(token: ITokenInfo, keyword: string): Promise<GlobalSearchResult[]> {
  try {
    const { apiGoogleSearch, mapGoogleFileToAliModel } = await import('../google/dirfilelist')
    const items = await apiGoogleSearch(token.user_id, keyword)
    const label = driveLabel(token)
    const uname = userName(token)
    const driveId = token.default_drive_id || 'google'
    return items.slice(0, 30).map((item) => cloudResult(mapGoogleFileToAliModel(item, driveId, item.parents?.[0] || 'google_root'), 'google', label, uname, token.user_id))
  } catch {
    return []
  }
}

async function mediaServerSearchTasks(keyword: string, signal?: AbortSignal): Promise<Array<() => Promise<GlobalSearchResult[]>>> {
  try {
    const { default: useMediaServerRegistryStore } = await import('../store/mediaServerRegistry')
    const { getMediaServerSearch } = await import('../media-server/contentGateway')
    const registry = useMediaServerRegistryStore()
    registry.ensureLoaded()
    return (registry.servers || []).filter(server => server.accessToken || server.password).map(server => async () => {
      const data = await getMediaServerSearch({ ...server, requestSignal: signal }, keyword)
      return data.items.map(node => mediaServerResult(node, server))
    })
  } catch {
    return []
  }
}

function dispatchSearch(token: ITokenInfo, keyword: string, allowedDriveIds: string[] = []): Promise<GlobalSearchResult[]> {
  const tf = token.tokenfrom
  if (tf === 'cloud123') return searchCloud123(token, keyword)
  if (tf === '115') return searchCloud115(token, keyword)
  if (tf === 'baidu') return searchBaidu(token, keyword)
  if (tf === 'quark') return searchQuark(token, keyword)
  if (tf === 'onedrive') return searchOneDrive(token, keyword)
  if (tf === 'dropbox') return searchDropbox(token, keyword)
  if (tf === 'box') return searchBox(token, keyword)
  if (tf === 'guangya') return searchGuangya(token, keyword)
  if (tf === 'google') return searchGoogle(token, keyword)
  if (tf === 'aliyun' || !tf || tf === 'unknown') return searchAliyun(token, keyword, allowedDriveIds)
  return Promise.resolve([])
}

export async function searchAllDrives(keyword: string, opts?: { platforms?: string[]; targets?: GlobalSearchDriveTarget[]; includeMediaServers?: boolean; signal?: AbortSignal; onUpdate?: (items: GlobalSearchResult[]) => void }): Promise<GlobalSearchResult[]> {
  if (!keyword || keyword.trim().length < 2) return []

  const k = keyword.trim()
  const { default: UserDAL } = await import('../user/userdal')

  let tokens = UserDAL.GetUserList()
  if (!tokens.length) {
    const dbTokens = await UserDAL.GetUserListFromDB()
    tokens = dbTokens.filter((t) => !!t.user_id)
  }

  const tasks: Array<() => Promise<GlobalSearchResult[]>> = []

  for (const token of tokens) {
    if (!token.access_token || !token.user_id) continue
    if (!supportsProviderSearch(token.tokenfrom)) continue
    if (opts?.platforms?.length && !opts.platforms.includes(token.tokenfrom || 'aliyun')) continue
    const selectedTargets = opts?.targets?.filter(target => target.userId === token.user_id) || []
    if (opts?.targets?.length && !selectedTargets.length) continue
    tasks.push(() => dispatchSearch(token, k, selectedTargets.map(target => target.driveId)))
  }

  if (opts?.includeMediaServers !== false) {
    tasks.push(...await mediaServerSearchTasks(k, opts?.signal))
  }

  return incrementalSearch(tasks, { signal: opts?.signal, onUpdate: opts?.onUpdate, concurrency: 3 })
}

export function searchResultGroupTitle(result: GlobalSearchResult): string {
  if (result.source === 'media_server') return result.providerName
  return `${result.providerName} · ${result.userName}`
}
