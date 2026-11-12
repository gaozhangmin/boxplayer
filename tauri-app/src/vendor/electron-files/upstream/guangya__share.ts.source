import type { IAliShareAnonymous, IAliShareFileItem, IAliShareItem } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import { humanDateTime, humanDateTimeDateStr, humanExpiration, humanSize } from '../utils/format'
import { GUANGYA_API_URL, GUANGYA_WEB_URL, generateGuangyaDid, generateGuangyaTraceparent, GUANGYA_USER_AGENT } from './auth'
import { getGuangyaFileId, getGuangyaFileName, guangyaApiParentId, guangyaRequest, isGuangyaDir } from './dirfilelist'

export interface GuangyaShareCreateResult {
  item?: IAliShareItem
  error: string
}

export interface GuangyaShareListResult {
  list: IAliShareItem[]
  nextMarker: string
  error: string
}

export interface GuangyaShareUpdateResult {
  success: boolean
  error: string
}

export const isGuangyaShareId = (shareId: string) => shareId.startsWith('guangya:')
export const encodeGuangyaShareId = (shareId: string) => `guangya:${shareId}`
export const decodeGuangyaShareId = (shareId: string) => isGuangyaShareId(shareId) ? shareId.slice('guangya:'.length) : shareId

export const parseGuangyaShareLink = (value: string): { id: string; pwd: string } => {
  const id = value.match(/guangyapan\.com\/s\/([A-Za-z0-9_-]+)/i)?.[1] || ''
  const pwd = value.match(/(?:提取码|密码|code|pwd)[:：\s]*([A-Za-z0-9]+)/i)?.[1] || ''
  return { id: id ? encodeGuangyaShareId(id) : '', pwd }
}

const toValidateDuration = (expiration: string) => {
  if (!expiration) return 0
  const time = new Date(expiration).getTime()
  if (!time || Number.isNaN(time)) return 0
  return Math.max(1, Math.ceil((time - Date.now()) / (24 * 60 * 60 * 1000)))
}

const shareUrl = (shareId: string, raw: any) => raw?.shareUrl || raw?.url || raw?.link || (shareId ? `https://www.guangyapan.com/s/${shareId}` : '')

const guangyaPublicPost = async (endpoint: string, body: any): Promise<any> => {
  const resp = await fetch(`${GUANGYA_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      did: generateGuangyaDid(),
      dt: '4',
      origin: GUANGYA_WEB_URL,
      referer: `${GUANGYA_WEB_URL}/`,
      traceparent: generateGuangyaTraceparent(),
      'user-agent': GUANGYA_USER_AGENT
    },
    body: JSON.stringify(body || {})
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.success === false) throw new Error(data?.message || data?.msg || `光鸭云盘分享请求失败 HTTP ${resp.status}`)
  return data
}

const mapGuangyaShareToAliItem = (raw: any, driveId = 'guangya'): IAliShareItem => {
  const shareId = String(raw?.shareId || raw?.id || raw?.share_id || '')
  const expiration = raw?.expiration || raw?.expireTime || raw?.expiredAt || raw?.validateTime || ''
  const createdAt = raw?.createdAt || raw?.createTime || raw?.created_at || ''
  const updatedAt = raw?.updatedAt || raw?.updateTime || raw?.updated_at || ''
  const fileIds = raw?.fileIds || raw?.fileIdList || raw?.file_id_list || []
  const shareName = raw?.title || raw?.shareName || raw?.name || '分享链接'
  return {
    created_at: createdAt ? humanDateTime(createdAt) : '',
    creator: '',
    description: '',
    display_name: '',
    display_label: '',
    download_count: Number(raw?.downloadCount || raw?.download_count || 0),
    drive_id: driveId,
    expiration,
    expired: !!(raw?.expired || raw?.isExpired),
    file_id: '',
    file_id_list: Array.isArray(fileIds) ? fileIds.map(String) : [],
    icon: 'iconwenjian',
    preview_count: Number(raw?.previewCount || raw?.preview_count || 0),
    save_count: Number(raw?.saveCount || raw?.save_count || raw?.restoreCount || 0),
    share_id: shareId,
    share_msg: humanExpiration(expiration),
    full_share_msg: '',
    share_name: shareName,
    share_policy: '',
    share_pwd: raw?.code || raw?.sharePwd || raw?.pwd || '',
    share_url: shareUrl(shareId, raw),
    status: String(raw?.status || ''),
    updated_at: updatedAt ? humanDateTime(updatedAt) : '',
    is_share_saved: false,
    share_saved: ''
  }
}

export const apiGuangyaShareCreate = async (user_id: string, expiration: string, sharePwd: string, shareName: string, fileIDList: string[]): Promise<GuangyaShareCreateResult> => {
  try {
    const data = await guangyaRequest(user_id, '/nd.bizuserres.s/v1/share_file', {
      fileIds: fileIDList,
      title: shareName || '分享链接',
      validateDuration: toValidateDuration(expiration),
      shareType: 1,
      code: sharePwd || '',
      autoFillCode: !sharePwd,
      trafficLimit: '0',
      maxRestoreCount: 0,
      downloadType: 1
    })
    const body = data?.data || data || {}
    const item = mapGuangyaShareToAliItem({ ...body, fileIds: fileIDList, title: shareName, code: sharePwd, expiration }, 'guangya')
    item.share_id = encodeGuangyaShareId(decodeGuangyaShareId(item.share_id))
    if (!item.share_id) return { error: data?.message || data?.msg || '创建光鸭云盘分享失败' }
    return { item, error: '' }
  } catch (error: any) {
    return { error: error?.message || '创建光鸭云盘分享失败' }
  }
}

export const apiGuangyaShareList = async (user_id: string, page = 0, pageSize = 100): Promise<GuangyaShareListResult> => {
  try {
    const data = await guangyaRequest(user_id, '/nd.bizuserres.s/v1/get_share_list', {
      page,
      pageSize,
      orderType: 1,
      sortType: 1
    })
    const body = data?.data || data || {}
    const list = body?.list || body?.items || body?.records || body?.content || []
    const items = Array.isArray(list) ? list.map((item) => {
      const mapped = mapGuangyaShareToAliItem(item, 'guangya')
      mapped.share_id = encodeGuangyaShareId(decodeGuangyaShareId(mapped.share_id))
      return mapped
    }).filter((item) => item.share_id) : []
    const total = Number(body?.total || body?.totalCount || 0)
    const hasMore = items.length >= pageSize && (!total || (page + 1) * pageSize < total)
    return { list: items, nextMarker: hasMore ? String(page + 1) : '', error: '' }
  } catch (error: any) {
    return { list: [], nextMarker: '', error: error?.message || '获取光鸭云盘分享列表失败' }
  }
}

export const apiGuangyaShareDelete = async (user_id: string, ids: string[]): Promise<string[]> => {
  if (!ids.length) return []
  try {
    await guangyaRequest(user_id, '/nd.bizuserres.s/v1/delete_share', { ids: ids.map(decodeGuangyaShareId) })
    return ids
  } catch {
    return []
  }
}

export const apiGuangyaShareUpdate = async (user_id: string, shareId: string, expiration: string, sharePwd: string, shareName: string): Promise<GuangyaShareUpdateResult> => {
  try {
    await guangyaRequest(user_id, '/nd.bizuserres.s/v1/update_share', {
      id: decodeGuangyaShareId(shareId),
      title: shareName || '分享链接',
      validateDuration: toValidateDuration(expiration),
      shareType: 1,
      code: sharePwd || '',
      autoFillCode: !sharePwd,
      trafficLimit: '0',
      maxRestoreCount: 0,
      downloadType: 1
    })
    return { success: true, error: '' }
  } catch (error: any) {
    return { success: false, error: error?.message || '修改光鸭云盘分享失败' }
  }
}

export const apiGuangyaShareAnonymous = async (share_id: string, share_pwd = ''): Promise<IAliShareAnonymous> => {
  const rawShareId = decodeGuangyaShareId(share_id)
  const share: IAliShareAnonymous = {
    shareinfo: {
      share_id,
      creator_id: '',
      creator_name: '',
      creator_phone: '',
      display_name: '',
      expiration: '',
      file_count: 0,
      share_name: '',
      created_at: '',
      updated_at: '',
      vip: '',
      is_photo_collection: false,
      album_id: ''
    },
    shareinfojson: '',
    error: '解析分享链接失败'
  }
  try {
    const data = await guangyaPublicPost('/nd.bizuserres.s/v1/get_share_summary', { shareId: rawShareId })
    const body = data?.data || data || {}
    share.shareinfo.display_name = body?.displayName || body?.creatorName || ''
    share.shareinfo.share_name = body?.title || body?.shareName || body?.name || rawShareId
    share.shareinfo.file_count = Number(body?.fileCount || body?.file_count || 0)
    share.shareinfo.expiration = body?.expiration || body?.expireTime || ''
    share.shareinfo.created_at = body?.createdAt || body?.createTime || ''
    share.shareinfo.updated_at = body?.updatedAt || body?.updateTime || ''
    share.shareinfojson = JSON.stringify(body)
    share.error = ''
  } catch (error: any) {
    share.error = error?.message || '解析分享链接失败'
  }
  return share
}

export const apiGuangyaShareToken = async (share_id: string, code: string): Promise<string> => {
  try {
    const data = await guangyaPublicPost('/nd.bizuserres.s/v1/get_share_access_token', {
      shareId: decodeGuangyaShareId(share_id),
      code
    })
    const body = data?.data || data || {}
    return body?.accessToken || body?.access_token || ''
  } catch (error: any) {
    return '，' + (error?.message || '获取光鸭云盘分享 token 失败')
  }
}

const mapGuangyaShareFile = (item: any, parentId: string): IAliShareFileItem => {
  const name = getGuangyaFileName(item)
  const isDir = isGuangyaDir(item)
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const size = Number(item?.size || item?.fileSize || 0)
  const updatedAt = item?.updatedAt || item?.updateTime || item?.createdAt || item?.createTime || ''
  const icon = getFileIcon(isDir ? '' : '', ext, ext, item?.mimeType || '', size)[1]
  return {
    drive_id: 'guangya',
    file_id: getGuangyaFileId(item),
    name,
    type: isDir ? 'folder' : 'file',
    parent_file_id: String(item?.parentId || parentId || ''),
    file_extension: ext,
    mime_extension: ext,
    mime_type: item?.mimeType || '',
    size,
    category: isDir ? '' : getFileIcon('', ext, ext, item?.mimeType || '', size)[0],
    punish_flag: 0,
    isDir,
    created_at: item?.createdAt || item?.createTime || '',
    updated_at: updatedAt,
    timeStr: updatedAt ? humanDateTimeDateStr(updatedAt) : '',
    sizeStr: isDir ? '' : humanSize(size),
    icon
  }
}

export const apiGuangyaShareFileList = async (share_id: string, accessToken: string, parentId: string): Promise<{ items: IAliShareFileItem[]; next_marker: string; error: string }> => {
  try {
    const items: IAliShareFileItem[] = []
    let page = 1
    let hasMore = false
    do {
      const data = await guangyaPublicPost('/nd.bizuserres.s/v1/get_share_page_files_list', {
        accessToken,
        parentId: parentId === 'root' ? '' : parentId,
        page,
        pageSize: 100,
        orderBy: 0,
        sortType: 0
      })
      const body = data?.data || data || {}
      const list = body?.list || body?.items || body?.records || body?.content || []
      const pageItems = Array.isArray(list) ? list : []
      items.push(...pageItems.map(item => mapGuangyaShareFile(item, parentId)))
      const total = Number(body?.total || body?.totalCount || 0)
      hasMore = total ? items.length < total : pageItems.length === 100
      page += 1
    } while (hasMore)
    return { items, next_marker: hasMore ? String(page) : '', error: '' }
  } catch (error: any) {
    return { items: [], next_marker: '', error: error?.message || '获取光鸭云盘分享文件失败' }
  }
}

export const apiGuangyaSaveShareFilesBatch = async (share_id: string, accessToken: string, user_id: string, parentFileId: string, fileIDList: string[]): Promise<string> => {
  try {
    await guangyaRequest(user_id, '/nd.bizuserres.s/v1/restore_share', {
      accessToken,
      fileIds: fileIDList,
      parentId: guangyaApiParentId(parentFileId)
    })
    return 'success'
  } catch (error: any) {
    return error?.message || '保存光鸭云盘分享失败'
  }
}
