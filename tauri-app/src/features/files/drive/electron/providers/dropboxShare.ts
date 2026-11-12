import type {IAliShareItem} from '../aliapi/alimodels'
import {humanExpiration} from '../utils/format'
import {dropboxShareRpc,prepareDropboxSharedLink,validateDropboxSharedLink} from '../../shareProviderTransport'
export type DropboxSharedLinkMetadata = {
  id?: string
  name?: string
  url: string
  expires?: string
  path_lower?: string
  link_permissions?: {
    resolved_visibility?: { '.tag'?: string }
  }
}

type DropboxListSharedLinksResp = {
  links?: DropboxSharedLinkMetadata[]
  cursor?: string
  has_more?: boolean
  error_summary?: string
}

export type DropboxShareCreateResult = {
  item?: IAliShareItem
  error: string
}

export const toDropboxShareExpiration = (expiration: string): string => {
  if (!expiration) return ''
  const date = new Date(expiration)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export const buildDropboxCreateSharedLinkBody = (path: string, expiration: string, sharePwd: string) => {
  const settings: Record<string, string> = {}
  const expires = toDropboxShareExpiration(expiration)
  if (sharePwd) {
    settings.requested_visibility = 'password'
    settings.link_password = sharePwd
  }
  if (expires) settings.expires = expires
  if (Object.keys(settings).length === 0) return { path }
  return { path, settings }
}

export const normalizeDropboxSharedLinkUrl = (url: string): string => {
  return url || ''
}

export const mapDropboxSharedLinkToAliShareItem = (
  link: DropboxSharedLinkMetadata,
  drive_id: string,
  file_id_list: string[],
  share_name: string,
  share_pwd: string
): IAliShareItem => {
  const expiration = link.expires || ''
  return {
    created_at: '',
    creator: '',
    description: link.path_lower || '',
    display_name: '',
    display_label: '',
    download_count: 0,
    drive_id: drive_id || 'dropbox',
    expiration,
    expired: false,
    file_id: file_id_list[0] || '',
    file_id_list,
    icon: 'iconwenjian',
    preview_count: 0,
    save_count: 0,
    share_id: link.id || link.url,
    share_msg: humanExpiration(expiration),
    full_share_msg: '',
    share_name: share_name || link.name || 'Dropbox 分享链接',
    share_policy: link.link_permissions?.resolved_visibility?.['.tag'] || '',
    share_pwd: share_pwd || '',
    share_url: normalizeDropboxSharedLinkUrl(link.url),
    status: '',
    updated_at: '',
    is_share_saved: false,
    share_saved: ''
  }
}

export const apiDropboxListSharedLinks = async (user_id: string, path: string, check:()=>void=()=>{}): Promise<DropboxSharedLinkMetadata[]> => {
  const links: DropboxSharedLinkMetadata[] = []
  let cursor = ''
  const seen=new Set<string>()
  do {
    check()
    const body = cursor ? { cursor } : (path ? { path, direct_only: true } : {})
    const resp = await dropboxShareRpc<DropboxListSharedLinksResp>(user_id, '/sharing/list_shared_links', body, '获取 Dropbox 分享链接失败')
    check()
    if(resp.error)throw Error(resp.error)
    if(!resp.data||!Array.isArray(resp.data.links)||typeof resp.data.has_more!=='boolean')throw Error('Dropbox 分享列表响应无效')
    if(resp.data.has_more&&(!resp.data.cursor||seen.has(resp.data.cursor)||seen.size>=1000))throw Error('Dropbox 分享分页重复或无效')
    if(resp.data.cursor)seen.add(resp.data.cursor)
    links.push(...(Array.isArray(resp.data?.links) ? resp.data.links : []))
    cursor = resp.data?.has_more ? (resp.data.cursor || '') : ''
  } while (cursor)
  return links
}

export const apiDropboxShareCreate = async (
  user_id: string,
  drive_id: string,
  file_id_list: string[],
  expiration: string,
  share_pwd: string,
  share_name: string,
  check:()=>void=()=>{}
): Promise<DropboxShareCreateResult> => {
  if (file_id_list.length !== 1) return { error: 'Dropbox 分享链接一次只能选择一个文件或文件夹；批量分享会逐个创建链接' }
  check()
  const path = file_id_list[0]
  const existing = await apiDropboxListSharedLinks(user_id, path,check)
  check()
  if (existing[0]?.url) {
    validateDropboxSharedLink(existing[0],path,'','')
    return { item: mapDropboxSharedLinkToAliShareItem(await prepareDropboxSharedLink(user_id,existing[0],expiration,share_pwd,check), drive_id, file_id_list, share_name, share_pwd), error: '' }
  }

  check()
  const body = buildDropboxCreateSharedLinkBody(path, expiration, share_pwd)
  const resp = await dropboxShareRpc<DropboxSharedLinkMetadata>(user_id, '/sharing/create_shared_link_with_settings', body, '创建 Dropbox 分享链接失败')
  check()
  if (resp.data?.url) return { item: mapDropboxSharedLinkToAliShareItem(validateDropboxSharedLink(resp.data,path,expiration,share_pwd), drive_id, file_id_list, share_name, share_pwd), error: '' }
  if (resp.error) {
    const links = await apiDropboxListSharedLinks(user_id, path,check)
    if (links[0]?.url) {validateDropboxSharedLink(links[0],path,'','');return { item: mapDropboxSharedLinkToAliShareItem(await prepareDropboxSharedLink(user_id,links[0],expiration,share_pwd,check), drive_id, file_id_list, share_name, share_pwd), error: '' }}
  }
  if (resp.error.includes('settings_error/not_authorized')) {
    return { error: '当前 Dropbox 账号或团队策略不允许设置分享密码/过期时间，请清空提取码和有效期后重试' }
  }
  return { error: resp.error || '创建 Dropbox 分享链接失败' }
}
