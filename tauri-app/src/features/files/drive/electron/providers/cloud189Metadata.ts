import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
import {cloud189FamilyId,type Cloud189FileItem} from './cloud189Identity'
export const mapCloud189FileToAliModel = (item: Cloud189FileItem, drive_id = 'cloud189', parentId = 'cloud189_root'): IAliGetFileModel => {
  const rawId = String(item.id || item.fileId || item.folderId || '')
  const file_id = item.familyId ? cloud189FamilyId(item.familyId, rawId) : rawId
  const name = String(item.name || item.fileName || item.folderName || '')
  const isDir = !!item.isFolder
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const size = Number(item.size || 0)
  const timeSource = item.lastOpTime || item.createDate || ''
  const time = timeSource ? new Date(timeSource).getTime() : 0
  const iconInfo = isDir ? ['', 'iconfile-folder'] : getFileIcon('', ext, ext, '', size)
  return {
    __v_skip: true,
    drive_id,
    file_id,
    parent_file_id: String(item.parentId || item.parentFolderId || parentId || 'cloud189_root'),
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
    thumbnail: item.icon?.max600 || item.icon?.mediumUrl || item.icon?.smallUrl || '',
    description: `cloud189_id:${file_id}`
  }
}
