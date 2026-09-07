import crypto from 'crypto'
import path from 'path'
import { OpenFileHandle } from '../utils/filehelper'
import type { IUploadingUI } from '../utils/dbupload'
import AliUploadDisk from '../aliapi/uploaddisk'

/** Random-access local source shared by the 139 and 189 multipart uploaders. */
export async function openUploadSource(file: IUploadingUI) {
  const opened = await OpenFileHandle(path.join(file.localFilePath, file.File.partPath))
  if (!opened.handle || opened.error) throw new Error(opened.error || '打开文件失败')
  const handle = opened.handle
  const check = () => { if (!file.IsRunning) throw new Error('已暂停') }
  return {
    check,
    close: () => handle.close(),
    async read(offset: number, length: number) {
      check()
      const buffer = Buffer.alloc(length)
      let done = 0
      while (done < length) {
        check()
        const { bytesRead } = await handle.read(buffer, done, length - done, offset + done)
        if (!bytesRead) throw new Error('文件长度发生变化，请重新上传')
        done += bytesRead
      }
      return buffer
    },
    progress(bytes: number, total: number) { AliUploadDisk.RecordUploadProgress(file.UploadID, bytes, total) }
  }
}

export const uploadHash = (data: Buffer | string, algorithm: string, encoding: 'hex' | 'base64' = 'hex') => crypto.createHash(algorithm).update(data).digest(encoding)

export async function putUploadPart(file: IUploadingUI, url: string, body: Buffer, headers: Record<string, string>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!file.IsRunning) throw new Error('已暂停')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000)
    const paused = setInterval(() => { if (!file.IsRunning) controller.abort() }, 200)
    try {
      const response = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body), signal: controller.signal })
      if (response.ok) { await response.arrayBuffer(); return }
      if (attempt === 2 || (response.status !== 429 && response.status < 500)) throw new Error(`分片上传失败 HTTP ${response.status}`)
      await response.body?.cancel()
    } catch (error) {
      if (!file.IsRunning || attempt === 2 || (error instanceof Error && error.message.startsWith('分片上传失败'))) throw error
    } finally {
      clearTimeout(timeout)
      clearInterval(paused)
    }
    await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
  }
}
