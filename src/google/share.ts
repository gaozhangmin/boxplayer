import type { IAliShareItem } from '../aliapi/alimodels'
import { googleDriveRequest } from './dirfilelist'
import { GOOGLE_DRIVE_READ_ONLY_MESSAGE } from './accessPolicy'


type GooglePermission = { id?: string; type?: string; role?: string; allowFileDiscovery?: boolean }
type GooglePermissionsResponse = { permissions?: GooglePermission[] }
const permissionPath = (fileId: string) => `/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&fields=permissions(id,type,role,allowFileDiscovery)`

export const apiGoogleListPermissions = async (userId: string, fileId: string) => (await googleDriveRequest<GooglePermissionsResponse>(userId, permissionPath(fileId), { method: 'GET' }, '获取 Google Drive 分享权限失败'))?.permissions || []
export const apiGoogleShareCreate = async (_userId: string, _driveId: string, _fileIds: string[], _shareName: string, _expiration: string, _password: string): Promise<{ item?: IAliShareItem; error: string }> =>
  ({ error: GOOGLE_DRIVE_READ_ONLY_MESSAGE })
