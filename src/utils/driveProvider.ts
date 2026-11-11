import type { ITokenInfo } from '../user/userstore'

export type DriveProvider = ITokenInfo['tokenfrom']

export interface DriveProviderResolution {
  provider: DriveProvider
  accountProvider: DriveProvider
  driveProvider: DriveProvider
  isValid: boolean
  error: string
}

export interface DriveProviderMeta {
  key: DriveProvider
  label: string
  icon: string
}

const driveProviderMap: Record<DriveProvider, DriveProviderMeta> = {
  aliyun: {
    key: 'aliyun',
    label: '阿里云盘',
    icon: 'images/drive-icons/aliyun.svg'
  },
  cloud123: {
    key: 'cloud123',
    label: '123网盘',
    icon: 'images/drive-icons/cloud123.svg'
  },
  '115': {
    key: '115',
    label: '115网盘',
    icon: 'images/drive-icons/drive115.svg'
  },
  '139': {
    key: '139',
    label: '139云盘',
    icon: 'images/drive-icons/cloud139.svg'
  },
  '189': {
    key: '189',
    label: '天翼云盘',
    icon: 'images/drive-icons/cloud189.svg'
  },
  guangya: {
    key: 'guangya',
    label: '光鸭云盘',
    icon: 'images/drive-icons/guangya.svg'
  },
  baidu: {
    key: 'baidu',
    label: '百度网盘',
    icon: 'images/drive-icons/baidu.svg'
  },
  pikpak: {
    key: 'pikpak',
    label: 'PikPak',
    icon: 'images/drive-icons/pikpak.png'
  },
  quark: {
    key: 'quark',
    label: '夸克网盘',
    icon: 'images/drive-icons/quark.svg'
  },
  dropbox: {
    key: 'dropbox',
    label: 'Dropbox',
    icon: 'images/drive-icons/dropbox.svg'
  },
  onedrive: {
    key: 'onedrive',
    label: 'OneDrive',
    icon: 'images/drive-icons/onedrive.svg'
  },
  box: {
    key: 'box',
    label: 'Box',
    icon: 'images/drive-icons/box.svg'
  },
  google: {
    key: 'google',
    label: 'Google Drive',
    icon: 'images/drive-icons/google-drive.svg'
  },
  webdav: {
    key: 'webdav',
    label: 'WebDAV',
    icon: ''
  },
  alist: {
    key: 'alist',
    label: 'AList',
    icon: 'images/source-tiles/alist.svg'
  },
  smb: {
    key: 'smb',
    label: 'SMB',
    icon: ''
  },
  nfs: {
    key: 'nfs',
    label: 'NFS',
    icon: ''
  },
  ftp: {
    key: 'ftp',
    label: 'FTP',
    icon: ''
  },
  unknown: {
    key: 'unknown',
    label: '未知网盘',
    icon: ''
  }
}

export const getDriveProviderMeta = (tokenfrom?: string): DriveProviderMeta => {
  return driveProviderMap[(tokenfrom || 'unknown') as DriveProvider] || driveProviderMap.unknown
}

export const getDriveProviderLabel = (tokenfrom?: string): string => getDriveProviderMeta(tokenfrom).label

export const getDriveProviderIcon = (tokenfrom?: string): string => getDriveProviderMeta(tokenfrom).icon

const providerByDriveId: Record<string, DriveProvider> = {
  cloud123: 'cloud123',
  cloud_root: 'cloud123',
  drive115: '115',
  drive115_root: '115',
  cloud139: '139',
  cloud139_root: '139',
  cloud189: '189',
  cloud189_root: '189',
  guangya: 'guangya',
  guangya_root: 'guangya',
  baidu: 'baidu',
  baidu_root: 'baidu',
  pikpak: 'pikpak',
  pikpak_root: 'pikpak',
  quark: 'quark',
  quark_root: 'quark',
  dropbox: 'dropbox',
  dropbox_root: 'dropbox',
  onedrive: 'onedrive',
  onedrive_root: 'onedrive',
  box: 'box',
  box_root: 'box',
  google: 'google',
  google_root: 'google'
}

const providerByUserIdPrefix: Array<[string, DriveProvider]> = [
  ['aliyun_', 'aliyun'],
  ['cloud123_', 'cloud123'],
  ['115_', '115'],
  ['cloud139_', '139'],
  ['cloud189_', '189'],
  ['guangya_', 'guangya'],
  ['baidu_', 'baidu'],
  ['pikpak_', 'pikpak'],
  ['quark_', 'quark'],
  ['dropbox_', 'dropbox'],
  ['onedrive_', 'onedrive'],
  ['box_', 'box'],
  ['google_', 'google'],
  ['webdav_', 'webdav'],
  ['alist_', 'alist'],
  ['smb_', 'smb'],
  ['nfs_', 'nfs'],
  ['ftp_', 'ftp']
]

/** Account kinds that share the `webdav:<connectionId>` virtual drive id (see remoteDriveAccount.ts). */
export const REMOTE_SOURCE_PROVIDERS: readonly DriveProvider[] = ['webdav', 'alist', 'smb', 'nfs', 'ftp']
export const isRemoteSourceProvider = (provider?: string): boolean => REMOTE_SOURCE_PROVIDERS.includes(provider as DriveProvider)

export const getDriveProviderById = (driveId?: string): DriveProvider => {
  if (!driveId) return 'unknown'
  if (driveId.startsWith('webdav:')) return 'webdav'
  return providerByDriveId[driveId] || 'unknown'
}

export const getDriveProviderByAccount = (userId?: string, tokenfrom?: string): DriveProvider => {
  if (tokenfrom && tokenfrom !== 'unknown' && driveProviderMap[tokenfrom as DriveProvider]) return tokenfrom as DriveProvider
  const prefix = providerByUserIdPrefix.find(([value]) => (userId || '').startsWith(value))
  return prefix?.[1] || 'unknown'
}

/** Historical Aliyun accounts were persisted before tokenfrom was required. */
export const getStoredTokenProvider = (token?: Pick<ITokenInfo, 'user_id' | 'tokenfrom' | 'access_token'>): DriveProvider => {
  if (!token?.user_id) return 'unknown'
  const provider = getDriveProviderByAccount(token.user_id, token.tokenfrom)
  return provider === 'unknown' ? 'aliyun' : provider
}

/**
 * A static third-party drive id is authoritative. Never send a mismatched
 * account/drive pair to the Aliyun fallback merely because account lookup failed.
 */
export const resolveDriveProvider = (userId?: string, driveId?: string, tokenfrom?: string): DriveProviderResolution => {
  const accountProvider = getDriveProviderByAccount(userId, tokenfrom)
  const driveProvider = getDriveProviderById(driveId)
  if (driveProvider === 'webdav' && isRemoteSourceProvider(accountProvider)) {
    return { provider: accountProvider, accountProvider, driveProvider, isValid: true, error: '' }
  }

  if (driveProvider !== 'unknown' && accountProvider !== 'unknown' && driveProvider !== accountProvider) {
    return { provider: 'unknown', accountProvider, driveProvider, isValid: false, error: `账号属于 ${getDriveProviderLabel(accountProvider)}，但当前 drive_id 属于 ${getDriveProviderLabel(driveProvider)}` }
  }

  const provider = driveProvider !== 'unknown' ? driveProvider : accountProvider
  if (provider === 'unknown') {
    return { provider, accountProvider, driveProvider, isValid: false, error: '无法识别当前网盘类型' }
  }
  return { provider, accountProvider, driveProvider, isValid: true, error: '' }
}

export const isTokenCompatibleWithDrive = (token: Pick<ITokenInfo, 'user_id' | 'tokenfrom'> | undefined, driveId: string) => {
  if (!token?.user_id || !token.tokenfrom) return false
  const route = resolveDriveProvider(token.user_id, driveId, token.tokenfrom)
  return route.isValid && route.provider === token.tokenfrom
}

export const isProviderTokenForUser = (token: ITokenInfo | undefined, userId: string, provider: ITokenInfo['tokenfrom']): token is ITokenInfo => {
  return !!token?.access_token && token.user_id === userId && token.tokenfrom === provider
}
