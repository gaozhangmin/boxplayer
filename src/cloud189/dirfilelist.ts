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
}

const getToken = async (user_id: string) => {
  let token = await getProviderTokenForUser(user_id, '189')
  if (token?.refresh_token && (!token.open_api_access_token || !token.open_api_refresh_token)) {
    const refreshed = await refreshCloud189Token(token)
    if (refreshed) {
      UserDAL.SaveUserToken(refreshed)
      token = refreshed
    }
  }
  return token
}

const apiParentId = (parentId: string | number) => {
  const id = String(parentId || '0')
  return id === 'cloud189_root' || id === '0' || id === '/' || id === '' ? '-11' : id
}

const renewSession = async (user_id: string) => {
  const token = await getProviderTokenForUser(user_id, '189')
  const refreshed = token && await refreshCloud189Token(token)
  if (!refreshed?.open_api_access_token || !refreshed?.open_api_refresh_token) throw new Error('天翼云盘会话已失效，自动刷新失败，请重新登录')
  UserDAL.SaveUserToken(refreshed)
}

const signedRequest = async (user_id: string, method: 'GET' | 'POST', action: string, params: Record<string, string>, retried = false): Promise<any> => {
  const token = await getToken(user_id)
  if (!token?.open_api_access_token || !token?.open_api_refresh_token) throw new Error('天翼云盘登录态无效，请重新登录')
  const url = `${CLOUD189_API_URL}/${action}`
  const query = new URLSearchParams({ ...cloud189ClientSuffix(), ...params }).toString()
  const resp = await fetch(`${url}?${query}`, {
    method,
    headers: {
      Accept: 'application/json;charset=UTF-8',
      'User-Agent': CLOUD189_USER_AGENT,
      Referer: CLOUD189_WEB_URL,
      ...cloud189SignatureHeaders(token.open_api_access_token, token.open_api_refresh_token, method, url)
    }
  })
  const data = await resp.json().catch(() => undefined)
  if (data?.errorCode === 'InvalidSessionKey' && !retried) {
    await renewSession(user_id)
    return signedRequest(user_id, method, action, params, true)
  }
  if (!resp.ok || data?.errorCode || data?.success === false || Number(data?.res_code || 0) !== 0) throw new Error(data?.errorMsg || data?.res_message || data?.message || `天翼云盘请求失败 HTTP ${resp.status}`)
  return data
}

const signedGet = (user_id: string, action: string, params: Record<string, string>) => signedRequest(user_id, 'GET', action, params)

const signedPost = (user_id: string, action: string, params: Record<string, string>) => signedRequest(user_id, 'POST', action, params)

const signedForm = async (user_id: string, action: string, form: Record<string, string>, retried = false): Promise<any> => {
  const token = await getToken(user_id)
  if (!token?.open_api_access_token || !token?.open_api_refresh_token) throw new Error('天翼云盘登录态无效，请重新登录')
  const url = `${CLOUD189_API_URL}/${action}`
  const query = new URLSearchParams(cloud189ClientSuffix()).toString()
  const resp = await fetch(`${url}?${query}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json;charset=UTF-8',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': CLOUD189_USER_AGENT,
      Referer: CLOUD189_WEB_URL,
      ...cloud189SignatureHeaders(token.open_api_access_token, token.open_api_refresh_token, 'POST', url)
    },
    body: new URLSearchParams(form)
  })
  const data = await resp.json().catch(() => undefined)
  if (data?.errorCode === 'InvalidSessionKey' && !retried) {
    await renewSession(user_id)
    return signedForm(user_id, action, form, true)
  }
  if (!resp.ok || data?.errorCode || data?.success === false || ![undefined, '', 0, '0'].includes(data?.res_code) || (data?.code && data.code !== 'SUCCESS')) {
    throw new Error(data?.errorMsg || data?.res_message || data?.message || `天翼云盘请求失败 HTTP ${resp.status}`)
  }
  return data
}

export const apiCloud189FileList = async (user_id: string, parentId: string | number, size = 1000, pageNum = 1, strict = false): Promise<Cloud189FileItem[]> => {
  try {
    const data = await signedGet(user_id, 'listFiles.action', {
      folderId: apiParentId(parentId),
      fileType: '0',
      mediaAttr: '0',
      iconOption: '5',
      pageNum: String(pageNum),
      pageSize: String(size),
      recursive: '0',
      orderBy: 'filename',
      descending: 'false'
    })
    const ao = data?.fileListAO || data?.data?.fileListAO || data
    const folders = Array.isArray(ao?.folderList) ? ao.folderList.map((item: any) => ({ ...item, isFolder: true })) : []
    const files = Array.isArray(ao?.fileList) ? ao.fileList.map((item: any) => ({ ...item, isFolder: false })) : []
    return [...folders, ...files]
  } catch (error: any) {
    message.error(error?.message || '获取天翼云盘文件列表失败')
    if (strict) throw error
    return []
  }
}

export const apiCloud189FileDetail = async (user_id: string, fileId: string): Promise<Cloud189FileItem | null> => {
  if (fileId === 'cloud189_root' || fileId === '0' || fileId === '-11') return { id: '-11', name: '根目录', isFolder: true }
  const list = await apiCloud189FileList(user_id, '-11')
  return list.find((item) => String(item.id || item.fileId || item.folderId) === String(fileId)) || null
}

export const apiCloud189DownloadInfo = async (user_id: string, fileId: string): Promise<{ url: string; size: number; name: string; error: string }> => {
  try {
    const data = await signedGet(user_id, 'getFileDownloadUrl.action', { fileId, dt: '3', flag: '1' })
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
  const file_id = String(item.id || item.fileId || item.folderId || '')
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
