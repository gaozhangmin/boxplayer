import {rawRequest,text} from '@/features/sources/transport'
import {checkTextCreation as mutationAccount} from './textCreationScope'
import {getBoxRetryAfterMs} from './electron/providers/boxText'
export async function boxUploadRequest(user:string,url:string,init:RequestInit,fallback:string){
 try{
  const account=mutationAccount(user,'box')
  if(url!=='https://upload.box.com/api/2.0/files/content'||init.method!=='POST'||!(init.body instanceof FormData)||init.headers)throw Error('Box 文本请求未适配')
  // Request serializes the original FormData locally; it does not perform network IO.
  const multipart=new Request(url,init),body=await multipart.text()
  mutationAccount(user,'box')
  const response=await rawRequest(account,'POST',url,body,{'Content-Type':multipart.headers.get('content-type')!})
  const raw=text(response);let data:any
  try{data=raw?JSON.parse(raw):undefined}catch{data=undefined}
  const success=response.status>=200&&response.status<300&&!data?.error
  return {status:response.status,data:success?data:undefined,error:success?'':data?.message||data?.code||fallback,retryAfterMs:getBoxRetryAfterMs(response.headers['retry-after']||null)}
 }catch(cause){return {status:0,data:undefined,error:cause instanceof Error?cause.message:fallback,retryAfterMs:0}}
}
