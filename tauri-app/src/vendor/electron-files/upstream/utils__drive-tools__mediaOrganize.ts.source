import type { IAliGetFileModel } from '../../aliapi/alimodels'
import { listDriveToolChildren } from './directLinks'

export interface MediaOrganizeItem {
  userId: string
  driveId: string
  fileId: string
  name: string
  isDir: boolean
}

export interface MediaOrganizePlanItem extends MediaOrganizeItem {
  category: string
  targetSegments: string[]
  targetPath: string
  title: string
  year: string
  season: number | null
}

export interface MediaOrganizeResult {
  total: number
  success: number
  failed: number
  report: string
}

const normalizeName = (name: string) => String(name || '').replace(/\.[^/.]+$/, '').replace(/[._]+/g, ' ').replace(/[\[\]【】()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()

const inferMedia = (name: string) => {
  const text = normalizeName(name)
  const year = text.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || ''
  const seasonMatch = text.match(/\bS(\d{1,2})(?:E\d{1,3})?\b|第\s*(\d{1,2})\s*季/iu)
  const season = seasonMatch ? Number(seasonMatch[1] || seasonMatch[2]) : null
  const category = /综艺|真人秀|脱口秀|奔跑|歌手|好声音/u.test(text) ? '综艺' : /动漫|动画|番剧|anime/iu.test(text) ? '动漫' : season || /电视剧|剧集|连续剧|S\d{1,2}/iu.test(text) ? '电视剧' : '电影'
  const title = text.replace(/\b(19\d{2}|20\d{2})\b/g, '').replace(/\bS\d{1,2}(?:E\d{1,3})?\b/iu, '').replace(/第\s*\d{1,2}\s*季/iu, '').replace(/\s+/g, ' ').trim()
  return { category, title: title || text || name, year, season }
}

export const buildMediaOrganizePlan = (files: MediaOrganizeItem[], rootParentId: string): MediaOrganizePlanItem[] => files.map(file => {
  const info = inferMedia(file.name)
  const title = info.year ? `${info.title} (${info.year})` : info.title
  const targetSegments = [info.category, title]
  if (info.season && info.category !== '电影') targetSegments.push(`Season ${String(info.season).padStart(2, '0')}`)
  return { ...file, ...info, targetSegments, targetPath: [rootParentId || '当前目录', ...targetSegments].join(' / ') }
}).filter(item => item.isDir || /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|ts|m2ts|rmvb)$/iu.test(item.name))

export const executeMediaOrganizePlan = async (plans: MediaOrganizePlanItem[], rootParentId: string): Promise<MediaOrganizeResult> => {
  const valid = plans.filter(item => item.fileId && item.userId && item.driveId)
  if (!valid.length || !rootParentId) return { total: 0, success: 0, failed: 0, report: '没有可整理的项目或整理根目录' }
  const { default: AliFileCmd } = await import('../../aliapi/filecmd')
  let success = 0
  for (const item of valid) {
    let parentId = rootParentId
    let failed = false
    if (item.driveId.startsWith('webdav:')) continue
    for (const segment of item.targetSegments) {
      const existing = (await listDriveToolChildren(item.userId, item.driveId, parentId)).find(child => child.isDir && child.name === segment)
      if (existing) {
        parentId = existing.file_id
        continue
      }
      const created = await AliFileCmd.ApiCreatNewForder(item.userId, item.driveId, parentId, segment, '', 'refuse')
      if (!created.file_id) { failed = true; break }
      parentId = created.file_id
    }
    if (failed) continue
    const successIds = await AliFileCmd.ApiMoveBatch(item.userId, item.driveId, [item.fileId], item.driveId, parentId)
    if (successIds.includes(item.fileId)) success += 1
  }
  return { total: valid.length, success, failed: valid.length - success, report: `媒体整理完成：成功 ${success}/${valid.length}${success < valid.length ? `，失败 ${valid.length - success}` : ''}` }
}

export const mapMediaOrganizeFiles = (files: IAliGetFileModel[], userId: string): MediaOrganizeItem[] => files.map(file => ({ userId, driveId: file.drive_id, fileId: file.file_id, name: file.name, isDir: file.isDir }))
