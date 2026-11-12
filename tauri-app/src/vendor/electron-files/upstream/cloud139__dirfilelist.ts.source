import type { IAliGetFileModel } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import { getProviderTokenForUser } from '../drive/account'
import { humanDateTimeDateStr, humanSize } from '../utils/format'
import message from '../utils/message'
import { HanToPin } from '../utils/utils'
import { CLOUD139_ROUTE_POLICY_URL, CLOUD139_USER_AGENT, cloud139Headers } from './auth'

export type Cloud139FileItem = {
  fileId?: string
  catalogId?: string
  catalogID?: string
  contentID?: string
  parentFileId?: string
  parentCatalogId?: string
  name?: string
  catalogName?: string
  contentName?: string
  type?: string
  size?: number | string
  contentSize?: number | string
  updated_at?: string
  updatedAt?: string
  updateTime?: string
  created_at?: string
  createTime?: string
  thumbnailURL?: string
  thumbnailUrls?: { url?: string }[]
}

const hostCache = new Map<string, string>()

const getToken = (user_id: string) => getProviderTokenForUser(user_id, '139')

const apiParentId = (parentId: string | number) => {
  const id = String(parentId || '/')
  return id === 'cloud139_root' || id === '0' || id === '' ? '/' : id
}

const oldApiParentId = (parentId: string | number) => {
  const id = String(parentId || 'root')
  return id === 'cloud139_root' || id === '/' || id === '0' || id === '' ? 'root' : id
}

const cloud139Account = (token: any) => (token.user_name || token.nick_name || token.user_id).replace(/^cloud139_/, '').replace(/^139云盘\s*/, '')

const cloud139Request = async (user_id: string, endpoint: string, body: any): Promise<any> => {
  const token = await getToken(user_id)
  if (!token?.access_token) throw new Error('未登录 139 云盘')
  const postBody = JSON.stringify(body || {})
  let lastError = ''
  for (const url of cloud139PersonalUrls(await getCloud139Host(user_id), endpoint)) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: cloud139Headers(token.access_token, postBody),
      body: postBody
    })
    const data = await resp.json().catch(() => undefined)
    if (resp.ok && data?.success !== false && data?.code !== '9000' && data?.code !== '9008' && data?.code !== '9100') return data
    lastError = data?.message || data?.msg || data?.error_msg || `139 云盘请求失败 HTTP ${resp.status}`
    // The routed host can expose either /hcy or /orchestration. Only a missing
    // route merits trying the alternate path; validation and permission errors
    // must be returned intact instead of being masked by a later 404.
    if (resp.status !== 404 && !/route not found/i.test(lastError)) throw new Error(lastError)
  }
  throw new Error(lastError || '139 云盘请求失败')
}

const cloud139PersonalUrl = (host: string, endpoint: string) => {
  const base = host.replace(/\/+$/, '')
  if (endpoint.startsWith('/orchestration')) return `${base}${endpoint}`
  const path = new URL(base).pathname.replace(/\/+$/, '')
  if (path && path !== '/') return `${base}${endpoint}`
  if (base.endsWith('/orchestration')) return `${base}${endpoint}`
  if (base.includes('/orchestration/')) return `${base}${endpoint}`
  return `${base}/orchestration${endpoint}`
}

const cloud139PersonalUrls = (host: string, endpoint: string) => {
  const urls = [cloud139PersonalUrl(host, endpoint)]
  const withoutHcy = host.replace(/\/hcy\/orchestration\/?$/i, '/orchestration').replace(/\/hcy\/?$/i, '')
  const fallbackUrl = cloud139PersonalUrl(withoutHcy, endpoint)
  if (!urls.includes(fallbackUrl)) urls.push(fallbackUrl)
  return urls
}

const getCloud139Host = async (user_id: string): Promise<string> => {
  const cached = hostCache.get(user_id)
  if (cached) return cached
  const token = await getToken(user_id)
  if (!token?.access_token) throw new Error('未登录 139 云盘')
  const account = cloud139Account(token)
  const body = JSON.stringify({
    userInfo: { userType: 1, accountType: 1, accountName: account },
    modAddrType: 1
  })
  const routeResp = await fetch(CLOUD139_ROUTE_POLICY_URL, {
    method: 'POST',
    headers: cloud139Headers(token.access_token, body, true),
    body
  })
  const data: any = await routeResp.json().catch(() => undefined)
  if (!routeResp.ok || data?.success === false) throw new Error(data?.message || data?.msg || data?.error_msg || `139 云盘路由请求失败 HTTP ${routeResp.status}`)
  const routeList: any[] = data?.data?.routePolicyList || data?.routePolicyList || []
  const personal = Array.isArray(routeList) ? routeList.find((item) => item?.modName === 'personal') || routeList[0] : null
  const host: string = personal?.httpsUrl || personal?.httpUrl || ''
  if (!host) throw new Error('139 云盘路由未返回 PersonalCloudHost')
  hostCache.set(user_id, host)
  return host
}

const cloud139OldPersonalRequest = async (user_id: string, endpoint: string, body: any): Promise<any> => {
  const token = await getToken(user_id)
  if (!token?.access_token) throw new Error('未登录 139 云盘')
  const postBody = JSON.stringify(body || {})
  const resp = await fetch(`https://yun.139.com${endpoint}`, {
    method: 'POST',
    headers: cloud139Headers(token.access_token, postBody),
    body: postBody
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.success === false) throw new Error(data?.message || data?.msg || data?.error_msg || `139 云盘老接口请求失败 HTTP ${resp.status}`)
  return data
}

const cloud139OldFileList = async (user_id: string, parentId: string | number, size: number): Promise<Cloud139FileItem[]> => {
  const token = await getToken(user_id)
  if (!token?.access_token) throw new Error('未登录 139 云盘')
  const data = await cloud139OldPersonalRequest(user_id, '/orchestration/personalCloud/catalog/v1.0/getDisk', {
    catalogID: oldApiParentId(parentId),
    sortDirection: 1,
    startNumber: 1,
    endNumber: size,
    filterType: 0,
    catalogSortType: 0,
    contentSortType: 0,
    commonAccountInfo: {
      account: cloud139Account(token),
      accountType: 1
    }
  })
  return listFromResponse(data)
}

const listFromResponse = (data: any): Cloud139FileItem[] => {
  const raw = data?.data || data
  const list = raw?.items || raw?.list || raw?.content || raw?.files || raw?.fileList || raw?.getDiskResult?.catalogList || []
  const contentList = raw?.getDiskResult?.contentList || []
  if (Array.isArray(list) && Array.isArray(contentList) && contentList.length) return [...list, ...contentList]
  return Array.isArray(list) ? list : []
}

export const apiCloud139FileListPage = async (user_id: string, parentId: string | number, size = 100, pageCursor = '', strict = false): Promise<{ items: Cloud139FileItem[]; nextCursor: string }> => {
  try {
    const data = await cloud139Request(user_id, '/file/list', {
      imageThumbnailStyleList: ['Small', 'Large'],
      orderBy: 'updated_at',
      orderDirection: 'DESC',
      pageInfo: { pageCursor, pageSize: size },
      parentFileId: apiParentId(parentId)
    })
    const raw = data?.data || data || {}
    const nextCursor = String(raw?.pageInfo?.nextPageCursor || raw?.pageInfo?.nextCursor || raw?.nextPageCursor || raw?.nextCursor || '')
    return { items: listFromResponse(data), nextCursor: nextCursor === pageCursor ? '' : nextCursor }
  } catch (error: any) {
    if (!pageCursor) {
      try {
        return { items: await cloud139OldFileList(user_id, parentId, size), nextCursor: '' }
      } catch (fallbackError: any) {
        if (strict) throw fallbackError
      }
    }
    if (strict) throw error
    message.error(error?.message || '获取 139 云盘文件列表失败')
    return { items: [], nextCursor: '' }
  }
}

export const apiCloud139FileList = async (user_id: string, parentId: string | number, size = 100): Promise<Cloud139FileItem[]> => {
  return (await apiCloud139FileListPage(user_id, parentId, size)).items
}

export const apiCloud139FileDetail = async (user_id: string, fileId: string): Promise<Cloud139FileItem | null> => {
  if (fileId === 'cloud139_root' || fileId === '/' || fileId === '0') return { fileId: '/', name: '根目录', type: 'folder' }
  const list = await apiCloud139FileList(user_id, '/')
  return list.find((item) => String(item.fileId || item.catalogId) === String(fileId)) || null
}

export const apiCloud139DownloadInfo = async (user_id: string, fileId: string): Promise<{ url: string; size: number; name: string; error: string }> => {
  try {
    const data = await cloud139Request(user_id, '/file/getDownloadUrl', { fileId })
    const info = data?.data || data || {}
    const url = info.cdnUrl || info.url || info.downloadUrl || ''
    return { url, size: Number(info.size || 0), name: info.fileName || info.name || '', error: url ? '' : '139 云盘未返回下载链接' }
  } catch (error: any) {
    return { url: '', size: 0, name: '', error: error?.message || '获取 139 云盘下载地址失败' }
  }
}

export const cloud139DownloadHeaders = () => ({
  'User-Agent': CLOUD139_USER_AGENT,
  Referer: 'https://yun.139.com/',
  Origin: 'https://yun.139.com'
})

export const mapCloud139FileToAliModel = (item: Cloud139FileItem, drive_id = 'cloud139', parentId = 'cloud139_root'): IAliGetFileModel => {
  const file_id = String(item.fileId || item.catalogId || item.catalogID || item.contentID || '')
  const name = String(item.name || item.catalogName || item.catalogName || item.contentName || '')
  const isDir = item.type === 'folder' || Boolean(item.catalogId || item.catalogID)
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const size = Number(item.size || item.contentSize || 0)
  const timeSource = item.updated_at || item.updatedAt || item.updateTime || item.created_at || item.createTime || ''
  const time = timeSource ? new Date(timeSource).getTime() : 0
  const iconInfo = isDir ? ['', 'iconfile-folder'] : getFileIcon('', ext, ext, '', size)
  return {
    __v_skip: true,
    drive_id,
    file_id,
    parent_file_id: String(item.parentFileId || item.parentCatalogId || parentId || 'cloud139_root'),
    name,
    namesearch: HanToPin(name),
    ext,
    mime_type: '',
    mime_extension: ext,
    category: iconInfo[0],
    icon: iconInfo[1],
    file_count: 0,
    size,
    sizeStr: humanSize(size),
    time,
    timeStr: time ? humanDateTimeDateStr(new Date(time).toISOString()) : '',
    starred: false,
    isDir,
    thumbnail: item.thumbnailUrls?.find((thumb) => thumb?.url)?.url || item.thumbnailURL || '',
    description: `cloud139_id:${file_id}`
  }
}

export { cloud139Request, apiParentId as cloud139ApiParentId, cloud139PersonalUrl, cloud139PersonalUrls }
