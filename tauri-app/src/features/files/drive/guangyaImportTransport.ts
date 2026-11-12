import {nativeCall} from '@/platform/native'
import {rawRequest,text,type ResponseData} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {guangyaId} from './guangyaFileTransport'
import {getGuangyaFileId,getGuangyaFileName} from './electron/providers/guangyaMetadata'
interface Scope {user:string;check():void;identity:string;pages:Map<string,Set<string>>;submitted:boolean;ack:'none'|'pending'|'done'}
const scopes=new Map<string,Scope>()
function scope(id:string){const value=scopes.get(id);if(!value)throw Error('光鸭分享窗口已关闭');value.check();if(JSON.stringify(mutationAccount(value.user,'guangya'))!==value.identity)throw Error('光鸭账号已变化');return value}
export function createGuangyaImportScope(user:string,check:()=>void){const id=crypto.randomUUID(),value:Scope={user,check,identity:JSON.stringify(mutationAccount(user,'guangya')),pages:new Map(),submitted:false,ack:'none'};scopes.set(id,value);return {id,check:()=>{scope(id)},dispose(){value.pages.clear();scopes.delete(id)},beginSave(){scope(id);value.submitted=false;value.ack='none'},receipt:()=>({submitted:value.submitted,ack:value.ack})}}
function parsed(response:ResponseData){const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('光鸭分享响应无效');return data as Record<string,any>}
function businessFailed(data:Record<string,any>){return data.success===false||Number.isFinite(Number(data.code))&&Number(data.code)!==0}
export async function guangyaImportFetch(id:string,url:string,init:RequestInit){
 scope(id)
 const endpoint=new URL(url),paths=['/nd.bizuserres.s/v1/get_share_summary','/nd.bizuserres.s/v1/get_share_access_token','/nd.bizuserres.s/v1/get_share_page_files_list']
 if(endpoint.origin!=='https://api.guangyapan.com'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!paths.includes(endpoint.pathname)||init.method!=='POST'||typeof init.body!=='string')throw Error('光鸭公开分享请求无效')
 const body=JSON.parse(init.body)
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('光鸭公开分享参数无效')
 if(endpoint.pathname.endsWith('get_share_page_files_list')){
  if(typeof body.accessToken!=='string'||!body.accessToken||typeof body.parentId!=='string'||!Number.isSafeInteger(body.page)||body.page<1||body.pageSize!==100||body.orderBy!==0||body.sortType!==0||Object.keys(body).some(key=>!['accessToken','parentId','page','pageSize','orderBy','sortType'].includes(key)))throw Error('光鸭分享列表参数无效')
  guangyaId(body.parentId,true)
 }else if(typeof body.shareId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(body.shareId)||Object.keys(body).some(key=>!['shareId','code'].includes(key))||endpoint.pathname.endsWith('get_share_access_token')&&typeof body.code!=='string')throw Error('光鸭分享标识或提取码无效')
 const headers=init.headers as Record<string,string>
 if(!headers||Object.keys(headers).some(key=>!['accept','content-type','did','dt','origin','referer','traceparent','user-agent'].includes(key)))throw Error('光鸭公开分享请求头无效')
 // Retain the original pure public header generator; never attach a current-account token.
 const response=await nativeCall<ResponseData>('http_request',{request:{requestId:crypto.randomUUID(),providerId:'guangya',accountId:'',method:'POST',url,headers,body:Array.from(new TextEncoder().encode(init.body)),timeoutMs:30000,proxy:null}})
 scope(id);const data=parsed(response)
 if(businessFailed(data))throw Error(data.message||data.msg||'光鸭分享请求失败')
 return {ok:response.status>=200&&response.status<300,status:response.status,json:async()=>data}
}
export function validateGuangyaImportPage(id:string,token:string,parent:string,page:number,rows:any[],data:any){
 const value=scope(id),key=JSON.stringify([token,parent]);if(page===1)value.pages.set(key,new Set());const seen=value.pages.get(key),list=data?.list||data?.items||data?.records||data?.content,total=data?.total??data?.totalCount
 if(!seen||!Array.isArray(list)||rows.length>100||page>10000||total!==undefined&&(!Number.isSafeInteger(Number(total))||Number(total)<0))throw Error('光鸭分享分页响应无效')
 for(const row of rows){const raw=row?.fileId||row?.file_id||row?.id||row?.resId||row?.resourceId;guangyaId(raw);const fid=getGuangyaFileId(row),size=Number(row?.size||row?.fileSize||0);if(seen.has(fid)||!getGuangyaFileName(row)||!Number.isSafeInteger(size)||size<0)throw Error('光鸭分享文件标识重复或数据无效');seen.add(fid)}
 if(total!==undefined&&Number(total)>seen.size&&!rows.length)throw Error('光鸭分享列表不完整')
}
export async function guangyaImportRequest(id:string,path:string,body:Record<string,unknown>){
 const value=scope(id)
 if(path!=='/nd.bizuserres.s/v1/restore_share'||!body||typeof body.accessToken!=='string'||!body.accessToken||!Array.isArray(body.fileIds)||!body.fileIds.length||new Set(body.fileIds).size!==body.fileIds.length||Object.keys(body).some(key=>!['accessToken','fileIds','parentId'].includes(key)))throw Error('光鸭分享转存参数无效')
 body.fileIds.forEach(fid=>guangyaId(fid));guangyaId(body.parentId,true)
 scope(id);value.submitted=true
 const response=await rawRequest(mutationAccount(value.user,'guangya'),'POST','https://api.guangyapan.com'+path,JSON.stringify(body),{'Content-Type':'application/json'})
 scope(id);const data=parsed(response),failed=businessFailed(data)
 if(response.status<200||response.status>=300||failed){if(response.status>=400&&response.status<500&&response.status!==408||response.status>=200&&response.status<300&&failed)value.submitted=false;throw Error(data.message||data.msg||'光鸭分享转存请求失败')}
 const result=data.data??data
 value.ack=response.status===202||result?.taskId||result?.task_id||result?.async_task_id?'pending':'done'
 return data
}
