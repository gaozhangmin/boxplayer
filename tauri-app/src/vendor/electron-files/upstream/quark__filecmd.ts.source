import { quarkRequest } from './dirfilelist'

export const apiQuarkMkdir = async (user_id: string, parentId: string, name: string): Promise<{ file_id: string; error: string }> => {
  const data = await quarkRequest(user_id, 'file', {
    method: 'POST',
    body: JSON.stringify({
      pdir_fid: parentId === 'quark_root' ? '0' : parentId,
      file_name: name,
      dir_init_lock: false,
      dir_path: ''
    })
  })
  if ((data as any)?.__error) return { file_id: '', error: String((data as any).message || '新建夸克文件夹失败') }
  const fileId = (data as any)?.data?.fid || (data as any)?.data?.file?.fid || ''
  return { file_id: String(fileId || ''), error: fileId ? '' : String((data as any)?.message || '新建夸克文件夹失败') }
}

export const apiQuarkRename = async (user_id: string, fileId: string, name: string): Promise<{ success: boolean; name: string; parent_file_id: string; isDir: boolean }> => {
  const data = await quarkRequest(user_id, 'file/rename', {
    method: 'POST',
    body: JSON.stringify({ fid: fileId, file_name: name })
  })
  const file = (data as any)?.data || {}
  return {
    success: !!data,
    name: file.file_name || name,
    parent_file_id: file.pdir_fid || '',
    isDir: Number(file.file_type || 1) === 0
  }
}

export const apiQuarkTrashBatch = async (user_id: string, ids: string[]): Promise<string[]> => {
  if (!ids.length) return []
  const data = await quarkRequest(user_id, 'file/delete', {
    method: 'POST',
    body: JSON.stringify({
      action_type: 2,
      filelist: ids,
      exclude_fids: []
    })
  })
  return data ? ids : []
}

export const apiQuarkMoveBatch = async (user_id: string, ids: string[], toParentId: string): Promise<string[]> => {
  if (!ids.length) return []
  const data = await quarkRequest(user_id, 'file/move', {
    method: 'POST',
    body: JSON.stringify({
      action_type: 1,
      to_pdir_fid: toParentId === 'quark_root' ? '0' : toParentId,
      filelist: ids,
      exclude_fids: []
    })
  })
  return data ? ids : []
}
