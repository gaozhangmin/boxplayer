import {nativeCall} from '@/platform/native'
import {text,type ResponseData} from '@/features/sources/transport'
export const AliImportHttp={
 IsSuccess:(code:number)=>code>=200&&code<300,
 HttpCodeBreak:(_code:number)=>true,
 async Post(path:string,body:unknown,_user:string,shareToken:string){
  const parsed=typeof body==='string'?JSON.parse(body):body as Record<string,unknown>
  if(!parsed||typeof parsed.share_id!=='string'||!/^[A-Za-z0-9_]{11,128}$/.test(parsed.share_id))throw Error('阿里分享标识无效')
  const tokenPath=path==='v2/share_link/get_share_token',infoPath=path==='adrive/v3/share_link/get_share_by_anonymous?share_id='+parsed.share_id,listPath=path.startsWith('adrive/v3/file/list?jsonmask=')
  if(!tokenPath&&!infoPath&&!listPath||_user)throw Error('匿名分享请求路径或账号无效')
  if(listPath&&!shareToken)throw Error('缺少分享访问令牌')
  const headers:Record<string,string>={'Content-Type':'application/json'};if(listPath)headers['X-Share-Token']=shareToken
  const response=await nativeCall<ResponseData>('http_request',{request:{requestId:crypto.randomUUID(),providerId:'aliyun',accountId:'',method:'POST',url:'https://api.aliyundrive.com/'+path,headers,body:Array.from(new TextEncoder().encode(JSON.stringify(parsed))),timeoutMs:30000,proxy:null}})
  const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('阿里分享响应无效')
  if(data.code!==undefined)data.code=String(data.code)
  if(listPath&&!data.code&&response.status>=200&&response.status<300){if(!Array.isArray(data.items)||data.next_marker!==undefined&&typeof data.next_marker!=='string')throw Error('分享文件分页响应无效');data.next_marker??=''}
  return {code:data.code?400:response.status,body:data}
 }
}
export const DebugLog={mSaveWarning:(_context:string,_data?:unknown)=>{},mSaveDanger:(_context:string,_data?:unknown)=>{}}
