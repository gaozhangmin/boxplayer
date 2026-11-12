import {graphRequest} from '../../revisionTransport'
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

export const buildOneDriveVersionsPath = (fileId: string) => {
  return `/me/drive/items/${encodeURIComponent(fileId)}/versions`
}

export const buildOneDriveRestoreVersionPath = (fileId: string, versionId: string) => {
  return `/me/drive/items/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/restoreVersion`
}

export const apiOneDriveListVersions = async (user_id: string, fileId: string, check:()=>void=()=>{}): Promise<OneDriveVersion[]> => {
  check()
  let data = await graphRequest<OneDriveVersionListResp>(
    user_id,
    buildOneDriveVersionsPath(fileId),
    { method: 'GET' },
    '获取 OneDrive 文件版本失败'
  )
  check()
  if(!data||!Array.isArray(data.value))throw Error('OneDrive 文件版本列表响应无效')
  const items=[...data.value],seen=new Set<string>()
  while (data?.['@odata.nextLink']) {
    check()
    const next=data['@odata.nextLink']
    if(typeof next!=='string'||seen.has(next)||seen.size>=1000)throw Error('OneDrive 文件版本分页重复或超限')
    if(new URL(next,'https://graph.microsoft.com/v1.0').pathname!=='/v1.0'+buildOneDriveVersionsPath(fileId))throw Error('OneDrive 文件版本分页文件不匹配')
    seen.add(next)
    data = await graphRequest<OneDriveVersionListResp>(
      user_id,
      data['@odata.nextLink'],
      { method: 'GET' },
      '获取 OneDrive 文件版本失败'
    )
    check()
    if(!data||!Array.isArray(data.value))throw Error('OneDrive 文件版本列表响应无效')
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
