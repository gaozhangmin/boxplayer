import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
import type {DropboxMetadata} from './dropboxMetadata'
const encodeDescription = (item: DropboxMetadata) => {
  const parts: string[] = []
  if (item.path_display || item.path_lower) parts.push(`dropbox_path:${encodeURIComponent(item.path_display || item.path_lower || '')}`)
  if (item.rev) parts.push(`dropbox_rev:${item.rev}`)
  if (item.content_hash) parts.push(`dropbox_hash:${item.content_hash}`)
  return parts.join(';')
}

export const mapDropboxFileToAliModel = (item: DropboxMetadata, drive_id: string, parentId: string): IAliGetFileModel => {
  const isDir = item['.tag'] === 'folder'
  const name = item.name || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const time = new Date(item.server_modified || item.client_modified || '').getTime() || 0
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
    file_id: item.id || item.path_display || item.path_lower || '',
    parent_file_id: parentId,
    path: item.path_display || item.path_lower || '',
    name,
    namesearch: HanToPin(name),
    ext,
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
    thumbnail: '',
    description: encodeDescription(item),
    content_hash: item.content_hash || '',
    content_hash_name: item.content_hash ? 'dropbox-content-hash' : '',
    created_at: item.server_modified || item.client_modified || '',
    updated_at: item.server_modified || item.client_modified || '',
    type: isDir ? 'folder' : 'file'
  } as any
}
