import {toBoxId} from './boxMetadata'
import {boxUploadRequest} from '../../boxTextTransport'
type Buffer=Uint8Array
const BOX_UPLOAD_HOST = 'https://upload.box.com/api/2.0'

export const BOX_DIRECT_UPLOAD_LIMIT = 50 * 1024 * 1024

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

export const getBoxRetryAfterMs = (value: string | null, now = Date.now()) => {
  if (!value) return 1000
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(1000, date - now) : 1000
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
