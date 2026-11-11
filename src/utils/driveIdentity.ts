import UserDAL from '../user/userdal'
import { isRemoteSourceProvider } from './driveProvider'

type DriveUser = string | { user_id?: string; tokenfrom?: string }

const resolveUserTokenInfo = (user: DriveUser) => typeof user === 'string'
  ? { user_id: user, tokenfrom: UserDAL.GetUserToken(user)?.tokenfrom || '' }
  : { user_id: user?.user_id || '', tokenfrom: user?.tokenfrom || '' }

const isProviderUser = (user: DriveUser, tokenfrom: string, prefix: string) => {
  const info = resolveUserTokenInfo(user)
  return info.tokenfrom === tokenfrom || info.user_id.startsWith(prefix)
}

export const isCloud123User = (user: DriveUser) => isProviderUser(user, 'cloud123', 'cloud123_')
export const isDrive115User = (user: DriveUser) => isProviderUser(user, '115', '115_')
export const isCloud139User = (user: DriveUser) => isProviderUser(user, '139', 'cloud139_')
export const isCloud189User = (user: DriveUser) => isProviderUser(user, '189', 'cloud189_')
export const isGuangyaUser = (user: DriveUser) => isProviderUser(user, 'guangya', 'guangya_')
export const isAliyunUser = (user: DriveUser) => isProviderUser(user, 'aliyun', 'aliyun_')
export const isBaiduUser = (user: DriveUser) => isProviderUser(user, 'baidu', 'baidu_')
export const isPikPakUser = (user: DriveUser) => isProviderUser(user, 'pikpak', 'pikpak_')
export const isQuarkUser = (user: DriveUser) => isProviderUser(user, 'quark', 'quark_')
export const isDropboxUser = (user: DriveUser) => isProviderUser(user, 'dropbox', 'dropbox_')
export const isOneDriveUser = (user: DriveUser) => isProviderUser(user, 'onedrive', 'onedrive_')
export const isBoxUser = (user: DriveUser) => isProviderUser(user, 'box', 'box_')
export const isGoogleUser = (user: DriveUser) => isProviderUser(user, 'google', 'google_')
export const isRemoteDriveUser = (user: DriveUser) => {
  const info = resolveUserTokenInfo(user)
  return isRemoteSourceProvider(info.tokenfrom) || /^(webdav|alist|smb|nfs|ftp)_/.test(info.user_id)
}
export const isNonAliyunProvider = (user: DriveUser) => !isAliyunUser(user) && (isCloud123User(user) || isDrive115User(user) || isCloud139User(user) || isCloud189User(user) || isGuangyaUser(user) || isBaiduUser(user) || isPikPakUser(user) || isQuarkUser(user) || isDropboxUser(user) || isOneDriveUser(user) || isBoxUser(user) || isGoogleUser(user) || isRemoteDriveUser(user))
