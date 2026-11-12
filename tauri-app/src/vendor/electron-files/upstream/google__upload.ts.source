import { getGoogleToken } from './dirfilelist'
import path from 'path'
import type { FileHandle } from 'fs/promises'
import type { IUploadingUI } from '../utils/dbupload'

const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

export const buildGoogleMultipartUploadBody = (parentId: string, name: string, contentType: string, bytes: Uint8Array, boundary: string) => {
  const parent = parentId === 'google_root' ? 'root' : parentId
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
  const tail = `\r\n--${boundary}--\r\n`
  return new Blob([head, new Uint8Array(Array.from(bytes)), tail], { type: `multipart/related; boundary=${boundary}` })
}

export const apiGoogleUploadBuffer = async (userId: string, parentId: string, name: string, buffer: Buffer) => {
  const token = await getGoogleToken(userId)
  if (!token?.access_token) return { file_id: '', error: '未登录 Google Drive' }
  const boundary = `boxplayer_${crypto.randomUUID().replace(/-/g, '')}`
  const response = await fetch(`${UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: buildGoogleMultipartUploadBody(parentId, name, 'application/octet-stream', new Uint8Array(buffer), boundary)
  })
  const data = await response.json().catch(() => undefined)
  return { file_id: data?.id || '', error: data?.id ? '' : (data?.error?.message || '上传 Google Drive 文件失败') }
}

export const buildGoogleResumableSessionUrl = () => `${UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true&fields=id`
export const buildGoogleContentRange = (start: number, size: number, total: number) => `bytes ${start}-${start + size - 1}/${total}`

const readSlice = async (handle: FileHandle, offset: number, size: number) => {
  const buffer = Buffer.alloc(size)
  const read = await handle.read(buffer, 0, size, offset)
  return buffer.subarray(0, read.bytesRead)
}

const recordProgress = async (fileui: IUploadingUI, delta: number, position: number) => {
  const { default: AliUploadDisk } = await import('../aliapi/uploaddisk')
  AliUploadDisk.RecordUploadProgress(fileui.UploadID, delta, position)
}

const createResumableSession = async (userId: string, parentId: string, name: string, size: number) => {
  const token = await getGoogleToken(userId)
  if (!token?.access_token) return ''
  const response = await fetch(buildGoogleResumableSessionUrl(), { method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(size) }, body: JSON.stringify({ name, parents: [parentId === 'google_root' ? 'root' : parentId] }) })
  return response.ok ? response.headers.get('location') || '' : ''
}

export default class GoogleUploadDisk {
  static async UploadOneFile(fileui: IUploadingUI): Promise<string> {
    if (fileui.encType) return 'Google Drive 暂不支持加密上传'
    const { OpenFileHandle } = await import('../utils/filehelper')
    const opened = await OpenFileHandle(path.join(fileui.localFilePath, fileui.File.partPath))
    if (opened.error || !opened.handle) return opened.error || '打开本地文件失败'
    try {
      const sessionUrl = await createResumableSession(fileui.user_id, fileui.parent_file_id, fileui.File.name, fileui.File.size)
      if (!sessionUrl) return '创建 Google Drive 可续传上传会话失败'
      const token = await getGoogleToken(fileui.user_id)
      if (!token?.access_token) return '未登录 Google Drive'
      let offset = 0
      const chunkSize = 8 * 1024 * 1024
      fileui.Info.uploadState = 'running'
      while (offset < fileui.File.size) {
        if (!fileui.IsRunning) return '已暂停'
        const chunk = await readSlice(opened.handle, offset, Math.min(chunkSize, fileui.File.size - offset))
        if (!chunk.length) return '读取本地文件失败'
        const response = await fetch(sessionUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(chunk.length), 'Content-Range': buildGoogleContentRange(offset, chunk.length, fileui.File.size) }, body: new Uint8Array(chunk) })
        if (!(response.status === 308 || response.ok)) return `上传 Google Drive 分片失败 (${response.status})`
        if (response.ok) {
          if (offset + chunk.length !== fileui.File.size) return 'Google Drive 上传过早完成'
          const data = await response.json().catch(() => undefined)
          if (!data?.id) return 'Google Drive 上传完成但未返回文件 ID'
          fileui.File.uploaded_file_id = data.id
          fileui.File.uploaded_is_rapid = false
        }
        offset += chunk.length
        await recordProgress(fileui, chunk.length, offset)
      }
      return fileui.File.uploaded_file_id ? 'success' : 'Google Drive 上传未完成'
    } finally {
      await opened.handle.close().catch(() => {})
    }
  }
}
