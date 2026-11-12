import type { IAliShareItem } from '../aliapi/alimodels'
import { humanExpiration } from '../utils/format'
import { apiBoxFileList, boxApiRequest } from './dirfilelist'

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

export const buildBoxSharedLinkUpdateBody = (expiration: string, sharePwd: string) => ({
  shared_link: {
    access: 'open',
    permissions: { can_download: true },
    password: sharePwd || null,
    unshared_at: expiration || null
  }
})

export const buildBoxSharedLinkPath = (type: 'file' | 'folder', id: string) => `/${type === 'folder' ? 'folders' : 'files'}/${encodeURIComponent(id)}`

export const encodeBoxShareId = (type: 'file' | 'folder', id: string) => `box:${type}:${id}`

export const decodeBoxShareId = (shareId: string): BoxShareTarget | undefined => {
  const match = /^box:(file|folder):(.+)$/.exec(shareId || '')
  return match ? { type: match[1] as BoxShareTarget['type'], id: match[2] } : undefined
}

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
  if (!data?.shared_link?.url) return { error: '创建 Box 分享链接失败' }
  return { item: mapBoxSharedLinkToAliShareItem(data, drive_id, file_id_list, share_name), error: '' }
}

export const apiBoxShareList = async (user_id: string): Promise<IAliShareItem[]> => {
  const result: IAliShareItem[] = []
  const visitedFolders = new Set<string>()

  const visit = async (parentId: string): Promise<void> => {
    const entries = await apiBoxFileList(user_id, parentId)
    for (const entry of entries) {
      if (entry.shared_link?.url) {
        result.push(mapBoxSharedLinkToAliShareItem(entry, 'box', [entry.id], entry.name))
      }
      if (entry.type === 'folder' && entry.id && !visitedFolders.has(entry.id)) {
        visitedFolders.add(entry.id)
        await visit(entry.id)
      }
    }
  }

  await visit('box_root')
  return result
}

export const apiBoxShareRemove = async (user_id: string, shareId: string): Promise<boolean> => {
  const target = decodeBoxShareId(shareId)
  if (!target) return false
  const data = await boxApiRequest<BoxSharedLinkItem>(
    user_id,
    `${buildBoxSharedLinkPath(target.type, target.id)}?fields=id,type,shared_link`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shared_link: null })
    },
    '取消 Box 分享链接失败'
  )
  return data?.shared_link == null
}

export const apiBoxShareUpdate = async (
  user_id: string,
  shareId: string,
  expiration: string,
  sharePwd: string
): Promise<BoxSharedLinkItem | null> => {
  const target = decodeBoxShareId(shareId)
  if (!target) return null
  const data = await boxApiRequest<BoxSharedLinkItem>(
    user_id,
    `${buildBoxSharedLinkPath(target.type, target.id)}?fields=id,type,name,shared_link`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBoxSharedLinkUpdateBody(expiration, sharePwd))
    },
    '修改 Box 分享链接失败'
  )
  return data?.shared_link ? data : null
}
