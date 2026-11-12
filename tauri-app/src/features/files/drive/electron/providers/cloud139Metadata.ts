import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
export type Cloud139FileItem = {
  fileId?: string
  catalogId?: string
  catalogID?: string
  contentID?: string
  parentFileId?: string
  parentCatalogId?: string
  name?: string
  catalogName?: string
  contentName?: string
  type?: string
  size?: number | string
  contentSize?: number | string
  updated_at?: string
  updatedAt?: string
  updateTime?: string
  created_at?: string
  createTime?: string
  thumbnailURL?: string
  thumbnailUrls?: { url?: string }[]
}

export const listFromResponse = (data: any): Cloud139FileItem[] => {
  const raw = data?.data || data
  const list = raw?.items || raw?.list || raw?.content || raw?.files || raw?.fileList || raw?.getDiskResult?.catalogList || []
  const contentList = raw?.getDiskResult?.contentList || []
  if (Array.isArray(list) && Array.isArray(contentList) && contentList.length) return [...list, ...contentList]
  return Array.isArray(list) ? list : []
}

export const mapCloud139FileToAliModel = (item: Cloud139FileItem, drive_id = 'cloud139', parentId = 'cloud139_root'): IAliGetFileModel => {
  const file_id = String(item.fileId || item.catalogId || item.catalogID || item.contentID || '')
  const name = String(item.name || item.catalogName || item.catalogName || item.contentName || '')
  const isDir = item.type === 'folder' || Boolean(item.catalogId || item.catalogID)
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const size = Number(item.size || item.contentSize || 0)
  const timeSource = item.updated_at || item.updatedAt || item.updateTime || item.created_at || item.createTime || ''
  const time = timeSource ? new Date(timeSource).getTime() : 0
  const iconInfo = isDir ? ['', 'iconfile-folder'] : getFileIcon('', ext, ext, '', size)
  return {
    __v_skip: true,
    drive_id,
    file_id,
    parent_file_id: String(item.parentFileId || item.parentCatalogId || parentId || 'cloud139_root'),
    name,
    namesearch: HanToPin(name),
    ext,
    mime_type: '',
    mime_extension: ext,
    category: iconInfo[0],
    icon: iconInfo[1],
    file_count: 0,
    size,
    sizeStr: humanSize(size),
    time,
    timeStr: time ? humanDateTimeDateStr(new Date(time).toISOString()) : '',
    starred: false,
    isDir,
    thumbnail: item.thumbnailUrls?.find((thumb) => thumb?.url)?.url || item.thumbnailURL || '',
    description: `cloud139_id:${file_id}`
  }
}
