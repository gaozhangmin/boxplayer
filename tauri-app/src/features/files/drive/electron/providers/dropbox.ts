import {completeDropboxBatch,resolveDropboxCommandName} from '../../dropboxBatchPorts'
import {resolveDropboxRenamePath} from '../../dropboxRenamePorts'
const message={error:(_value:string)=>{}}
import {dropboxRpc} from '../../providerTransport'

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
  if (!fileId || ['dropbox_root','root'].includes(fileId)) return ''
  if (path) return path
  if (fileId.startsWith('/')) return fileId
  return extractDropboxPathFromDescription(description) || fileId
}

export const buildDropboxChildPath = (parentId: string, name: string, parentDescription = '', parentPath = ''): string => {
  const parent = resolveDropboxCommandPath(parentId, parentDescription, parentPath)
  if (!parent) return `/${name}`
  return `${parent.replace(/\/+$/g, '')}/${name}`
}

export const apiDropboxMkdir = async (user_id: string, parentId: string, name: string, parentDescription = ''): Promise<{ file_id: string; error: string }> => {
  const path = buildDropboxChildPath(parentId, name, parentDescription)
  const resp = await dropboxRpc<DropboxFileMetadataResp>(user_id, '/files/create_folder_v2', { path, autorename: false }, '新建文件夹')
  if (resp.error) return { file_id: '', error: resp.error }
  return { file_id: resp.data?.metadata?.id || resp.data?.metadata?.path_display || path, error: '' }
}

export const parentPathFromDropboxPath = (path: string): string => {
  if (!path.startsWith('/')) return ''
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return `/${parts.slice(0, -1).join('/')}`
}

export const buildDropboxRelocationBody = (fromPath: string, toPath: string) => ({
  from_path: fromPath,
  to_path: toPath,
  allow_shared_folder: true,
  autorename: true,
  allow_ownership_transfer: false
})

export const apiDropboxRename = async (user_id: string, fileId: string, name: string): Promise<{ success: boolean; file_id: string; name: string; parent_file_id: string; isDir: boolean }> => {
  const fromPath = await resolveDropboxRenamePath(user_id, fileId)
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

type DropboxBatchResult = {
  '.tag'?: 'async_job_id' | 'complete' | 'in_progress' | 'failed'
  async_job_id?: string
  entries?: Array<{ '.tag'?: 'success' | 'failure' }>
}

export const buildDropboxRelocationBatchBody = (entries: Array<{ from_path: string; to_path: string }>, isMove: boolean) => ({
  entries,
  autorename: true,
  ...(isMove ? { allow_ownership_transfer: false } : {})
})

const batchSuccessIndexes = (result: DropboxBatchResult | undefined, count: number): number[] => {
  if (!result || result['.tag'] !== 'complete') return []
  return (result.entries || []).flatMap((entry, index) => entry['.tag'] === 'success' && index < count ? [index] : [])
}

const apiDropboxRelocateBatch = async (user_id: string, fileIds: string[], toParentId: string, toParentDescription: string, endpoint: '/files/move_v2' | '/files/copy_v2', title: string, check?:()=>void): Promise<string[]> => {
  check?.()
  const targetParentPath = resolveDropboxCommandPath(toParentId, toParentDescription)
  const entries: Array<{ fileId: string; fromPath: string; toPath: string }> = []
  for (const fileId of fileIds) {
    const fromPath = await resolveDropboxRenamePath(user_id, fileId)
    const name = await resolveDropboxCommandName(user_id, fileId)
    if (!fromPath || !name) continue
    const toPath = buildDropboxChildPath(targetParentPath || 'dropbox_root', name)
    entries.push({ fileId, fromPath, toPath })
  }
  if (!entries.length) return []
  const isMove = endpoint === '/files/move_v2'
  const result = await completeDropboxBatch(user_id, isMove ? '/files/move_batch_v2' : '/files/copy_batch_v2', isMove ? '/files/move_batch/check_v2' : '/files/copy_batch/check_v2', buildDropboxRelocationBatchBody(entries.map(item => ({ from_path: item.fromPath, to_path: item.toPath })), isMove), check)
  if (!result) message.error(`${title} Dropbox 文件失败`)
  return batchSuccessIndexes(result, entries.length).map(index => entries[index].fileId)
}

export const apiDropboxMoveBatch = async (user_id: string, fileIds: string[], toParentId: string, toParentDescription = '', check?:()=>void): Promise<string[]> => {
  return apiDropboxRelocateBatch(user_id, fileIds, toParentId, toParentDescription, '/files/move_v2', '移动', check)
}

export const apiDropboxCopyBatch = async (user_id: string, fileIds: string[], toParentId: string, toParentDescription = '', check?:()=>void): Promise<string[]> => {
  return apiDropboxRelocateBatch(user_id, fileIds, toParentId, toParentDescription, '/files/copy_v2', '复制', check)
}

export const apiDropboxDeleteBatch = async (user_id: string, fileIds: string[], check?:()=>void): Promise<string[]> => {
  check?.()
  const entries = (await Promise.all(fileIds.map(async fileId => ({ fileId, path: await resolveDropboxRenamePath(user_id, fileId) })))).filter(item => !!item.path)
  if (!entries.length) return []
  const result = await completeDropboxBatch(user_id, '/files/delete_batch', '/files/delete_batch/check', { entries: entries.map(item => ({ path: item.path })) }, check)
  return batchSuccessIndexes(result, entries.length).map(index => entries[index].fileId)
}
