import message from '../utils/message'
import Config from '../config'
import { getCloud123Token } from './auth'

export type Cloud123MkdirResult = {
  file_id: string
  error: string
}

export const getCloud123MkdirFileId = (data: any): string => {
  const fileId = data?.data?.dirID || data?.data?.fileID || data?.data?.fileId || data?.data?.file_id || ''
  return fileId ? String(fileId) : ''
}

export const apiCloud123Mkdir = async (user_id: string, parent_id: string, name: string): Promise<Cloud123MkdirResult> => {
  const result: Cloud123MkdirResult = { file_id: '', error: '新建文件夹失败' }
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return result
  const url = 'https://open-api.123pan.com/upload/v1/file/mkdir'
  const body = JSON.stringify({ parentID: parent_id, name })
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body
    })
    if (!resp.ok) return result
    const data = await resp.json()
    if (data?.code === 0) {
      const fileId = getCloud123MkdirFileId(data)
      return { file_id: fileId ? String(fileId) : '', error: '' }
    }
    if (data?.message) result.error = data.message
  } catch (err: any) {
    message.error('新建文件夹 失败 ' + (err?.message || ''))
  }
  return result
}

export type Cloud123RenameResult = {
  file_id: string
  parent_file_id: string
  name: string
  isDir: boolean
}

export const apiCloud123TrashBatch = async (user_id: string, file_id_list: string[]): Promise<string[]> => {
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return []
  const url = 'https://open-api.123pan.com/api/v1/file/trash'
  const fileIDs = file_id_list.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
  if (fileIDs.length === 0) return []
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body: JSON.stringify({ fileIDs })
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (data?.code !== 0) return []
    return fileIDs.map((id) => String(id))
  } catch (err: any) {
    message.error('删除到回收站失败 ' + (err?.message || ''))
    return []
  }
}

export const apiCloud123RecoverBatch = async (user_id: string, file_id_list: string[]): Promise<string[]> => {
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return []
  const url = 'https://open-api.123pan.com/api/v1/file/recover'
  const fileIDs = file_id_list.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
  if (fileIDs.length === 0) return []
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body: JSON.stringify({ fileIDs })
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (data?.code !== 0) {
      message.error('还原失败：' + (data?.message || ''))
      return []
    }
    const abnormal = Array.isArray(data?.data?.abnormalFileIDs) ? data.data.abnormalFileIDs : []
    const abnormalSet = new Set<number>(abnormal.map((id: any) => Number(id)))
    return fileIDs.filter((id) => !abnormalSet.has(id)).map((id) => String(id))
  } catch (err: any) {
    message.error('从回收站恢复失败 ' + (err?.message || ''))
    return []
  }
}

export const apiCloud123TrashDeleteAll = async (user_id: string): Promise<boolean> => {
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return false
  const url = `https://www.123pan.com/api/v1/file/trash_delete_all?t=${Date.now()}`
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.access_token}`
      },
      body: JSON.stringify({ event: 'recycleClear', RequestSource: null })
    })
    if (!resp.ok) return false
    const data = await resp.json()
    if (data?.code !== 0) return false
    return true
  } catch (err: any) {
    message.error('清空回收站失败 ' + (err?.message || ''))
    return false
  }
}

export const apiCloud123CopySingle = async (user_id: string, file_id: string, targetDirId: string): Promise<string[]> => {
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return []
  const url = 'https://open-api.123pan.com/api/v1/file/copy'
  const body = {
    fileId: Number(file_id),
    targetDirId: Number(targetDirId)
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body: JSON.stringify(body)
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (data?.code !== 0) return []
    const targetFileId = data?.data?.targetFileId ?? data?.data?.targetFileID
    return targetFileId ? [String(targetFileId)] : []
  } catch (err: any) {
    message.error('复制失败 ' + (err?.message || ''))
    return []
  }
}

export const apiCloud123CopyBatch = async (user_id: string, file_id_list: string[], targetDirId: string): Promise<string[]> => {
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return []
  const url = 'https://open-api.123pan.com/api/v1/file/async/copy'
  const fileIds = file_id_list.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
  if (fileIds.length === 0) return []
  const body = {
    fileIds,
    targetDirId: Number(targetDirId)
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body: JSON.stringify(body)
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (data?.code !== 0) return []
    return fileIds.map((id) => String(id))
  } catch (err: any) {
    message.error('批量复制失败 ' + (err?.message || ''))
    return []
  }
}

export const apiCloud123MoveBatch = async (user_id: string, file_id_list: string[], toParentFileId: string): Promise<string[]> => {
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return []
  const url = 'https://open-api.123pan.com/api/v1/file/move'
  const fileIDs = file_id_list.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
  if (fileIDs.length === 0) return []
  const body = {
    fileIDs,
    toParentFileID: Number(toParentFileId)
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body: JSON.stringify(body)
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (data?.code !== 0) return []
    return fileIDs.map((id) => String(id))
  } catch (err: any) {
    message.error('移动失败 ' + (err?.message || ''))
    return []
  }
}

export const apiCloud123FileDetail = async (user_id: string, file_id: string): Promise<any | null> => {
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return null
  const url = `https://open-api.123pan.com/api/v1/file/detail?fileID=${encodeURIComponent(file_id)}`
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': Config.downAgent || '',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      }
    })
    if (!resp.ok) return null
    const data = await resp.json()
    if (data?.code !== 0) return null
    return data?.data || null
  } catch (err: any) {
    message.error('获取文件详情失败 ' + (err?.message || ''))
    return null
  }
}

export const apiCloud123FileInfos = async (user_id: string, file_ids: string[]): Promise<any[]> => {
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return []
  const url = 'https://open-api.123pan.com/api/v1/file/infos'
  const fileIds = file_ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
  if (fileIds.length === 0) return []
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body: JSON.stringify({ fileIds })
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (data?.code !== 0) return []
    const list = Array.isArray(data?.data?.fileList) ? data.data.fileList : []
    return list
  } catch (err: any) {
    message.error('获取文件详情失败 ' + (err?.message || ''))
    return []
  }
}

export const apiCloud123DownloadInfo = async (user_id: string, file_id: string): Promise<{ url: string } | string> => {
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return '未登录 123 网盘'
  const url = `https://open-api.123pan.com/api/v1/file/download_info?fileId=${encodeURIComponent(file_id)}`
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      }
    })
    if (!resp.ok) {
      message.error('获取下载地址失败')
      return '获取下载地址失败'
    }
    const data = await resp.json()
    console.log('[cloud123] download_info', { file_id, code: data?.code, message: data?.message, hasUrl: !!data?.data?.downloadUrl })
    if (data?.code !== 0) {
      const msg = data?.message || '获取下载地址失败'
      message.error(msg)
      return msg
    }
    const downloadUrl = data?.data?.downloadUrl || ''
    if (!downloadUrl) {
      message.error('获取下载地址失败')
      return '获取下载地址失败'
    }
    return { url: downloadUrl }
  } catch (err: any) {
    message.error('获取下载地址失败 ' + (err?.message || ''))
    return err?.message || '获取下载地址失败'
  }
}

export const apiCloud123Rename = async (user_id: string, file_id: string, newName: string): Promise<{ success: boolean; error: string }> => {
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return { success: false, error: '未登录 123 网盘' }
  const url = 'https://open-api.123pan.com/api/v1/file/name'
  const body = JSON.stringify({ fileId: Number(file_id), fileName: newName })
  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body
    })
    if (!resp.ok) return { success: false, error: '重命名失败' }
    const data = await resp.json()
    if (data?.code === 0) return { success: true, error: '' }
    return { success: false, error: data?.message || '重命名失败' }
  } catch (err: any) {
    message.error('重命名 失败 ' + (err?.message || ''))
    return { success: false, error: err?.message || '重命名失败' }
  }
}

export const apiCloud123RenameBatch = async (
  user_id: string,
  file_id_list: string[],
  name_list: string[]
): Promise<Cloud123RenameResult[]> => {
  const result: Cloud123RenameResult[] = []
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) return result
  const url = 'https://open-api.123pan.com/api/v1/file/rename'
  const renameList: string[] = []
  for (let i = 0; i < file_id_list.length; i++) {
    const file_id = file_id_list[i]
    const name = name_list[i]
    if (!file_id || !name) continue
    renameList.push(`${file_id}|${name}`)
  }
  if (renameList.length === 0) return result
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Platform: 'open_platform',
        Authorization: `Bearer ${token.access_token}`
      },
      body: JSON.stringify({ renameList })
    })
    if (!resp.ok) return result
    const data = await resp.json()
    if (data?.code !== 0) return result
    for (let i = 0; i < renameList.length; i++) {
      const file_id = file_id_list[i]
      const name = name_list[i]
      result.push({ file_id, parent_file_id: '', name, isDir: false })
    }
  } catch (err: any) {
    message.error('批量重命名 失败 ' + (err?.message || ''))
  }
  return result
}
