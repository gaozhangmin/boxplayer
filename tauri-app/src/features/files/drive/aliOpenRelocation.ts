import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {request,text} from '@/features/sources/transport'
import {getDrivePane} from './ports'
import {aliFolderAccount} from './aliFolderTransport'
import {checkAliRelocationContext} from './aliRelocationContext'
type Job={owner:string;user:string;id:string;destination:string;copy:boolean;known:IAliGetFileModel;submitted:boolean;accepted:boolean;rejected?:boolean;target?:string;task?:string;launch?:Promise<{id:string;file_id:string;name:string}>}
// Foreground file-command receipts, not an upload/download queue.
const jobs=new Map<string,Job>()
export function acknowledgeOpenAliMove(account:Account,id:string,destination:string){for(const [key,job] of jobs)if(!job.copy&&job.user===account.id&&job.id===id&&job.destination===destination&&job.owner===JSON.stringify(account))jobs.delete(key)}
export function acknowledgeOpenAliCopy(account:Account,id:string,destination:string){for(const [key,job] of jobs)if(job.copy&&job.user===account.id&&job.id===id&&job.destination===destination&&job.owner===JSON.stringify(account))jobs.delete(key)}
export async function openAliRelocationBatch(account:Account,batchList:string[],share:string){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{checkAliRelocationContext(account.id);if(getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||account.providerId!=='alipan-open'||JSON.stringify(aliFolderAccount(account.id))!==owner)throw Error('阿里开放移动/复制来源已切换或账号已变化')}
 check();if(share)throw Error('移动/复制不接受分享令牌')
 const reslut:Array<{id:string;file_id:string}>=[],receipts:Array<{id:string;name:string}>=[],seen=new Set<string>()
 for(const raw of batchList){
  check();const row=JSON.parse(raw),body=row?.body,copy=row?.url==='/file/copy'
  if(!['/file/move','/file/copy'].includes(row?.url)||row.method!=='POST'||typeof row.id!=='string'||!row.id||seen.has(row.id)||body?.file_id!==row.id||typeof body.drive_id!=='string'||!body.drive_id||typeof body.to_parent_file_id!=='string'||!body.to_parent_file_id||body.auto_rename!==true)throw Error('阿里开放移动/复制请求无效');seen.add(row.id)
  const targetDrive=body.to_drive_id||body.drive_id,id=JSON.stringify({driveId:body.drive_id,fileId:row.id}),destination=JSON.stringify({driveId:targetDrive,fileId:body.to_parent_file_id}),key=JSON.stringify([account.id,row.url,body])
  if(typeof targetDrive!=='string'||!targetDrive)throw Error('阿里开放目标网盘标识无效')
  if(!copy&&targetDrive!==body.drive_id)throw Error('阿里跨盘移动身份对账尚未接入，未提交请求')
  const known=pane.file?.(id),folder=pane.file?.(destination)
  if(!known||known.drive_id!==account.id||known.file_id!==id||row.id==='root'||!folder?.isDir||folder.drive_id!==account.id||folder.file_id!==destination)throw Error('阿里开放源文件或目标不在当前来源记录中')
  let job=jobs.get(key)
  if(job&&(job.owner!==owner||job.known.name!==known.name||job.known.isDir!==known.isDir||job.known.parent_file_id!==known.parent_file_id))throw Error('阿里开放待确认操作身份已变化，勿重复提交')
  if(!job){if(jobs.size>=128)throw Error('阿里开放待确认操作过多');job={owner,user:account.id,id,destination,copy,known:{...known},submitted:false,accepted:false};jobs.set(key,job)}
  const entry=job
  if(!entry.launch)entry.launch=(async()=>{
   const call=async(path:string,value:unknown,sent?:()=>void,received?:(status:number,data:any)=>void)=>{
    check();sent?.();const response=await request(account,'POST','https://openapi.alipan.com/adrive/v1.0/openFile/'+path,JSON.stringify(value),{'Content-Type':'application/json'})
    const data=JSON.parse(text(response));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('阿里开放文件操作响应无效')
    received?.(response.status,data);check()
    if((received?![200,201,202].includes(response.status):response.status!==200)||data.code)throw Error('阿里开放文件操作未确认完成')
    return data
   }
   if(!entry.submitted){
    let parent:any;try{parent=JSON.parse(entry.known.parent_file_id)}catch{throw Error('阿里开放源文件父目录无效')}
    const original=await call('get',{drive_id:body.drive_id,file_id:row.id})
    if(original.file_id!==row.id||original.drive_id!==body.drive_id||parent?.driveId!==body.drive_id||original.parent_file_id!==parent.fileId||original.type!==(entry.known.isDir?'folder':'file')||original.name!==entry.known.name||original.trashed)throw Error('阿里开放源文件身份或位置已变化')
    if(body.to_parent_file_id!=='root'){const target=await call('get',{drive_id:targetDrive,file_id:body.to_parent_file_id});if(target.file_id!==body.to_parent_file_id||target.drive_id!==targetDrive||target.type!=='folder'||target.trashed)throw Error('阿里开放目标不是已确认的文件夹')}
    const input=copy?{drive_id:body.drive_id,file_id:row.id,to_drive_id:targetDrive,to_parent_file_id:body.to_parent_file_id,auto_rename:true}:{drive_id:body.drive_id,file_id:row.id,to_parent_file_id:body.to_parent_file_id,check_name_mode:'auto_rename'}
    await call(copy?'copy':'move',input,()=>{entry.submitted=true},(status,value)=>{
     if([400,401,403,404,409,422,429].includes(status)||value.code){entry.rejected=true;throw Error('阿里开放已拒绝移动/复制')}
     if(![200,201,202].includes(status)||value.drive_id!==targetDrive||typeof value.file_id!=='string'||!value.file_id||value.exist===true||(copy?value.file_id===row.id:value.file_id!==row.id))throw Error('阿里开放移动/复制回执身份未确认，勿重复提交')
     entry.target=value.file_id
     if(value.async_task_id){if(typeof value.async_task_id!=='string')throw Error('阿里开放任务标识无效');entry.task=value.async_task_id}
     else if(status===202)throw Error('阿里开放缺少异步任务标识，勿重复提交')
     entry.accepted=true
    })
   }
   if(!entry.accepted||!entry.target)throw Error('阿里开放移动/复制受理状态未知，勿重复提交')
   if(entry.task){
    let complete=false
    for(let attempt=0;attempt<60;attempt++){
     const task=await call('async_task/get',{async_task_id:entry.task})
     if(task.async_task_id&&task.async_task_id!==entry.task)throw Error('阿里开放任务回执标识不匹配')
     if(task.state==='Succeed'){complete=true;break}
     if(task.state!=='Running')throw Error('阿里开放文件任务未成功')
     if(attempt<59){await new Promise(resolve=>setTimeout(resolve,1000));check()}
    }
    if(!complete)throw Error('阿里开放任务仍在执行，请继续确认原任务')
    entry.task=undefined
   }
   const detail=await call('get',{drive_id:targetDrive,file_id:entry.target})
   if(detail.file_id!==entry.target||detail.drive_id!==targetDrive||detail.parent_file_id!==body.to_parent_file_id||detail.type!==(entry.known.isDir?'folder':'file')||detail.trashed||typeof detail.name!=='string'||!detail.name)throw Error('阿里开放移动/复制目标尚未确认')
   return {id:row.id,file_id:entry.target,name:detail.name}
  })()
  const launch=entry.launch
  try{const result=await launch;check();reslut.push({id:result.id,file_id:result.file_id});receipts.push({id,name:result.name})}
  catch(error){if(!entry.submitted||entry.rejected)jobs.delete(key);throw error}
  finally{if(entry.launch===launch)entry.launch=undefined}
 }
 return {reslut,receipts}
}
