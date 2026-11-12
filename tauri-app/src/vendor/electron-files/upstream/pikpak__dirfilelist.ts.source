import type { IAliGetFileModel } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import { humanDateTimeDateStr, humanSize } from '../utils/format'
import { HanToPin } from '../utils/utils'
import message from '../utils/message'
import { captchaSign, pikpakAuthHeaders } from './auth'
import { getProviderTokenForUser } from '../drive/account'

export type PikPakFileItem = {
  id: string
  parent_id?: string
  kind?: string
  name: string
  size?: string | number
  modified_time?: string
  created_time?: string
  thumbnail_link?: string
  web_content_link?: string
  medias?: Array<{ link?: { url?: string }; media_name?: string }>
}

export type PikPakDownloadInfo = {
  item: PikPakFileItem | null
  streamUrl: string
  downloadUrl: string
  error: string
}

type PikPakFileListResp = {
  files?: PikPakFileItem[]
  next_page_token?: string
}

const API_URL = 'https://api-drive.mypikpak.com/drive/v1/files'

const isPikPakDir = (item: PikPakFileItem) => (item.kind || '').includes('folder')

const getPikPakStreamUrl = (item: PikPakFileItem) => {
  return item.medias?.find(media => media?.link?.url)?.link?.url || ''
}

const getPikPakWebContentUrl = (item: PikPakFileItem) => item.web_content_link || ''

const encodeDescription = (item: PikPakFileItem) => {
  const downloadUrl = getPikPakStreamUrl(item) || getPikPakWebContentUrl(item)
  return downloadUrl ? `pikpak_download:${encodeURIComponent(downloadUrl)}` : ''
}

const parsePikPakError = (data: any, fallback: string) => {
  return data?.error_description || data?.message || data?.error || fallback
}

export const getPikPakToken = (user_id: string) => getProviderTokenForUser(user_id, 'pikpak')

export const apiPikPakFileList = async (
  user_id: string,
  parentId: string,
  limit = 100,
  pageToken = '',
  trashed = false,
  strict = false
): Promise<{ items: PikPakFileItem[]; nextPageToken: string }> => {
  const token = await getPikPakToken(user_id)
  if (!token?.access_token) {
    message.error('未登录 PikPak')
    if (strict) throw new Error('未登录 PikPak')
    return { items: [], nextPageToken: '' }
  }
  const params = new URLSearchParams()
  params.set('thumbnail_size', 'SIZE_MEDIUM')
  params.set('limit', String(limit))
  params.set('with_audit', 'true')
  params.set('filters', JSON.stringify({
    trashed: { eq: trashed },
    phase: { eq: 'PHASE_TYPE_COMPLETE' }
  }))
  if (!trashed && parentId && parentId !== 'pikpak_root') params.set('parent_id', parentId)
  if (pageToken) params.set('page_token', pageToken)
  const resp = await fetch(`${API_URL}?${params.toString()}`, {
    headers: pikpakAuthHeaders(token)
  })
  const data = await resp.json().catch(() => undefined) as PikPakFileListResp | any
  if (!resp.ok || data?.error) {
    message.error(data?.error_description || data?.message || '获取 PikPak 文件列表失败')
    if (strict) throw new Error(parsePikPakError(data, '获取 PikPak 文件列表失败'))
    return { items: [], nextPageToken: '' }
  }
  return {
    items: Array.isArray(data?.files) ? data.files : [],
    nextPageToken: data?.next_page_token || ''
  }
}

export const apiPikPakFileDetail = async (user_id: string, fileId: string): Promise<PikPakFileItem | null> => {
  const token = await getPikPakToken(user_id)
  if (!token?.access_token) return null
  const resp = await fetch(`${API_URL}/${fileId}?thumbnail_size=SIZE_LARGE`, {
    headers: pikpakAuthHeaders(token)
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.error) return null
  return data as PikPakFileItem
}

export const apiPikPakDownloadInfo = async (user_id: string, fileId: string): Promise<PikPakDownloadInfo> => {
  const result: PikPakDownloadInfo = { item: null, streamUrl: '', downloadUrl: '', error: '获取 PikPak 下载地址失败' }
  const token = await getPikPakToken(user_id)
  if (!token?.access_token) {
    result.error = '请先登录 PikPak'
    return result
  }
  try {
    const timestamp = Date.now().toString()
    const meta = {
      captcha_sign: '',
      client_version: '1.47.1',
      package_name: 'com.pikcloud.pikpak',
      user_id: token.user_id.replace(/^pikpak_/, ''),
      timestamp
    }
    meta.captcha_sign = captchaSign(token.device_id || '', timestamp)
    const captchaResp = await fetch('https://user.mypikpak.com/v1/shield/captcha/init', {
      method: 'POST',
      headers: pikpakAuthHeaders(token),
      body: JSON.stringify({
        client_id: 'YNxT9w7GMdWvEOKa',
        action: `GET:/drive/v1/files/${fileId}`,
        device_id: token.device_id || '',
        meta
      })
    })
    const captchaData = await captchaResp.json().catch(() => undefined)
    if (!captchaResp.ok || captchaData?.error || !captchaData?.captcha_token) {
      result.error = parsePikPakError(captchaData, '获取 PikPak 验证信息失败')
      return result
    }
    const headers = pikpakAuthHeaders(token) as Record<string, string>
    headers['X-Captcha-Token'] = captchaData.captcha_token
    const resp = await fetch(`${API_URL}/${fileId}?thumbnail_size=SIZE_LARGE`, { headers })
    const data = await resp.json().catch(() => undefined)
    if (!resp.ok || data?.error) {
      result.error = parsePikPakError(data, result.error)
      return result
    }
    const item = data as PikPakFileItem
    result.item = item
    result.streamUrl = getPikPakStreamUrl(item)
    result.downloadUrl = getPikPakWebContentUrl(item)
    result.error = result.streamUrl || result.downloadUrl ? '' : '获取 PikPak 下载地址失败'
  } catch (err: any) {
    result.error = err?.message || result.error
  }
  return result
}

export const mapPikPakFileToAliModel = (item: PikPakFileItem, drive_id: string, parentId: string): IAliGetFileModel => {
  const isDir = isPikPakDir(item)
  const name = item.name || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const time = new Date(item.modified_time || item.created_time || '').getTime() || 0
  const timeStr = time ? humanDateTimeDateStr(new Date(time).toISOString()) : ''
  const size = Number(item.size || 0)
  let category = ''
  let icon = 'iconfile-folder'
  if (!isDir) {
    const iconInfo = getFileIcon('', ext, ext, '', size)
    category = iconInfo[0]
    icon = iconInfo[1]
  }
  return {
    __v_skip: true,
    drive_id,
    file_id: String(item.id || ''),
    parent_file_id: item.parent_id || parentId,
    name,
    namesearch: HanToPin(name),
    ext,
    mime_type: '',
    mime_extension: ext,
    category,
    icon,
    file_count: 0,
    size,
    sizeStr: humanSize(size),
    time,
    timeStr,
    starred: false,
    isDir,
    thumbnail: item.thumbnail_link || '',
    description: encodeDescription(item)
  }
}
