import crypto from 'crypto'
import path from 'path'
import { FileHandle } from 'fs/promises'
import { OpenFileHandle } from '../utils/filehelper'
import { IUploadingUI } from '../utils/dbupload'
import AliUploadDisk from '../aliapi/uploaddisk'
import { Sleep } from '../utils/format'
import { formatOssMultipartETag } from '../utils/oss'
import { apiGuangyaCheckFlashUpload, apiGuangyaUploadBuffer, apiGuangyaUploadInfo, apiGuangyaUploadToken, GuangyaUploadTokenData } from './upload'

const SMALL_FILE_SIZE = 1024 * 1024
const OSS_PART_SIZE = 5 * 1024 * 1024

const shouldRetryFileOpen = (error: string) => error.includes('同时打开文件过多') || error.includes('文件被其他程序占用') || error.includes('操作超时') || error.includes('IO错误')

const openFileHandleWithRetry = async (filePath: string) => {
  let lastError = ''
  for (let i = 0; i < 5; i++) {
    const fh = await OpenFileHandle(filePath)
    if (!fh.error && fh.handle) return fh
    lastError = fh.error || '打开文件失败'
    if (!shouldRetryFileOpen(lastError) || i === 4) return { handle: undefined, error: lastError }
    await Sleep(400 * (i + 1))
  }
  return { handle: undefined, error: lastError || '打开文件失败' }
}

const readAll = async (filePath: string, size: number): Promise<{ buff?: Buffer; error: string }> => {
  const fh = await openFileHandleWithRetry(filePath)
  if (fh.error || !fh.handle) return { error: fh.error || '打开文件失败' }
  try {
    const buff = Buffer.alloc(size)
    const read = await fh.handle.read(buff, 0, size, 0)
    return { buff: buff.subarray(0, read.bytesRead), error: '' }
  } catch (error: any) {
    return { error: error?.message || '读取文件失败' }
  } finally {
    await fh.handle.close().catch(() => {})
  }
}

const readSlice = async (fileHandle: FileHandle, start: number, size: number): Promise<Buffer> => {
  const buff = Buffer.alloc(size)
  const read = await fileHandle.read(buff, 0, size, start)
  return buff.subarray(0, read.bytesRead)
}

const getGcidChunkSize = (fileSize: number) => {
  if (fileSize <= 0x8000000) return 262144
  if (fileSize <= 0x10000000) return 524288
  if (fileSize <= 0x20000000) return 1048576
  return 2097152
}

const gcidFile = async (filePath: string, fileSize: number): Promise<{ gcid: string; error: string }> => {
  const fh = await openFileHandleWithRetry(filePath)
  if (fh.error || !fh.handle) return { gcid: '', error: fh.error || '打开文件失败' }
  try {
    const chunkSize = getGcidChunkSize(fileSize)
    const chunks: Buffer[] = []
    let pos = 0
    while (pos < fileSize) {
      const size = Math.min(chunkSize, fileSize - pos)
      const buff = await readSlice(fh.handle, pos, size)
      chunks.push(crypto.createHash('sha1').update(buff).digest())
      pos += buff.length
    }
    return { gcid: crypto.createHash('sha1').update(Buffer.concat(chunks)).digest('hex').toUpperCase(), error: '' }
  } catch (error: any) {
    return { gcid: '', error: error?.message || '计算 GCID 失败' }
  } finally {
    await fh.handle.close().catch(() => {})
  }
}

const getOssCredentials = (tokenData: GuangyaUploadTokenData) => {
  const creds = tokenData.creds || {}
  return {
    accessKeyID: creds.accessKeyID || creds.accessKeyId || '',
    secretAccessKey: creds.secretAccessKey || creds.accessKeySecret || '',
    sessionToken: creds.sessionToken || creds.securityToken || ''
  }
}

const normalizeEndpoint = (endpoint: string) => endpoint.startsWith('http') ? endpoint.replace(/\/$/, '') : `https://${endpoint.replace(/\/$/, '')}`
const ossDate = () => new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')

const signOss = (method: string, objectPath: string, query: string, date: string, contentType: string, contentMd5: string, tokenData: GuangyaUploadTokenData) => {
  const { accessKeyID, secretAccessKey, sessionToken } = getOssCredentials(tokenData)
  const bucketName = tokenData.bucketName || ''
  const ossHeaders = `x-oss-date:${date}\n${sessionToken ? `x-oss-security-token:${sessionToken.trim()}\n` : ''}`
  const resource = `/${bucketName}/${objectPath}${query ? `?${query}` : ''}`
  const canonical = `${method}\n${contentMd5}\n${contentType}\n${date}\n${ossHeaders}${resource}`
  const signature = crypto.createHmac('sha1', secretAccessKey).update(canonical).digest('base64')
  return `OSS ${accessKeyID}:${signature}`
}

const ossFetch = async (method: string, tokenData: GuangyaUploadTokenData, query: string, contentType: string, body?: BodyInit, contentMd5 = '') => {
  const endpoint = normalizeEndpoint(tokenData.fullEndPoint || '')
  const objectPath = tokenData.objectPath || ''
  const date = ossDate()
  const url = `${endpoint}/${objectPath}${query ? `?${query}` : ''}`
  const { sessionToken } = getOssCredentials(tokenData)
  const headers: Record<string, string> = {
    'x-oss-date': date,
    Authorization: signOss(method, objectPath, query, date, contentType, contentMd5, tokenData)
  }
  if (contentType) headers['Content-Type'] = contentType
  if (contentMd5) headers['Content-MD5'] = contentMd5
  if (sessionToken) headers['x-oss-security-token'] = sessionToken
  return fetch(url, { method, headers, body })
}

const parseUploadId = (xml: string) => xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1] || ''
const parseETag = (xml: string) => xml.match(/<ETag>([^<]+)<\/ETag>/)?.[1]?.replace(/"/g, '') || ''

const ossMultipartUpload = async (fileui: IUploadingUI, filePath: string, tokenData: GuangyaUploadTokenData): Promise<string> => {
  if (!tokenData.fullEndPoint || !tokenData.bucketName || !tokenData.objectPath) return '光鸭云盘上传凭证不完整'
  const initResp = await ossFetch('POST', tokenData, 'uploads', 'application/octet-stream')
  const initXml = await initResp.text().catch(() => '')
  if (!initResp.ok) return '初始化光鸭云盘分片上传失败'
  const uploadId = parseUploadId(initXml)
  if (!uploadId) return '光鸭云盘未返回分片上传 ID'

  const fh = await openFileHandleWithRetry(filePath)
  if (fh.error || !fh.handle) return fh.error || '打开文件失败'
  const parts: Array<{ partNumber: number; eTag: string }> = []
  try {
    let offset = 0
    let partNumber = 1
    while (offset < fileui.File.size) {
      if (!fileui.IsRunning) return '已暂停'
      const size = Math.min(OSS_PART_SIZE, fileui.File.size - offset)
      const buff = await readSlice(fh.handle, offset, size)
      const contentMd5 = crypto.createHash('md5').update(buff).digest('base64')
      let partResp: Response | undefined
      for (let i = 0; i < 3; i++) {
        partResp = await ossFetch('PUT', tokenData, `partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`, 'application/octet-stream', buff as any, contentMd5)
        if (partResp.ok) break
        await Sleep(800)
      }
      if (!partResp?.ok) return '光鸭云盘分片上传失败'
      const eTag = (partResp.headers.get('etag') || parseETag(await partResp.text().catch(() => ''))).replace(/"/g, '')
      parts.push({ partNumber, eTag })
      offset += buff.length
      AliUploadDisk.RecordUploadProgress(fileui.UploadID, buff.length, offset)
      partNumber += 1
    }
  } finally {
    await fh.handle.close().catch(() => {})
  }

  const completeXml = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${parts.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${formatOssMultipartETag(part.eTag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
  const completeBody = Buffer.from(completeXml)
  const completeMd5 = crypto.createHash('md5').update(completeBody).digest('base64')
  const completeResp = await ossFetch('POST', tokenData, `uploadId=${encodeURIComponent(uploadId)}`, 'application/xml', completeBody, completeMd5)
  if (!completeResp.ok) return '光鸭云盘分片合并失败'
  return ''
}

export default class GuangyaUploadDisk {
  static async UploadOneFile(fileui: IUploadingUI): Promise<string> {
    const filePath = path.join(fileui.localFilePath, fileui.File.partPath)
    fileui.Info.uploadState = 'hashing'

    if (fileui.File.size < SMALL_FILE_SIZE) {
      const { buff, error } = await readAll(filePath, fileui.File.size)
      if (!buff) return error || '读取文件失败'
      fileui.Info.uploadState = 'running'
      const result = await apiGuangyaUploadBuffer(fileui.user_id, fileui.parent_file_id, fileui.File.name, buff)
      if (!result.file_id) return result.error || '光鸭云盘上传失败'
      fileui.File.uploaded_file_id = result.file_id
      fileui.File.uploaded_is_rapid = false
      AliUploadDisk.RecordUploadProgress(fileui.UploadID, fileui.File.size, fileui.File.size)
      return 'success'
    }

    const { gcid, error } = await gcidFile(filePath, fileui.File.size)
    fileui.Info.uploadState = 'running'
    if (!gcid) return error || '计算 GCID 失败'

    const tokenResp = await apiGuangyaUploadToken(fileui.user_id, fileui.File.name, fileui.File.size, fileui.parent_file_id)
    if (!tokenResp.data) return tokenResp.error
    const flashResp = await apiGuangyaCheckFlashUpload(fileui.user_id, tokenResp.data.taskId, gcid)
    if (flashResp.canFlashUpload) {
      const info = await apiGuangyaUploadInfo(fileui.user_id, tokenResp.data.taskId)
      if (info.fileId) {
        fileui.File.uploaded_file_id = info.fileId
        fileui.File.uploaded_is_rapid = true
        AliUploadDisk.RecordUploadProgress(fileui.UploadID, fileui.File.size, fileui.File.size)
        return 'success'
      }
      return info.error || '光鸭云盘秒传失败'
    }

    const ossError = await ossMultipartUpload(fileui, filePath, tokenResp.data)
    if (ossError) return ossError
    for (let i = 0; i < 3; i++) {
      const info = await apiGuangyaUploadInfo(fileui.user_id, tokenResp.data.taskId)
      if (info.fileId) {
        fileui.File.uploaded_file_id = info.fileId
        fileui.File.uploaded_is_rapid = false
        return 'success'
      }
      if (!info.uploading && info.error) return info.error
      await Sleep(2000)
    }
    return '光鸭云盘上传完成确认超时'
  }
}
