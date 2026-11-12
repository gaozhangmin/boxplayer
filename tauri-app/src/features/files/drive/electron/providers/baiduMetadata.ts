import {baiduMetaFetch} from '../../baiduMetadataTransport'
import {baiduFileId} from '../../baiduListTransport'
export type BaiduFileMetaItem = {
  category?: number
  dlink?: string
  filename?: string
  fs_id: number | string
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

export const apiBaiduFileMetas = async (
  user_id: string,
  fsids: (number | string)[],
  needDlink = 0,
  needThumb = 1,
  needExtra = 1,
  needMedia = 1,
  needDetail = 1
): Promise<BaiduFileMetaItem[] | null> => {
  if (!fsids.length) return null
  const params = new URLSearchParams({
    method: 'filemetas',
    fsids: '[' + fsids.map(baiduFileId).join(',') + ']',
    dlink: String(needDlink),
    thumb: String(needThumb),
    extra: String(needExtra),
    needmedia: String(needMedia),
    detail: String(needDetail)
  })
  const url = `${API_URL}?${params.toString()}`
  const resp = await baiduMetaFetch(user_id, url, {
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
