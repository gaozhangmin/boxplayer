import { apiGoogleFileDetail, googleDriveRequest, googleDriveFolderMimeType, mapGoogleFileToAliModel } from './dirfilelist'

const fields = 'id,name,mimeType,size,parents,createdTime,modifiedTime,thumbnailLink,webContentLink,md5Checksum,trashed'
const withAllDrives = (params: Record<string, string> = {}) => new URLSearchParams({ supportsAllDrives: 'true', fields, ...params }).toString()

export const buildGoogleMkdirBody = (name: string, parentId: string) => ({ name, mimeType: googleDriveFolderMimeType, parents: [parentId === 'google_root' ? 'root' : parentId] })
export const buildGoogleRenameBody = (name: string) => ({ name })
export const buildGoogleTrashBody = () => ({ trashed: true })
export const buildGoogleRestoreBody = () => ({ trashed: false })
export const buildGoogleMovePath = (fileId: string, oldParentId: string, newParentId: string) => `/files/${encodeURIComponent(fileId)}?${withAllDrives({ addParents: newParentId === 'google_root' ? 'root' : newParentId, removeParents: oldParentId === 'google_root' ? 'root' : oldParentId })}`
export const buildGoogleCopyBody = (parentId: string, name?: string) => ({ parents: [parentId === 'google_root' ? 'root' : parentId], ...(name ? { name } : {}) })

export const apiGoogleMkdir = async (userId: string, parentId: string, name: string) => {
  const file = await googleDriveRequest<any>(userId, `/files?${withAllDrives()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildGoogleMkdirBody(name, parentId)) }, '创建 Google Drive 文件夹失败')
  return { file_id: file?.id || '', error: file?.id ? '' : '创建 Google Drive 文件夹失败' }
}

export const apiGoogleRename = async (userId: string, fileId: string, name: string) => {
  const file = await googleDriveRequest<any>(userId, `/files/${encodeURIComponent(fileId)}?${withAllDrives()}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildGoogleRenameBody(name)) }, '重命名 Google Drive 文件失败')
  return file ? mapGoogleFileToAliModel(file, 'google', file.parents?.[0] || 'google_root') : undefined
}

export const apiGoogleTrashBatch = async (userId: string, fileIds: string[]) => {
  const failed: string[] = []
  for (const fileId of fileIds) {
    const file = await googleDriveRequest<any>(userId, `/files/${encodeURIComponent(fileId)}?${withAllDrives()}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildGoogleTrashBody()) }, '移入 Google Drive 回收站失败')
    if (!file) failed.push(fileId)
  }
  return failed
}

export const apiGoogleTrashRestoreBatch = async (userId: string, fileIds: string[]) => {
  const success: string[] = []
  for (const fileId of fileIds) {
    const file = await googleDriveRequest<any>(userId, `/files/${encodeURIComponent(fileId)}?${withAllDrives()}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildGoogleRestoreBody()) }, '恢复 Google Drive 文件失败')
    if (file) success.push(fileId)
  }
  return success
}

export const apiGoogleDeleteBatch = async (userId: string, fileIds: string[]) => {
  const success: string[] = []
  for (const fileId of fileIds) {
    const file = await googleDriveRequest<any>(userId, `/files/${encodeURIComponent(fileId)}?${withAllDrives()}`, { method: 'DELETE' }, '彻底删除 Google Drive 文件失败')
    if (file !== null) success.push(fileId)
  }
  return success
}

export const apiGoogleEmptyTrash = async (userId: string) => {
  const result = await googleDriveRequest<any>(userId, '/files/trash?supportsAllDrives=true', { method: 'DELETE' }, '清空 Google Drive 回收站失败')
  return result !== null
}

export const apiGoogleMoveBatch = async (userId: string, fileIds: string[], newParentId: string) => {
  const success: string[] = []
  for (const fileId of fileIds) {
    const detail = await apiGoogleFileDetail(userId, fileId)
    const oldParentId = detail?.parents?.[0]
    if (!oldParentId) continue
    const file = await googleDriveRequest<any>(userId, buildGoogleMovePath(fileId, oldParentId, newParentId), { method: 'PATCH' }, '移动 Google Drive 文件失败')
    if (file) success.push(fileId)
  }
  return success
}

export const apiGoogleCopyBatch = async (userId: string, fileIds: string[], parentId: string) => {
  const success: string[] = []
  for (const fileId of fileIds) {
    const file = await googleDriveRequest<any>(userId, `/files/${encodeURIComponent(fileId)}/copy?${withAllDrives()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildGoogleCopyBody(parentId)) }, '复制 Google Drive 文件失败')
    if (file) success.push(fileId)
  }
  return success
}
