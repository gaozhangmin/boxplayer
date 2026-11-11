import type { IDownloadUrl } from '../aliapi/models'
import AliFile from '../aliapi/file'
import { getCloud123DownloadUrl } from '../cloud123/adapter'
import { getDrive115DownloadUrl } from '../cloud115/adapter'
import { getBaiduDownloadUrl } from '../cloudbaidu/adapter'
import { getPikPakDownloadUrl } from '../pikpak/adapter'
import { getQuarkDownloadUrl } from '../quark/adapter'
import { getCloud139DownloadUrl } from '../cloud139/adapter'
import { getCloud189DownloadUrl } from '../cloud189/adapter'
import { getGuangyaDownloadUrl } from '../guangya/adapter'
import { getDropboxDownloadUrl } from '../dropbox/adapter'
import { getOneDriveProviderDownloadUrl } from '../onedrive/adapter'
import { getBoxDownloadUrl } from '../box/adapter'
import { getGoogleDownloadUrl } from '../google/adapter'
import UserDAL from '../user/userdal'
import { resolveDriveProvider } from '../utils/driveProvider'

/** Provider-neutral file operations. AliFile only handles the Aliyun branch. */
export default class DriveFile {
  static async ApiFileDownloadUrl(userId: string, driveId: string, fileId: string, expireSec: number, tokenfrom = ''): Promise<IDownloadUrl | string> {
    if (!driveId || !fileId) return '参数错误'
    const route = resolveDriveProvider(userId, driveId, tokenfrom || UserDAL.GetUserToken(userId)?.tokenfrom)
    if (!route.isValid) return route.error

    switch (route.provider) {
      case 'aliyun':
      case 'webdav':
      case 'alist':
      case 'smb':
      case 'nfs':
      case 'ftp':
        return AliFile.ApiFileDownloadUrl(userId, driveId, fileId, expireSec)
      case 'baidu': return getBaiduDownloadUrl(userId, driveId, fileId)
      case 'cloud123': return getCloud123DownloadUrl(userId, driveId, fileId)
      case '115': return getDrive115DownloadUrl(userId, driveId, fileId)
      case 'pikpak': return getPikPakDownloadUrl(userId, driveId, fileId)
      case 'quark': return getQuarkDownloadUrl(userId, driveId, fileId)
      case '139': return getCloud139DownloadUrl(userId, driveId, fileId)
      case '189': return getCloud189DownloadUrl(userId, driveId, fileId)
      case 'guangya': return getGuangyaDownloadUrl(userId, driveId, fileId)
      case 'dropbox': return getDropboxDownloadUrl(userId, driveId, fileId)
      case 'onedrive': return getOneDriveProviderDownloadUrl(userId, driveId, fileId)
      case 'box': return getBoxDownloadUrl(userId, driveId, fileId)
      case 'google': return getGoogleDownloadUrl(userId, driveId, fileId)
      default:
        return '当前网盘不支持下载'
    }
  }
}
