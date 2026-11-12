import type {IAliShareItem} from '../aliapi/alimodels'
import {humanExpiration} from '../utils/format'
import {boxApiRequest} from '../../providerTransport'
export type BoxSharedLinkItem = {
  id?: string
  name?: string
  type?: string
  shared_link?: {
    url?: string
    download_url?: string
    access?: string
    password?: string
    unshared_at?: string
  } | null
}

export type BoxShareTarget = {
  type: 'file' | 'folder'
  id: string
}

export const buildBoxSharedLinkBody = (expiration = '', sharePwd = '') => ({
  shared_link: {
    access: 'open',
    permissions: { can_download: true },
    ...(sharePwd ? { password: sharePwd } : {}),
    ...(expiration ? { unshared_at: expiration } : {})
  }
})

export const buildBoxSharedLinkPath = (type: 'file' | 'folder', id: string) => `/${type === 'folder' ? 'folders' : 'files'}/${encodeURIComponent(id)}`

export const encodeBoxShareId = (type: 'file' | 'folder', id: string) => `box:${type}:${id}`

export const mapBoxSharedLinkToAliShareItem = (
  item: BoxSharedLinkItem,
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
  drive_id: drive_id || 'box',
  expiration: '',
  expired: false,
  file_id: file_id_list[0] || '',
  file_id_list,
  icon: 'iconwenjian',
  preview_count: 0,
  save_count: 0,
  share_id: item.id ? encodeBoxShareId(item.type === 'folder' ? 'folder' : 'file', item.id) : item.shared_link?.url || '',
  share_msg: humanExpiration(''),
  full_share_msg: '',
  share_name: share_name || item.name || 'Box 分享链接',
  share_policy: item.shared_link?.access || '',
  share_pwd: '',
  share_url: item.shared_link?.url || '',
  status: '',
  updated_at: '',
  is_share_saved: false,
  share_saved: ''
})

export const apiBoxShareCreate = async (
  user_id: string,
  drive_id: string,
  file_id_list: string[],
  share_name: string,
  isFolder = false,
  expiration = '',
  sharePwd = ''
): Promise<{ item?: IAliShareItem; error: string }> => {
  if (file_id_list.length !== 1) return { error: 'Box 分享链接一次只能选择一个文件或文件夹' }
  const data = await boxApiRequest<BoxSharedLinkItem>(
    user_id,
    `${buildBoxSharedLinkPath(isFolder ? 'folder' : 'file', file_id_list[0])}?fields=shared_link,id,name,type`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBoxSharedLinkBody(expiration, sharePwd))
    },
    '创建 Box 分享链接失败'
  )
  if(data?.id!==file_id_list[0]||data?.type!==(isFolder?'folder':'file'))return {error:'Box 分享结果文件标识或类型不匹配'}
  if (!data?.shared_link?.url) return { error: '创建 Box 分享链接失败' }
  return { item: mapBoxSharedLinkToAliShareItem(data, drive_id, file_id_list, share_name), error: '' }
}
