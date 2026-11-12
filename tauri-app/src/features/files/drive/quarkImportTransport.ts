import {rawRequest,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {quarkParams} from './electron/providers/quarkMetadata'
import {quarkId} from './quarkFileTransport'
interface Scope {user:string;check():void;identity:string;tokens:Map<string,string>;pages:Map<string,Set<string>>;submitted:boolean;task:string}
const scopes=new Map<string,Scope>()
function scope(id:string){const value=scopes.get(id);if(!value)throw Error('夸克分享窗口已关闭');value.check();if(JSON.stringify(mutationAccount(value.user,'quark'))!==value.identity)throw Error('夸克账号已变化');return value}
export function createQuarkImportScope(user:string,check:()=>void){
 const id=crypto.randomUUID(),value:Scope={user,check,identity:JSON.stringify(mutationAccount(user,'quark')),tokens:new Map(),pages:new Map(),submitted:false,task:''};scopes.set(id,value)
 return {id,check:()=>{scope(id)},dispose(){value.tokens.clear();value.pages.clear();scopes.delete(id)},beginSave(){scope(id);value.submitted=false;value.task=''},receipt(){return {submitted:value.submitted,task:value.task}}}
}
export function quarkImportTokens(id:string){return scope(id).tokens}
export function validateQuarkImportPage(id:string,share:string,parent:string,page:number,rows:any[],data:any){
 const value=scope(id),key=JSON.stringify([share,parent]);if(page===1)value.pages.set(key,new Set());const seen=value.pages.get(key)
 const total=data?.metadata?._total??data?.total??data?.count
 if(!seen||!Array.isArray(data?.list)||rows.length>100||page>10000||total!==undefined&&(!Number.isSafeInteger(total)||total<0))throw Error('夸克分享分页响应无效')
 for(const row of rows){const fid=quarkId(row?.fid);if(seen.has(fid)||typeof row.file_name!=='string'||!row.file_name||!Number.isSafeInteger(row.size??0)||(row.size??0)<0||row.share_fid_token!==undefined&&typeof row.share_fid_token!=='string')throw Error('夸克分享文件标识重复或数据无效');seen.add(fid);value.tokens.delete(`${share}:${fid}`)}
 if(total!==undefined&&total>seen.size&&!rows.length)throw Error('夸克分享列表不完整')
}
export async function quarkImportRequest<T=any>(id:string,path:string,init:RequestInit={},params:Record<string,string|number|undefined>={},base='https://drive-pc.quark.cn/1/clouddrive'):Promise<T>{
 const value=scope(id),method=init.method||'GET',readBase='https://drive.quark.cn/1/clouddrive'
 const payload=typeof init.body==='string'?JSON.parse(init.body):undefined
 if(path==='share/sharepage/token'){
  if(base!==readBase||method!=='POST'||!payload||typeof payload.pwd_id!=='string'||!/^[A-Za-z0-9]+$/.test(payload.pwd_id)||typeof payload.passcode!=='string'||payload.support_visit_limit_private_share!==true)throw Error('夸克分享令牌请求无效')
 }else if(path==='share/sharepage/detail'){
  if(base!==readBase||method!=='GET'||typeof params.pwd_id!=='string'||!/^[A-Za-z0-9]+$/.test(params.pwd_id)||typeof params.stoken!=='string'||!params.stoken||!Number.isSafeInteger(params._page)||Number(params._page)<1||params._size!==100)throw Error('夸克分享详情请求无效');quarkId(params.pdir_fid,true)
 }else if(path==='share/sharepage/save'){
  if(base!==readBase||method!=='POST'||!payload||!Array.isArray(payload.fid_list)||!payload.fid_list.length||new Set(payload.fid_list).size!==payload.fid_list.length||!Array.isArray(payload.fid_token_list)||payload.fid_token_list.length!==payload.fid_list.length||payload.fid_token_list.some((token:unknown)=>typeof token!=='string'||!token)||typeof payload.pwd_id!=='string'||!/^[A-Za-z0-9]+$/.test(payload.pwd_id)||typeof payload.stoken!=='string'||!payload.stoken||payload.pdir_fid!=='0'||payload.pdir_save_all!==false||payload.scene!=='link'||!Array.isArray(payload.exclude_fids)||payload.exclude_fids.length)throw Error('夸克分享转存参数无效')
  payload.fid_list.forEach((fid:unknown)=>quarkId(fid));quarkId(payload.to_pdir_fid,true)
 }else if(path==='task'){
  if(base!=='https://drive-pc.quark.cn/1/clouddrive'||method!=='GET'||typeof params.task_id!=='string'||!params.task_id)throw Error('夸克分享任务参数无效')
 }else throw Error('夸克分享导入端点未适配')
 // Request uses the protected native account; the random scope is never an account ID.
 const headers:Record<string,string>={'Content-Type':'application/json'}
 if(path.startsWith('share/sharepage/'))headers.Referer='https://pan.quark.cn/s/'+(payload?.pwd_id||params.pwd_id)
 scope(id);if(path==='share/sharepage/save')value.submitted=true
 const response=await rawRequest(mutationAccount(value.user,'quark'),method,`${base}/${path}?${quarkParams(params)}`,init.body as string|undefined,headers)
 scope(id)
 const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('夸克分享响应无效')
 if(response.status<200||response.status>=300||data.status==='error'||data.code!==undefined&&![0,200].includes(data.code)){if(path==='share/sharepage/save'&&(response.status>=400&&response.status<500&&response.status!==408||response.status>=200&&response.status<300&&data.code!==undefined&&![0,200].includes(data.code)))value.submitted=false;return {__error:true,code:data.code||response.status,message:data.message||'夸克分享请求失败'} as T}
 if(path==='share/sharepage/save'){
  const result=data.data
  if(!result||typeof result!=='object'||result.task_id!==undefined&&typeof result.task_id!=='string'||!result.task_id&&result.task_sync!==true)throw Error('夸克分享转存缺少任务回执')
  value.task=result.task_id||''
 }
 return data as T
}
