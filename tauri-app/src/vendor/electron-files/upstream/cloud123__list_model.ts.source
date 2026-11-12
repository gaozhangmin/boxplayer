import { humanDateTimeDateStr, humanSize } from '../utils/format'
import { HanToPin } from '../utils/utils'
import type { IAliGetFileModel } from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import message from '../utils/message'
import { getCloud123Token } from './auth'
import UserDAL from '../user/userdal'
import { fetchCloud123JsonWithAuthRetry } from './request'

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

export const apiCloud123FileList = async (
  user_id: string,
  parentFileId: string | number,
  limit = 100,
  trashed: boolean = false,
  searchData: string = '',
  searchMode: number = 0,
  lastFileId: string | number = ''
): Promise<Cloud123FileItem[]> => {
  const page = await apiCloud123FileListPage(user_id, parentFileId, limit, trashed, searchData, searchMode, lastFileId)
  return page.items
}

export const apiCloud123DirectoryFileList = async (user_id: string, parentFileId: string | number, trashed: boolean = false, searchData: string = '', searchMode: number = 0): Promise<Cloud123FileItem[]> => {
  const items: Cloud123FileItem[] = []
  let lastFileId: string | number = ''
  while (true) {
    const page = await apiCloud123FileListPage(user_id, parentFileId, 100, trashed, searchData, searchMode, lastFileId)
    items.push(...page.items)
    if (page.lastFileId < 0 || !page.items.length || String(page.lastFileId) === String(lastFileId)) return items
    lastFileId = page.lastFileId
  }
}

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
  const token = await getCloud123Token(user_id)
  if (!token?.access_token) {
    message.error('未登录 123 网盘')
    if (strict) throw new Error('未登录 123 网盘')
    return { items: [], lastFileId: -1 }
  }
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
  const { response: resp, data } = await fetchCloud123JsonWithAuthRetry(url, token, () => UserDAL.EnsureUserTokenReady(user_id, true))
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

export const mapCloud123FileToAliModel = (item: Cloud123FileItem): IAliGetFileModel => {
  const isDir = item.type === 1
  const name = item.filename
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const timeStr = humanDateTimeDateStr(item.updateAt || item.createAt || '')
  const time = new Date(item.updateAt || item.createAt || '').getTime()
  const size = item.size || 0
  let category = ''
  let icon = 'iconfile-folder'
  if (!isDir) {
    const iconInfo = getFileIcon('', ext, ext, '', size)
    category = iconInfo[0]
    icon = iconInfo[1]
  }
  return {
    __v_skip: true,
    drive_id: 'cloud123',
    file_id: String(item.fileId),
    parent_file_id: String(item.parentFileId),
    name: name,
    namesearch: HanToPin(name),
    ext: ext,
    mime_type: '',
    mime_extension: ext,
    category,
    icon,
    file_count: 0,
    size,
    sizeStr: humanSize(size),
    time,
    timeStr,
    starred: false,
    isDir,
    thumbnail: pickCloud123Thumbnail(item),
    description: ''
  }
}

export const mapCloud123InfoToAliModel = (item: any): IAliGetFileModel => {
  const isDir = Number(item.type) === 1
  const name = item.filename || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const timeStr = humanDateTimeDateStr(item.updateAt || item.createAt || '')
  const time = new Date(item.updateAt || item.createAt || '').getTime()
  const size = Number(item.size || 0)
  let category = ''
  let icon = 'iconfile-folder'
  if (!isDir) {
    const iconInfo = getFileIcon('', ext, ext, '', size)
    category = iconInfo[0]
    icon = iconInfo[1]
  }
  return {
    __v_skip: true,
    drive_id: 'cloud123',
    file_id: String(item.fileId || item.fileID || item.file_id || ''),
    parent_file_id: String(item.parentFileId || item.parentFileID || item.parent_file_id || ''),
    name: name,
    namesearch: HanToPin(name),
    ext: ext,
    mime_type: '',
    mime_extension: ext,
    category,
    icon,
    file_count: 0,
    size,
    sizeStr: humanSize(size),
    time,
    timeStr,
    starred: false,
    isDir,
    thumbnail: pickCloud123Thumbnail(item),
    description: ''
  }
}

const pickCloud123Thumbnail = (item: Partial<Cloud123FileItem> & Record<string, unknown>) => {
  const thumbnail = [item.thumbnail, item.thumbnailUrl, item.thumbnailURL, item.previewUrl, item.previewURL, item.cover, item.coverUrl]
    .find((value) => typeof value === 'string' && value.length > 0)
  return typeof thumbnail === 'string' ? thumbnail : ''
}
