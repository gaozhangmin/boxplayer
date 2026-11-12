import {request,text} from '@/features/sources/transport'
import {aliFolderAccount as aliRelocationAccount} from './aliFolderTransport'
import {getDrivePane} from './ports'
import {openAliRelocationBatch} from './aliOpenRelocation'
import {checkAliRelocationContext} from './aliRelocationContext'
import type {Account} from '@/features/sources/contracts'
import {requireAliCrossDriveObservation} from './aliCrossDriveObservationScope'
import {readAliMoveSnapshot,pairObservedAliMoveNodes} from './aliMoveSnapshot'
import type {AliMoveNode,AliMovePair} from './aliCrossDriveIdentity'
export interface AliCrossDriveReceipt {before:AliMoveNode[];after:AliMoveNode[];pairs:AliMovePair[];destination:string}
type Job={task?:string;target?:string;accepted?:boolean;id:string;destination:string;copy:boolean;identity:string;before?:AliMoveNode[]}
const sessions=new WeakMap<object,{epoch:unknown;owner:string;items:Map<string,Job>}>()
let receipt:{pane:object;epoch:unknown;owner:string;id:string;name:string;crossDrive?:AliCrossDriveReceipt}|undefined
export function aliRelocationReceipt(id:string){const pane=getDrivePane();if(receipt?.pane!==pane||receipt.epoch!==pane.context||receipt.id!==id||receipt.owner!==JSON.stringify(aliRelocationAccount(pane.sourceId)))return undefined;return {...receipt,...(receipt.crossDrive?{crossDrive:JSON.parse(JSON.stringify(receipt.crossDrive)) as AliCrossDriveReceipt}:{})}}
export function acknowledgeWebAliMove(account:Account,id:string,destination:string){
 const pane=getDrivePane(),session=sessions.get(pane)
 if(!session||pane.sourceId!==account.id||session.epoch!==pane.context||session.owner!==JSON.stringify(account)||JSON.stringify(aliRelocationAccount(account.id))!==session.owner)throw Error('阿里移动同步账号或浏览器已变化')
 for(const [key,job] of session.items)if(!job.copy&&job.id===id&&job.destination===destination&&job.accepted)session.items.delete(key)
}
export async function ApiBatch(_title:string,batchList:string[],user:string,share:string){
 const account=aliRelocationAccount(user),pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 let activeCross:{file:string;destination:string}|undefined
 const check=()=>{checkAliRelocationContext(user);if(getDrivePane()!==pane||pane.sourceId!==user||pane.context!==epoch||JSON.stringify(aliRelocationAccount(user))!==owner)throw Error('来源已切换或账号已变化，停止移动/复制确认');if(activeCross)requireAliCrossDriveObservation(account,activeCross.file,activeCross.destination)}
 check();if(share)throw Error('文件移动/复制不接受分享令牌')
 if(account.providerId==='alipan-open'){const result=await openAliRelocationBatch(account,batchList,share);check();const last=result.receipts.at(-1);if(last)receipt={pane,epoch,owner,...last};return {reslut:result.reslut}}
 let session=sessions.get(pane)
 if(session&&session.epoch===epoch&&session.owner!==owner&&session.items.size)throw Error('阿里待确认移动/复制账号已变化，请刷新确认')
 if(!session||session.epoch!==epoch||session.owner!==owner){session={epoch,owner,items:new Map()};sessions.set(pane,session)}
 const call=async(path:string,value:unknown)=>{check();const response=await request(account,'POST','https://api.aliyundrive.com/'+path,JSON.stringify(value),{'Content-Type':'application/json'});check();const data=JSON.parse(text(response));if(response.status!==200||!data||typeof data!=='object'||data.code)throw Error('阿里文件操作尚未确认完成');return data}
 const reslut:Array<{id:string;file_id:string}>=[],seen=new Set<string>()
 for(const raw of batchList){
  check();const row=JSON.parse(raw),body=row?.body,copy=row?.url==='/file/copy'
  if(!['/file/move','/file/copy'].includes(row?.url)||row.method!=='POST'||typeof row.id!=='string'||!row.id||seen.has(row.id)||body?.file_id!==row.id||!body?.drive_id||!body?.to_parent_file_id||body.auto_rename!==true)throw Error('阿里移动/复制请求无效');seen.add(row.id)
  const targetDrive=body.to_drive_id||body.drive_id,key=JSON.stringify([row.url,body]),encoded=JSON.stringify({driveId:body.drive_id,fileId:row.id}),known=pane.file?.(encoded)
  if(!known||known.drive_id!==user)throw Error('阿里源文件不在当前来源记录中')
  const identity=JSON.stringify([known.file_id,known.parent_file_id,known.name,known.isDir]),destination=JSON.stringify({driveId:targetDrive,fileId:body.to_parent_file_id})
  const crossDrive=!copy&&targetDrive!==body.drive_id
  activeCross=crossDrive?{file:encoded,destination}:undefined
  if(crossDrive)requireAliCrossDriveObservation(account,encoded,destination)
  let job=session.items.get(key)
  if(job&&job.identity!==identity)throw Error('阿里待确认移动/复制文件身份已变化，请刷新确认')
  if(!job){
   if(session.items.size>=128)throw Error('待确认阿里文件操作过多，请先刷新确认')
   const before=crossDrive?await readAliMoveSnapshot(account,[{id:encoded,parent:known.parent_file_id}],check):undefined
   check();if(crossDrive)requireAliCrossDriveObservation(account,encoded,destination)
   job={id:encoded,destination,copy,identity,before};session.items.set(key,job)
   const result=await call('adrive/v4/batch',{requests:[row],resource:'file'})
   if(!Array.isArray(result.responses)||result.responses.length!==1||result.responses[0]?.id!==row.id)throw Error('阿里移动/复制缺少匹配回执')
   const response=result.responses[0],value=response.body
   if([400,401,403,404,409,422,429].includes(response.status)){session.items.delete(key);throw Error('阿里已拒绝移动/复制，可修正后重试')}
   if(![200,201,202].includes(response.status)||!value||value.code||value.drive_id!==targetDrive||typeof value.file_id!=='string'||!value.file_id||value.file_id==='root'||(!copy&&!crossDrive&&value.file_id!==row.id)||(copy&&value.file_id===row.id))throw Error('阿里移动/复制返回身份不匹配，请刷新确认')
   job.target=value.file_id
   if(value.async_task_id){if(typeof value.async_task_id!=='string')throw Error('阿里异步任务标识无效');job.task=value.async_task_id}
   else if(response.status===202)throw Error('阿里缺少异步任务回执，请刷新确认')
   job.accepted=true
  }
  if(!job.target||!job.accepted)throw Error('阿里移动/复制受理未知，请刷新确认，勿重复提交')
  if(job.task){
   let completed=false
   for(let attempt=0;attempt<60;attempt++){
    const task=await call('v2/async_task/get',{async_task_id:job.task})
    if(['Succeed','succeed','done'].includes(task.state)){completed=true;break}
    if(!['Running','running'].includes(task.state))throw Error('阿里异步文件任务未成功')
    if(attempt<59){await new Promise(resolve=>setTimeout(resolve,1000));check()}
   }
   if(!completed)throw Error('阿里文件任务仍在执行；重试继续确认原任务')
   job.task=undefined
  }
  const detail=await call('v2/file/get',{drive_id:targetDrive,file_id:job.target})
  if(detail.file_id!==job.target||detail.drive_id!==targetDrive||detail.parent_file_id!==body.to_parent_file_id||detail.type!==(known.isDir?'folder':'file')||detail.trashed||typeof detail.name!=='string'||!detail.name)throw Error('阿里移动/复制结果类型或目标不匹配')
  let crossReceipt:AliCrossDriveReceipt|undefined
  if(crossDrive){
   requireAliCrossDriveObservation(account,encoded,destination)
   if(!job.before)throw Error('已提交跨盘移动缺少原始快照，不能重放')
   const targetId=JSON.stringify({driveId:targetDrive,fileId:job.target}),after=await readAliMoveSnapshot(account,[{id:targetId,parent:destination}],check);check()
   if(after[0]?.name!==detail.name)throw Error('跨盘移动目标根在确认期间已变化')
   const pairs=pairObservedAliMoveNodes(job.before,after,[{from:encoded,to:targetId}],destination)
   crossReceipt={before:job.before,after,pairs,destination}
  }
  receipt={pane,epoch,owner,id:encoded,name:detail.name,...(crossReceipt?{crossDrive:crossReceipt}:{})};reslut.push({id:row.id,file_id:job.target});if(copy)session.items.delete(key)
 }
 return {reslut}
}
