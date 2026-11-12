import {nativeCall} from '@/platform/native'
import {text,type ResponseData} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {getDrivePane} from './ports'
type Task={id?:string;ids:Set<string>}
const sessions=new WeakMap<object,{epoch:unknown;pending:Map<string,Task>;tasks:Map<string,Task>}>()
export async function recoverPost(path:string,body:string|Record<string,unknown>,user:string,share:string){
 mutationAccount(user,'aliyun');const pane=getDrivePane(),epoch=pane.context,check=()=>{mutationAccount(user,'aliyun');if(getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==user)throw Error('恢复来源已切换')};check()
 if(share)throw Error('恢复操作不接受分享令牌')
 const value=typeof body==='string'?JSON.parse(body):body
 let session=sessions.get(pane);if(!session||session.epoch!==epoch){session={epoch,pending:new Map(),tasks:new Map()};sessions.set(pane,session)}
 let task:Task,key=''
 if(path==='adrive/v1/file/resumeDeleted'){
  const rows=value.resume_file_list
  if(!Array.isArray(rows)||!rows.length||rows.length>100||rows.some(row=>!row||typeof row.drive_id!=='string'||!row.drive_id||typeof row.file_id!=='string'||!row.file_id||row.file_id==='root'||typeof row.content_hash!=='string'||!row.content_hash||!Number.isSafeInteger(row.size)||row.size<0||typeof row.name!=='string'||!row.name)||new Set(rows.map(row=>row.file_id)).size!==rows.length)throw Error('恢复文件参数无效')
  key=JSON.stringify(rows);const known=session.pending.get(key)
  if(known){if(!known.id)throw Error('恢复任务受理未知，请刷新确认，勿重复提交');return {code:200,body:{task_id:known.id}}}
  if(session.pending.size>=128)throw Error('待确认恢复任务过多')
  task={ids:new Set(rows.map(row=>row.file_id))};session.pending.set(key,task)
 }else if(path==='adrive/v1/file/checkResumeTask'){
  if(typeof value.task_id!=='string'||!session.tasks.has(value.task_id))throw Error('恢复任务不属于当前来源会话')
  task=session.tasks.get(value.task_id)!
 }else throw Error('恢复请求路径无效')
 const response=await nativeCall<ResponseData>('http_request',{request:{requestId:crypto.randomUUID(),providerId:'aliyun',accountId:user,method:'POST',url:'https://api.aliyundrive.com/'+path,headers:{'Content-Type':'application/json'},body:Array.from(new TextEncoder().encode(JSON.stringify(value))),timeoutMs:30000,proxy:null}});check()
 const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('恢复任务回执无效')
 if(path.endsWith('/resumeDeleted')){
  if(response.status===200&&!data.code){if(typeof data.task_id!=='string'||!data.task_id)throw Error('恢复任务缺少标识');task.id=data.task_id;session.tasks.set(data.task_id,task)}
  else if(response.status===403)session.pending.delete(key)
 }else if(response.status===200){
  if(data.task_id&&data.task_id!==value.task_id)throw Error('恢复任务标识不匹配')
  if(data.state==='done'){
   if(!Array.isArray(data.results)||data.results.some((row:any)=>!task.ids.has(row.file_id)||!Number.isInteger(row.status))||new Set(data.results.map((row:any)=>row.file_id)).size!==data.results.length)throw Error('恢复任务结果不匹配')
   session.tasks.delete(task.id!);for(const [entry,item] of session.pending)if(item===task)session.pending.delete(entry)
  }else if(data.state==='running'){await new Promise(resolve=>setTimeout(resolve,1000));check()}
  else throw Error('恢复任务状态未成功')
 }else throw Error('恢复任务查询失败，请稍后重试')
 return {code:response.status,body:data}
}
