import {message} from '../../ports'
import {drive115Check,drive115Request,drive115DetailRequest} from '../../drive115FileTransport'
export type Drive115MkdirResult = { file_id:string;error:string }
const API_URL = 'https://proapi.115.com/open/folder/add'

export const apiDrive115Mkdir = async (user_id: string, parent_id: string, name: string): Promise<Drive115MkdirResult> => {
  const result: Drive115MkdirResult = { file_id: '', error: '新建文件夹失败' }
  drive115Check(user_id)
  const body = new URLSearchParams()
  body.set('pid', parent_id)
  body.set('file_name', name)
  try {
    const resp = await drive115Request(user_id, API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body
    })
    if (!resp.ok) return result
    const data = await resp.json()
    if (data?.code === 0 && data?.data?.file_id) {
      return { file_id: String(data.data.file_id), error: '' }
    }
    if (data?.message) result.error = data.message
  } catch (err: any) {
    message.error('新建文件夹 失败 ' + (err?.message || ''))
  }
  return result
}

const DETAIL_URL = 'https://proapi.115.com/open/folder/get_info'

export type Drive115DetailResult = {
  file_id: string
  name: string
  size: number
  folder_count: number
  file_count: number
  isDir: boolean
  created_at: string
  updated_at: string
  pick_code: string
  sha1: string
  play_long: number
  path: { file_id: string; file_name: string }[]
}

export type Drive115DetailApiResult = {
  detail: Drive115DetailResult | null
  error: string
}

const toIsoTime = (value?: string | number) => {
  if (!value && value !== 0) return ''
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return ''
  const ms = num < 1000000000000 ? num * 1000 : num
  return new Date(ms).toISOString()
}

export const apiDrive115FileDetailResult = async (user_id: string, file_id: string): Promise<Drive115DetailApiResult> => {
  drive115Check(user_id)
  const params = new URLSearchParams({ file_id })
  const url = `${DETAIL_URL}?${params.toString()}`
  try {
    const resp = await drive115DetailRequest(user_id, url)
    if (!resp.ok) return { detail: null, error: '获取文件详情失败' }
    const data = await resp.json()
    if (data?.code !== 0 || !data?.data) {
      return { detail: null, error: data?.message || '获取文件详情失败' }
    }
    const info = data.data
    return {
      detail: {
        file_id: String(info.file_id || file_id),
        name: info.file_name || '',
        size: Number(info.size_byte || 0),
        folder_count: Number(info.folder_count || 0),
        file_count: Number(info.count || 0),
        isDir: String(info.file_category) !== '1',
        created_at: toIsoTime(info.ptime),
        updated_at: toIsoTime(info.utime),
        pick_code: info.pick_code || '',
        sha1: info.sha1 || '',
        play_long: Number(info.play_long || 0),
        path: Array.isArray(info.paths)
          ? info.paths.map((p: any) => ({
            file_id: String(p.file_id || ''),
            file_name: String(p.file_name || '')
          }))
          : []
      },
      error: ''
    }
  } catch (err: any) {
    // Native caller reports this failure after checking its lifecycle.
    return { detail: null, error: '获取文件详情失败' }
  }
}

export const apiDrive115FileDetail = async (user_id: string, file_id: string): Promise<Drive115DetailResult | null> => {
  const result = await apiDrive115FileDetailResult(user_id, file_id)
  return result.detail
}
