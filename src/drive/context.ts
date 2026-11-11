import UserDAL from '../user/userdal'
import { getDriveProviderLabel, isRemoteSourceProvider, resolveDriveProvider, type DriveProvider } from '../utils/driveProvider'

export type DriveContext = { title: string; name: string; key: string }

const providerRoots: Partial<Record<DriveProvider, DriveContext>> = {
  cloud123: { title: '根目录', name: 'cloud', key: 'cloud_root' },
  '115': { title: '根目录', name: 'drive115', key: 'drive115_root' },
  '139': { title: '根目录', name: 'cloud139', key: 'cloud139_root' },
  '189': { title: '根目录', name: 'cloud189', key: 'cloud189_root' },
  guangya: { title: '根目录', name: 'guangya', key: 'guangya_root' },
  baidu: { title: '根目录', name: 'baidu', key: 'baidu_root' },
  pikpak: { title: '根目录', name: 'pikpak', key: 'pikpak_root' },
  quark: { title: '根目录', name: 'quark', key: 'quark_root' },
  dropbox: { title: '根目录', name: 'dropbox', key: 'dropbox_root' },
  onedrive: { title: '根目录', name: 'onedrive', key: 'onedrive_root' },
  box: { title: '根目录', name: 'box', key: 'box_root' },
  google: { title: '我的云端硬盘', name: 'google', key: 'google_root' }
}

export function getDriveId(userId: string, drive: string): string {
  if ((drive || '').startsWith('webdav:')) return drive
  const token = UserDAL.GetUserToken(userId)
  const route = resolveDriveProvider(userId, drive, token?.tokenfrom)
  if (!route.isValid) return ''
  if (route.driveProvider !== 'unknown' && route.provider !== 'aliyun') return drive
  if (route.provider !== 'aliyun') {
    if (route.provider === 'cloud123') return token?.default_drive_id || token?.resource_drive_id || 'cloud123'
    if (isRemoteSourceProvider(route.provider)) return token?.default_drive_id || ''
    return token?.default_drive_id || (route.provider === '115' ? 'drive115' : route.provider)
  }
  if (drive.includes('backup')) return token?.backup_drive_id || ''
  if (drive.includes('resource')) return token?.resource_drive_id || ''
  if (drive.includes('pic')) return token?.pic_drive_id || ''
  if (drive.includes('safe')) return token?.default_sbox_drive_id || ''
  return ''
}

export function getDriveType(userId: string, driveId: string): DriveContext {
  if ((driveId || '').startsWith('webdav:')) {
    const token = UserDAL.GetUserToken(userId)
    return { title: token?.nick_name || token?.user_name || getDriveProviderLabel(isRemoteSourceProvider(token?.tokenfrom) ? token?.tokenfrom : 'webdav'), name: token?.tokenfrom && isRemoteSourceProvider(token.tokenfrom) ? token.tokenfrom : 'webdav', key: '/' }
  }
  const token = UserDAL.GetUserToken(userId)
  const route = resolveDriveProvider(userId, driveId, token?.tokenfrom)
  if (!route.isValid) return { title: '未知网盘', name: 'unknown', key: '' }
  const root = providerRoots[route.provider]
  if (root) return root
  if (driveId === token?.backup_drive_id) return { title: '备份盘', name: 'backup', key: 'backup_root' }
  if (driveId === token?.resource_drive_id) return { title: '资源盘', name: 'resource', key: 'resource_root' }
  if (driveId === token?.pic_drive_id) return { title: '全部相册', name: 'pic', key: 'pic_root' }
  if (driveId === token?.default_sbox_drive_id) return { title: '安全盘', name: 'safe', key: 'safe_root' }
  return { title: '未知网盘', name: 'unknown', key: '' }
}
