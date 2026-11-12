import { boxApiRequest } from './dirfilelist'

export type BoxFileVersion = {
  id?: string
  type?: string
  name?: string
  size?: number
  sha1?: string
  modified_at?: string
}

type BoxVersionsResp = {
  entries?: BoxFileVersion[]
}

export const buildBoxVersionsPath = (fileId: string, limit = 100, offset = 0) => {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset)
  })
  return `/files/${encodeURIComponent(fileId)}/versions?${params.toString()}`
}

export const buildBoxPromoteVersionPath = (fileId: string) => {
  return `/files/${encodeURIComponent(fileId)}/versions/current`
}

export const buildBoxDeleteVersionPath = (fileId: string, versionId: string) => `/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}`

export const apiBoxListVersions = async (user_id: string, fileId: string): Promise<BoxFileVersion[]> => {
  const data = await boxApiRequest<BoxVersionsResp>(user_id, buildBoxVersionsPath(fileId), { method: 'GET' }, '获取 Box 文件版本失败')
  return Array.isArray(data?.entries) ? data.entries : []
}

export const apiBoxPromoteVersion = async (user_id: string, fileId: string, versionId: string): Promise<boolean> => {
  const data = await boxApiRequest<BoxFileVersion>(user_id, buildBoxPromoteVersionPath(fileId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: versionId, type: 'file_version' })
  }, '恢复 Box 文件版本失败')
  return !!data
}

export const apiBoxDeleteVersion = async (user_id: string, fileId: string, versionId: string): Promise<boolean> => {
  const data = await boxApiRequest<any>(user_id, buildBoxDeleteVersionPath(fileId, versionId), { method: 'DELETE' }, '删除 Box 文件历史版本失败')
  return data !== null
}
