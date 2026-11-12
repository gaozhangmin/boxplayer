import {mutationAccount} from './providerTransport'
import {nativeCall} from '@/platform/native'
import {text,type ResponseData} from '@/features/sources/transport'
// Retained Ali methods expect HTTP status plus the original business-error code.
// Use the native gateway directly so a 400 response is not flattened by the
// convenience transport; no account token or Cookie is available here.
export const AliHttp={
 IsSuccess:(code:number)=>code>=200&&code<300,
 HttpCodeBreak:(_code:number)=>true,
 async Post(path:string,body:unknown,user:string,_shareToken:string){
  mutationAccount(user,'aliyun')
  if(!['adrive/v2/share_link/create','adrive/v1/share/create','adrive/v4/batch'].includes(path))throw Error('阿里分享请求路径无效')
  const response=await nativeCall<ResponseData>('http_request',{request:{requestId:crypto.randomUUID(),providerId:'aliyun',accountId:user,method:'POST',url:'https://api.aliyundrive.com/'+path,headers:{'Content-Type':'application/json'},body:Array.from(new TextEncoder().encode(typeof body==='string'?body:JSON.stringify(body))),timeoutMs:30000,proxy:null}})
  const data=JSON.parse(text(response))
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('阿里分享响应无效')
  if(data.code!==undefined)data.code=String(data.code)
  return {code:data.code?400:response.status,body:data}
 }
}
export const DebugLog={mSaveWarning:(_context:string,_data:unknown)=>{}}


export async function ApiBatch(_title:string,batchList:string[],user:string,_shareToken:string){
 if(!batchList.length||batchList.length>100)throw Error('阿里分享更新批量大小无效')
 const requests=batchList.map(raw=>JSON.parse(raw)),ids=new Set<string>()
 for(const item of requests){if(!item||typeof item.id!=='string'||!item.id||item.method!=='POST'||item.url!=='/share_link/update'||item.body?.share_id!==item.id||ids.has(item.id))throw Error('阿里分享更新子请求无效');ids.add(item.id)}
 const response=await AliHttp.Post('adrive/v4/batch',{requests,resource:'file'},user,'')
 if(!AliHttp.IsSuccess(response.code)||!Array.isArray(response.body.responses)||response.body.responses.length!==requests.length)throw Error('阿里分享更新结果未确认')
 const seen=new Set<string>(),reslut:Array<{share_id:string;share_pwd:string;expiration:string;share_name:string}>=[]
 for(const result of response.body.responses){
  if(!result||!ids.has(result.id)||seen.has(result.id)||!Number.isInteger(result.status)||result.status<200||result.status>205||result.status===202||!result.body||result.body.code||result.body.async_task_id||result.body.share_id!==result.id)throw Error('阿里分享更新部分失败或仍在执行')
  seen.add(result.id);reslut.push({share_id:result.body.share_id,share_pwd:result.body.share_pwd||'',expiration:result.body.expiration||'',share_name:result.body.share_name||''})
 }
 return {reslut}
}
