import {graphJson} from '../../providerTransport'

export const buildOneDriveMkdirBody = (name: string) => ({
  name,
  folder: {},
  '@microsoft.graph.conflictBehavior': 'rename'
})

export const apiOneDriveMkdir = async (user_id: string, parentId: string, name: string): Promise<{ file_id: string; error: string }> => {
  const parent = parentId === 'onedrive_root' ? 'root' : `items/${encodeURIComponent(parentId)}`
  const resp = await graphJson<any>(user_id, `/me/drive/${parent}/children`, 'POST', buildOneDriveMkdirBody(name), '新建 OneDrive 文件夹失败')
  return { file_id: resp.data?.id || '', error: resp.error }
}

export const buildOneDriveRenameBody = (name: string) => ({ name })

export const apiOneDriveRename = async (user_id: string, fileId: string, name: string): Promise<{ file_id: string; error: string }> => {
  const resp = await graphJson<any>(user_id, `/me/drive/items/${encodeURIComponent(fileId)}`, 'PATCH', buildOneDriveRenameBody(name), '重命名 OneDrive 文件失败')
  return { file_id: resp.data?.id || fileId, error: resp.error }
}

const buildParentReference = (targetParentId: string) => (
  !targetParentId || targetParentId === 'onedrive_root'
    ? { path: '/drive/root:' }
    : { id: targetParentId }
)

export const buildOneDriveMoveBody = (targetParentId: string) => ({
  parentReference: buildParentReference(targetParentId)
})

export const apiOneDriveMoveBatch = async (user_id: string, targetParentId: string, fileIdList: string[]): Promise<string[]> => {
  const success: string[] = []
  for (const fileId of fileIdList) {
    const resp = await graphJson(user_id, `/me/drive/items/${encodeURIComponent(fileId)}`, 'PATCH', buildOneDriveMoveBody(targetParentId), '移动 OneDrive 文件失败')
    if (!resp.error) success.push(fileId)
  }
  return success
}

export const apiOneDriveDeleteBatch = async (user_id: string, fileIdList: string[]): Promise<string[]> => {
  const success: string[] = []
  for (const fileId of fileIdList) {
    const resp = await graphJson(user_id, `/me/drive/items/${encodeURIComponent(fileId)}`, 'DELETE', undefined, '删除 OneDrive 文件失败')
    if (!resp.error) success.push(fileId)
  }
  return success
}

export const buildOneDriveCopyBody = (targetParentId: string, name: string) => ({
  parentReference: buildParentReference(targetParentId),
  name
})

export const apiOneDriveCopyBatch = async (user_id: string, targetParentId: string, fileList: { file_id: string; name: string }[]): Promise<string[]> => {
  const success: string[] = []
  for (const item of fileList) {
    const resp = await graphJson(user_id, `/me/drive/items/${encodeURIComponent(item.file_id)}/copy`, 'POST', buildOneDriveCopyBody(targetParentId, item.name), '复制 OneDrive 文件失败')
    if (!resp.error) success.push(item.file_id)
  }
  return success
}
