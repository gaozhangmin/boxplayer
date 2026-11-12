import {dropboxContentRequest,Sleep} from '../../dropboxTextTransport'
type Buffer=Uint8Array
export const toDropboxWriteMode = (checkNameMode: string): { mode: 'add' | 'overwrite'; autorename: boolean } => {
  if (checkNameMode === 'auto_rename') return { mode: 'add', autorename: true }
  if (checkNameMode === 'refuse') return { mode: 'add', autorename: false }
  return { mode: 'overwrite', autorename: false }
}

export const buildDropboxCommitInfo = (uploadPath: string, checkNameMode: string) => {
  const writeMode = toDropboxWriteMode(checkNameMode)
  return {
    path: uploadPath,
    mode: writeMode.mode,
    autorename: writeMode.autorename,
    mute: false,
    strict_conflict: false
  }
}

export const parseDropboxContentError = (data: string, fallback: string): string => {
  if (!data) return fallback
  try {
    const parsed = JSON.parse(data)
    const error = parsed?.error_summary || parsed?.error_description || parsed?.message || ''
    if (String(error).startsWith('path/conflict/folder')) return '同名文件夹已存在，请更换文件名'
    if (String(error).startsWith('path/conflict/file')) return '同名文件已存在，请更换文件名'
    return error || fallback
  } catch {
    return data || fallback
  }
}

const uploadBufferWithRetry = async <T>(accessToken: string, endpoint: string, arg: any, body: Buffer, fallback: string): Promise<{ data?: T; error: string }> => {
  let last = ''
  for (let i = 0; i < 3; i++) {
    const resp = await dropboxContentRequest<T>(accessToken, endpoint, arg, body, fallback)
    if (!resp.error) return resp
    last = resp.error
    await Sleep(800 * (i + 1))
  }
  return { error: last || fallback }
}

export {uploadBufferWithRetry}
