import type { IAliShareItem } from '../aliapi/alimodels'
import type { IDownloadUrl, IVideoPreviewUrl } from '../aliapi/models'
import { humanExpiration } from '../utils/format'
import { GetExpiresTime } from '../utils/utils'
import { apiCloud123CopyBatch, apiCloud123CopySingle, apiCloud123DownloadInfo, apiCloud123FileDetail, apiCloud123FileInfos, apiCloud123Mkdir, apiCloud123MoveBatch, apiCloud123RecoverBatch, apiCloud123RenameBatch, apiCloud123TrashBatch } from './filecmd'
import { apiCloud123DirectoryFileList, apiCloud123FileListPage, mapCloud123FileToAliModel, mapCloud123InfoToAliModel } from './dirfilelist'
import { apiCloud123PaidShareCreate, apiCloud123ShareCreate, apiCloud123ShareList, getCloud123ShareUrl } from './share'
import { apiCloud123TranscodeList } from './video'

const toExpireDays = (expiration: string) => {
  if (!expiration) return 0
  const target = new Date(expiration).getTime()
  if (Number.isNaN(target)) return 0
  const days = Math.ceil(Math.max(0, target - Date.now()) / 86400000)
  return days <= 1 ? 1 : days <= 7 ? 7 : 30
}

const shareItem = (driveId: string, fileIds: string[], shareId: string, shareName: string, shareUrl: string, sharePwd = '', expiration = ''): IAliShareItem => ({
  created_at: '', creator: '', description: '', display_name: '', display_label: '', download_count: 0, drive_id: driveId, expiration, expired: false, file_id: '', file_id_list: fileIds, icon: 'iconwenjian', preview_count: 0, save_count: 0, share_id: shareId, share_msg: '', full_share_msg: '', share_name: shareName, share_policy: '', share_pwd: sharePwd, share_url: shareUrl, status: '', updated_at: '', is_share_saved: false, share_saved: ''
})

export const listCloud123Items = async (userId: string, driveId: string, dirId: string, includeFiles: boolean, lastFileId: string | number = '', strict = false) => {
  const isTrash = dirId === 'trash'
  const isSearch = dirId.startsWith('search')
  const parentFileId = dirId === 'cloud_root' || isTrash ? 0 : dirId
  const searchData = isSearch ? dirId.substring('search'.length).trim() : ''
  const page = includeFiles ? await apiCloud123FileListPage(userId, parentFileId, 100, isTrash, searchData, 0, lastFileId, strict) : undefined
  const sourceItems = page?.items || await apiCloud123DirectoryFileList(userId, parentFileId, isTrash, searchData)
  const items = sourceItems.map(item => {
    const mapped = mapCloud123FileToAliModel(item)
    mapped.drive_id = driveId
    return mapped
  })
  const visibleItems = includeFiles ? items : items.filter(item => item.isDir)
  return { items: visibleItems, total: visibleItems.length, nextCursor: page && page.lastFileId >= 0 ? String(page.lastFileId) : '' }
}

export const listCloud123Shares = async (userId: string) => {
  const items: IAliShareItem[] = []
  let lastShareId = 0
  do {
    const result = await apiCloud123ShareList(userId, lastShareId, 100)
    if (result.error) return { items, error: result.error }
    for (const share of result.list) {
      const expiration = share.expiration || ''
      items.push({ ...shareItem('cloud123', [], String(share.shareId), share.shareName || '分享链接', getCloud123ShareUrl(userId, share.shareKey), share.sharePwd || '', expiration), download_count: share.downloadCount || 0, preview_count: share.previewCount || 0, save_count: share.saveCount || 0, expired: share.expired === 1, status: share.expired === 1 ? 'expired' : '', share_msg: share.expired === 1 ? '过期失效' : humanExpiration(expiration) })
    }
    lastShareId = result.lastShareId
  } while (lastShareId !== -1)
  return { items, error: '' }
}

export const getCloud123DownloadUrl = async (userId: string, driveId: string, fileId: string): Promise<IDownloadUrl | string> => {
  const result = await apiCloud123DownloadInfo(userId, fileId)
  return typeof result === 'string' ? result : { drive_id: driveId, file_id: fileId, expire_time: 0, url: result.url, size: 0 }
}

export const getCloud123FileInfo = async (userId: string, fileId: string) => {
  const detail = await apiCloud123FileDetail(userId, fileId)
  if (!detail) return undefined
  const mapped = mapCloud123InfoToAliModel(detail) as any
  mapped.type = mapped.isDir ? 'folder' : 'file'
  return mapped
}

export const getCloud123VideoPreview = async (userId: string, driveId: string, fileId: string): Promise<IVideoPreviewUrl | string> => {
  const transcode = await apiCloud123TranscodeList(userId, fileId)
  if (typeof transcode === 'string') return transcode
  if (!transcode.list.length) {
    if (transcode.status === 1) return '视频正在转码中，稍后重试'
    if (transcode.status === 3) return '视频转码失败'
    return '暂无转码信息'
  }
  const detectVideoType = (url: string) => {
    const lower = String(url || '').split('?')[0].split('#')[0].toLowerCase()
    if (lower.endsWith('.m3u8')) return 'm3u8'
    if (lower.endsWith('.mpd')) return 'mpd'
    if (lower.endsWith('.ts')) return 'ts'
    return 'm3u8'
  }
  const data: IVideoPreviewUrl = { drive_id: driveId, file_id: fileId, size: 0, expire_time: 0, width: 0, height: 0, duration: 0, qualities: [], subtitles: [] }
  data.qualities = transcode.list
    .filter(item => item && item.url)
    .map(item => {
      const label = item.resolution || (item.height ? `${item.height}p` : '清晰度')
      return { html: label, quality: label, height: Number(item.height || 0), width: 0, label, value: label, url: item.url, type: detectVideoType(item.url) }
    })
    .sort((a, b) => (b.height || 0) - (a.height || 0))
  if (data.qualities.length > 0) {
    const first = data.qualities[0]
    data.height = first.height || 0
    data.expire_time = GetExpiresTime(first.url)
  }
  data.duration = Math.floor(Number(transcode.list.find(item => item.duration)?.duration || 0))
  return data
}

export const createCloud123Folder = (userId: string, parentFileId: string, name: string) => apiCloud123Mkdir(userId, parentFileId.includes('root') ? '0' : parentFileId, name)
export const trashCloud123Files = (userId: string, fileIds: string[]) => apiCloud123TrashBatch(userId, fileIds)
export const restoreCloud123Files = (userId: string, fileIds: string[]) => apiCloud123RecoverBatch(userId, fileIds)
export const renameCloud123Files = (userId: string, fileIds: string[], names: string[]) => apiCloud123RenameBatch(userId, fileIds, names)
export const moveCloud123Files = (userId: string, fileIds: string[], parentFileId: string) => apiCloud123MoveBatch(userId, fileIds, parentFileId.includes('root') ? '0' : parentFileId)
export const copyCloud123Files = (userId: string, fileIds: string[], parentFileId: string) => fileIds.length <= 1 ? apiCloud123CopySingle(userId, fileIds[0], parentFileId.includes('root') ? '0' : parentFileId) : apiCloud123CopyBatch(userId, fileIds, parentFileId.includes('root') ? '0' : parentFileId)
export const getCloud123FilesInfo = async (userId: string, fileIds: string[]) => {
  if (fileIds.length !== 1) return (await apiCloud123FileInfos(userId, fileIds)).map(item => mapCloud123InfoToAliModel(item))
  const detail = await apiCloud123FileDetail(userId, fileIds[0])
  return detail ? [mapCloud123InfoToAliModel(detail)] : []
}

export const createCloud123Share = async (userId: string, driveId: string, fileIds: string[], shareName: string, expiration: string, sharePwd: string): Promise<string | IAliShareItem> => {
  const days = toExpireDays(expiration)
  const result = await apiCloud123ShareCreate(userId, shareName, days, fileIds, sharePwd)
  if (result.error) return result.error
  const fallbackExpiration = days ? new Date(Date.now() + days * 86400000).toISOString() : ''
  return shareItem(driveId, fileIds, result.shareId, shareName || '分享链接', getCloud123ShareUrl(userId, result.shareKey), sharePwd, expiration || fallbackExpiration)
}

export const createCloud123PaidShare = async (userId: string, driveId: string, fileIds: string[], shareName: string, payAmount: number, resourceDesc: string, isReward: number): Promise<string | IAliShareItem> => {
  const result = await apiCloud123PaidShareCreate(userId, shareName, fileIds, payAmount, resourceDesc, isReward)
  if (result.error) return result.error
  return { ...shareItem(driveId || 'cloud123', fileIds, result.shareId, shareName || '付费分享', getCloud123ShareUrl(userId, result.shareKey)), description: resourceDesc, share_msg: `付费 ${payAmount} 元`, share_policy: 'cloud123_paid' }
}
