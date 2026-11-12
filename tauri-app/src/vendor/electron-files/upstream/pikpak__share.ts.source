import { pikpakAuthHeaders } from './auth'
import { getPikPakToken } from './dirfilelist'
import type { IAliShareAnonymous, IAliShareFileItem } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import { humanDateTimeDateStr, humanSize } from '../utils/format'

export type PikPakShareCreateResult = {
  shareId: string
  shareUrl: string
  passCode: string
  error: string
}

export type PikPakShareListResult = {
  list: Array<{ shareId: string; shareUrl: string; title: string; passCode: string; createdAt: string; expiration: string; expired: boolean; previewCount: number; saveCount: number; downloadCount: number }>
  error: string
}

export type PikPakShareUpdateResult = { success: boolean; error: string }

const PIKPAK_API_HOST = 'https://api-drive.mypikpak.com'
const PIKPAK_SHARE_PREFIX = 'pikpak:'

const publicHeaders = (): HeadersInit => ({
  'Content-Type': 'application/json; charset=utf-8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
})

const parsePikPakError = (data: any, fallback: string) => {
  return data?.error_description || data?.message || data?.error || fallback
}

export const isPikPakShareId = (shareId: string) => shareId.startsWith(PIKPAK_SHARE_PREFIX)
export const encodePikPakShareId = (shareId: string) => `${PIKPAK_SHARE_PREFIX}${shareId}`
export const decodePikPakShareId = (shareId: string) => isPikPakShareId(shareId) ? shareId.slice(PIKPAK_SHARE_PREFIX.length) : shareId

export const parsePikPakShareLink = (value: string): { id: string; pwd: string } => {
  const id = value.match(/(?:mypikpak|pikpak)\.com\/s\/([A-Za-z0-9_-]+)/i)?.[1] || ''
  const pwd = value.match(/[?&#]pass_code=([A-Za-z0-9]+)/i)?.[1] || value.match(/(?:提取码|密码|pass_code|passcode|pwd)[:：\s]*([A-Za-z0-9]+)/i)?.[1] || ''
  return { id: id ? encodePikPakShareId(id) : '', pwd }
}

const requestPublicShare = async (path: string, params: Record<string, string>) => {
  const url = new URL(`${PIKPAK_API_HOST}${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const resp = await fetch(url, { headers: publicHeaders() })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.error) throw new Error(parsePikPakError(data, '获取 PikPak 分享失败'))
  return data || {}
}

const getPikPakShareInfo = async (shareId: string, passCode = '') => {
  return requestPublicShare('/drive/v1/share', {
    limit: '100',
    thumbnail_size: 'SIZE_LARGE',
    order: '3',
    share_id: decodePikPakShareId(shareId),
    parent_id: '',
    pass_code: passCode
  })
}

const toShareFile = (item: any, parentId: string): IAliShareFileItem => {
  const isDir = String(item?.kind || '').includes('folder')
  const name = String(item?.name || '')
  const ext = isDir ? '' : name.split('.').pop() || ''
  const size = Number(item?.size || 0)
  const updatedAt = String(item?.modified_time || item?.created_time || '')
  return {
    drive_id: 'pikpak',
    file_id: String(item?.id || ''),
    name,
    type: isDir ? 'folder' : 'file',
    created_at: String(item?.created_time || ''),
    updated_at: updatedAt,
    parent_file_id: String(item?.parent_id || parentId),
    file_extension: ext,
    mime_extension: ext,
    mime_type: String(item?.mime_type || ''),
    size,
    category: isDir ? '' : getFileIcon('', ext, ext, String(item?.mime_type || ''), size)[0],
    punish_flag: 0,
    isDir,
    sizeStr: isDir ? '' : humanSize(size),
    timeStr: updatedAt ? humanDateTimeDateStr(updatedAt) : '',
    icon: isDir ? 'iconfile-folder' : getFileIcon('', ext, ext, String(item?.mime_type || ''), size)[1]
  }
}

export const apiPikPakShareAnonymous = async (shareId: string, passCode = ''): Promise<IAliShareAnonymous> => {
  const id = decodePikPakShareId(shareId)
  const share: IAliShareAnonymous = {
    shareinfo: { share_id: encodePikPakShareId(id), creator_id: '', creator_name: '', creator_phone: '', display_name: id, expiration: '', file_count: 0, share_name: id, created_at: '', updated_at: '', vip: '', is_photo_collection: false, album_id: '' },
    shareinfojson: '',
    error: '解析 PikPak 分享链接失败'
  }
  try {
    const data = await getPikPakShareInfo(id, passCode)
    const meta = data?.share || data?.share_info || data || {}
    const files = data?.files || data?.file_list || []
    share.shareinfo.display_name = meta.name || meta.title || id
    share.shareinfo.share_name = share.shareinfo.display_name
    share.shareinfo.file_count = Number(meta.file_count || files.length || 0)
    share.shareinfo.expiration = meta.expiration || meta.expired_at || ''
    share.shareinfojson = JSON.stringify(data)
    share.error = ''
  } catch (error: any) {
    share.error = error?.message || share.error
  }
  return share
}

export const apiPikPakShareToken = async (shareId: string, passCode = ''): Promise<string> => {
  try {
    const data = await getPikPakShareInfo(shareId, passCode)
    return data?.pass_code_token || data?.passcode_token || '，获取 PikPak 分享 token 失败'
  } catch (error: any) {
    return `，${error?.message || '获取 PikPak 分享 token 失败'}`
  }
}

export const apiPikPakShareFileList = async (shareId: string, passCodeToken: string, parentId: string): Promise<{ items: IAliShareFileItem[]; next_marker: string; error: string }> => {
  try {
    const items: IAliShareFileItem[] = []
    let pageToken = ''
    const seenPageTokens = new Set<string>()
    do {
      const data = await requestPublicShare('/drive/v1/share/detail', { limit: '100', thumbnail_size: 'SIZE_LARGE', order: '6', share_id: decodePikPakShareId(shareId), parent_id: parentId === 'root' ? '' : parentId, pass_code_token: passCodeToken, page_token: pageToken })
      const pageItems = data?.files || data?.file_list || []
      if (Array.isArray(pageItems)) items.push(...pageItems.map(item => toShareFile(item, parentId)))
      const nextPageToken = String(data?.next_page_token || data?.nextPageToken || '')
      if (nextPageToken && seenPageTokens.has(nextPageToken)) return { items: [], next_marker: '', error: 'PikPak 分享列表分页游标重复' }
      if (nextPageToken) seenPageTokens.add(nextPageToken)
      pageToken = nextPageToken
    } while (pageToken)
    return { items, next_marker: pageToken, error: '' }
  } catch (error: any) {
    return { items: [], next_marker: '', error: error?.message || '获取 PikPak 分享文件失败' }
  }
}

export const apiPikPakSaveShareFilesBatch = async (shareId: string, passCodeToken: string, userId: string, _parentFileId: string, fileIds: string[]): Promise<string> => {
  if (!fileIds.length) return 'success'
  const token = await getPikPakToken(userId)
  if (!token?.access_token) return '请先登录 PikPak'
  try {
    const resp = await fetch(`${PIKPAK_API_HOST}/drive/v1/share/restore`, {
      method: 'POST',
      headers: pikpakAuthHeaders(token),
      body: JSON.stringify({ share_id: decodePikPakShareId(shareId), pass_code_token: passCodeToken, file_ids: fileIds })
    })
    const data = await resp.json().catch(() => undefined)
    return !resp.ok || data?.error ? parsePikPakError(data, '保存 PikPak 分享失败') : 'success'
  } catch (error: any) {
    return error?.message || '保存 PikPak 分享失败'
  }
}

export const toPikPakExpirationDays = (expiration: string): number => {
  if (!expiration) return -1
  const target = new Date(expiration).getTime()
  if (Number.isNaN(target)) return -1
  const diff = target - Date.now()
  if (diff <= 0) return 1
  return Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000)))
}

export const apiPikPakShareCreate = async (
  user_id: string,
  fileIDList: string[],
  needPassword: boolean,
  expiration: string
): Promise<PikPakShareCreateResult> => {
  const result: PikPakShareCreateResult = { shareId: '', shareUrl: '', passCode: '', error: '创建 PikPak 分享链接失败' }
  const token = await getPikPakToken(user_id)
  if (!token?.access_token) {
    result.error = '请先登录 PikPak'
    return result
  }
  try {
    const resp = await fetch(`${PIKPAK_API_HOST}/drive/v1/share`, {
      method: 'POST',
      headers: pikpakAuthHeaders(token),
      body: JSON.stringify({
        file_ids: fileIDList,
        share_to: needPassword ? 'encryptedlink' : 'publiclink',
        expiration_days: toPikPakExpirationDays(expiration),
        pass_code_option: needPassword ? 'REQUIRED' : 'NOT_REQUIRED'
      })
    })
    const data = await resp.json().catch(() => undefined)
    if (!resp.ok || data?.error) {
      result.error = parsePikPakError(data, result.error)
      return result
    }
    result.shareId = String(data?.share_id || data?.id || '')
    result.shareUrl = data?.share_url || data?.share_link || ''
    result.passCode = data?.pass_code || data?.passcode || ''
    result.error = result.shareId && result.shareUrl ? '' : '创建 PikPak 分享链接失败'
  } catch (err: any) {
    result.error = err?.message || result.error
  }
  return result
}

export const apiPikPakShareList = async (user_id: string): Promise<PikPakShareListResult> => {
  const result: PikPakShareListResult = { list: [], error: '' }
  const token = await getPikPakToken(user_id)
  if (!token?.access_token) { result.error = '请先登录 PikPak'; return result }
  try {
    let pageToken = ''
    for (let page = 0; page < 100; page++) {
      const url = new URL(`${PIKPAK_API_HOST}/drive/v1/share/list`)
      url.searchParams.set('limit', '100')
      url.searchParams.set('thumbnail_size', 'SIZE_SMALL')
      if (pageToken) url.searchParams.set('page_token', pageToken)
      const resp = await fetch(url, { headers: pikpakAuthHeaders(token) })
      const data = await resp.json().catch(() => undefined)
      if (!resp.ok) { result.error = parsePikPakError(data, `获取 PikPak 分享列表失败（HTTP ${resp.status}）`); return result }
      const items = Array.isArray(data?.data) ? data.data : []
      result.list.push(...items.map((item: any) => {
        const expiration = item.expiration_at || (Number(item.expiration_left) > 0 ? new Date(Date.now() + Number(item.expiration_left) * 86400000).toISOString() : '')
        return { shareId: String(item.share_id || item.id || ''), shareUrl: item.share_url || item.share_link || '', title: item.title || '分享链接', passCode: item.pass_code || item.passcode || '', createdAt: item.create_time || item.created_at || '', expiration, expired: String(item.share_status || '').toLowerCase().includes('expired') || (expiration ? new Date(expiration).getTime() <= Date.now() : false), previewCount: Number(item.view_count || item.preview_count || 0), saveCount: Number(item.restore_count || item.save_count || 0), downloadCount: Number(item.download_count || 0) }
      }).filter((item: any) => item.shareId))
      pageToken = data?.next_page_token || ''
      if (!pageToken) break
    }
  } catch (err: any) { result.error = err?.message || '获取 PikPak 分享列表失败' }
  return result
}

export const apiPikPakShareUpdate = async (user_id: string, shareId: string, title: string, expiration: string, sharePwd: string): Promise<PikPakShareUpdateResult> => {
  const result: PikPakShareUpdateResult = { success: false, error: '修改 PikPak 分享失败' }
  const token = await getPikPakToken(user_id)
  if (!token?.access_token) { result.error = '请先登录 PikPak'; return result }
  const body: any = { share_id: decodePikPakShareId(shareId), expiration_days: toPikPakExpirationDays(expiration), pass_code_option: sharePwd ? 'REQUIRED' : 'NOT_REQUIRED' }
  if (title) body.title = title
  if (sharePwd) body.custom_pass_code = sharePwd
  try {
    const resp = await fetch(`${PIKPAK_API_HOST}/drive/v1/share`, { method: 'PATCH', headers: pikpakAuthHeaders(token), body: JSON.stringify(body) })
    const data = await resp.json().catch(() => undefined)
    if (!resp.ok || data?.error) { result.error = parsePikPakError(data, result.error); return result }
    return { success: true, error: '' }
  } catch (err: any) { result.error = err?.message || result.error }
  return result
}

export const apiPikPakShareDelete = async (user_id: string, shareIds: string[]): Promise<string[]> => {
  const token = await getPikPakToken(user_id)
  if (!token?.access_token || !shareIds.length) return []
  try {
    const resp = await fetch(`${PIKPAK_API_HOST}/drive/v1/share:batchDelete`, { method: 'POST', headers: pikpakAuthHeaders(token), body: JSON.stringify({ ids: shareIds.map(decodePikPakShareId) }) })
    const data = await resp.json().catch(() => undefined)
    return resp.ok && !data?.error ? shareIds : []
  } catch { return [] }
}
