import {nativeCall} from '@/platform/native'
import {rawRequest,text,type ResponseData} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {pikpakId} from './pikpakFileTransport'
interface Scope {user:string;check():void;identity:string;pages:Map<string,Set<string>>;submitted:boolean;ack:'none'|'pending'|'done'}
const scopes=new Map<string,Scope>()
function scope(id:string){const value=scopes.get(id);if(!value)throw Error('PikPak 分享窗口已关闭');value.check();if(JSON.stringify(mutationAccount(value.user,'pikpak'))!==value.identity)throw Error('PikPak 账号已变化');return value}
export function createPikpakImportScope(user:string,check:()=>void){const id=crypto.randomUUID(),value:Scope={user,check,identity:JSON.stringify(mutationAccount(user,'pikpak')),pages:new Map(),submitted:false,ack:'none'};scopes.set(id,value);return {id,check:()=>{scope(id)},dispose(){value.pages.clear();scopes.delete(id)},beginSave(){scope(id);value.submitted=false;value.ack='none'},receipt:()=>({submitted:value.submitted,ack:value.ack})}}
export function pikpakImportAccount(id:string){const value=scope(id);return mutationAccount(value.user,'pikpak')}
function parsed(response:ResponseData){const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('PikPak 分享响应无效');return data as Record<string,any>}
function shareId(value:string|null){if(!value||!/^[A-Za-z0-9_-]{1,128}$/.test(value))throw Error('PikPak 分享标识无效')}
export async function pikpakImportPublicFetch(id:string,input:URL,init:RequestInit){
 const value=scope(id),url=new URL(input)
 if(url.origin!=='https://api-drive.mypikpak.com'||url.username||url.password||url.hash||!['/drive/v1/share','/drive/v1/share/detail'].includes(url.pathname)||init.method&&init.method!=='GET'||init.body!==undefined)throw Error('PikPak 公开分享请求无效')
 shareId(url.searchParams.get('share_id'))
 const detail=url.pathname.endsWith('/detail'),allowed=detail?['limit','thumbnail_size','order','share_id','parent_id','pass_code_token','page_token']:['limit','thumbnail_size','order','share_id','parent_id','pass_code']
 if([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1)||url.searchParams.get('limit')!=='100'||url.searchParams.get('thumbnail_size')!=='SIZE_LARGE'||url.searchParams.get('order')!==(detail?'6':'3')||!url.searchParams.has('parent_id'))throw Error('PikPak 分享列表参数无效')
 if(detail&&!url.searchParams.get('pass_code_token')||!detail&&!url.searchParams.has('pass_code'))throw Error('PikPak 分享访问参数无效')
 const headers=init.headers as Record<string,string>;if(!headers||Object.keys(headers).some(key=>!['content-type','user-agent'].includes(key.toLowerCase())))throw Error('PikPak 公开请求头无效')
 const response=await nativeCall<ResponseData>('http_request',{request:{requestId:crypto.randomUUID(),providerId:'pikpak',accountId:'',method:'GET',url:url.toString(),headers,body:null,timeoutMs:30000,proxy:null}})
 scope(id);const data=parsed(response)
 if(detail&&response.status>=200&&response.status<300&&!data.error){
  const rows=data.files||data.file_list,next=data.next_page_token||data.nextPageToken||'',key=JSON.stringify([url.searchParams.get('share_id'),url.searchParams.get('pass_code_token'),url.searchParams.get('parent_id')])
  if(!url.searchParams.get('page_token'))value.pages.set(key,new Set());const seen=value.pages.get(key)
  if(!Array.isArray(rows)||rows.length>100||typeof next!=='string'||!seen)throw Error('PikPak 分享分页响应无效')
  for(const row of rows){pikpakId(row?.id);if(seen.has(row.id)||typeof row.name!=='string'||!row.name||!['drive#file','drive#folder'].includes(row.kind)||!Number.isSafeInteger(Number(row.size||0))||Number(row.size||0)<0)throw Error('PikPak 分享文件标识重复或数据无效');seen.add(row.id)}
 }
 return {ok:response.status>=200&&response.status<300,status:response.status,json:async()=>data}
}
export async function pikpakImportPrivateFetch(id:string,input:string,init:RequestInit){
 const value=scope(id)
 if(input!=='https://api-drive.mypikpak.com/drive/v1/share/restore'||init.method!=='POST'||typeof init.body!=='string')throw Error('PikPak 分享转存请求无效')
 const body=JSON.parse(init.body);shareId(body?.share_id)
 if(typeof body.pass_code_token!=='string'||!body.pass_code_token||!Array.isArray(body.file_ids)||!body.file_ids.length||new Set(body.file_ids).size!==body.file_ids.length||Object.keys(body).some(key=>!['share_id','pass_code_token','file_ids'].includes(key)))throw Error('PikPak 分享转存参数无效')
 body.file_ids.forEach((fid:string)=>pikpakId(fid));scope(id);value.submitted=true
 const response=await rawRequest(pikpakImportAccount(id),'POST',input,init.body,{'Content-Type':'application/json'})
 scope(id);const data=parsed(response)
 if(response.status<200||response.status>=300||data.error){if(response.status>=400&&response.status<500&&response.status!==408||response.status>=200&&response.status<300&&data.error)value.submitted=false}
 else value.ack=response.status===202||data.task_id||data.taskId||data.tasks?.length?'pending':'done'
 return {ok:response.status>=200&&response.status<300,status:response.status,json:async()=>data}
}
