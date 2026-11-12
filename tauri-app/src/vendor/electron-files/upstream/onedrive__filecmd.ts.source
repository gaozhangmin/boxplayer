import message from '../utils/message'
import { getOneDriveToken } from './dirfilelist'

const GRAPH_API_HOST = 'https://graph.microsoft.com/v1.0'

const graphJson = async <T>(user_id: string, path: string, method: string, body: any, fallback: string): Promise<{ data?: T; error: string }> => {
  const token = await getOneDriveToken(user_id)
  if (!token?.access_token) return { error: '未登录 OneDrive' }
  const resp = await fetch(`${GRAPH_API_HOST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.error) {
    const error = data?.error?.message || fallback
    message.error(error)
    return { error }
  }
  return { data: data as T, error: '' }
}

export const buildOneDriveMkdirBody = (name: string) => ({
  name,
  folder: {},
  '@microsoft.graph.conflictBehavior': 'rename'
})

export const buildOneDriveRenameBody = (name: string) => ({ name })

const buildParentReference = (targetParentId: string) => (
  !targetParentId || targetParentId === 'onedrive_root'
    ? { path: '/drive/root:' }
    : { id: targetParentId }
)

export const buildOneDriveMoveBody = (targetParentId: string) => ({
  parentReference: buildParentReference(targetParentId)
})

export const buildOneDriveCopyBody = (targetParentId: string, name: string) => ({
  parentReference: buildParentReference(targetParentId),
  name
})

export const apiOneDriveMkdir = async (user_id: string, parentId: string, name: string): Promise<{ file_id: string; error: string }> => {
  const parent = parentId === 'onedrive_root' ? 'root' : `items/${encodeURIComponent(parentId)}`
  const resp = await graphJson<any>(user_id, `/me/drive/${parent}/children`, 'POST', buildOneDriveMkdirBody(name), '新建 OneDrive 文件夹失败')
  return { file_id: resp.data?.id || '', error: resp.error }
}

export const apiOneDriveDeleteBatch = async (user_id: string, fileIdList: string[]): Promise<string[]> => {
  const success: string[] = []
  for (const fileId of fileIdList) {
    const resp = await graphJson(user_id, `/me/drive/items/${encodeURIComponent(fileId)}`, 'DELETE', undefined, '删除 OneDrive 文件失败')
    if (!resp.error) success.push(fileId)
  }
  return success
}

export const apiOneDriveRename = async (user_id: string, fileId: string, name: string): Promise<{ file_id: string; error: string }> => {
  const resp = await graphJson<any>(user_id, `/me/drive/items/${encodeURIComponent(fileId)}`, 'PATCH', buildOneDriveRenameBody(name), '重命名 OneDrive 文件失败')
  return { file_id: resp.data?.id || fileId, error: resp.error }
}

export const apiOneDriveMoveBatch = async (user_id: string, targetParentId: string, fileIdList: string[]): Promise<string[]> => {
  const success: string[] = []
  for (const fileId of fileIdList) {
    const resp = await graphJson(user_id, `/me/drive/items/${encodeURIComponent(fileId)}`, 'PATCH', buildOneDriveMoveBody(targetParentId), '移动 OneDrive 文件失败')
    if (!resp.error) success.push(fileId)
  }
  return success
}

export const apiOneDriveCopyBatch = async (user_id: string, targetParentId: string, fileList: { file_id: string; name: string }[]): Promise<string[]> => {
  const success: string[] = []
  for (const item of fileList) {
    const resp = await graphJson(user_id, `/me/drive/items/${encodeURIComponent(item.file_id)}/copy`, 'POST', buildOneDriveCopyBody(targetParentId, item.name), '复制 OneDrive 文件失败')
    if (!resp.error) success.push(item.file_id)
  }
  return success
}
