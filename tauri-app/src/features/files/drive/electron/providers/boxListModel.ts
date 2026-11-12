import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
import {BOX_FIELDS,toBoxId,type BoxItem} from './boxMetadata'
export const buildBoxChildrenPath = (parentId: string, limit = 500, offset = 0): string => {
  const params = new URLSearchParams({
    fields: BOX_FIELDS,
    limit: String(limit),
    offset: String(offset)
  })
  return `/folders/${encodeURIComponent(toBoxId(parentId))}/items?${params.toString()}`
}

const encodeDescription = (item: BoxItem) => {
  const parts: string[] = []
  if (item.parent?.id) parts.push(`box_parent:${item.parent.id}`)
  if (item.path_collection?.entries?.length) parts.push(`box_path:${encodeURIComponent(item.path_collection.entries.map((entry) => entry.name || '').filter(Boolean).join('/'))}`)
  if (item.shared_link?.download_url) parts.push(`box_download:${encodeURIComponent(item.shared_link.download_url)}`)
  if (item.shared_link?.url) parts.push(`box_shared:${encodeURIComponent(item.shared_link.url)}`)
  return parts.join(';')
}

const pickThumbnail = (item: BoxItem) => {
  const template = item.representations?.entries?.[0]?.content?.url_template || ''
  return template
}

export const mapBoxItemToAliModel = (item: BoxItem, drive_id: string, parentId: string): IAliGetFileModel => {
  const isDir = item.type === 'folder'
  const name = item.name || ''
  const ext = isDir ? '' : (item.extension || name.split('.').pop() || '')
  const time = new Date(item.modified_at || item.content_modified_at || item.created_at || '').getTime() || 0
  const timeStr = time ? humanDateTimeDateStr(new Date(time).toISOString()) : ''
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
    drive_id,
    file_id: item.id || '',
    parent_file_id: parentId,
    name,
    namesearch: HanToPin(name),
    ext,
    mime_type: '',
    mime_extension: ext,
    category,
    icon,
    file_count: Number(item.item_collection?.total_count || 0),
    size,
    sizeStr: humanSize(size),
    time,
    timeStr,
    starred: false,
    isDir,
    thumbnail: pickThumbnail(item),
    description: encodeDescription(item),
    content_hash: item.sha1 || '',
    content_hash_name: item.sha1 ? 'sha1' : '',
    created_at: item.created_at || item.content_created_at || '',
    updated_at: item.modified_at || item.content_modified_at || item.created_at || '',
    type: isDir ? 'folder' : 'file'
  } as any
}
