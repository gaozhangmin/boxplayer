import {rawRequest as request,text} from '@/features/sources/transport'
import {checkTextCreation as mutationAccount} from './textCreationScope'
import {parseDropboxContentError} from './electron/providers/dropboxText'
export const Sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
export function dropboxHeader(value:unknown){return JSON.stringify(value).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))}
export async function dropboxContentRequest<T>(accountId:string,endpoint:string,arg:unknown,body:Uint8Array,fallback:string):Promise<{data?:T;error:string}>{
 try{
  const account=mutationAccount(accountId,'dropbox')
  if(endpoint!=='/files/upload'||!(body instanceof Uint8Array))throw Error('Dropbox 文本请求未适配')
  const content=new TextDecoder('utf-8',{fatal:true}).decode(body)
  const response=await request(account,'POST','https://content.dropboxapi.com/2'+endpoint,content,{'Content-Type':'application/octet-stream','Dropbox-API-Arg':dropboxHeader(arg)})
  const raw=text(response)
  if(response.status<200||response.status>=300)return {error:parseDropboxContentError(raw,fallback)}
  const data=JSON.parse(raw||'{}')
  if(!data||typeof data!=='object'||Array.isArray(data)||data.error||data.error_summary)return {error:parseDropboxContentError(raw,fallback)}
  return {data,error:''}
 }catch(cause){return {error:cause instanceof Error?cause.message:fallback}}
}
