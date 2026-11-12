import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
import type {Cloud123FileItem} from './cloud123List'
const pickCloud123Thumbnail = (item: Partial<Cloud123FileItem> & Record<string, unknown>) => {
  const thumbnail = [item.thumbnail, item.thumbnailUrl, item.thumbnailURL, item.previewUrl, item.previewURL, item.cover, item.coverUrl]
    .find((value) => typeof value === 'string' && value.length > 0)
  return typeof thumbnail === 'string' ? thumbnail : ''
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
