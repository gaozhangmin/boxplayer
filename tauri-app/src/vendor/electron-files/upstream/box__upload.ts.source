import crypto from 'crypto'
import path from 'path'
import type { FileHandle } from 'fs/promises'
import { apiBoxFileList, getBoxToken, toBoxId } from './dirfilelist'
import type { IUploadingUI } from '../utils/dbupload'
import { Sleep } from '../utils/format'

const BOX_UPLOAD_HOST = 'https://upload.box.com/api/2.0'
export const BOX_DIRECT_UPLOAD_LIMIT = 50 * 1024 * 1024

type BoxUploadPart = { part_id: string; offset: number; size: number; sha1: string }

type BoxUploadSession = {
  id?: string
  part_size?: number
  session_endpoints?: {
    upload_part?: string
    commit?: string
    abort?: string
    status?: string
  }
}

type BoxResponse = { status: number; data: any; error: string; retryAfterMs: number }

export const toBoxConflictBehavior = (mode: string) => {
  if (mode === 'overwrite') return 'overwrite'
  if (mode === 'refuse') return 'refuse'
  return 'rename'
}

export const buildBoxSmallUploadAttributes = (parentId: string, name: string) => ({
  name,
  parent: { id: toBoxId(parentId) }
})

export const buildBoxUploadSessionPath = () => '/files/upload_sessions'

export const buildBoxUploadSessionBody = (parentId: string, name: string, size: number) => ({
  folder_id: toBoxId(parentId),
  file_name: name,
  file_size: size
})

export const buildBoxVersionUploadSessionBody = (size: number) => ({ file_size: size })

export const buildBoxAutoRenameName = (name: string, index: number) => {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return `${base} (${index})${ext}`
}

export const buildBoxPreflightBody = (parentId: string, name: string, size: number) => ({ name, parent: { id: toBoxId(parentId) }, size })

export const buildBoxPartDigest = (body: Buffer) => `sha=${crypto.createHash('sha1').update(body).digest('base64')}`

export const buildBoxContentRange = (offset: number, size: number, total: number) => `bytes ${offset}-${offset + size - 1}/${total}`

export const buildBoxCommitBody = (parts: BoxUploadPart[]) => ({ parts })

export const getBoxRetryAfterMs = (value: string | null, now = Date.now()) => {
  if (!value) return 1000
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(1000, date - now) : 1000
}

const boxUploadRequest = async (user_id: string, url: string, init: RequestInit, fallback: string): Promise<BoxResponse> => {
  const token = await getBoxToken(user_id)
  if (!token?.access_token) return { status: 401, data: undefined, error: '未登录 Box', retryAfterMs: 0 }
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token.access_token}`, ...(init.headers as Record<string, string> || {}) }
    })
    const raw = await response.text().catch(() => '')
    let data: any
    try {
      data = raw ? JSON.parse(raw) : undefined
    } catch {
      data = undefined
    }
    return { status: response.status, data, error: response.ok ? '' : (data?.message || data?.code || fallback), retryAfterMs: getBoxRetryAfterMs(response.headers.get('retry-after')) }
  } catch (error: any) {
    return { status: 0, data: undefined, error: error?.message || fallback, retryAfterMs: 0 }
  }
}

export const apiBoxPreflightUpload = async (user_id: string, parentId: string, name: string, size: number): Promise<'ok' | 'conflict' | string> => {
  const response = await boxUploadRequest(user_id, `${BOX_UPLOAD_HOST}/files/content`, { method: 'OPTIONS', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildBoxPreflightBody(parentId, name, size)) }, 'Box 上传预检失败')
  if (!response.error) return 'ok'
  return response.status === 409 ? 'conflict' : response.error
}

const readSlice = async (handle: FileHandle, offset: number, size: number) => {
  const buffer = Buffer.alloc(size)
  const read = await handle.read(buffer, 0, size, offset)
  return buffer.subarray(0, read.bytesRead)
}

const recordUploadProgress = async (uploadId: number, delta: number, position: number) => {
  const { default: AliUploadDisk } = await import('../aliapi/uploaddisk')
  AliUploadDisk.RecordUploadProgress(uploadId, delta, position)
}

const abortBoxSession = async (user_id: string, url: string) => {
  await boxUploadRequest(user_id, url, { method: 'DELETE' }, '取消 Box 上传会话失败')
}

const uploadBoxSmallFile = async (user_id: string, handle: FileHandle, fileui: IUploadingUI, existingFileId = ''): Promise<string> => {
  const body = await readSlice(handle, 0, fileui.File.size)
  const form = new FormData()
  form.set('attributes', JSON.stringify(buildBoxSmallUploadAttributes(fileui.parent_file_id, fileui.File.name)))
  form.set('file', new Blob([new Uint8Array(body)]), fileui.File.name)
  const url = existingFileId ? `${BOX_UPLOAD_HOST}/files/${encodeURIComponent(existingFileId)}/content` : `${BOX_UPLOAD_HOST}/files/content`
  const response = await boxUploadRequest(user_id, url, { method: 'POST', body: form }, '上传 Box 文件失败')
  const file = response.data?.entries?.[0]
  if (!response.error && file?.id) {
    fileui.File.uploaded_file_id = file.id
    fileui.File.uploaded_is_rapid = false
    await recordUploadProgress(fileui.UploadID, body.length, body.length)
    return 'success'
  }
  return response.status === 409 ? 'Box 中已有同名文件，请更名后重试' : (response.error || '上传 Box 文件失败')
}

const uploadBoxSessionFile = async (user_id: string, handle: FileHandle, fileui: IUploadingUI, existingFileId = ''): Promise<string> => {
  const created = await boxUploadRequest(user_id, `${BOX_UPLOAD_HOST}${existingFileId ? `/files/${encodeURIComponent(existingFileId)}/upload_sessions` : buildBoxUploadSessionPath()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(existingFileId ? buildBoxVersionUploadSessionBody(fileui.File.size) : buildBoxUploadSessionBody(fileui.parent_file_id, fileui.File.name, fileui.File.size))
  }, '创建 Box 上传会话失败')
  const session = created.data as BoxUploadSession | undefined
  const partSize = Number(session?.part_size || 0)
  const uploadUrl = session?.session_endpoints?.upload_part || ''
  const commitUrl = session?.session_endpoints?.commit || ''
  if (created.error || !partSize || !uploadUrl || !commitUrl) return created.error || 'Box 未返回完整上传会话'

  const parts: BoxUploadPart[] = []
  const totalHash = crypto.createHash('sha1')
  let offset = 0
  while (offset < fileui.File.size) {
    if (!fileui.IsRunning) {
      if (session?.session_endpoints?.abort) await abortBoxSession(user_id, session.session_endpoints.abort)
      return '已暂停'
    }
    const body = await readSlice(handle, offset, Math.min(partSize, fileui.File.size - offset))
    if (!body.length) return '读取本地文件失败'
    const response = await boxUploadRequest(user_id, uploadUrl, {
      method: 'PUT',
      headers: {
        Digest: buildBoxPartDigest(body),
        'Content-Range': buildBoxContentRange(offset, body.length, fileui.File.size),
        'Content-Type': 'application/octet-stream'
      },
      body: new Uint8Array(body)
    }, `上传 Box 分片失败 (${parts.length + 1})`)
    const part = response.data?.part as BoxUploadPart | undefined
    if (response.error || !part?.part_id) return response.error || `上传 Box 分片失败 (${parts.length + 1})`
    parts.push(part)
    totalHash.update(body)
    offset += body.length
    await recordUploadProgress(fileui.UploadID, body.length, offset)
  }

  let committed = await boxUploadRequest(user_id, commitUrl, {
    method: 'POST',
    headers: {
      Digest: `sha=${totalHash.copy().digest('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildBoxCommitBody(parts))
  }, '合并 Box 分片失败')
  for (let attempt = 0; attempt < 5; attempt++) {
    const file = committed.data?.entries?.[0]
    if (!committed.error && file?.id) {
      fileui.File.uploaded_file_id = file.id
      fileui.File.uploaded_is_rapid = false
      return 'success'
    }
    if (committed.status !== 202) return committed.error || 'Box 合并分片未返回文件'
    await Sleep(committed.retryAfterMs)
    committed = await boxUploadRequest(user_id, commitUrl, {
      method: 'POST',
      headers: {
        Digest: `sha=${totalHash.copy().digest('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildBoxCommitBody(parts))
    }, '合并 Box 分片失败')
  }
  return 'Box 合并分片仍在处理中，请稍后重试'
}

export const apiBoxUploadBuffer = async (
  user_id: string,
  parentId: string,
  name: string,
  buff: Buffer,
  mode: string
): Promise<{ file_id: string; error: string }> => {
  if (toBoxConflictBehavior(mode) === 'overwrite') return { file_id: '', error: 'Box 新建文件暂不支持覆盖同名文件' }
  if (buff.length > BOX_DIRECT_UPLOAD_LIMIT) return { file_id: '', error: 'Box 新建文件超过 50MB 限制' }
  const form = new FormData()
  form.set('attributes', JSON.stringify(buildBoxSmallUploadAttributes(parentId, name)))
  form.set('file', new Blob([new Uint8Array(buff)]), name)
  const data = await boxUploadRequest(user_id, `${BOX_UPLOAD_HOST}/files/content`, {
    method: 'POST',
    body: form
  }, '上传 Box 文件失败')
  const file = data.data?.entries?.[0]
  return { file_id: file?.id || '', error: file?.id ? '' : (data.error || '上传 Box 文件失败') }
}

export default class BoxUploadDisk {
  static async UploadOneFile(fileui: IUploadingUI): Promise<string> {
    if (fileui.encType) return 'Box 暂不支持加密上传'
    const preflight = await apiBoxPreflightUpload(fileui.user_id, fileui.parent_file_id, fileui.File.name, fileui.File.size)
    let existingFileId = ''
    if (preflight === 'conflict') {
      if (fileui.check_name_mode === 'overwrite') {
        const files = await apiBoxFileList(fileui.user_id, fileui.parent_file_id || 'box_root')
        existingFileId = files.find((item) => item.type === 'file' && item.name === fileui.File.name)?.id || ''
        if (!existingFileId) return '无法定位 Box 中需要覆盖的同名文件'
      } else if (fileui.check_name_mode === 'auto_rename') {
        let availableName = ''
        for (let index = 1; index <= 100; index++) {
          const candidate = buildBoxAutoRenameName(fileui.File.name, index)
          if (await apiBoxPreflightUpload(fileui.user_id, fileui.parent_file_id, candidate, fileui.File.size) === 'ok') {
            availableName = candidate
            break
          }
        }
        if (!availableName) return 'Box 自动重命名失败，请手动更名后重试'
        fileui.File.name = availableName
      } else return 'Box 中已有同名文件，请更名后重试'
    } else if (preflight !== 'ok') return preflight
    const filePath = path.join(fileui.localFilePath, fileui.File.partPath)
    const { OpenFileHandle } = await import('../utils/filehelper')
    const opened = await OpenFileHandle(filePath)
    if (opened.error || !opened.handle) return opened.error || '打开本地文件失败'
    fileui.Info.uploadState = 'running'
    try {
      if (fileui.File.size <= BOX_DIRECT_UPLOAD_LIMIT) return await uploadBoxSmallFile(fileui.user_id, opened.handle, fileui, existingFileId)
      return await uploadBoxSessionFile(fileui.user_id, opened.handle, fileui, existingFileId)
    } finally {
      await opened.handle.close().catch(() => {})
    }
  }
}
