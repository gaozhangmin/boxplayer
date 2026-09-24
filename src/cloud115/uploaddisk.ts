import path from 'path'
import { OpenFileHandle } from '../utils/filehelper'
import DBUpload, { IUploadingUI } from '../utils/dbupload'
import AliUploadDisk from '../aliapi/uploaddisk'
import { Sleep } from '../utils/format'
import {
  apiDrive115GetUploadToken,
  apiDrive115UploadInit,
  apiDrive115UploadResume,
  build115Target,
  getDrive115UploadInitError,
  computePreSha1,
  computeRangeSha1,
  computeSha1,
  normalizeDrive115OssCallback
} from './upload'
import { apiDrive115FileList } from './dirfilelist'
import { apiDrive115TrashBatch } from './trash'
import { ossCompleteMultipart, ossInitiateMultipart, ossUploadPart, parseOssCallbackResult, parseOssError } from './oss'

const PART_SIZE = 8 * 1024 * 1024

const clearOssResumeState = (fileui: IUploadingUI) => {
  fileui.Info.drive115_oss_upload_id = ''
  fileui.Info.drive115_oss_bucket = ''
  fileui.Info.drive115_oss_object = ''
  fileui.Info.drive115_oss_parts = []
}

const parseSignCheck = (signCheck: string) => {
  const seg = signCheck.split('-')
  if (seg.length !== 2) return null
  const start = Number(seg[0])
  const end = Number(seg[1])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return { start, end }
}

const findConflictName = async (user_id: string, parentId: string | number, name: string) => {
  const targetId = parentId === '' || parentId === undefined || parentId === null || parentId === 'drive115_root' ? 0 : parentId
  const limit = 200
  let offset = 0
  while (offset < 2000) {
    const list = await apiDrive115FileList(user_id, targetId, limit, offset, true)
    if (!list.length) break
    const hit = list.find((item) => item.fn === name)
    if (hit) return { conflict: true, file_id: String(hit.fid) }
    if (list.length < limit) break
    offset += limit
  }
  return { conflict: false, file_id: '' }
}

const ensureUploadName = async (user_id: string, parentId: string | number, originName: string, mode: string) => {
  const conflict = await findConflictName(user_id, parentId, originName)
  if (!conflict.conflict) return { name: originName, error: '' }

  if (mode === 'refuse') {
    return { name: originName, error: '同名文件已存在' }
  }

  if (mode === 'overwrite' || mode === 'ignore') {
    if (conflict.file_id) {
      await apiDrive115TrashBatch(user_id, [conflict.file_id], String(parentId || 0))
    }
    return { name: originName, error: '' }
  }

  if (mode === 'auto_rename') {
    const extIndex = originName.lastIndexOf('.')
    const base = extIndex > 0 ? originName.slice(0, extIndex) : originName
    const ext = extIndex > 0 ? originName.slice(extIndex) : ''
    let index = 1
    while (index < 1000) {
      const candidate = `${base} (${index})${ext}`
      const candidateConflict = await findConflictName(user_id, parentId, candidate)
      if (!candidateConflict.conflict) return { name: candidate, error: '' }
      index += 1
    }
    return { name: originName, error: '自动重命名失败' }
  }

  return { name: originName, error: '' }
}

export default class Drive115UploadDisk {
  static async UploadOneFile(fileui: IUploadingUI): Promise<string> {
    const filePath = path.join(fileui.localFilePath, fileui.File.partPath)
    const handle = await OpenFileHandle(filePath)
    if (handle.error || !handle.handle) return handle.error || '打开文件失败'

    fileui.Info.uploadState = 'hashing'
    const fileSha1 = await computeSha1(handle.handle, fileui.File.size)
    const preSha1 = await computePreSha1(handle.handle, fileui.File.size)
    fileui.Info.uploadState = 'running'
    await handle.handle.close()

    if (!fileSha1) return '计算 sha1 失败'

    const rename = await ensureUploadName(fileui.user_id, fileui.parent_file_id || 0, fileui.File.name, fileui.check_name_mode)
    if (rename.error) return rename.error
    const target = build115Target(fileui.parent_file_id || 0)
    const shouldResumeUpload = !!fileui.Info.up_upload_id
    let initResp = null
    if (shouldResumeUpload) {
      initResp = await apiDrive115UploadResume(fileui.user_id, fileui.File.size, target, fileSha1, fileui.Info.up_upload_id)
    }
    if (!initResp?.data || initResp.state === false) {
      initResp = await apiDrive115UploadInit(
        fileui.user_id,
        rename.name,
        fileui.File.size,
        target,
        fileSha1,
        preSha1
      )
    }
    if (!initResp?.data || initResp.state === false) {
      const { code: errorCode, message: errorMessage } = getDrive115UploadInitError(initResp)
      const detail = errorMessage ? `: ${errorMessage}` : ''
      const code = errorCode ? ` (${errorCode})` : ''
      return `115 上传初始化失败 [POST /open/upload/init target=${target}]${code}${detail}`
    }

    if (initResp.data.sign_key && initResp.data.sign_check) {
      const range = parseSignCheck(initResp.data.sign_check)
      if (!range) return '签名验证失败'
      const rangeHandle = await OpenFileHandle(filePath)
      if (rangeHandle.error || !rangeHandle.handle) return rangeHandle.error || '打开文件失败'
      const rangeSha1 = await computeRangeSha1(rangeHandle.handle, range.start, range.end)
      await rangeHandle.handle.close()
      const signVal = rangeSha1.toUpperCase()
      initResp = await apiDrive115UploadInit(
        fileui.user_id,
        rename.name,
        fileui.File.size,
        target,
        fileSha1,
        preSha1,
        '',
        '0',
        initResp.data.sign_key,
        signVal
      )
      if (!initResp?.data || initResp.state === false) {
        const { code: errorCode, message: errorMessage } = getDrive115UploadInitError(initResp)
        const detail = errorMessage ? `: ${errorMessage}` : ''
        const code = errorCode ? ` (${errorCode})` : ''
        return `115 上传认证失败 [POST /open/upload/init target=${target}]${code}${detail}`
      }
    }

    const data = initResp.data
    const callback = normalizeDrive115OssCallback(data.callback, data.callback_var)
    if (data.status === 2) {
      if (!data.file_id) return '115 网盘秒传成功但未返回文件 ID'
      fileui.File.uploaded_file_id = data.file_id
      fileui.File.uploaded_is_rapid = true
      clearOssResumeState(fileui)
      return 'success'
    }
    if (data.status !== 1) return `上传初始化失败(${data.status || 0})`

    if (!data.pick_code) return '上传初始化失败'
    fileui.Info.up_upload_id = data.pick_code

    const tokenList = await apiDrive115GetUploadToken(fileui.user_id, target)
    if (!tokenList || tokenList.length === 0) return '获取上传凭证失败'
    const token = tokenList[0]
    if (!token.endpoint || !token.AccessKeyId || !token.AccessKeySecret || !token.SecurityToken) {
      return '上传凭证信息不完整'
    }
    if (!data.bucket || !data.object) return '上传初始化信息不完整'

    const cred = {
      endpoint: token.endpoint,
      accessKeyId: token.AccessKeyId,
      accessKeySecret: token.AccessKeySecret,
      securityToken: token.SecurityToken
    }
    const canResumeOss = shouldResumeUpload && fileui.Info.drive115_oss_upload_id && fileui.Info.drive115_oss_bucket === data.bucket && fileui.Info.drive115_oss_object === data.object
    if (!canResumeOss) clearOssResumeState(fileui)
    if (!fileui.Info.drive115_oss_upload_id) {
      const init = await ossInitiateMultipart(cred, data.bucket, data.object)
      if (init.status !== 200) {
        const detail = parseOssError(init.body)
        return detail ? `OSS 初始化失败(${init.status}): ${detail}` : `OSS 初始化失败(${init.status})`
      }

      const uploadIdMatch = init.body.match(/<UploadId>(.+)<\/UploadId>/i)
      if (!uploadIdMatch) return 'OSS 初始化失败'
      fileui.Info.drive115_oss_upload_id = uploadIdMatch[1]
      fileui.Info.drive115_oss_bucket = data.bucket
      fileui.Info.drive115_oss_object = data.object
      fileui.Info.drive115_oss_parts = []
      await DBUpload.saveUploadInfo(fileui.Info)
    }
    const uploadId = fileui.Info.drive115_oss_upload_id
    const completedParts = new Map((fileui.Info.drive115_oss_parts || []).map((part) => [part.partNumber, part.etag]))
    const partHandle = await OpenFileHandle(filePath)
    if (partHandle.error || !partHandle.handle) return partHandle.error || '打开文件失败'
    let offset = 0
    let partNumber = 1
    while (offset < fileui.File.size) {
      if (!fileui.IsRunning) {
        await partHandle.handle.close()
        return '已暂停'
      }
      const size = Math.min(PART_SIZE, fileui.File.size - offset)
      if (completedParts.has(partNumber)) {
        offset += size
        AliUploadDisk.RecordUploadProgress(fileui.UploadID, size, offset)
        partNumber += 1
        continue
      }
      const buff = Buffer.alloc(size)
      const read = await partHandle.handle.read(buff, 0, size, offset)
      const body = buff.subarray(0, read.bytesRead)
      let ok = false
      let etag = ''
      for (let i = 0; i < 3; i++) {
        const resp = await ossUploadPart(
          cred,
          data.bucket,
          data.object,
          uploadId,
          partNumber,
          body
        )
        if (resp.status === 200 && resp.etag) {
          ok = true
          etag = resp.etag.replace(/\"/g, '')
          break
        }
        await Sleep(800)
      }
      if (!ok) {
        await partHandle.handle.close()
        return '分片上传失败'
      }
      completedParts.set(partNumber, etag)
      fileui.Info.drive115_oss_parts = Array.from(completedParts, ([partNumber, etag]) => ({ partNumber, etag }))
      await DBUpload.saveUploadInfo(fileui.Info)
      offset += size
      AliUploadDisk.RecordUploadProgress(fileui.UploadID, size, offset)
      partNumber += 1
    }
    await partHandle.handle.close()

    const complete = await ossCompleteMultipart(
      cred,
      data.bucket,
      data.object,
      uploadId,
      Array.from(completedParts, ([partNumber, etag]) => ({ partNumber, etag })),
      callback
    )
    if (complete.status !== 200) {
      const detail = parseOssError(complete.body)
      return detail ? `OSS 合并失败(${complete.status}): ${detail}` : `OSS 合并失败(${complete.status})`
    }
    const callbackResult = parseOssCallbackResult(complete.body)
    if (callbackResult.error) return callbackResult.error

    const fileId = callbackResult.fileId || data.file_id || ''
    if (!fileId) return '115 网盘上传完成但未返回文件 ID'
    fileui.File.uploaded_file_id = fileId
    fileui.File.uploaded_is_rapid = false
    clearOssResumeState(fileui)
    return 'success'
  }
}
