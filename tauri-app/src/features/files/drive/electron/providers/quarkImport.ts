import type {IAliShareAnonymous,IAliShareFileItem} from '../aliapi/alimodels'
import type {QuarkFileItem} from './quarkMetadata'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import getFileIcon from '../aliapi/fileicon'
import {quarkImportRequest as request,quarkImportTokens,validateQuarkImportPage} from '../../quarkImportTransport'
const QUARK_SHARE_PREFIX = 'quark:'
const DRIVE = 'https://drive.quark.cn/1/clouddrive'

const isError = (data: any): data is { __error: true; code: number; message: string } => !!data?.__error

export const encodeQuarkShareId = (pwdId: string): string => `${QUARK_SHARE_PREFIX}${pwdId}`

export const decodeQuarkShareId = (shareId: string): string => shareId.startsWith(QUARK_SHARE_PREFIX) ? shareId.slice(QUARK_SHARE_PREFIX.length) : shareId

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

export const apiQuarkShareAnonymous = async (shareId: string, passcode = '', user_id = ''): Promise<IAliShareAnonymous> => {
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
  const stoken = await apiQuarkShareToken(pwdId, passcode, user_id)
  if (stoken.startsWith('，')) {
    share.error = stoken.slice(1)
    return share
  }
  const detail = await apiQuarkShareDetail(pwdId, stoken, '0', 1, user_id)
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

const mapShareFile = (item: QuarkFileItem & { share_fid_token?: string; dir?: boolean }, shareId: string, user_id: string): IAliShareFileItem => {
  const isDir = item.dir !== undefined ? !!item.dir : Number(item.file_type || 0) === 0
  const name = item.file_name || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const size = Number(item.size || 0)
  const icon = isDir ? 'iconfile-folder' : getFileIcon('', ext, ext, item.format_type || item.obj_category || '', size)[1]
  if (item.share_fid_token) quarkImportTokens(user_id).set(`${shareId}:${item.fid}`, item.share_fid_token)
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
    validateQuarkImportPage(user_id, shareId, dirId, page, list, data.data)
    items.push(...list.map((item: any) => mapShareFile(item, encodeQuarkShareId(pwdId), user_id)))
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
  const fidTokenList = file_idList.map(fid => quarkImportTokens(user_id).get(`${encodedShareId}:${fid}`) || '')
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
