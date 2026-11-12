import type {Account} from '@/features/sources/contracts'
import {rawRequest,text} from '@/features/sources/transport'
import {CLOUD189_API_URL,CLOUD189_WEB_URL,CLOUD189_USER_AGENT} from './electron/providers/cloud189Constants'
import {cloud189Scope,forgetCloud189Files,preserveCloud189LargeIds,type Cloud189FileItem} from './electron/providers/cloud189Identity'
export class Cloud189BatchRejected extends Error {}
interface Context{
 account:Account;type:'MOVE'|'COPY'|'DELETE';originalId:string;target?:string;file:Cloud189FileItem
 check:()=>void;taskId:()=>string|undefined;submitted:()=>void;created:(id:string)=>void
}
const contexts=new Map<string,Context>()
export async function withCloud189BatchScope<T>(context:Context,run:(user:string)=>Promise<T>){
 context.check();if(contexts.size>=128)throw Error('天翼批任务会话过多')
 const key=`cloud189-batch:${crypto.randomUUID()}`;contexts.set(key,context)
 try{return await run(key)}finally{forgetCloud189Files(key);contexts.delete(key)}
}
function bound(user:string){const context=contexts.get(user);if(!context)throw Error('天翼批任务会话已关闭');context.check();return context}
export async function apiCloud189FileDetail(user:string,id:string){const context=bound(user);if(id!==context.originalId)throw Error('天翼批任务详情标识不匹配');return {...context.file}}
export async function cloud189FormRequest(user:string,action:string,form:Record<string,string>,family=false):Promise<any>{
 const context=bound(user),scope=cloud189Scope(context.originalId),create=action==='batch/createBatchTask.action',poll=action==='batch/checkBatchTask.action'
 if(!create&&!poll||form.type!==context.type)throw Error('天翼批任务请求未适配')
 if(create){
  const expected:Record<string,string>={type:context.type,taskInfos:JSON.stringify([{fileId:scope.rawId,fileName:context.file.name||'',isFolder:context.file.isFolder?1:0}])}
  if(scope.familyId)expected.familyId=scope.familyId
  if(context.target!==undefined){const destination=cloud189Scope(context.target);if(destination.familyId!==scope.familyId)throw Error('天翼批任务目标空间不匹配');if(destination.rawId)expected.targetFolderId=destination.rawId}
  if(family!==!!scope.familyId||JSON.stringify(Object.keys(form).sort())!==JSON.stringify(Object.keys(expected).sort())||Object.keys(expected).some(key=>form[key]!==expected[key]))throw Error('天翼批任务表单或空间不匹配')
  const previous=context.taskId();if(previous)return {taskId:previous}
 }else if(family||Object.keys(form).length!==2||form.taskId!==context.taskId()||!form.taskId)throw Error('天翼轮询任务或会话不匹配')
 context.check();if(create)context.submitted()
 const response=await rawRequest(context.account,'POST',CLOUD189_API_URL+'/'+action,new URLSearchParams(form).toString(),{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json;charset=UTF-8','User-Agent':CLOUD189_USER_AGENT,Referer:CLOUD189_WEB_URL})
 if(response.status>=400&&response.status<500&&response.status!==408){if(create)throw new Cloud189BatchRejected(`天翼拒绝创建批任务（HTTP ${response.status}）`);throw Error(`天翼批任务查询失败（HTTP ${response.status}）`)}
 if(response.status<200||response.status>=300)throw Error('天翼批任务响应不确定')
 const data=JSON.parse(preserveCloud189LargeIds(text(response)))
 if(!data||typeof data!=='object'||Array.isArray(data)||data.success!==undefined&&typeof data.success!=='boolean'||['errorCode','res_code','code'].some(key=>data[key]!==undefined&&!['string','number'].includes(typeof data[key])))throw Error('天翼批任务回执无效')
 if(data.errorCode||data.success===false||Number(data.res_code||0)!==0||data.code&&data.code!=='SUCCESS'){
  if(create)throw new Cloud189BatchRejected('天翼拒绝创建批任务')
  throw Error('天翼批任务查询失败')
 }
 const state=data.data||data
 if(create){
  const value=data.taskId||state.taskId
  if(typeof value!=='string'&&typeof value!=='number'||typeof value==='number'&&!Number.isSafeInteger(value))throw Error('天翼批任务ID无效')
  const id=String(value||'')
  if(!id||id.length>4096||/[\u0000-\u0020/\\]/.test(id))throw Error('天翼批任务ID无效')
  context.created(id)
 }else{
  if(state.taskId!==undefined&&String(state.taskId)!==context.taskId()||data.taskId!==undefined&&String(data.taskId)!==context.taskId())throw Error('天翼返回了其他批任务的进度')
  if(!['string','number'].includes(typeof state.taskStatus)||!Number.isSafeInteger(Number(state.taskStatus))||Number(state.taskStatus)<0)throw Error('天翼批任务进度无效')
  for(const key of ['failedCount','skipCount'])if(state[key]!==undefined&&(!['string','number'].includes(typeof state[key])||!Number.isSafeInteger(Number(state[key]))||Number(state[key])<0))throw Error('天翼批任务计数无效')
  if(state.successedFileIdList!==undefined&&(!Array.isArray(state.successedFileIdList)||state.successedFileIdList.some((id:unknown)=>typeof id!=='string'&&typeof id!=='number')))throw Error('天翼批任务成功标识无效')
 }
 context.check();return data
}
