import crypto from 'crypto'
import type { IUploadingUI } from '../utils/dbupload'
import { cloud139Request, cloud139ApiParentId } from './dirfilelist'
import { openUploadSource, putUploadPart } from '../drive/uploadSource'

// Protocol reference: OpenListTeam/OpenList drivers/139, personal-cloud multipart API.
export default class Cloud139UploadDisk {
  static async UploadOneFile(file: IUploadingUI): Promise<string> {
    const source = await openUploadSource(file)
    try {
      file.Info.uploadState = 'hashing'
      const size = file.File.size
      const partSize = 16 * 1024 * 1024
      const hash = crypto.createHash('sha256')
      for (let offset = 0; offset < size; offset += partSize) hash.update(await source.read(offset, Math.min(partSize, size - offset)))
      const contentHash = hash.digest('hex')
      const parts = Array.from({ length: Math.max(1, Math.ceil(size / partSize)) }, (_, i) => ({ partNumber: i + 1, partSize: Math.min(partSize, size - i * partSize), parallelHashCtx: { partOffset: i * partSize } }))
      source.check()
      file.Info.uploadState = 'running'
      const response = await cloud139Request(file.user_id, '/file/create', {
        contentHash, contentHashAlgorithm: 'SHA256', contentType: 'application/octet-stream', parallelUpload: false,
        partInfos: parts.slice(0, 100), size, parentFileId: cloud139ApiParentId(file.parent_file_id), name: file.File.name, type: 'file', fileRenameMode: 'auto_rename'
      })
      const task = response?.data
      if (!task?.fileId) throw new Error('139 云盘未返回上传文件 ID')
      if (!task.exist && (!task.rapidUpload || task.partInfos?.length)) {
        if (!task.uploadId) throw new Error('139 云盘未返回上传任务 ID')
        for (let start = 0; start < parts.length; start += 100) {
          source.check()
          const batch = parts.slice(start, start + 100)
          const urls = start === 0 ? task.partInfos : (await cloud139Request(file.user_id, '/file/getUploadUrl', { fileId: task.fileId, uploadId: task.uploadId, partInfos: batch }))?.data?.partInfos
          if (!Array.isArray(urls)) throw new Error('139 云盘未返回分片地址')
          for (const part of batch) {
            const url = urls.find(item => Number(item.partNumber) === part.partNumber)?.uploadUrl
            if (!url) throw new Error(`139 云盘缺少分片 ${part.partNumber} 地址`)
            const body = await source.read(part.parallelHashCtx.partOffset, part.partSize)
            await putUploadPart(file, url, body, { 'Content-Type': 'application/octet-stream', Origin: 'https://yun.139.com', Referer: 'https://yun.139.com/' })
            source.progress(body.length, part.parallelHashCtx.partOffset + body.length)
          }
        }
        source.check()
        await cloud139Request(file.user_id, '/file/complete', { contentHash, contentHashAlgorithm: 'SHA256', fileId: task.fileId, uploadId: task.uploadId })
      }
      file.File.uploaded_file_id = String(task.fileId)
      file.File.uploaded_is_rapid = !!(task.exist || task.rapidUpload)
      return 'success'
    } finally { await source.close() }
  }
}
