import {useFileSourcesStore} from '@/stores/fileSources'
import {json,request,text} from '@/features/sources/transport'
import type {Account} from '@/features/sources/contracts'
import {oneDriveCopy} from './oneDriveCopyTransport'
export function mutationAccount(user:string,provider:Account['providerId']):Account{
 const account=useFileSourcesStore().accounts.find(account=>account.id===user)
 if(!account||account.providerId!==provider)throw Error('文件操作来源不匹配或账号已移除')
 return account
}
async function bound<T>(user:string,provider:Account['providerId'],origin:string,path:string,method:string,body:unknown,fallback:string,extraHeaders?:Record<string,string>):Promise<T>{
 if(!path.startsWith('/')||path.startsWith('//'))throw Error('提供商请求路径无效')
 const account=mutationAccount(user,provider)
 let data:T&{error?:unknown;type?:string}
 if(method==='DELETE'){
  const response=await request(account,method,origin+path)
  if(response.status===204){if(!response.body.length)return undefined as T;data=JSON.parse(text(response))}
  else if(provider==='google'&&response.status===200&&response.body.length){
   data=JSON.parse(text(response))
   if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length)throw Error('提供商尚未确认删除完成')
  }else throw Error('提供商尚未确认删除完成')
 }else if(extraHeaders&&Object.keys(extraHeaders).some(key=>key.toLowerCase()!=='content-type')){
  const response=await request(account,method,origin+path,body===undefined?undefined:JSON.stringify(body),{'Content-Type':'application/json',...extraHeaders})
  data=JSON.parse(text(response))
 }else data=await json<T&{error?:unknown;type?:string}>(account,method,origin+path,body)
 if(data?.error||data?.type==='error')throw Error(fallback)
 return data
}
export async function graphJson<T>(user:string,path:string,method:string,body:unknown,fallback:string):Promise<{data?:T;error:string}>{
 try{
  if(method==='POST'&&/^\/me\/drive\/items\/[^/?]+\/copy$/.test(path))return {data:await oneDriveCopy(mutationAccount(user,'onedrive'),path,body) as T,error:''}
  const data=await bound<T>(user,'onedrive','https://graph.microsoft.com/v1.0',path,method,body,fallback)
  if(method==='PATCH'&&body&&typeof body==='object'&&'name'in body){
   const item=path.match(/^\/me\/drive\/items\/([^/?]+)$/)
   const row=data as {id?:unknown;name?:unknown}|null
   if(!item||!row||row.id!==decodeURIComponent(item[1]!)||row.name!==body.name)throw Error('重命名结果缺少匹配的标识或名称，请刷新确认')
  }
  if(method==='PATCH'&&body&&typeof body==='object'&&'parentReference'in body){
   const item=path.match(/^\/me\/drive\/items\/([^/?]+)$/),parent=(body as {parentReference?:{id?:unknown}}).parentReference
   const row=data as {id?:unknown;parentReference?:{id?:unknown}}|null
   if(!item||typeof parent?.id!=='string'||!parent.id||!row||row.id!==decodeURIComponent(item[1]!)||row.parentReference?.id!==parent.id)throw Error('移动结果缺少匹配的标识或目标目录，请刷新确认')
  }
  return {data,error:''}
 }
 catch(error){return {error:error instanceof Error?error.message:fallback}}
}
interface RequestOptions {method:string;headers?:Record<string,string>;body?:string}
function body(options:RequestOptions){return options.body===undefined?undefined:JSON.parse(options.body)}
export async function boxApiRequest<T>(user:string,path:string,options:RequestOptions,fallback:string):Promise<T>{
 const value=body(options),data=await bound<T>(user,'box','https://api.box.com/2.0',path,options.method,value,fallback,options.headers)
 const item=path.match(/^\/(files|folders)\/([^/?]+)(\/copy)?$/)
 if(path.startsWith('/folders/trash/items?')){
  const page=data as {entries?:unknown;next_marker?:unknown}|null
  if(!page||!Array.isArray(page.entries)||page.next_marker!==undefined&&typeof page.next_marker!=='string')throw Error('Box 回收站列表响应无效')
 }
 if(item&&options.method==='POST'&&!item[3]){
  const result=data as {id?:unknown}|null
  if(!result||result.id!==decodeURIComponent(item[2]!))throw Error('还原结果标识不匹配，请刷新确认')
 }
 if(item&&value?.parent?.id&&(options.method==='PUT'||options.method==='POST'&&item[3])){
  const result=data as {id?:unknown;parent?:{id?:unknown}}|null,original=decodeURIComponent(item[2]!)
  if(!result||typeof result.id!=='string'||!result.id||result.parent?.id!==value.parent.id||(item[3]?result.id===original:result.id!==original))throw Error('移动或复制结果缺少匹配的标识或目标目录，请刷新确认')
 }
 return data
}
export async function googleDriveRequest<T>(user:string,path:string,options:RequestOptions,fallback:string):Promise<T>{
 const value=body(options),data=await bound<T>(user,'google','https://www.googleapis.com/drive/v3',path,options.method,value,fallback)
 const url=new URL(path,'https://www.googleapis.com'),item=url.pathname.match(/^\/files\/([^/]+)(\/copy)?$/)
 if(item){
  const original=decodeURIComponent(item[1]!),row=data as {id?:unknown;parents?:unknown;trashed?:unknown}|null
  const parents=Array.isArray(row?.parents)?row.parents:[]
  if(options.method==='GET'&&(!row||typeof row.id!=='string'||!row.id||original!=='root'&&row.id!==original))throw Error('文件详情标识不匹配')
  const target=url.searchParams.get('addParents')
  if(options.method==='PATCH'&&target&&(!row||row.id!==original||!parents.includes(target)))throw Error('移动结果缺少匹配的标识或目标目录，请刷新确认')
  if(options.method==='PATCH'&&typeof value?.trashed==='boolean'&&(!row||row.id!==original||row.trashed!==value.trashed))throw Error('回收站操作结果标识或状态不匹配，请刷新确认')
  if(options.method==='POST'&&item[2]&&(!row||typeof row.id!=='string'||!row.id||row.id===original||!Array.isArray(value?.parents)||!value.parents.length||!value.parents.every((parent:unknown)=>parents.includes(parent))))throw Error('复制结果缺少匹配的新标识或目标目录，请刷新确认')
 }
 return data
}
export async function dropboxRpc<T>(user:string,path:string,value:unknown,fallback:string):Promise<{data?:T;error:string}>{
 try{
  const data=await bound<T>(user,'dropbox','https://api.dropboxapi.com/2',path,'POST',value,fallback)
  if(path==='/files/create_folder_v2'){
   const metadata=(data as {metadata?:{id?:unknown;path_display?:unknown}})?.metadata
   if(!metadata||(!(typeof metadata.id==='string'&&metadata.id.length>0)&&!(typeof metadata.path_display==='string'&&metadata.path_display.startsWith('/'))))throw Error('创建结果缺少文件夹标识，请刷新后确认')
  }
  if(path==='/files/move_v2'){
   const input=value as {from_path?:string;to_path?:string},metadata=(data as {metadata?:{id?:unknown;name?:unknown;path_display?:unknown;path_lower?:unknown;'.tag'?:unknown}})?.metadata
   const returned=metadata?.path_display||metadata?.path_lower
   if(!metadata||typeof metadata.id!=='string'||!metadata.id||!['file','folder'].includes(String(metadata['.tag']))||typeof returned!=='string'||typeof input.to_path!=='string'||returned.toLowerCase()!==input.to_path.toLowerCase()||metadata.name!==input.to_path.split('/').at(-1))throw Error('Dropbox 重命名回执名称或目标不匹配，请刷新确认')
  }
  return {data,error:''}
 }
 catch(error){return {error:error instanceof Error?error.message:fallback}}
}
