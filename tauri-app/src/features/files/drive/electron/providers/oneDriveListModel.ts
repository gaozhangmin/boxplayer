import type {IAliGetFileModel} from '../aliapi/alimodels'
import getFileIcon from '../aliapi/fileicon'
import {humanDateTimeDateStr,humanSize} from '../utils/format'
import {HanToPin} from '../utils/pinyin'
export type OneDriveItem = {
  id: string
  name: string
  size?: number
  createdDateTime?: string
  lastModifiedDateTime?: string
  parentReference?: {
    id?: string
    driveId?: string
    path?: string
  }
  folder?: {
    childCount?: number
  }
  file?: {
    mimeType?: string
    hashes?: {
      sha1Hash?: string
      quickXorHash?: string
    }
  }
  image?: {
    width?: number
    height?: number
  }
  video?: {
    width?: number
    height?: number
    duration?: number
  }
  thumbnails?: Array<{
    small?: { url?: string }
    medium?: { url?: string }
    large?: { url?: string }
  }>
  '@microsoft.graph.downloadUrl'?: string
  '@content.downloadUrl'?: string
}

export const buildOneDriveChildrenPath = (parentId: string, pageSize = 200): string => {
  const query = new URLSearchParams({ '$expand': 'thumbnails', '$top': String(pageSize) }).toString()
  if (!parentId || parentId === 'onedrive_root') return `/me/drive/root/children?${query}`
  return `/me/drive/items/${encodeURIComponent(parentId)}/children?${query}`
}

export const getOneDriveDownloadUrl = (item?: OneDriveItem | null): string =>
  item?.['@microsoft.graph.downloadUrl'] || item?.['@content.downloadUrl'] || ''

const encodeDescription = (item: OneDriveItem) => {
  const parts: string[] = []
  if (item.parentReference?.id) parts.push(`onedrive_parent:${item.parentReference.id}`)
  if (item.parentReference?.path) parts.push(`onedrive_path:${encodeURIComponent(item.parentReference.path)}`)
  if (item.parentReference?.driveId) parts.push(`onedrive_drive:${item.parentReference.driveId}`)
  const downloadUrl = getOneDriveDownloadUrl(item)
  if (downloadUrl) parts.push(`onedrive_download:${encodeURIComponent(downloadUrl)}`)
  return parts.join(';')
}

const pickThumbnail = (item: OneDriveItem): string => {
  const thumbnail = item.thumbnails?.[0]
  return thumbnail?.large?.url || thumbnail?.medium?.url || thumbnail?.small?.url || ''
}

export const mapOneDriveItemToAliModel = (item: OneDriveItem, drive_id: string, parentId: string): IAliGetFileModel => {
  const isDir = !!item.folder
  const name = item.name || ''
  const ext = isDir ? '' : (name.split('.').pop() || '')
  const time = new Date(item.lastModifiedDateTime || item.createdDateTime || '').getTime() || 0
  const timeStr = time ? humanDateTimeDateStr(new Date(time).toISOString()) : ''
  const size = Number(item.size || 0)
  let category = ''
  let icon = 'iconfile-folder'
  if (!isDir) {
    const iconInfo = getFileIcon(item.file?.mimeType || '', ext, ext, '', size)
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
    mime_type: item.file?.mimeType || '',
    mime_extension: ext,
    category,
    icon,
    file_count: Number(item.folder?.childCount || 0),
    size,
    sizeStr: humanSize(size),
    time,
    timeStr,
    starred: false,
    isDir,
    thumbnail: pickThumbnail(item),
    description: encodeDescription(item),
    content_hash: item.file?.hashes?.sha1Hash || item.file?.hashes?.quickXorHash || '',
    content_hash_name: item.file?.hashes?.sha1Hash ? 'sha1' : item.file?.hashes?.quickXorHash ? 'quickxor' : '',
    created_at: item.createdDateTime || '',
    updated_at: item.lastModifiedDateTime || item.createdDateTime || '',
    type: isDir ? 'folder' : 'file',
    image_media_metadata: item.image ? { width: item.image.width || 0, height: item.image.height || 0 } : undefined,
    video_media_metadata: item.video ? {
      width: item.video.width || 0,
      height: item.video.height || 0,
      duration: Math.floor(Number(item.video.duration || 0) / 1000)
    } : undefined
  } as any
}
