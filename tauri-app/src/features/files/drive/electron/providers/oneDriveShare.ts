import type {IAliShareItem} from '../aliapi/alimodels'
import {humanExpiration} from '../utils/format'
import {graphPost} from '../../shareProviderTransport'
export type OneDrivePermission = {
  id?: string
  link?: {
    type?: string
    scope?: string
    webUrl?: string
  }
}

export const buildOneDriveCreateLinkBody = () => ({
  type: 'view',
  scope: 'anonymous'
})

export const mapOneDrivePermissionToAliShareItem = (
  permission: OneDrivePermission,
  drive_id: string,
  file_id_list: string[],
  share_name: string
): IAliShareItem => ({
  created_at: '',
  creator: '',
  description: '',
  display_name: '',
  display_label: '',
  download_count: 0,
  drive_id: drive_id || 'onedrive',
  expiration: '',
  expired: false,
  file_id: file_id_list[0] || '',
  file_id_list,
  icon: 'iconwenjian',
  preview_count: 0,
  save_count: 0,
  share_id: permission.id || permission.link?.webUrl || '',
  share_msg: humanExpiration(''),
  full_share_msg: '',
  share_name: share_name || 'OneDrive 分享链接',
  share_policy: permission.link?.scope || '',
  share_pwd: '',
  share_url: permission.link?.webUrl || '',
  status: '',
  updated_at: '',
  is_share_saved: false,
  share_saved: ''
})

export const apiOneDriveShareCreate = async (
  user_id: string,
  drive_id: string,
  file_id_list: string[],
  share_name: string
): Promise<{ item?: IAliShareItem; error: string }> => {
  if (file_id_list.length !== 1) return { error: 'OneDrive 分享链接一次只能选择一个文件或文件夹' }
  const resp = await graphPost<OneDrivePermission>(
    user_id,
    `/me/drive/items/${encodeURIComponent(file_id_list[0])}/createLink`,
    buildOneDriveCreateLinkBody(),
    '创建 OneDrive 分享链接失败'
  )
  if (resp.error || !resp.data?.link?.webUrl) return { error: resp.error || '创建 OneDrive 分享链接失败' }
  return { item: mapOneDrivePermissionToAliShareItem(resp.data, drive_id, file_id_list, share_name), error: '' }
}
