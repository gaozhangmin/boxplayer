import { cloud139ApiParentId, cloud139Request } from './dirfilelist'

export const apiCloud139Mkdir = async (user_id: string, parentId: string, name: string): Promise<{ file_id: string; error: string }> => {
  try {
    const data = await cloud139Request(user_id, '/file/create', {
      parentFileId: cloud139ApiParentId(parentId),
      name,
      description: '',
      type: 'folder',
      fileRenameMode: 'force_rename'
    })
    const fileId = data?.data?.fileId || data?.data?.catalogId || data?.fileId || data?.catalogId || ''
    return { file_id: String(fileId || ''), error: fileId ? '' : '新建文件夹失败' }
  } catch (error: any) {
    return { file_id: '', error: error?.message || '新建文件夹失败' }
  }
}

export const apiCloud139Rename = async (user_id: string, fileId: string, name: string): Promise<{ success: boolean; name: string; parent_file_id: string; isDir: boolean }> => {
  try {
    const data = await cloud139Request(user_id, '/file/update', { fileId, fileName: name })
    const item = data?.data || {}
    return { success: true, name: item.name || item.fileName || name, parent_file_id: item.parentFileId || '', isDir: item.type === 'folder' }
  } catch {
    return { success: false, name, parent_file_id: '', isDir: false }
  }
}

export const apiCloud139TrashBatch = async (user_id: string, ids: string[]): Promise<string[]> => {
  if (!ids.length) return []
  try {
    await cloud139Request(user_id, '/recyclebin/batchTrash', { fileIds: ids })
    return ids
  } catch {
    return []
  }
}

export const apiCloud139MoveBatch = async (user_id: string, ids: string[], toParentId: string): Promise<string[]> => {
  if (!ids.length) return []
  try {
    await cloud139Request(user_id, '/file/batchMove', {
      fileIds: ids,
      parentFileId: cloud139ApiParentId(toParentId)
    })
    return ids
  } catch {
    return []
  }
}

export const apiCloud139CopyBatch = async (user_id: string, ids: string[], toParentId: string): Promise<string[]> => {
  if (!ids.length) return []
  try {
    await cloud139Request(user_id, '/file/batchCopy', {
      fileIds: ids,
      parentFileId: cloud139ApiParentId(toParentId)
    })
    return ids
  } catch {
    return []
  }
}
