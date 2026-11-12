import {graphJson,dropboxRpc as rpc,mutationAccount} from './providerTransport'
import {request} from '@/features/sources/transport'
// Original provider APIs keep their DTOs and request builders. Credentials stay in
// the native account transport; pagination URLs cannot select another origin.
export async function graphRequest<T>(user:string,pathOrUrl:string,init:RequestInit,fallback:string):Promise<T>{
 let path=pathOrUrl
 if(pathOrUrl.startsWith('https://')){
  const url=new URL(pathOrUrl)
  if(url.origin!=='https://graph.microsoft.com'||!url.pathname.startsWith('/v1.0/'))throw Error('OneDrive 分页地址无效')
  path=url.pathname.slice('/v1.0'.length)+url.search
 }
 if(!/^\/me\/drive\/items\//.test(path)||path.startsWith('//'))throw Error('OneDrive 版本请求路径无效')
 if(init.method==='POST'){
  if(!/^\/me\/drive\/items\/[^/]+\/versions\/[^/]+\/restoreVersion$/.test(path))throw Error('OneDrive 版本操作无效')
  const result=await request(mutationAccount(user,'onedrive'),'POST','https://graph.microsoft.com/v1.0'+path,undefined,{'Content-Type':'application/json'})
  if(result.status!==204||result.body.length)throw Error('OneDrive 尚未确认版本恢复完成')
  return {} as T
 }
 if(init.method!=='GET')throw Error('OneDrive 版本请求方法无效')
 const result=await graphJson<T>(user,path,'GET',undefined,fallback)
 if(result.error||!result.data)throw Error(result.error||fallback)
 return result.data
}
export async function dropboxRpc<T>(user:string,path:string,body:unknown,fallback:string):Promise<T>{
 const result=await rpc<T>(user,path,body,fallback)
 if(result.error||!result.data)throw Error(result.error||fallback)
 return result.data
}
