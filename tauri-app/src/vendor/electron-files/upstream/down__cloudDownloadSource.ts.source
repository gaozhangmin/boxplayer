import type { IStateDownInfo } from './DownDAL'

const providerLabels: Record<string, string> = {
  aliyun: '阿里云盘',
  cloud123: '123 云盘',
  drive115: '115 网盘',
  pikpak: 'PikPak',
  guangya: '光鸭云盘',
  baidu: '百度网盘',
  quark: '夸克网盘',
  '139': '139 云盘',
  '189': '天翼云盘',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  box: 'Box'
}

export const getCloudProviderLabel = (info: Pick<IStateDownInfo, 'offlineProvider' | 'drive_id'>): string => {
  return providerLabels[info.offlineProvider || info.drive_id] || '网盘'
}

export const getCloudDownloadSourceLabel = (info: Pick<IStateDownInfo, 'offlineProvider' | 'drive_id' | 'user_id'>, accountName = '') => {
  return `${getCloudProviderLabel(info)} · ${accountName || info.user_id || '未知账号'}`
}
