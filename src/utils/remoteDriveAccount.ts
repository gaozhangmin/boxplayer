import type { MediaLibraryFolder } from '../types/media'
import type { ITokenInfo } from '../user/userstore'
import type { WebDavConnectionConfig } from './webdavClient'

export interface RemoteDriveAccount {
  token: ITokenInfo
  folder: MediaLibraryFolder
}

export const createRemoteDriveAccount = (connection: WebDavConnectionConfig): RemoteDriveAccount => {
  const kind = connection.kind && ['alist', 'smb', 'nfs', 'ftp'].includes(connection.kind) ? connection.kind : 'webdav'
  const userId = `${kind}_${connection.id}`
  const driveId = `webdav:${connection.id}`

  return {
    token: {
      tokenfrom: kind,
      access_token: connection.id,
      refresh_token: '',
      session_expires_in: 0,
      open_api_token_type: '',
      open_api_access_token: '',
      open_api_refresh_token: '',
      open_api_expires_in: 0,
      signature: '',
      device_id: '',
      expires_in: 0,
      token_type: 'Basic',
      user_id: userId,
      user_name: connection.name,
      avatar: '',
      nick_name: connection.name,
      default_drive_id: driveId,
      default_sbox_drive_id: '',
      resource_drive_id: '',
      backup_drive_id: '',
      sbox_drive_id: '',
      role: '',
      status: '',
      expire_time: '',
      state: '',
      pin_setup: false,
      is_first_login: false,
      need_rp_verify: false,
      name: connection.name,
      spu_id: '',
      is_expires: false,
      used_size: 0,
      total_size: 0,
      free_size: 0,
      space_expire: false,
      spaceinfo: '',
      vipname: '',
      vipIcon: '',
      vipexpire: '',
      pic_drive_id: '',
      signInfo: { signMon: -1, signDay: -1 }
    },
    folder: {
      id: `webdav_${driveId}_/`,
      fileId: '/',
      name: connection.name,
      path: '/',
      userId: connection.id,
      driveId,
      driveServerId: 'webdav',
      scanDate: new Date(connection.createdAt),
      itemCount: 0
    }
  }
}
