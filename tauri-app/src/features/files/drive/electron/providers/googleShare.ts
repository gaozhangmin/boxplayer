import type {IAliShareItem} from '../aliapi/alimodels'
import {googleDriveRequest} from '../../providerTransport'
import {apiGoogleListPermissions} from './googlePermissions'
export const buildGoogleAnyonePermissionBody = () => ({ type: 'anyone', role: 'reader' })

export const apiGoogleShareCreate = async (userId: string, driveId: string, fileIds: string[], shareName: string, expiration: string, password: string, check:()=>void=()=>{}): Promise<{ item?: IAliShareItem; error: string }> => {
  if (password || expiration) return { error: 'Google Drive 分享暂不支持提取码或有效期，请清空后重试' }
  if (fileIds.length !== 1) return { error: 'Google Drive 当前仅支持单个文件或文件夹创建链接' }
  const fileId = fileIds[0]
  const existing = (await apiGoogleListPermissions(userId, fileId,check)).find((permission) => permission.type === 'anyone')
  check()
  const permission = existing || await googleDriveRequest<any>(userId, `/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildGoogleAnyonePermissionBody()) }, '创建 Google Drive 分享权限失败')
  check()
  if (!permission?.id) return { error: '创建 Google Drive 分享权限失败' }
  const file = await googleDriveRequest<any>(userId, `/files/${encodeURIComponent(fileId)}?fields=id,name,webViewLink&supportsAllDrives=true`, { method: 'GET' }, '获取 Google Drive 分享链接失败')
  check()
  if (!file?.webViewLink) return { error: 'Google Drive 未返回分享链接' }
  return { error: '', item: { created_at: '', creator: '', description: '', display_name: '', display_label: '', download_count: 0, drive_id: driveId || 'google', expiration: '', expired: false, file_id: fileId, file_id_list: fileIds, icon: 'iconwenjian', preview_count: 0, save_count: 0, share_id: permission.id || fileId, share_msg: '', full_share_msg: '', share_name: shareName || file.name || 'Google Drive 分享链接', share_policy: 'anyone_reader', share_pwd: '', share_url: file.webViewLink, status: '', updated_at: '', is_share_saved: false, share_saved: '' } }
}
