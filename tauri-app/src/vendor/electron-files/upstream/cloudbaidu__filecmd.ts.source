import message from '../utils/message'
import { getBaiduToken } from './auth'
import type { IAliFileItem } from '../aliapi/alimodels'

type BaiduPathItem = { file_id?: string; path?: string; description?: string }

const descriptionPath = (description = '') => /baidu_path:([^;]+)/.exec(description)?.[1] || ''

export const resolveBaiduPaths = (fileIds: string[], items: BaiduPathItem[]): string[] => fileIds.map((fileId) => {
  if (fileId.startsWith('/')) return fileId
  const item = items.find(value => value.file_id === fileId)
  return item?.path || descriptionPath(item?.description) || fileId
})

export const resolveBaiduTargetPath = (fileId: string, path: string, description: string, items: BaiduPathItem[], selectedDir?: BaiduPathItem): string => {
  if (path.startsWith('/')) return path
  if (!fileId || fileId === 'baidu_root') return '/'
  if (fileId.startsWith('/')) return fileId
  const item = items.find(value => value.file_id === fileId)
  if (item?.path) return item.path
  if (selectedDir?.file_id === fileId && selectedDir.path) return selectedDir.path
  return descriptionPath(description) || descriptionPath(item?.description) || descriptionPath(selectedDir?.description) || ''
}

export const resolveBaiduUploadParentPath = (fileId: string, description: string, items: BaiduPathItem[], selectedDir?: BaiduPathItem): string => {
  return resolveBaiduTargetPath(fileId, '', description, items, selectedDir)
}

export type BaiduFileMetaItem = {
  category?: number
  dlink?: string
  filename?: string
  fs_id: number
  isdir?: number
  server_ctime?: number
  server_mtime?: number
  local_ctime?: number
  local_mtime?: number
  size?: number
  md5?: string
  path?: string
  duration?: number  // 添加顶层 duration 字段
  thumbs?: {
    icon?: string
    url1?: string
    url2?: string
    url3?: string
    url4?: string  // 添加 url4 字段
  }
  width?: number
  height?: number
  date_taken?: number
  orientation?: string
  oper_id?: number  // 添加 oper_id 字段
  media_info?: {
    channels?: number
    duration?: number
    duration_ms?: number
    extra_info?: string
    file_size?: string
    frame_rate?: number
    height?: number
    width?: number
    meta_info?: string
    resolution?: string
    rotate?: number
    sample_rate?: number
    use_segment?: number
  }
}

type BaiduFileMetaResp = {
  errno: number
  list?: BaiduFileMetaItem[]
  info?: BaiduFileMetaItem[]
}

const API_URL = 'https://pan.baidu.com/rest/2.0/xpan/multimedia'

const mapCategory = (category?: number) => {
  switch (category) {
    case 1: return 'video'
    case 2: return 'audio'
    case 3: return 'image'
    case 4: return 'doc'
    case 5: return 'app'
    case 7: return 'bt'
    default: return 'other'
  }
}

export const apiBaiduFileMetas = async (
  user_id: string,
  fsids: number[],
  needDlink = 0,
  needThumb = 1,
  needExtra = 1,
  needMedia = 1,
  needDetail = 1
): Promise<BaiduFileMetaItem[] | null> => {
  const token = await getBaiduToken(user_id)
  if (!token?.access_token) {
    message.error('未登录百度网盘')
    return null
  }
  if (!fsids.length) return null
  const params = new URLSearchParams({
    method: 'filemetas',
    access_token: token.access_token,
    fsids: JSON.stringify(fsids),
    dlink: String(needDlink),
    thumb: String(needThumb),
    extra: String(needExtra),
    needmedia: String(needMedia),
    detail: String(needDetail)
  })
  const url = `${API_URL}?${params.toString()}`
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'pan.baidu.com'
    }
  })
  if (!resp.ok) return null
  const data = (await resp.json()) as BaiduFileMetaResp
  if (data?.errno !== 0) return null
  if (Array.isArray(data.list)) return data.list
  if (Array.isArray(data.info)) return data.info
  return null
}

export const mapBaiduMetaToAliFileItem = (item: BaiduFileMetaItem, drive_id: string, file_id: string): IAliFileItem => {
  const isDir = item.isdir === 1
  const name = item.filename || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const createdAt = item.server_ctime ? new Date(item.server_ctime * 1000).toISOString() : ''
  const updatedAt = item.server_mtime ? new Date(item.server_mtime * 1000).toISOString() : ''
  const thumbnail = item.thumbs?.url2 || item.thumbs?.url1 || item.thumbs?.url3 || item.thumbs?.url4 || item.thumbs?.icon || ''
  const category = mapCategory(item.category)
  const parentPath = item.path ? item.path.substring(0, item.path.lastIndexOf('/')) || '/' : ''

  // 优先使用 media_info 中的 duration，如果没有则使用顶层的 duration
  const duration = item.media_info?.duration || item.duration || 0

  return {
    drive_id,
    domain_id: '',
    description: item.fs_id ? `baidu_fsid:${item.fs_id}${item.path ? `;baidu_path:${item.path}` : ''}` : '',
    file_id: String(item.fs_id || file_id),
    name,
    type: isDir ? 'folder' : 'file',
    content_type: '',
    created_at: createdAt,
    updated_at: updatedAt,
    file_extension: ext,
    hidden: false,
    size: Number(item.size || 0),
    starred: false,
    status: '',
    upload_id: '',
    parent_file_id: parentPath,
    crc64_hash: '',
    content_hash: item.md5 || '',
    content_hash_name: 'md5',
    download_url: item.dlink || '',
    url: '',
    category,
    encrypt_mode: '',
    punish_flag: 0,
    thumbnail,
    mime_extension: ext,
    mime_type: '',
    play_cursor: '',
    duration: duration ? String(duration) : '',
    video_media_metadata: (item.media_info || duration || item.width || item.height)
      ? {
        duration: duration,
        height: item.media_info?.height || item.height,
        width: item.media_info?.width || item.width
      }
      : undefined,
    image_media_metadata: item.width || item.height || item.date_taken
      ? {
        height: item.height,
        width: item.width,
        time: item.date_taken ? new Date(item.date_taken * 1000).toISOString() : undefined
      }
      : undefined,
    user_meta: ''
  }
}
