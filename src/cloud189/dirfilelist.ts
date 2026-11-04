import { t } from '../i18n'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import UserDAL from '../user/userdal'
import { getProviderTokenForUser } from '../drive/account'
import { humanDateTimeDateStr, humanSize } from '../utils/format'
import message from '../utils/message'
import { HanToPin } from '../utils/utils'
import { CLOUD189_API_URL, CLOUD189_USER_AGENT, CLOUD189_WEB_URL, cloud189ClientSuffix, cloud189SignatureHeaders, refreshCloud189Token } from './auth'

export type Cloud189FileItem = {
  id?: string
  fileId?: string
  folderId?: string
  name?: string
  fileName?: string
  folderName?: string
  size?: number | string
  parentId?: string
  parentFolderId?: string
  lastOpTime?: string
  createDate?: string
  icon?: { smallUrl?: string; mediumUrl?: string; max600?: string }
  isFolder?: boolean
  familyId?: string
}

// Family identifiers remain distinct from personal IDs, including after app restart.
export const cloud189FamilyId = (familyId: string, rawId = '') => `cloud189_family:${encodeURIComponent(familyId)}:${encodeURIComponent(rawId)}`
export const cloud189Scope = (id: string | number) => {
  const value = String(id ?? '')
  if (value.startsWith('cloud189_family:')) {
    const parts = value.split(':')
    if (parts.length !== 3 || !parts[1]) throw new Error('无效的天翼家庭空间标识')
    return { familyId: decodeURIComponent(parts[1]), rawId: decodeURIComponent(parts[2]) }
  }
  return { familyId: '', rawId: ['', 'root', 'cloud189_root', '0', '/', '-11'].includes(value) ? '-11' : value }
}
export const cloud189IsRoot = (id: string) => ['', 'root', 'cloud189_root', '0', '/', '-11'].includes(id)
export const cloud189Session = async (user_id: string, family = false) => {
  let token = await getProviderTokenForUser(user_id, '189')
  if (token?.refresh_token && (!token.open_api_access_token || !token.open_api_refresh_token || family && (!token.cloud189_family_session_key || !token.cloud189_family_session_secret))) {
    const refreshed = await refreshCloud189Token(token)
    if (refreshed) {
      UserDAL.SaveUserToken(refreshed)
      token = refreshed
    }
  }
  const key = family ? token?.cloud189_family_session_key : token?.open_api_access_token
  const secret = family ? token?.cloud189_family_session_secret : token?.open_api_refresh_token
  if (!key || !secret) throw new Error(family ? '天翼家庭空间会话无效，请重新登录' : '天翼云盘登录态无效，请重新登录')
  return { key, secret }
}
const apiParentId = (parentId: string | number) => cloud189Scope(parentId).rawId

const preserveCloud189LargeIds = (text: string) => {
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length;) {
    const char = text[index]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      index++
      continue
    }
    if (char === '"') {
      inString = true
      output += char
      index++
      continue
    }
    if (char === '-' || char >= '0' && char <= '9') {
      let end = index + 1
      while (end < text.length && !/[\s,}\]]/.test(text[end])) end++
      const value = text.slice(index, end)
      if (/^-?\d+$/.test(value) && !Number.isSafeInteger(Number(value))) output += `"${value}"`
      else output += value
      index = end
      continue
    }
    output += char
    index++
  }
  return output
}

export const readCloud189Json = async (resp: Response) => {
  const text = await resp.text()
  return JSON.parse(preserveCloud189LargeIds(text))
}

export const renewCloud189Session = async (user_id: string) => {
  const token = await getProviderTokenForUser(user_id, '189')
  const refreshed = token && await refreshCloud189Token(token)
  if (!refreshed?.open_api_access_token || !refreshed?.open_api_refresh_token) throw new Error('天翼云盘会话已失效，自动刷新失败，请重新登录')
  UserDAL.SaveUserToken(refreshed)
}

const signedRequest = async (user_id: string, method: 'GET' | 'POST', action: string, params: Record<string, string>, family = false, retried = false): Promise<any> => {
  const { key, secret } = await cloud189Session(user_id, family)
  const url = `${CLOUD189_API_URL}/${action}`
  const query = new URLSearchParams({ ...cloud189ClientSuffix(), ...params }).toString()
  const resp = await fetch(`${url}?${query}`, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: 'application/json;charset=UTF-8',
      'User-Agent': CLOUD189_USER_AGENT,
      Referer: CLOUD189_WEB_URL,
      ...cloud189SignatureHeaders(key, secret, method, url)
    }
  })
  const data = await readCloud189Json(resp).catch(() => undefined)
  if ((data?.errorCode === 'InvalidSessionKey' || data?.code === 'InvalidSessionKey' || data?.res_code === 'InvalidSessionKey') && !retried) {
    await renewCloud189Session(user_id)
    return signedRequest(user_id, method, action, params, family, true)
  }
  if (!resp.ok || data?.errorCode || data?.success === false || Number(data?.res_code || 0) !== 0 || (data?.code && data.code !== 'SUCCESS') || !data) throw new Error(data?.errorMsg || data?.res_message || data?.message || `天翼云盘请求失败 HTTP ${resp.status}`)
  return data
}

const signedGet = (user_id: string, action: string, params: Record<string, string>, family = false) => signedRequest(user_id, 'GET', action, params, family)

const signedPost = (user_id: string, action: string, params: Record<string, string>, family = false) => signedRequest(user_id, 'POST', action, params, family)

const signedForm = async (user_id: string, action: string, form: Record<string, string>, family = false, retried = false): Promise<any> => {
  const { key, secret } = await cloud189Session(user_id, family)
  const url = `${CLOUD189_API_URL}/${action}`
  const query = new URLSearchParams(cloud189ClientSuffix()).toString()
  const resp = await fetch(`${url}?${query}`, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: 'application/json;charset=UTF-8',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': CLOUD189_USER_AGENT,
      Referer: CLOUD189_WEB_URL,
      ...cloud189SignatureHeaders(key, secret, 'POST', url)
    },
    body: new URLSearchParams(form)
  })
  const data = await readCloud189Json(resp).catch(() => undefined)
  if ((data?.errorCode === 'InvalidSessionKey' || data?.code === 'InvalidSessionKey' || data?.res_code === 'InvalidSessionKey') && !retried) {
    await renewCloud189Session(user_id)
    return signedForm(user_id, action, form, family, true)
  }
  if (!resp.ok || data?.errorCode || data?.success === false || ![undefined, '', 0, '0'].includes(data?.res_code) || (data?.code && data.code !== 'SUCCESS') || !data) {
    throw new Error(data?.errorMsg || data?.res_message || data?.message || `天翼云盘请求失败 HTTP ${resp.status}`)
  }
  return data
}

const details = new Map<string, Cloud189FileItem>()
const detailKey = (userId: string, id: string) => JSON.stringify([userId, id])
export const rememberCloud189File = (userId: string, item: Cloud189FileItem) => {
  const raw = String(item.id || item.fileId || item.folderId || '')
  if (!raw) return
  const id = item.familyId ? cloud189FamilyId(item.familyId, raw) : raw
  details.set(detailKey(userId, id), item)
}
export const forgetCloud189Files = (userId: string) => {
  // Folder operations can invalidate cached descendants as well.
  const prefix = JSON.stringify([userId]).slice(0, -1) + ','
  for (const key of details.keys()) if (key.startsWith(prefix)) details.delete(key)
}
export const apiCloud189Families = async (userId: string): Promise<Cloud189FileItem[]> => {
  const data = await signedGet(userId, 'family/manage/getFamilyList.action', {}, true)
  const families = data.familyInfoResp || data.data?.familyInfoResp
  if (!Array.isArray(families)) throw new Error('天翼家庭空间未返回有效的空间列表')
  if (families.some((family: any) => !/^\d+$/.test(String(family.familyId || '')))) throw new Error('天翼家庭空间返回无效的家庭 ID')
  return families.map((family: any) => ({ id: '', familyId: String(family.familyId), name: family.remarkName ? `${t('drive.cloud189Family')} · ${family.remarkName}` : `${t('drive.cloud189Family')} · ${family.familyId}`, isFolder: true, parentId: 'cloud189_root' }))
}
export const apiCloud189FileList = async (user_id: string, parentId: string | number, size = 1000, pageNum = 1, strict = false): Promise<Cloud189FileItem[]> => {
  try {
    const scope = cloud189Scope(parentId)
    const params: Record<string, string> = {
      folderId: scope.rawId, fileType: '0', mediaAttr: '0', iconOption: '5',
      pageNum: String(pageNum), pageSize: String(size), orderBy: scope.familyId ? '1' : 'filename', descending: 'false'
    }
    if (scope.familyId) params.familyId = scope.familyId
    else params.recursive = '0'
    const data = await signedGet(user_id, `${scope.familyId ? 'family/file/' : ''}listFiles.action`, params, !!scope.familyId)
    const ao = data?.fileListAO || data?.data?.fileListAO || data
    if (!data?.fileListAO && !data?.data?.fileListAO && !Array.isArray(ao?.folderList) && !Array.isArray(ao?.fileList)) throw new Error('天翼云盘未返回有效的文件列表')
    const folders = Array.isArray(ao?.folderList) ? ao.folderList.map((item: any) => ({ ...item, isFolder: true })) : []
    const files = Array.isArray(ao?.fileList) ? ao.fileList.map((item: any) => ({ ...item, isFolder: false })) : []
    const items: Cloud189FileItem[] = [...folders, ...files].map(item => ({ ...item, familyId: scope.familyId, parentId: String(parentId) }))
    for (const item of items) rememberCloud189File(user_id, item)
    return items
  } catch (error: any) {
    message.error(error?.message || '获取天翼云盘文件列表失败')
    if (strict) throw error
    return []
  }
}

export const apiCloud189FileDetail = async (user_id: string, fileId: string): Promise<Cloud189FileItem | null> => {
  const scope = cloud189Scope(fileId)
  if (cloud189IsRoot(fileId)) return { id: '-11', name: t('pan.rootFolder'), isFolder: true }
  if (scope.familyId && !scope.rawId) return (await apiCloud189Families(user_id)).find(item => item.familyId === scope.familyId) || null
  const cached = details.get(detailKey(user_id, fileId))
  if (cached) return cached
  // Stored media sources may be opened without first browsing their parent. Use
  // paginated provider listings rather than guessing a personal detail endpoint.
  const queue = [scope.familyId ? cloud189FamilyId(scope.familyId) : 'cloud189_root']
  const visited = new Set<string>()
  const deadline = Date.now() + 30000
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index]
    if (visited.has(parent)) continue
    visited.add(parent)
    for (let page = 1; ; page++) {
      if (Date.now() > deadline) throw new Error('查找文件详情超时，请先打开文件所在目录后重试')
      const items = await apiCloud189FileList(user_id, parent, 200, page, true)
      const found = details.get(detailKey(user_id, fileId))
      if (found) return found
      for (const item of items) if (item.isFolder) queue.push(scope.familyId ? cloud189FamilyId(scope.familyId, String(item.id || item.folderId)) : String(item.id || item.folderId))
      if (items.length < 200) break
    }
  }
  return null
}

export const apiCloud189DownloadInfo = async (user_id: string, fileId: string): Promise<{ url: string; size: number; name: string; error: string }> => {
  try {
    const scope = cloud189Scope(fileId)
    if (!scope.rawId || cloud189IsRoot(fileId)) throw new Error('文件夹不能获取下载链接')
    const params: Record<string, string> = { fileId: scope.rawId }
    if (scope.familyId) params.familyId = scope.familyId
    else { params.dt = '3'; params.flag = '1' }
    const data = await signedGet(user_id, `${scope.familyId ? 'family/file/' : ''}getFileDownloadUrl.action`, params, !!scope.familyId)
    let url = String(data?.fileDownloadUrl || data?.downloadUrl || data?.url || '')
    url = url.replace(/&amp;/g, '&').replace(/^http:\/\//i, 'https://')
    return { url, size: Number(data?.size || 0), name: data?.fileName || '', error: url ? '' : '天翼云盘未返回下载链接' }
  } catch (error: any) {
    return { url: '', size: 0, name: '', error: error?.message || '获取天翼云盘下载地址失败' }
  }
}

export const cloud189DownloadHeaders = () => ({
  'User-Agent': CLOUD189_USER_AGENT,
  Referer: CLOUD189_WEB_URL
})

export const mapCloud189FileToAliModel = (item: Cloud189FileItem, drive_id = 'cloud189', parentId = 'cloud189_root'): IAliGetFileModel => {
  const rawId = String(item.id || item.fileId || item.folderId || '')
  const file_id = item.familyId ? cloud189FamilyId(item.familyId, rawId) : rawId
  const name = String(item.name || item.fileName || item.folderName || '')
  const isDir = !!item.isFolder
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const size = Number(item.size || 0)
  const timeSource = item.lastOpTime || item.createDate || ''
  const time = timeSource ? new Date(timeSource).getTime() : 0
  const iconInfo = isDir ? ['', 'iconfile-folder'] : getFileIcon('', ext, ext, '', size)
  return {
    __v_skip: true,
    drive_id,
    file_id,
    parent_file_id: String(item.parentId || item.parentFolderId || parentId || 'cloud189_root'),
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
    thumbnail: item.icon?.max600 || item.icon?.mediumUrl || item.icon?.smallUrl || '',
    description: `cloud189_id:${file_id}`
  }
}

export { signedGet as cloud189Request, signedPost as cloud189PostRequest, signedForm as cloud189FormRequest, apiParentId as cloud189ApiParentId }
