import { boxApiRequest } from '../../providerTransport'

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
  total_count?:number;offset?:number;limit?:number
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

export const apiBoxListVersions = async (user_id: string, fileId: string, check:()=>void=()=>{}): Promise<BoxFileVersion[]> => {
  const items:BoxFileVersion[]=[],seen=new Set<string>()
  let offset=0
  for(let page=0;page<1000;page++){
    check()
    const data=await boxApiRequest<BoxVersionsResp>(user_id,buildBoxVersionsPath(fileId,100,offset),{method:'GET'},'获取 Box 文件版本失败')
    check()
    if(!data||!Array.isArray(data.entries))throw Error('Box 文件版本列表响应无效')
    if(data.offset!==undefined&&data.offset!==offset)throw Error('Box 文件版本分页位置不匹配')
    for(const item of data.entries){if(!item.id||seen.has(item.id))throw Error('Box 文件版本列表含重复或无效版本');seen.add(item.id);items.push(item)}
    const limit=data.limit??100,total=data.total_count
    if(!Number.isInteger(limit)||limit<=0||total!==undefined&&(!Number.isInteger(total)||total<0))throw Error('Box 文件版本分页信息无效')
    if(total===undefined){if(data.entries.length<limit)return items}
    else if(offset+limit>=total)return items
    if(!data.entries.length)throw Error('Box 文件版本分页提前结束，请重新加载')
    offset+=limit
  }
  throw Error('Box 文件版本分页超限，未返回不完整结果')
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
