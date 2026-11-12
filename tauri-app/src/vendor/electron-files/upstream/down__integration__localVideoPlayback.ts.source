import path from 'path'
import type { IPageVideo } from '../../store/appstore'

const LOCAL_VIDEO_EXTENSIONS = new Set(['3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ts', 'webm', 'wmv'])

export function isLocalVideoPath(filePath: string): boolean {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  return LOCAL_VIDEO_EXTENSIONS.has(extension)
}

export function buildLocalVideoPage(filePath: string): IPageVideo {
  const normalizedPath = path.normalize(filePath)
  const parentPath = path.dirname(normalizedPath)
  const fileName = path.basename(normalizedPath)
  return {
    user_id: 'local',
    drive_id: 'local',
    file_id: normalizedPath,
    parent_file_id: parentPath,
    parent_file_name: path.basename(parentPath) || parentPath,
    file_name: fileName,
    html: fileName,
    encType: '',
    password: '',
    expire_time: 0,
    play_cursor: 0
  }
}
