import type {IAliShareAnonymous,IAliShareFileItem} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {pikpakImportPublicFetch,pikpakImportPrivateFetch,pikpakImportAccount} from '../../pikpakImportTransport'
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

const requestPublicShare = async (scope: string, path: string, params: Record<string, string>) => {
  const url = new URL(`${PIKPAK_API_HOST}${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const resp = await pikpakImportPublicFetch(scope, url, { headers: publicHeaders() })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.error) throw new Error(parsePikPakError(data, '获取 PikPak 分享失败'))
  return data || {}
}

const getPikPakShareInfo = async (shareId: string, passCode = '', scope = '') => {
  return requestPublicShare(scope, '/drive/v1/share', {
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

export const apiPikPakShareAnonymous = async (shareId: string, passCode = '', scope = ''): Promise<IAliShareAnonymous> => {
  const id = decodePikPakShareId(shareId)
  const share: IAliShareAnonymous = {
    shareinfo: { share_id: encodePikPakShareId(id), creator_id: '', creator_name: '', creator_phone: '', display_name: id, expiration: '', file_count: 0, share_name: id, created_at: '', updated_at: '', vip: '', is_photo_collection: false, album_id: '' },
    shareinfojson: '',
    error: '解析 PikPak 分享链接失败'
  }
  try {
    const data = await getPikPakShareInfo(id, passCode, scope)
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

export const apiPikPakShareToken = async (shareId: string, passCode = '', scope = ''): Promise<string> => {
  try {
    const data = await getPikPakShareInfo(shareId, passCode, scope)
    return data?.pass_code_token || data?.passcode_token || '，获取 PikPak 分享 token 失败'
  } catch (error: any) {
    return `，${error?.message || '获取 PikPak 分享 token 失败'}`
  }
}

export const apiPikPakShareFileList = async (shareId: string, passCodeToken: string, parentId: string, scope = ''): Promise<{ items: IAliShareFileItem[]; next_marker: string; error: string }> => {
  try {
    const items: IAliShareFileItem[] = []
    let pageToken = ''
    const seenPageTokens = new Set<string>()
    do {
      const data = await requestPublicShare(scope, '/drive/v1/share/detail', { limit: '100', thumbnail_size: 'SIZE_LARGE', order: '6', share_id: decodePikPakShareId(shareId), parent_id: parentId === 'root' ? '' : parentId, pass_code_token: passCodeToken, page_token: pageToken })
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
  pikpakImportAccount(userId)
  try {
    const resp = await pikpakImportPrivateFetch(userId, `${PIKPAK_API_HOST}/drive/v1/share/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ share_id: decodePikPakShareId(shareId), pass_code_token: passCodeToken, file_ids: fileIds })
    })
    const data = await resp.json().catch(() => undefined)
    return !resp.ok || data?.error ? parsePikPakError(data, '保存 PikPak 分享失败') : 'success'
  } catch (error: any) {
    return error?.message || '保存 PikPak 分享失败'
  }
}
