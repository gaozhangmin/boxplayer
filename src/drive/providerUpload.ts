import type { IUploadingUI } from '../utils/dbupload'
import Cloud123UploadDisk from '../cloud123/uploaddisk'
import BaiduUploadDisk from '../cloudbaidu/uploaddisk'
import Drive115UploadDisk from '../cloud115/uploaddisk'
import DropboxUploadDisk from '../dropbox/upload'
import OneDriveUploadDisk from '../onedrive/upload'
import GuangyaUploadDisk from '../guangya/uploaddisk'
import QuarkUploadDisk from '../quark/uploaddisk'
import BoxUploadDisk from '../box/upload'
import GoogleUploadDisk from '../google/upload'
import Cloud139UploadDisk from '../cloud139/uploaddisk'
import Cloud189UploadDisk from '../cloud189/uploaddisk'
import type { DriveProvider } from '../utils/driveProvider'

/** Thin local-upload registry. Provider upload implementations stay in their own directories. */
export const uploadProviderFile = (provider: DriveProvider, file: IUploadingUI): Promise<string> | undefined => {
  switch (provider) {
    case '139': return Cloud139UploadDisk.UploadOneFile(file)
    case '189': return Cloud189UploadDisk.UploadOneFile(file)
    case 'cloud123': return Cloud123UploadDisk.UploadOneFile(file)
    case 'baidu': return BaiduUploadDisk.UploadOneFile(file)
    case '115': return Drive115UploadDisk.UploadOneFile(file)
    case 'guangya': return GuangyaUploadDisk.UploadOneFile(file)
    case 'quark': return QuarkUploadDisk.UploadOneFile(file)
    case 'dropbox': return DropboxUploadDisk.UploadOneFile(file)
    case 'onedrive': return OneDriveUploadDisk.UploadOneFile(file)
    case 'box': return BoxUploadDisk.UploadOneFile(file)
    case 'google': return GoogleUploadDisk.UploadOneFile(file)
    default: return undefined
  }
}
