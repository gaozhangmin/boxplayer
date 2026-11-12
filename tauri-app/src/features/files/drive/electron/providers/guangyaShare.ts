import type {IAliShareItem} from '../aliapi/alimodels'
import {humanDateTime,humanExpiration} from '../utils/format'
import {guangyaRequest} from '../../shareProviderTransport'
export interface GuangyaShareCreateResult {
  item?: IAliShareItem
  error: string
}

export const isGuangyaShareId = (shareId: string) => shareId.startsWith('guangya:')

export const encodeGuangyaShareId = (shareId: string) => `guangya:${shareId}`

export const decodeGuangyaShareId = (shareId: string) => isGuangyaShareId(shareId) ? shareId.slice('guangya:'.length) : shareId

const toValidateDuration = (expiration: string) => {
  if (!expiration) return 0
  const time = new Date(expiration).getTime()
  if (!time || Number.isNaN(time)) return 0
  return Math.max(1, Math.ceil((time - Date.now()) / (24 * 60 * 60 * 1000)))
}

const shareUrl = (shareId: string, raw: any) => raw?.shareUrl || raw?.url || raw?.link || (shareId ? `https://www.guangyapan.com/s/${shareId}` : '')

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

export const parseGuangyaShareLink = (value: string): { id: string; pwd: string } => {
  const id = value.match(/guangyapan\.com\/s\/([A-Za-z0-9_-]+)/i)?.[1] || ''
  const pwd = value.match(/(?:提取码|密码|code|pwd)[:：\s]*([A-Za-z0-9]+)/i)?.[1] || ''
  return { id: id ? encodeGuangyaShareId(id) : '', pwd }
}
