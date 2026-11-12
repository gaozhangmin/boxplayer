import type {IAliShareItem} from '../aliapi/alimodels'
import {humanDateTime,humanExpiration,humanSize} from '../utils/format'
import {quarkShareFetch} from '../../shareProviderTransport'
const DRIVE_PC = 'https://drive-pc.quark.cn/1/clouddrive'

const QUARK_SHARE_PREFIX = 'quark:'

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
  const resp = await quarkShareFetch(user_id,`${base}/${path.replace(/^\//, '')}?${quarkParams(params).toString()}`, {
    ...init,
    headers: {
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

export const encodeQuarkShareId = (pwdId: string): string => `${QUARK_SHARE_PREFIX}${pwdId}`

export const decodeQuarkShareId = (shareId: string): string => shareId.startsWith(QUARK_SHARE_PREFIX) ? shareId.slice(QUARK_SHARE_PREFIX.length) : shareId

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
  file_id_list: string[],
  check:()=>void=()=>{}
): Promise<string | IAliShareItem> => {
  check()
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
  check()
  if (isError(created)) return created.message || '创建夸克分享链接失败'
  const taskId = (created as any)?.data?.task_id || ''
  let shareId = (created as any)?.data?.task_resp?.data?.share_id || (created as any)?.data?.share_id || ''
  if (taskId) {
    const task = await pollQuarkTask(user_id, taskId,40,check)
    if (typeof task === 'string') return task
    shareId = task?.share_id || shareId
  }
  check()
  if (!shareId) return '创建夸克分享链接失败'
  const info = await apiQuarkSharePassword(user_id, shareId,check)
  check()
  if (info.error) return info.error
  if(!info.data||!(info.data.pwd_id||info.data.share_url||info.data.url))return '夸克未返回公开分享链接或标识'
  if(info.data.share_id&&info.data.share_id!==shareId)return '夸克分享结果标识不匹配'
  return buildShareItem({ ...info.data, share_id: shareId,fid_list:file_id_list }, share_name)
}

export const apiQuarkSharePassword = async (user_id: string, shareId: string,check:()=>void=()=>{}): Promise<{ data: any; error: string }> => {
  check()
  const data = await request(user_id, 'share/password', {
    method: 'POST',
    body: JSON.stringify({ share_id: decodeQuarkShareId(shareId) })
  })
  check()
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

export const pollQuarkTask = async (user_id: string, taskId: string, retry = 40,check:()=>void=()=>{}): Promise<any | string> => {
  for (let i = 0; i < retry; i++) {
    check()
    const data = await request(user_id, 'task', {}, { task_id: taskId, retry_index: i })
    check()
    if (isError(data)) return data.message || '夸克任务失败'
    const task = (data as any)?.data || {}
    const taskError = getQuarkTaskError(task)
    if (taskError) return taskError
    if (task.status === 2) return task
    await new Promise(resolve => setTimeout(resolve, 600))
  }
  return '夸克任务超时'
}

export const parseQuarkShareLink = (text: string): { id: string; pwd: string } => {
  const match = text.match(/(?:https?:\/\/)?pan\.quark\.cn\/s\/([0-9a-zA-Z]+)/i) || text.match(/quark:\/\/share\/([0-9a-zA-Z]+)/i)
  const id = match?.[1] || ''
  const pwd =
    text.match(/[?&#]pwd=([0-9a-zA-Z]+)/i)?.[1] ||
    text.match(/(?:提取码|密码|password|pwd)[^0-9a-zA-Z]{0,8}([0-9a-zA-Z]{4,8})/i)?.[1] ||
    ''
  return { id: id ? encodeQuarkShareId(id) : '', pwd }
}
