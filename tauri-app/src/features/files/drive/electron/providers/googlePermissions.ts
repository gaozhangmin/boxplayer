import {googleDriveRequest} from '../../providerTransport'
type GooglePermission = { id?: string; type?: string; role?: string; allowFileDiscovery?: boolean }

type GooglePermissionsResponse = { permissions?: GooglePermission[];nextPageToken?:string }

const permissionPath = (fileId: string) => `/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&fields=nextPageToken,permissions(id,type,role,allowFileDiscovery)`

export const apiGoogleListPermissions = async (userId: string, fileId: string, check:()=>void=()=>{}) => {
 const items:GooglePermission[]=[],seen=new Set<string>(),ids=new Set<string>()
 let token=''
 do{
  check()
  const path=permissionPath(fileId)+(token?'&pageToken='+encodeURIComponent(token):'')
  const data=await googleDriveRequest<GooglePermissionsResponse>(userId,path,{method:'GET'},'获取 Google Drive 分享权限失败')
  check()
  if(!data||!Array.isArray(data.permissions))throw Error('Google Drive 权限列表响应无效')
  for(const item of data.permissions){if(!item.id||ids.has(item.id))throw Error('Google Drive 权限列表含重复或无效权限');ids.add(item.id);items.push(item)}
  if(data.nextPageToken&&(typeof data.nextPageToken!=='string'||seen.has(data.nextPageToken)||seen.size>=1000))throw Error('Google Drive 权限分页重复或超限')
  token=data.nextPageToken||'';if(token)seen.add(token)
 }while(token)
 return items
}

export const apiGoogleDeletePermission = async (userId: string, fileId: string, permissionId: string) => (await googleDriveRequest<any>(userId, `/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`, { method: 'DELETE' }, '取消 Google Drive 分享失败')) !== null
