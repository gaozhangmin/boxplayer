import crypto from 'crypto'
import path from 'path'
import { FileHandle } from 'fs/promises'
import message from '../utils/message'
import { getDrive115Token } from './auth'
import { normalizeDrive115OssCallback, normalizeDrive115UploadTokens, type Drive115OssCallback, type Drive115UploadTokenItem, type Drive115UploadTokenResp } from './uploadtoken'

export { normalizeDrive115OssCallback, normalizeDrive115UploadTokens, type Drive115OssCallback, type Drive115UploadTokenItem, type Drive115UploadTokenResp } from './uploadtoken'

const API_BASE = 'https://proapi.115.com'

export type Drive115UploadInitData = {
  pick_code?: string
  status?: number
  sign_key?: string
  sign_check?: string
  file_id?: string
  target?: string
  bucket?: string
  object?: string
  callback?: string | Drive115OssCallback | Drive115OssCallback[]
  callback_var?: string
}

export type Drive115UploadInitResp = {
  state: boolean
  code?: number
  errno?: number
  message?: string
  error?: string
  msg?: string
  data?: Drive115UploadInitData
}

export const getDrive115UploadInitError = (resp: Drive115UploadInitResp | null | undefined) => {
  const code = Number(resp?.code || resp?.errno || 0)
  const providerMessage = String(resp?.message || resp?.msg || resp?.error || '').trim()
  const message = providerMessage || '115 未返回初始化详情'
  return { code, message }
}

const getResponseError = async (resp: Response): Promise<Drive115UploadInitResp> => {
  const text = await resp.text().catch(() => '')
  let payload: any
  try { payload = text ? JSON.parse(text) : undefined } catch {}
  return {
    state: false,
    code: Number(payload?.code || payload?.errno || resp.status || 0),
    errno: Number(payload?.errno || 0) || undefined,
    message: String(payload?.message || payload?.msg || payload?.error || text || `HTTP ${resp.status}`).slice(0, 300),
    error: String(payload?.error || '')
  }
}

const reportUploadInitResponse = (endpoint: string, target: string, status: number, payload: unknown) => {
  const entry = { endpoint, target, status, response: payload }
  console.error('[115 upload] API error', entry)
  try {
    window.Electron?.ipcRenderer?.send('115-upload-error', entry)
  } catch {}
}

const lastUploadTokenNotice = new Map<string, number>()
const notifyUploadTokenFailure = (text: string) => {
  const notice = text || '获取 115 上传凭据失败'
  const now = Date.now()
  if (now - (lastUploadTokenNotice.get(notice) || 0) < 10_000) return
  lastUploadTokenNotice.set(notice, now)
  message.error(notice)
}

const buildFormData = (fields: Record<string, string>) => {
  const boundary = '----xby115' + Date.now().toString(16) + Math.random().toString(16).slice(2)
  const chunks: Buffer[] = []
  const pushField = (name: string, value: string) => {
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`))
    chunks.push(Buffer.from(`${value}\r\n`))
  }
  Object.keys(fields).forEach((key) => {
    const val = fields[key]
    if (val !== undefined && val !== null && val !== '') pushField(key, String(val))
  })
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), boundary }
}

const sha1Buffer = (buff: Buffer) => crypto.createHash('sha1').update(buff).digest('hex')

export const computeSha1 = async (fileHandle: FileHandle, size: number) => {
  const hash = crypto.createHash('sha1')
  const buff = Buffer.alloc(1024 * 1024)
  let offset = 0
  while (offset < size) {
    const read = await fileHandle.read(buff, 0, buff.length, offset)
    if (!read.bytesRead) break
    hash.update(buff.subarray(0, read.bytesRead))
    offset += read.bytesRead
  }
  return hash.digest('hex')
}

export const computePreSha1 = async (fileHandle: FileHandle, size: number) => {
  const len = Math.min(128 * 1024, size)
  if (len <= 0) return sha1Buffer(Buffer.alloc(0))
  const buff = Buffer.alloc(len)
  const read = await fileHandle.read(buff, 0, len, 0)
  return sha1Buffer(buff.subarray(0, read.bytesRead))
}

export const computeRangeSha1 = async (fileHandle: FileHandle, start: number, end: number) => {
  const size = end - start + 1
  const buff = Buffer.alloc(size)
  const read = await fileHandle.read(buff, 0, size, start)
  return sha1Buffer(buff.subarray(0, read.bytesRead))
}

export const build115Target = (parentId: string | number) => {
  const id = parentId === undefined || parentId === null || parentId === '' || parentId === 'drive115_root'
    ? '0'
    : String(parentId)
  // 115 directory IDs can exceed Number.MAX_SAFE_INTEGER. Keep them as strings
  // or Number conversion will silently change the ID sent to /open/upload/init.
  return `U_1_${id}`
}

export const apiDrive115GetUploadToken = async (user_id: string, target = ''): Promise<Drive115UploadTokenItem[] | null> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) {
    message.error('未登录 115 网盘')
    return null
  }
  const url = `${API_BASE}/open/upload/get_token`
  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token.access_token}`
      }
    })
    if (!resp.ok) {
      const errorMessage = `获取 115 上传凭据失败（HTTP ${resp.status}）`
      notifyUploadTokenFailure(errorMessage)
      reportUploadInitResponse('/open/upload/get_token', target, resp.status, { error: errorMessage })
      return null
    }
    const data = (await resp.json()) as Drive115UploadTokenResp
    const tokens = normalizeDrive115UploadTokens(data?.data)
    if (!data?.state || Number(data?.code) !== 0 || tokens.length === 0) {
      notifyUploadTokenFailure(data?.message || '获取 115 上传凭据失败')
      // Never print the raw response here: it contains temporary OSS credentials.
      const safeResponse = {
        state: data?.state,
        code: data?.code,
        message: data?.message,
        dataType: Array.isArray(data?.data) ? 'array' : typeof data?.data,
        tokenCount: tokens.length,
        credentialFieldsPresent: tokens.map(item => ({
          endpoint: !!item.endpoint,
          AccessKeyId: !!item.AccessKeyId,
          AccessKeySecret: !!item.AccessKeySecret,
          SecurityToken: !!item.SecurityToken
        }))
      }
      reportUploadInitResponse('/open/upload/get_token', target, resp.status, safeResponse)
      return null
    }
    return tokens
  } catch (error: any) {
    const errorMessage = error?.message || '请求 115 上传凭据接口失败'
    notifyUploadTokenFailure(errorMessage)
    reportUploadInitResponse('/open/upload/get_token', target, 0, { error: errorMessage })
    return null
  }
}

export const apiDrive115UploadInit = async (
  user_id: string,
  fileName: string,
  fileSize: number,
  target: string,
  fileSha1: string,
  preSha1: string,
  pickCode: string = '',
  topupload: string = '0',
  signKey: string = '',
  signVal: string = ''
): Promise<Drive115UploadInitResp | null> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) {
    message.error('未登录 115 网盘')
    return null
  }
  const url = `${API_BASE}/open/upload/init`
  const fields: Record<string, string> = {
    file_name: path.basename(fileName),
    file_size: String(fileSize),
    target,
    fileid: fileSha1
  }
  if (preSha1) fields.preid = preSha1
  if (pickCode) fields.pick_code = pickCode
  if (topupload !== '') fields.topupload = topupload
  if (signKey) fields.sign_key = signKey
  if (signVal) fields.sign_val = signVal
  const { body, boundary } = buildFormData(fields)
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    })
  } catch (error: any) {
    const failure = { state: false, code: 0, message: error?.message || '请求 115 上传初始化接口失败' }
    reportUploadInitResponse('/open/upload/init', target, 0, failure)
    return failure
  }
  if (!resp.ok) {
    const error = await getResponseError(resp)
    reportUploadInitResponse('/open/upload/init', target, resp.status, error)
    return error
  }
  try {
    const payload = (await resp.json()) as Drive115UploadInitResp
    if (payload?.state === false || payload?.code !== undefined && payload.code !== 0 || payload?.errno) {
      reportUploadInitResponse('/open/upload/init', target, resp.status, payload)
    }
    if (payload && (payload.state === false || payload.code !== undefined && payload.code !== 0 || payload.errno)) {
      return { ...payload, code: Number(payload.code || payload.errno || 0), errno: Number(payload.errno || 0) || undefined }
    }
    return payload
  } catch (error: any) {
    const failure = { state: false, code: resp.status, message: error?.message || '115 上传初始化响应不是有效 JSON' }
    reportUploadInitResponse('/open/upload/init', target, resp.status, failure)
    return failure
  }
}

export const apiDrive115UploadResume = async (
  user_id: string,
  fileSize: number,
  target: string,
  fileSha1: string,
  pickCode: string
): Promise<Drive115UploadInitResp | null> => {
  const token = await getDrive115Token(user_id)
  if (!token?.access_token) {
    message.error('未登录 115 网盘')
    return null
  }
  const url = `${API_BASE}/open/upload/resume`
  const fields: Record<string, string> = {
    file_size: String(fileSize),
    target,
    fileid: fileSha1,
    pick_code: pickCode
  }
  const { body, boundary } = buildFormData(fields)
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    })
  } catch (error: any) {
    const failure = { state: false, code: 0, message: error?.message || '请求 115 上传续传接口失败' }
    reportUploadInitResponse('/open/upload/resume', target, 0, failure)
    return failure
  }
  if (!resp.ok) {
    const error = await getResponseError(resp)
    reportUploadInitResponse('/open/upload/resume', target, resp.status, error)
    return error
  }
  try {
    const payload = (await resp.json()) as Drive115UploadInitResp
    if (payload?.state === false || payload?.code !== undefined && payload.code !== 0 || payload?.errno) {
      reportUploadInitResponse('/open/upload/resume', target, resp.status, payload)
    }
    if (payload && (payload.state === false || payload.code !== undefined && payload.code !== 0 || payload.errno)) {
      return { ...payload, code: Number(payload.code || payload.errno || 0), errno: Number(payload.errno || 0) || undefined }
    }
    return payload
  } catch (error: any) {
    const failure = { state: false, code: resp.status, message: error?.message || '115 上传续传响应不是有效 JSON' }
    reportUploadInitResponse('/open/upload/resume', target, resp.status, failure)
    return failure
  }
}
