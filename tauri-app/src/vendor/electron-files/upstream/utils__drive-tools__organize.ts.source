import type { IAliGetFileModel } from '../../aliapi/alimodels'
import { listDriveToolChildren } from './directLinks'

export interface OrganizeFileItem {
  userId: string
  driveId: string
  fileId: string
  name: string
}

export interface OrganizeResult {
  total: number
  success: number
  failed: number
  report: string
}

export const moveDriveToolFiles = async (files: OrganizeFileItem[], targetParentId: string, targetDriveId = ''): Promise<OrganizeResult> => {
  const validFiles = files.filter(file => file.userId && file.driveId && file.fileId)
  if (!validFiles.length || !targetParentId) return { total: 0, success: 0, failed: 0, report: '没有可移动的文件或目标目录' }
  const { default: AliFileCmd } = await import('../../aliapi/filecmd')
  const groups = new Map<string, OrganizeFileItem[]>()
  for (const file of validFiles) {
    const key = `${file.userId}\n${file.driveId}`
    groups.set(key, [...(groups.get(key) || []), file])
  }
  let success = 0
  for (const [key, group] of groups) {
    const [userId, driveId] = key.split('\n')
    const successIds = driveId.startsWith('webdav:') ? [] : await AliFileCmd.ApiMoveBatch(userId, driveId, group.map(file => file.fileId), targetDriveId || driveId, targetParentId)
    success += successIds.length
  }
  return { total: validFiles.length, success, failed: validFiles.length - success, report: `移动整理完成：成功 ${success}/${validFiles.length}${success < validFiles.length ? `，失败 ${validFiles.length - success}` : ''}` }
}

export const flattenDriveToolFolders = async (files: OrganizeFileItem[], targetParentId: string, targetDriveId = ''): Promise<OrganizeResult> => {
  const children: OrganizeFileItem[] = []
  for (const file of files) {
    const listed = await listDriveToolChildren(file.userId, file.driveId, file.fileId)
    children.push(...listed.map(item => ({ userId: file.userId, driveId: item.drive_id, fileId: item.file_id, name: item.name })))
  }
  return moveDriveToolFiles(children, targetParentId, targetDriveId)
}
