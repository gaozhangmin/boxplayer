import { googleDriveRequest } from './dirfilelist'

export type GoogleRevision = { id?: string; modifiedTime?: string; size?: string; mimeType?: string; keepForever?: boolean; originalFilename?: string }
type GoogleRevisionList = { revisions?: GoogleRevision[]; nextPageToken?: string }

const fields = 'nextPageToken,revisions(id,modifiedTime,size,mimeType,keepForever,originalFilename)'
export const buildGoogleRevisionsPath = (fileId: string, pageToken = '') => {
  const params = new URLSearchParams({ fields, pageSize: '200', supportsAllDrives: 'true' })
  if (pageToken) params.set('pageToken', pageToken)
  return `/files/${encodeURIComponent(fileId)}/revisions?${params.toString()}`
}
export const buildGoogleRevisionPath = (fileId: string, revisionId: string) => `/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?supportsAllDrives=true`
export const buildGoogleRevisionDownloadUrl = (fileId: string, revisionId: string) => `/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media&supportsAllDrives=true`

export const apiGoogleListRevisions = async (userId: string, fileId: string) => {
  const revisions: GoogleRevision[] = []
  let pageToken = ''
  do {
    const data = await googleDriveRequest<GoogleRevisionList>(userId, buildGoogleRevisionsPath(fileId, pageToken), { method: 'GET' }, '获取 Google Drive 文件版本失败')
    revisions.push(...(data?.revisions || []))
    pageToken = data?.nextPageToken || ''
  } while (pageToken)
  return revisions
}

export const apiGoogleUpdateRevision = async (userId: string, fileId: string, revisionId: string, keepForever: boolean) => {
  return await googleDriveRequest<GoogleRevision>(userId, buildGoogleRevisionPath(fileId, revisionId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepForever }) }, '更新 Google Drive 文件版本失败')
}

export const apiGoogleDeleteRevision = async (userId: string, fileId: string, revisionId: string) => {
  const result = await googleDriveRequest<any>(userId, buildGoogleRevisionPath(fileId, revisionId), { method: 'DELETE' }, '删除 Google Drive 文件版本失败')
  return result !== null
}
