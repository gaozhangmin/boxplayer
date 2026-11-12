import {cloud123FileCheck,cloud123ListRequest} from '../../cloud123FileTransport'
const message={error:(_value:string)=>{}}

export type Cloud123FileItem = {
  fileId: number
  filename: string
  parentFileId: number
  type: number
  size: number
  category: number
  status: number
  trashed: number
  createAt?: string
  updateAt?: string
  thumbnail?: string
  thumbnailUrl?: string
  thumbnailURL?: string
  previewUrl?: string
  previewURL?: string
  cover?: string
  coverUrl?: string
}

export type Cloud123FileListResp = {
  code: number
  message: string
  data?: {
    lastFileId: number
    fileList: Cloud123FileItem[]
  }
}

const API_URL = 'https://open-api.123pan.com/api/v2/file/list'

export const apiCloud123FileListPage = async (
  user_id: string,
  parentFileId: string | number,
  limit = 100,
  trashed: boolean = false,
  searchData: string = '',
  searchMode: number = 0,
  lastFileId: string | number = '',
  strict = false
): Promise<{ items: Cloud123FileItem[]; lastFileId: number }> => {
  cloud123FileCheck(user_id)
  const params = new URLSearchParams()
  params.set('parentFileId', String(parentFileId))
  params.set('limit', String(limit))
  params.set('trashed', trashed ? '1' : '0')
  if (lastFileId !== '' && lastFileId !== undefined && lastFileId !== null) params.set('lastFileId', String(lastFileId))
  if (searchData) {
    params.set('parentFileId', '0')
    params.set('searchData', searchData)
    params.set('searchMode', String(searchMode))
  }
  const url = `${API_URL}?${params.toString()}`
  const { response: resp, data } = await cloud123ListRequest(user_id, url)
  if (!resp.ok) {
    message.error('获取 123 网盘文件列表失败')
    if (strict) throw new Error('获取 123 网盘文件列表失败')
    return { items: [], lastFileId: -1 }
  }
  if (data?.code !== 0 || !data?.data?.fileList) {
    if (strict) throw new Error(data?.message || '获取 123 网盘文件列表失败')
    return { items: [], lastFileId: -1 }
  }
  const fileList = data.data.fileList as Cloud123FileItem[]
  const items = trashed ? fileList.filter((item) => item.trashed === 1) : fileList.filter((item) => item.trashed !== 1)
  return { items, lastFileId: Number(data.data.lastFileId ?? -1) }
}
