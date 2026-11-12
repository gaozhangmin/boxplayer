import type { IAliGetFileModel } from '../aliapi/alimodels'
import message from '../utils/message'
import { Sleep } from '../utils/format'
import { getDropboxToken } from './dirfilelist'

const DROPBOX_API_HOST = 'https://api.dropboxapi.com/2'

type DropboxFileMetadataResp = {
  metadata?: {
    '.tag'?: 'file' | 'folder' | 'deleted'
    id?: string
    name?: string
    path_lower?: string
    path_display?: string
  }
  error_summary?: string
}

type DropboxBatchResult = {
  '.tag'?: 'async_job_id' | 'complete' | 'in_progress' | 'failed'
  async_job_id?: string
  entries?: Array<{ '.tag'?: 'success' | 'failure' }>
}

const parseDropboxError = (data: any, fallback: string) => data?.error_summary || data?.error_description || data?.message || fallback

const dropboxRpc = async <T>(user_id: string, endpoint: string, body: any, title: string): Promise<{ data?: T; error: string }> => {
  const token = await getDropboxToken(user_id)
  if (!token?.access_token) return { error: '请先登录 Dropbox' }
  try {
    const resp = await fetch(`${DROPBOX_API_HOST}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const data = await resp.json().catch(() => undefined)
    if (!resp.ok || data?.error) return { data, error: parseDropboxError(data, `${title}失败`) }
    return { data: data as T, error: '' }
  } catch (err: any) {
    return { error: err?.message || `${title}失败` }
  }
}

export const extractDropboxPathFromDescription = (description = ''): string => {
  const match = /dropbox_path:([^;]+)/.exec(description)
  if (!match?.[1]) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export const resolveDropboxCommandPath = (fileId: string, description = '', path = ''): string => {
  if (!fileId || fileId.includes('root')) return ''
  if (path) return path
  if (fileId.startsWith('/')) return fileId
  return extractDropboxPathFromDescription(description) || fileId
}

export const parentPathFromDropboxPath = (path: string): string => {
  if (!path.startsWith('/')) return ''
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return `/${parts.slice(0, -1).join('/')}`
}

export const buildDropboxChildPath = (parentId: string, name: string, parentDescription = '', parentPath = ''): string => {
  const parent = resolveDropboxCommandPath(parentId, parentDescription, parentPath)
  if (!parent) return `/${name}`
  return `${parent.replace(/\/+$/g, '')}/${name}`
}

export const buildDropboxRelocationBody = (fromPath: string, toPath: string) => ({
  from_path: fromPath,
  to_path: toPath,
  allow_shared_folder: true,
  autorename: true,
  allow_ownership_transfer: false
})

export const buildDropboxRelocationBatchBody = (entries: Array<{ from_path: string; to_path: string }>, isMove: boolean) => ({
  entries,
  autorename: true,
  ...(isMove ? { allow_ownership_transfer: false } : {})
})

const batchSuccessIndexes = (result: DropboxBatchResult | undefined, count: number): number[] => {
  if (!result || result['.tag'] !== 'complete') return []
  return (result.entries || []).flatMap((entry, index) => entry['.tag'] === 'success' && index < count ? [index] : [])
}

const waitDropboxBatch = async (user_id: string, checkEndpoint: string, jobId: string): Promise<DropboxBatchResult | undefined> => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await dropboxRpc<DropboxBatchResult>(user_id, checkEndpoint, { async_job_id: jobId }, '查询 Dropbox 批量任务失败')
    const result = response.data
    if (!result || result['.tag'] !== 'in_progress') return result
    await Sleep(1000)
  }
  return undefined
}

const completeDropboxBatch = async (user_id: string, launchEndpoint: string, checkEndpoint: string, body: any): Promise<DropboxBatchResult | undefined> => {
  const response = await dropboxRpc<DropboxBatchResult>(user_id, launchEndpoint, body, '创建 Dropbox 批量任务失败')
  const launched = response.data
  if (!launched) return undefined
  if (launched['.tag'] === 'async_job_id' && launched.async_job_id) return waitDropboxBatch(user_id, checkEndpoint, launched.async_job_id)
  return launched
}

const currentFileById = async (fileId: string): Promise<IAliGetFileModel | undefined> => {
  const { default: usePanFileStore } = await import('../pan/panfilestore')
  const list = usePanFileStore().ListDataRaw || []
  return list.find((item: IAliGetFileModel) => item.file_id === fileId)
}

const resolveCurrentPath = async (fileId: string): Promise<string> => {
  const item = await currentFileById(fileId)
  return resolveDropboxCommandPath(fileId, item?.description || '', item?.path || '')
}

const resolveCurrentName = async (fileId: string): Promise<string> => {
  const item = await currentFileById(fileId)
  if (item?.name) return item.name
  const path = await resolveCurrentPath(fileId)
  return path.split('/').filter(Boolean).pop() || fileId
}

export const apiDropboxMkdir = async (user_id: string, parentId: string, name: string, parentDescription = ''): Promise<{ file_id: string; error: string }> => {
  const path = buildDropboxChildPath(parentId, name, parentDescription)
  const resp = await dropboxRpc<DropboxFileMetadataResp>(user_id, '/files/create_folder_v2', { path, autorename: false }, '新建文件夹')
  if (resp.error) return { file_id: '', error: resp.error }
  return { file_id: resp.data?.metadata?.id || resp.data?.metadata?.path_display || path, error: '' }
}

export const apiDropboxDeleteBatch = async (user_id: string, fileIds: string[]): Promise<string[]> => {
  const entries = (await Promise.all(fileIds.map(async fileId => ({ fileId, path: await resolveCurrentPath(fileId) })))).filter(item => !!item.path)
  if (!entries.length) return []
  const result = await completeDropboxBatch(user_id, '/files/delete_batch', '/files/delete_batch/check', { entries: entries.map(item => ({ path: item.path })) })
  return batchSuccessIndexes(result, entries.length).map(index => entries[index].fileId)
}

export const apiDropboxRename = async (user_id: string, fileId: string, name: string): Promise<{ success: boolean; file_id: string; name: string; parent_file_id: string; isDir: boolean }> => {
  const fromPath = await resolveCurrentPath(fileId)
  const parentPath = parentPathFromDropboxPath(fromPath)
  if (!fromPath || !name) return { success: false, file_id: fileId, name, parent_file_id: parentPath, isDir: false }
  const toPath = buildDropboxChildPath(parentPath || 'dropbox_root', name)
  const resp = await dropboxRpc<DropboxFileMetadataResp>(user_id, '/files/move_v2', buildDropboxRelocationBody(fromPath, toPath), '重命名')
  if (resp.error) {
    message.error(resp.error)
    return { success: false, file_id: fileId, name, parent_file_id: parentPath, isDir: false }
  }
  const metadata = resp.data?.metadata
  return {
    success: true,
    file_id: metadata?.id || metadata?.path_display || fileId,
    name: metadata?.name || name,
    parent_file_id: parentPath,
    isDir: metadata?.['.tag'] === 'folder'
  }
}

const apiDropboxRelocateBatch = async (user_id: string, fileIds: string[], toParentId: string, toParentDescription: string, endpoint: '/files/move_v2' | '/files/copy_v2', title: string): Promise<string[]> => {
  const targetParentPath = resolveDropboxCommandPath(toParentId, toParentDescription)
  const entries: Array<{ fileId: string; fromPath: string; toPath: string }> = []
  for (const fileId of fileIds) {
    const fromPath = await resolveCurrentPath(fileId)
    const name = await resolveCurrentName(fileId)
    if (!fromPath || !name) continue
    const toPath = buildDropboxChildPath(targetParentPath || 'dropbox_root', name)
    entries.push({ fileId, fromPath, toPath })
  }
  if (!entries.length) return []
  const isMove = endpoint === '/files/move_v2'
  const result = await completeDropboxBatch(user_id, isMove ? '/files/move_batch_v2' : '/files/copy_batch_v2', isMove ? '/files/move_batch/check_v2' : '/files/copy_batch/check_v2', buildDropboxRelocationBatchBody(entries.map(item => ({ from_path: item.fromPath, to_path: item.toPath })), isMove))
  if (!result) message.error(`${title} Dropbox 文件失败`)
  return batchSuccessIndexes(result, entries.length).map(index => entries[index].fileId)
}

export const apiDropboxMoveBatch = async (user_id: string, fileIds: string[], toParentId: string, toParentDescription = ''): Promise<string[]> => {
  return apiDropboxRelocateBatch(user_id, fileIds, toParentId, toParentDescription, '/files/move_v2', '移动')
}

export const apiDropboxCopyBatch = async (user_id: string, fileIds: string[], toParentId: string, toParentDescription = ''): Promise<string[]> => {
  return apiDropboxRelocateBatch(user_id, fileIds, toParentId, toParentDescription, '/files/copy_v2', '复制')
}
