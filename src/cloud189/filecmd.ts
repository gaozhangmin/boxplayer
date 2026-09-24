import { cloud189ApiParentId, cloud189FormRequest, cloud189PostRequest } from './dirfilelist'

export const apiCloud189Mkdir = async (user_id: string, parentId: string, name: string): Promise<{ file_id: string; error: string }> => {
  try {
    const data = await cloud189PostRequest(user_id, 'createFolder.action', {
      folderName: name,
      parentFolderId: cloud189ApiParentId(parentId),
      relativePath: ''
    })
    const fileId = data?.folderId || data?.id || data?.folder?.id || data?.data?.folderId || data?.data?.id || data?.data?.folder?.id || ''
    return { file_id: String(fileId || ''), error: fileId ? '' : '新建文件夹失败' }
  } catch (error: any) {
    return { file_id: '', error: error?.message || '新建文件夹失败' }
  }
}

export const apiCloud189Rename = async (user_id: string, fileId: string, name: string): Promise<{ success: boolean; name: string; parent_file_id: string; isDir: boolean }> => {
  try {
    await cloud189PostRequest(user_id, 'renameFile.action', { fileId, destFileName: name })
    return { success: true, name, parent_file_id: '', isDir: false }
  } catch {
    try {
      await cloud189PostRequest(user_id, 'renameFolder.action', { folderId: fileId, destFolderName: name })
      return { success: true, name, parent_file_id: '', isDir: true }
    } catch {
      return { success: false, name, parent_file_id: '', isDir: false }
    }
  }
}

const createBatchTask = async (user_id: string, type: 'DELETE' | 'MOVE' | 'COPY', ids: string[], targetFolderId = '') => {
  const taskInfos = ids.map((id) => ({ fileId: String(id), fileName: '', isFolder: 0 }))
  const data = await cloud189FormRequest(user_id, 'batch/createBatchTask.action', {
    type,
    taskInfos: JSON.stringify(taskInfos),
    targetFolderId
  })
  return String(data?.taskId || data?.task_id || '')
}

export const apiCloud189TrashBatch = async (user_id: string, ids: string[]): Promise<string[]> => {
  if (!ids.length) return []
  try {
    const taskId = await createBatchTask(user_id, 'DELETE', ids)
    if (taskId) {
      await cloud189FormRequest(user_id, 'batch/checkBatchTask.action', { taskId })
    }
    return ids
  } catch {
    return []
  }
}

export const apiCloud189MoveBatch = async (user_id: string, ids: string[], toParentId: string): Promise<string[]> => {
  if (!ids.length) return []
  try {
    const taskId = await createBatchTask(user_id, 'MOVE', ids, cloud189ApiParentId(toParentId))
    if (taskId) await cloud189FormRequest(user_id, 'batch/checkBatchTask.action', { taskId })
    return ids
  } catch {
    return []
  }
}

export const apiCloud189CopyBatch = async (user_id: string, ids: string[], toParentId: string): Promise<string[]> => {
  if (!ids.length) return []
  try {
    const taskId = await createBatchTask(user_id, 'COPY', ids, cloud189ApiParentId(toParentId))
    if (taskId) await cloud189FormRequest(user_id, 'batch/checkBatchTask.action', { taskId })
    return ids
  } catch {
    return []
  }
}
