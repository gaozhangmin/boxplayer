import type { IAliShareAnonymous, IAliShareFileItem, IAliShareItem } from '../aliapi/alimodels'
import type { UpdateShareModel } from '../aliapi/share'
import { humanDateTime, humanDateTimeDateStr, humanExpiration, humanSize } from '../utils/format'
import getFileIcon from '../aliapi/fileicon'
import message from '../utils/message'
import { quarkAuthHeaders } from './auth'
import { getQuarkToken, type QuarkFileItem } from './dirfilelist'

const DRIVE_PC = 'https://drive-pc.quark.cn/1/clouddrive'
const DRIVE = 'https://drive.quark.cn/1/clouddrive'
const QUARK_SHARE_PREFIX = 'quark:'
const shareTokenMap = new Map<string, string>()

type QuarkShareResp<T = any> = T | { __error: true; code: number; message: string }

const quarkParams = (params: Record<string, string | number | undefined> = {}) => {
  const qs = new URLSearchParams({
    pr: 'ucpro',
    fr: 'pc',
    uc_param_str: '',
    __t: String(Date.now()),
    __dt: '1000'
  })
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value))
  }
  return qs
}

const request = async <T = any>(
  user_id: string,
  path: string,
  init: RequestInit = {},
  params: Record<string, string | number | undefined> = {},
  base = DRIVE_PC
): Promise<QuarkShareResp<T>> => {
  const token = await getQuarkToken(user_id)
  if (!token?.access_token) return { __error: true, code: 401, message: '未登录夸克网盘' }
  const resp = await fetch(`${base}/${path.replace(/^\//, '')}?${quarkParams(params).toString()}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...quarkAuthHeaders(token.access_token),
      ...(init.headers || {})
    }
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.status === 'error' || (data?.code !== undefined && data.code !== 0 && data.code !== 200)) {
    return {
      __error: true,
      code: Number(data?.code || data?.status || resp.status || 0),
      message: data?.message || '夸克分享请求失败'
    }
  }
  return data as T
}

const isError = (data: any): data is { __error: true; code: number; message: string } => !!data?.__error

export const isQuarkShareId = (shareId: string): boolean => shareId.startsWith(QUARK_SHARE_PREFIX)

export const encodeQuarkShareId = (pwdId: string): string => `${QUARK_SHARE_PREFIX}${pwdId}`

export const decodeQuarkShareId = (shareId: string): string => shareId.startsWith(QUARK_SHARE_PREFIX) ? shareId.slice(QUARK_SHARE_PREFIX.length) : shareId

export const parseQuarkShareLink = (text: string): { id: string; pwd: string } => {
  const match = text.match(/(?:https?:\/\/)?pan\.quark\.cn\/s\/([0-9a-zA-Z]+)/i) || text.match(/quark:\/\/share\/([0-9a-zA-Z]+)/i)
  const id = match?.[1] || ''
  const pwd =
    text.match(/[?&#]pwd=([0-9a-zA-Z]+)/i)?.[1] ||
    text.match(/(?:提取码|密码|password|pwd)[^0-9a-zA-Z]{0,8}([0-9a-zA-Z]{4,8})/i)?.[1] ||
    ''
  return { id: id ? encodeQuarkShareId(id) : '', pwd }
}

const toExpireDays = (expiration: string): number => {
  if (!expiration) return 0
  const expireAt = new Date(expiration).getTime()
  if (!Number.isFinite(expireAt)) return 0
  return Math.max(1, Math.ceil((expireAt - Date.now()) / (24 * 60 * 60 * 1000)))
}

const buildShareItem = (raw: any, shareName = ''): IAliShareItem => {
  const shareUrl = raw.share_url || raw.url || ''
  const pwdId = raw.pwd_id || shareUrl.match(/\/s\/([0-9a-zA-Z]+)/)?.[1] || raw.share_id || ''
  const createTime = Number(raw.create_time || raw.created_at || 0)
  const expireTime = Number(raw.expire_time || raw.expired_at || 0)
  const expiration = expireTime > 0 ? new Date(expireTime * (expireTime > 100000000000 ? 1 : 1000)).toISOString() : ''
  const created = createTime > 0 ? humanDateTime(createTime * (createTime > 100000000000 ? 1 : 1000)) : ''
  return {
    created_at: created,
    creator: '',
    description: '',
    display_name: '',
    display_label: '',
    download_count: Number(raw.download_count || raw.download_num || 0),
    drive_id: 'quark',
    expiration,
    expired: false,
    file_id: '',
    file_id_list: Array.isArray(raw.fid_list) ? raw.fid_list : [],
    icon: 'iconwenjian',
    preview_count: Number(raw.visit_count || raw.browse_count || raw.preview_count || 0),
    save_count: Number(raw.save_count || 0),
    share_id: encodeQuarkShareId(String(pwdId || raw.share_id || '')),
    share_msg: humanExpiration(expiration),
    full_share_msg: '',
    share_name: raw.title || raw.share_name || shareName || '夸克分享',
    share_policy: '',
    share_pwd: raw.share_pwd || raw.passcode || raw.password || '',
    share_url: shareUrl || (pwdId ? `https://pan.quark.cn/s/${pwdId}` : ''),
    status: raw.status || '',
    updated_at: '',
    is_share_saved: false,
    share_saved: ''
  }
}

export const apiQuarkShareCreate = async (
  user_id: string,
  expiration: string,
  share_pwd: string,
  share_name: string,
  file_id_list: string[]
): Promise<string | IAliShareItem> => {
  const expireDays = toExpireDays(expiration)
  const body: any = {
    fid_list: file_id_list,
    title: share_name || '夸克分享',
    url_type: share_pwd ? 2 : 1,
    expired_type: expireDays > 0 ? 2 : 1
  }
  if (expireDays > 0) body.expired_at = Date.now() + expireDays * 24 * 60 * 60 * 1000
  if (share_pwd) {
    body.passcode = share_pwd
  }
  const created = await request(user_id, 'share', { method: 'POST', body: JSON.stringify(body) })
  if (isError(created)) return created.message || '创建夸克分享链接失败'
  const taskId = (created as any)?.data?.task_id || ''
  let shareId = (created as any)?.data?.task_resp?.data?.share_id || (created as any)?.data?.share_id || ''
  if (!shareId && taskId) {
    const task = await pollQuarkTask(user_id, taskId)
    if (typeof task === 'string') return task
    shareId = task?.share_id || ''
  }
  if (!shareId) return '创建夸克分享链接失败'
  const info = await apiQuarkSharePassword(user_id, shareId)
  if (info.error) return info.error
  return buildShareItem({ ...info.data, share_id: shareId }, share_name)
}

export const apiQuarkSharePassword = async (user_id: string, shareId: string): Promise<{ data: any; error: string }> => {
  const data = await request(user_id, 'share/password', {
    method: 'POST',
    body: JSON.stringify({ share_id: decodeQuarkShareId(shareId) })
  })
  if (isError(data)) return { data: undefined, error: data.message || '获取夸克分享链接失败' }
  return { data: (data as any)?.data || {}, error: '' }
}

const getQuarkTaskError = (task: any): string => {
  const code = Number(task?.code || 0)
  const status = Number(task?.status || 0)
  if ((code === 0 || code === 200) && status < 400 && status !== 3) return ''
  const missingCapacity = Number(task?.metadata?.missing_capacity || task?.data?.metadata?.missing_capacity || 0)
  if (code === 32003 || /capacity limit/i.test(String(task?.message || ''))) {
    return missingCapacity > 0 ? `夸克网盘容量不足，还需 ${humanSize(missingCapacity)}` : '夸克网盘容量不足'
  }
  return task?.message || '夸克分享转存失败'
}

export const pollQuarkTask = async (user_id: string, taskId: string, retry = 40): Promise<any | string> => {
  for (let i = 0; i < retry; i++) {
    const data = await request(user_id, 'task', {}, { task_id: taskId, retry_index: i })
    if (isError(data)) return data.message || '夸克任务失败'
    const task = (data as any)?.data || {}
    const taskError = getQuarkTaskError(task)
    if (taskError) return taskError
    if (task.status === 2 || task.share_id) return task
    await new Promise(resolve => setTimeout(resolve, 600))
  }
  return '夸克任务超时'
}

export const apiQuarkShareList = async (user_id: string): Promise<IAliShareItem[]> => {
  const data = await request(user_id, 'share/mypage/detail', {}, {
    _page: 1,
    _size: 100,
    _order_field: 'created_at',
    _order_type: 'desc',
    _fetch_total: 1,
    _fetch_notify_follow: 1
  })
  if (isError(data)) {
    message.error(data.message || '获取夸克分享列表失败')
    return []
  }
  const list = (data as any)?.data?.list || (data as any)?.data || []
  return Array.isArray(list) ? list.map((item: any) => buildShareItem(item)) : []
}

export const apiQuarkShareCancelBatch = async (user_id: string, shareIds: string[]): Promise<string[]> => {
  const success: string[] = []
  for (const shareId of shareIds) {
    const id = decodeQuarkShareId(shareId)
    const data = await request(user_id, 'share/cancel', { method: 'POST', body: JSON.stringify({ share_id: id }) })
    if (!isError(data)) success.push(shareId)
  }
  return success
}

export const apiQuarkShareUpdateBatch = async (
  user_id: string,
  share_idList: string[],
  expirationList: string[],
  share_pwdList: string[],
  share_nameList: string[] | undefined
): Promise<UpdateShareModel[]> => {
  const success: UpdateShareModel[] = []
  for (let i = 0; i < share_idList.length; i++) {
    const expireDays = toExpireDays(expirationList[i])
    const body: any = {
      share_id: decodeQuarkShareId(share_idList[i]),
      title: share_nameList ? share_nameList[i] : undefined,
      url_type: share_pwdList[i] ? 2 : 1,
      expired_type: expireDays > 0 ? 2 : 1
    }
    if (expireDays > 0) body.expired_at = Date.now() + expireDays * 24 * 60 * 60 * 1000
    if (share_pwdList[i]) body.passcode = share_pwdList[i]
    const data = await request(user_id, 'share/update', { method: 'POST', body: JSON.stringify(body) })
    if (!isError(data)) {
      success.push({
        share_id: share_idList[i],
        share_pwd: share_pwdList[i] || '',
        expiration: expirationList[i] || '',
        share_name: share_nameList ? share_nameList[i] : ''
      })
    }
  }
  return success
}

export const apiQuarkShareAnonymous = async (shareId: string, passcode = ''): Promise<IAliShareAnonymous> => {
  const pwdId = decodeQuarkShareId(shareId)
  const share: IAliShareAnonymous = {
    shareinfo: {
      share_id: encodeQuarkShareId(pwdId),
      creator_id: '',
      creator_name: '',
      creator_phone: '',
      display_name: pwdId,
      expiration: '',
      file_count: 0,
      share_name: pwdId,
      created_at: '',
      updated_at: '',
      vip: '',
      is_photo_collection: false,
      album_id: ''
    },
    shareinfojson: '',
    error: '解析夸克分享链接失败'
  }
  const stoken = await apiQuarkShareToken(pwdId, passcode)
  if (stoken.startsWith('，')) {
    share.error = stoken.slice(1)
    return share
  }
  const detail = await apiQuarkShareDetail(pwdId, stoken, '0')
  if (detail.error) {
    share.error = detail.error
    return share
  }
  const data = detail.data
  const meta = data?.share || data?.share_info || data || {}
  const list = data?.list || []
  share.shareinfo.display_name = meta.title || meta.share_name || meta.name || pwdId
  share.shareinfo.share_name = share.shareinfo.display_name
  share.shareinfo.file_count = Number(meta.file_num || meta.file_count || list.length || 0)
  if (meta.expire_time) share.shareinfo.expiration = new Date(Number(meta.expire_time) * 1000).toISOString()
  share.shareinfojson = JSON.stringify(data)
  share.error = ''
  return share
}

export const apiQuarkShareToken = async (pwdId: string, passcode = '', user_id = ''): Promise<string> => {
  pwdId = decodeQuarkShareId(pwdId)
  const data = await request<any>(user_id, 'share/sharepage/token', {
    method: 'POST',
    headers: { referer: `https://pan.quark.cn/s/${pwdId}` },
    body: JSON.stringify({ pwd_id: pwdId, passcode, support_visit_limit_private_share: true })
  }, {}, DRIVE)
  if (isError(data)) return `，${data.message || '获取夸克分享 token 失败'}`
  return data?.data?.stoken || '，获取夸克分享 token 失败'
}

export const apiQuarkShareDetail = async (pwdId: string, stoken: string, pdirFid = '0', page = 1, user_id = ''): Promise<{ data: any; error: string }> => {
  pwdId = decodeQuarkShareId(pwdId)
  const data = await request<any>(user_id, 'share/sharepage/detail', {}, {
    pwd_id: pwdId,
    stoken,
    pdir_fid: pdirFid,
    force: '0',
    _page: page,
    _size: 100,
    _fetch_share: 1,
    _fetch_total: 1,
    _sort: 'file_type:asc,file_name:asc'
  }, DRIVE)
  if (isError(data)) return { data: undefined, error: data.message || '获取夸克分享详情失败' }
  return { data: data?.data || {}, error: '' }
}

const mapShareFile = (item: QuarkFileItem & { share_fid_token?: string; dir?: boolean }, shareId: string): IAliShareFileItem => {
  const isDir = item.dir !== undefined ? !!item.dir : Number(item.file_type || 0) === 0
  const name = item.file_name || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const size = Number(item.size || 0)
  const icon = isDir ? 'iconfile-folder' : getFileIcon('', ext, ext, item.format_type || item.obj_category || '', size)[1]
  if (item.share_fid_token) shareTokenMap.set(`${shareId}:${item.fid}`, item.share_fid_token)
  return {
    drive_id: 'quark',
    file_id: String(item.fid || ''),
    name,
    type: isDir ? 'folder' : 'file',
    created_at: String(item.created_at || ''),
    updated_at: String(item.updated_at || ''),
    parent_file_id: item.pdir_fid || '0',
    file_extension: ext,
    mime_extension: ext,
    mime_type: item.format_type || '',
    size,
    category: '',
    punish_flag: 0,
    isDir,
    sizeStr: isDir ? '' : humanSize(size),
    timeStr: item.updated_at || item.created_at ? humanDateTimeDateStr(new Date(Number(item.updated_at || item.created_at) * 1000).toISOString()) : '',
    icon
  }
}

export const apiQuarkShareFileList = async (shareId: string, stoken: string, dirId: string, user_id = ''): Promise<{ items: IAliShareFileItem[]; next_marker: string; error: string }> => {
  const pwdId = decodeQuarkShareId(shareId)
  const items: IAliShareFileItem[] = []
  let page = 1
  let hasMore = false
  do {
    const data = await apiQuarkShareDetail(pwdId, stoken, dirId === 'root' ? '0' : dirId, page, user_id)
    if (data.error) return { items: [], next_marker: '', error: data.error }
    const list = Array.isArray(data.data?.list) ? data.data.list : []
    items.push(...list.map((item: any) => mapShareFile(item, encodeQuarkShareId(pwdId))))
    const total = Number(data.data?.metadata?._total || data.data?.total || data.data?.count || 0)
    hasMore = total ? items.length < total : list.length === 100
    page += 1
  } while (hasMore)
  return { items, next_marker: hasMore ? String(page) : '', error: '' }
}

export const apiQuarkSaveShareFilesBatch = async (
  shareId: string,
  stoken: string,
  user_id: string,
  parent_file_id: string,
  file_idList: string[]
): Promise<string> => {
  if (!file_idList.length) return 'success'
  const pwdId = decodeQuarkShareId(shareId)
  const encodedShareId = encodeQuarkShareId(pwdId)
  const fidTokenList = file_idList.map(fid => shareTokenMap.get(`${encodedShareId}:${fid}`) || '')
  if (fidTokenList.some(token => !token)) return '缺少夸克分享文件 token，请重新打开分享链接后再转存'
  const data = await request(user_id, 'share/sharepage/save', {
    method: 'POST',
    body: JSON.stringify({
      fid_list: file_idList,
      fid_token_list: fidTokenList,
      to_pdir_fid: parent_file_id === 'quark_root' ? '0' : parent_file_id,
      pwd_id: pwdId,
      stoken,
      pdir_fid: '0',
      pdir_save_all: false,
      exclude_fids: [],
      scene: 'link'
    })
  }, {}, DRIVE)
  if (isError(data)) return data.message || '夸克分享转存失败'
  const taskId = (data as any)?.data?.task_id || ''
  const taskError = getQuarkTaskError((data as any)?.data?.task_resp)
  if (taskError) return taskError
  if (!taskId || (data as any)?.data?.task_sync) return 'success'
  const task = await pollQuarkTask(user_id, taskId)
  return typeof task === 'string' ? task : 'success'
}
