import crypto from 'crypto'
import type { IUploadingUI } from '../utils/dbupload'
import { getProviderTokenForUser } from '../drive/account'
import { cloud189ClientSuffix, cloud189SignatureHeaders } from './auth'
import { openUploadSource, putUploadPart, uploadHash } from '../drive/uploadSource'

// Protocol reference: OpenListTeam/OpenList drivers/189pc multipart personal upload.
export default class Cloud189UploadDisk {
  static async UploadOneFile(file: IUploadingUI): Promise<string> {
    const token = await getProviderTokenForUser(file.user_id, '189')
    const key = token?.open_api_access_token
    const secret = token?.open_api_refresh_token
    if (!key || !secret || secret.length < 16) throw new Error('天翼云盘登录态无效，请重新登录')
    const request = async (action: string, values: Record<string, string>) => {
      if (!file.IsRunning) throw new Error('已暂停')
      const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(secret.slice(0, 16)), null)
      const plain = Object.keys(values).sort().map(key => `${key}=${values[key]}`).join('&')
      const params = Buffer.concat([cipher.update(plain), cipher.final()]).toString('hex').toUpperCase()
      const url = `https://upload.cloud.189.cn/person/${action}`
      const response = await fetch(`${url}?${new URLSearchParams({ ...cloud189ClientSuffix(), params })}`, { headers: { Accept: 'application/json', ...cloud189SignatureHeaders(key, secret, 'GET', url, params) }, signal: AbortSignal.timeout(120000) })
      const data = await response.json()
      if (!response.ok || (data.code && data.code !== 'SUCCESS') || data.errorCode || Number(data.res_code || 0)) throw new Error(data.message || data.res_message || data.errorCode || `天翼上传请求失败 HTTP ${response.status}`)
      return data.data || data
    }
    const source = await openUploadSource(file)
    try {
      file.Info.uploadState = 'hashing'
      const size = file.File.size
      const unit = 10 * 1024 * 1024
      const partSize = size > unit * 2 * 999 ? Math.max(5, Math.ceil(size / 1999 / unit)) * unit : size > unit * 999 ? unit * 2 : unit
      const hashes: string[] = []
      const whole = crypto.createHash('md5')
      for (let offset = 0; offset < Math.max(1, size); offset += partSize) {
        const body = await source.read(offset, Math.min(partSize, size - offset))
        whole.update(body)
        hashes.push(uploadHash(body, 'md5').toUpperCase())
      }
      const fileMd5 = whole.digest('hex').toUpperCase()
      const sliceMd5 = hashes.length === 1 ? fileMd5 : uploadHash(hashes.join('\n'), 'md5').toUpperCase()
      file.Info.uploadState = 'running'
      const task = await request('initMultiUpload', {
        parentFolderId: ['cloud189_root', '0', '/', ''].includes(file.parent_file_id) ? '-11' : file.parent_file_id,
        fileName: new URLSearchParams({ n: file.File.name }).toString().slice(2), fileSize: String(size), fileMd5, sliceSize: String(partSize), sliceMd5
      })
      if (!task.uploadFileId) throw new Error('天翼云盘未返回上传任务 ID')
      if (Number(task.fileDataExists) !== 1) {
        for (let i = 0; i < hashes.length; i++) {
          const urls = await request('getMultiUploadUrls', { uploadFileId: task.uploadFileId, partInfo: `${i + 1}-${Buffer.from(hashes[i], 'hex').toString('base64')}` })
          const target = urls[`partNumber_${i + 1}`]
          if (!target?.requestURL) throw new Error('天翼云盘未返回分片地址')
          const headers: Record<string, string> = {}
          for (const pair of String(target.requestHeader || '').split('&')) {
            const split = pair.indexOf('=')
            if (split > 0) headers[pair.slice(0, split)] = pair.slice(split + 1)
          }
          const body = await source.read(i * partSize, Math.min(partSize, size - i * partSize))
          await putUploadPart(file, target.requestURL, body, headers)
          source.progress(body.length, i * partSize + body.length)
        }
      }
      const result = await request('commitMultiUploadFile', { uploadFileId: task.uploadFileId, isLog: '0', opertype: '1' })
      const id = result.file?.userFileId || result.fileId || result.userFileId
      if (!id) throw new Error('天翼上传完成但未返回文件 ID')
      file.File.uploaded_file_id = String(id)
      file.File.uploaded_is_rapid = Number(task.fileDataExists) === 1
      return 'success'
    } finally { await source.close() }
  }
}
