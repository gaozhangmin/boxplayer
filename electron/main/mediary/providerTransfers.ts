// Share import and offline download for the drives whose mediary executor BoxPlayer hosts.
// Ported from the retired MediaProviderAdapter; links and tokens never leave the main process.
import type { CliToken } from './cliDrive'

export interface OfflineTask { taskId?: string; fileId?: string }
export interface OfflineTaskStatus { completed: boolean; failed: boolean; message?: string }

const PIKPAK_API_HOST = 'https://api-drive.mypikpak.com'
const PIKPAK_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export async function importAliyunShare(token: CliToken, driveId: string, url: string, password: string, directoryId: string): Promise<void> {
  const id = shareId(url, /(?:aliyundrive|alipan)\.com\/s\/([A-Za-z0-9_-]+)/i)
  const tokenReply = await requestJson('https://api.aliyundrive.com/v2/share_link/get_share_token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ share_id: id, share_pwd: sharePassword(url, password) }) }, '获取阿里云盘分享凭证失败')
  const shareToken = String(tokenReply?.share_token || '')
  if (!shareToken) throw new Error(`分享不存在或已失效：${tokenReply?.message || tokenReply?.code || '无法获取分享凭证'}`)
  const files = await listAliyunShareFiles(id, shareToken)
  if (!files.length) throw new Error('分享为空或已失效')
  for (const fileIds of chunks(files.map(item => String(item.file_id || '')).filter(Boolean), 100)) {
    const requests = fileIds.map(fileId => ({ body: { share_id: id, file_id_list: [''], file_id: fileId, to_drive_id: driveId, to_parent_file_id: directoryId, auto_rename: true }, headers: { 'Content-Type': 'application/json' }, id: fileId, method: 'POST', url: '/file/copy' }))
    const reply = await requestJson('https://api.aliyundrive.com/adrive/v4/batch', { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', 'x-share-token': shareToken }, body: JSON.stringify({ requests, resource: 'file' }) }, '阿里云盘分享转存失败')
    const failure = (Array.isArray(reply?.responses) ? reply.responses : []).find((item: any) => Number(item?.status) >= 400 || item?.body?.code)
    if (failure) throw new Error(failure?.body?.message || failure?.body?.code || '阿里云盘分享转存失败')
  }
}

async function listAliyunShareFiles(id: string, shareToken: string): Promise<any[]> {
  const items: any[] = []
  let marker = ''
  do {
    const url = 'https://api.aliyundrive.com/adrive/v3/file/list?jsonmask=next_marker%2Citems(category%2Ccreated_at%2Cdrive_id%2Cfile_extension%2Cfile_id%2Chidden%2Cmime_extension%2Cmime_type%2Cname%2Cparent_file_id%2Cpunish_flag%2Csize%2Cstarred%2Ctype%2Cupdated_at%2Cdescription)'
    const page = await requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-share-token': shareToken }, body: JSON.stringify({ share_id: id, parent_file_id: 'root', limit: 100, url_expire_sec: 14400, fields: 'thumbnail', order_by: 'name', order_direction: 'DESC', ...(marker ? { marker } : {}) }) }, '获取阿里云盘分享文件失败')
    items.push(...(Array.isArray(page?.items) ? page.items : []))
    marker = String(page?.next_marker || '')
  } while (marker)
  return items
}

export async function importPikPakShare(token: CliToken, url: string, password: string, directoryId: string): Promise<void> {
  const id = shareId(url, /(?:mypikpak|pikpak)\.com\/s\/([A-Za-z0-9_-]+)/i)
  const passCode = password || url.match(/[?&#]pass_code=([A-Za-z0-9]+)/i)?.[1] || ''
  const query = new URLSearchParams({ limit: '100', thumbnail_size: 'SIZE_LARGE', order: '3', share_id: id, parent_id: '', pass_code: passCode })
  const initial = await requestJson(`${PIKPAK_API_HOST}/drive/v1/share?${query}`, { headers: pikpakHeaders() }, '获取 PikPak 分享凭证失败')
  const shareToken = String(initial?.pass_code_token || initial?.passcode_token || '')
  if (!shareToken) throw new Error(`分享不存在或已失效：${initial?.error_description || '无法获取分享凭证'}`)
  const files = await listPikPakShareFiles(id, shareToken)
  if (!files.length) throw new Error('分享为空或已失效')
  for (const fileIds of chunks(files.map((item: any) => String(item?.id || '')).filter(Boolean), 100)) {
    await requestJson(`${PIKPAK_API_HOST}/drive/v1/share/restore`, { method: 'POST', headers: pikpakHeaders(token), body: JSON.stringify({ share_id: id, pass_code_token: shareToken, file_ids: fileIds, ...(directoryId ? { parent_id: directoryId } : {}) }) }, '保存 PikPak 分享失败')
  }
}

async function listPikPakShareFiles(id: string, shareToken: string): Promise<any[]> {
  const files: any[] = []
  const seen = new Set<string>()
  let pageToken = ''
  do {
    const query = new URLSearchParams({ limit: '100', thumbnail_size: 'SIZE_LARGE', order: '6', share_id: id, parent_id: '', pass_code_token: shareToken, page_token: pageToken })
    const page = await requestJson(`${PIKPAK_API_HOST}/drive/v1/share/detail?${query}`, { headers: pikpakHeaders() }, '获取 PikPak 分享文件失败')
    const values = page?.files || page?.file_list || []
    if (Array.isArray(values)) files.push(...values)
    const next = String(page?.next_page_token || page?.nextPageToken || '')
    if (next && seen.has(next)) throw new Error('PikPak 分享列表分页游标重复')
    if (next) seen.add(next)
    pageToken = next
  } while (pageToken)
  return files
}

export async function create115OfflineTask(token: CliToken, url: string, directoryId: string): Promise<OfflineTask> {
  const body = new URLSearchParams({ urls: url, wp_path_id: directoryId })
  const data = await requestJson('https://proapi.115.com/open/offline/add_task_urls', { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body }, '115 云下载请求失败')
  if (data?.code !== 0 || data?.state === false) throw new Error(data?.message || '115 云下载请求失败')
  const taskId = (Array.isArray(data?.data) ? data.data : []).filter((item: any) => item?.state !== false && item?.code === 0).map((item: any) => String(item?.info_hash || '')).find(Boolean)
  if (!taskId) throw new Error(data?.data?.[0]?.message || data?.message || '115 云下载任务未创建')
  return { taskId }
}

export async function get115OfflineTaskStatus(token: CliToken, task: OfflineTask): Promise<OfflineTaskStatus> {
  const tasks: any[] = []
  let page = 1
  let pageCount = 1
  do {
    const data = await requestJson(`https://proapi.115.com/open/offline/get_task_list?page=${page}`, { headers: { Authorization: `Bearer ${token.access_token}` } }, '获取 115 云下载进度失败')
    if (data?.code !== 0 || data?.state === false) throw new Error(data?.message || '获取 115 云下载进度失败')
    tasks.push(...(Array.isArray(data?.data?.tasks) ? data.data.tasks : []))
    pageCount = Math.max(1, Number(data?.data?.page_count) || 1)
    page += 1
  } while (page <= pageCount)
  const found = tasks.find(item => String(item?.info_hash || '') === String(task.taskId))
  if (!found) return { completed: false, failed: true, message: '115 云下载任务不存在' }
  const status = Number(found?.status) || 0
  return { completed: status === 2 || clampProgress(found?.percentDone) >= 100, failed: status < 0, message: String(found?.name || '') }
}

export async function create123OfflineTask(token: CliToken, url: string, title: string, directoryId: string): Promise<OfflineTask> {
  const body: Record<string, unknown> = { url, fileName: title }
  if (directoryId && Number.isFinite(Number(directoryId)) && directoryId !== '0') body.dirID = Number(directoryId)
  const data = await requestJson('https://open-api.123pan.com/api/v1/offline/download', { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', Platform: 'open_platform' }, body: JSON.stringify(body) }, '创建 123 云盘离线下载任务失败')
  if (data?.code !== 0) throw new Error(data?.message || '创建 123 云盘离线下载任务失败')
  const taskId = String(data?.data?.taskID || data?.data?.taskId || '')
  if (!taskId) throw new Error('123 云盘未返回有效任务 ID')
  return { taskId }
}

export async function get123OfflineTaskStatus(token: CliToken, task: OfflineTask): Promise<OfflineTaskStatus> {
  const data = await requestJson(`https://open-api.123pan.com/api/v1/offline/download/process?taskID=${encodeURIComponent(String(task.taskId))}`, { headers: { Authorization: `Bearer ${token.access_token}`, Platform: 'open_platform' } }, '获取 123 云盘离线下载进度失败')
  if (data?.code !== 0) throw new Error(data?.message || '获取 123 云盘离线下载进度失败')
  const status = Number(data?.data?.status) || 0
  return { completed: status === 2 || clampProgress(data?.data?.process) >= 100, failed: status < 0 }
}

export async function createPikPakOfflineTask(token: CliToken, url: string, title: string, directoryId: string): Promise<OfflineTask> {
  const body: Record<string, unknown> = { kind: 'drive#file', name: title || undefined, upload_type: 'UPLOAD_TYPE_URL', url: { url }, ...(directoryId ? { parent_id: directoryId, folder_type: '' } : { folder_type: 'DOWNLOAD' }) }
  const data = await requestJson(`${PIKPAK_API_HOST}/drive/v1/files`, { method: 'POST', headers: pikpakHeaders(token), body: JSON.stringify(body) }, '创建 PikPak 离线下载任务失败')
  if (data?.error) throw new Error(data?.error_description || data?.message || data.error)
  const taskId = String(data?.task?.id || data?.task_id || data?.upload_task_id || '')
  const fileId = String(data?.file?.id || data?.file_id || data?.id || '')
  if (!taskId && !fileId) throw new Error('创建 PikPak 离线下载任务失败')
  return { taskId: taskId || undefined, fileId: fileId || undefined }
}

export async function getPikPakOfflineTaskStatus(token: CliToken, task: OfflineTask): Promise<OfflineTaskStatus> {
  if (!task.taskId) return { completed: true, failed: false }
  const params = new URLSearchParams({ type: 'offline', thumbnail_size: 'SIZE_SMALL', limit: '100', filters: JSON.stringify({ phase: { in: 'PHASE_TYPE_PENDING,PHASE_TYPE_RUNNING,PHASE_TYPE_COMPLETE,PHASE_TYPE_ERROR' } }) })
  const data = await requestJson(`${PIKPAK_API_HOST}/drive/v1/tasks?${params}`, { headers: pikpakHeaders(token) }, '获取 PikPak 离线下载进度失败')
  const found = (Array.isArray(data?.tasks) ? data.tasks : []).find((item: any) => String(item?.id || item?.task_id || '') === String(task.taskId))
  if (!found) return { completed: !!task.fileId, failed: false }
  const phase = String(found?.phase || found?.status || '')
  return { completed: phase === 'PHASE_TYPE_COMPLETE', failed: phase === 'PHASE_TYPE_ERROR', message: String(found?.message || found?.error || '') || undefined }
}

function pikpakHeaders(token?: CliToken): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': PIKPAK_USER_AGENT,
    ...(token ? { Authorization: `Bearer ${token.access_token}` } : {}),
    ...(token?.device_id ? { 'X-Device-Id': String(token.device_id) } : {})
  }
}

function shareId(url: string, pattern: RegExp): string {
  const id = url.match(pattern)?.[1]
  if (!id) throw new Error('无法识别分享链接')
  return id
}

function sharePassword(url: string, explicit: string): string {
  if (explicit) return explicit
  return url.match(/[?&#](?:pwd|password|share_pwd)=([A-Za-z0-9]+)/i)?.[1] || ''
}

function clampProgress(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, numeric > 0 && numeric <= 1 ? numeric * 100 : numeric))
}

async function requestJson(url: string, init: RequestInit, fallback: string): Promise<any> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || data?.error_description || data?.error || `${fallback}（HTTP ${response.status}）`) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return data
}

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size))
  return output
}
