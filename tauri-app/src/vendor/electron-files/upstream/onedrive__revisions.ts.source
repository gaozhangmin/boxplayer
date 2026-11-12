import message from '../utils/message'
import { getOneDriveToken } from './dirfilelist'

const GRAPH_API_HOST = 'https://graph.microsoft.com/v1.0'

export type OneDriveVersion = {
  id?: string
  lastModifiedDateTime?: string
  size?: number
  publication?: {
    level?: string
    versionId?: string
  }
}

type OneDriveVersionListResp = {
  value?: OneDriveVersion[]
  '@odata.nextLink'?: string
}

const graphRequest = async <T>(user_id: string, pathOrUrl: string, init: RequestInit, fallback: string): Promise<T | null> => {
  const token = await getOneDriveToken(user_id)
  if (!token?.access_token) {
    message.error('未登录 OneDrive')
    return null
  }
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH_API_HOST}${pathOrUrl}`
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.error) {
    message.error(data?.error?.message || fallback)
    return null
  }
  return (data || {}) as T
}

export const buildOneDriveVersionsPath = (fileId: string) => {
  return `/me/drive/items/${encodeURIComponent(fileId)}/versions`
}

export const buildOneDriveRestoreVersionPath = (fileId: string, versionId: string) => {
  return `/me/drive/items/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/restoreVersion`
}

export const apiOneDriveListVersions = async (user_id: string, fileId: string): Promise<OneDriveVersion[]> => {
  let data = await graphRequest<OneDriveVersionListResp>(
    user_id,
    buildOneDriveVersionsPath(fileId),
    { method: 'GET' },
    '获取 OneDrive 文件版本失败'
  )
  const items = Array.isArray(data?.value) ? [...data.value] : []
  while (data?.['@odata.nextLink']) {
    data = await graphRequest<OneDriveVersionListResp>(
      user_id,
      data['@odata.nextLink'],
      { method: 'GET' },
      '获取 OneDrive 文件版本失败'
    )
    if (!data) break
    items.push(...(Array.isArray(data.value) ? data.value : []))
  }
  return items
}

export const apiOneDriveRestoreVersion = async (user_id: string, fileId: string, versionId: string): Promise<boolean> => {
  const data = await graphRequest<Record<string, never>>(
    user_id,
    buildOneDriveRestoreVersionPath(fileId, versionId),
    { method: 'POST' },
    '恢复 OneDrive 文件版本失败'
  )
  return data !== null
}
