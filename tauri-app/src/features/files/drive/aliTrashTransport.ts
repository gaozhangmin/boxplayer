import {openAliTrashBatch} from './aliOpenTrash'
import {aliFolderAccount} from './aliFolderTransport'
import {checkAliTrashContext} from './aliTrashContext'
import {request,text} from '@/features/sources/transport'
import {getDrivePane} from './ports'
type Job={accepted?:boolean;task?:string}
const sessions=new WeakMap<object,{epoch:unknown;owner:string;jobs:Map<string,Job>}>()
export async function ApiBatch(_title:string,rows:string[],user:string,share:string){
 const account=aliFolderAccount(user),pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{checkAliTrashContext(user);if(getDrivePane()!==pane||pane.sourceId!==user||pane.context!==epoch||JSON.stringify(aliFolderAccount(user))!==owner)throw Error('阿里回收站来源已切换')}
 check();if(account.providerId==='alipan-open')return openAliTrashBatch(account,rows,share);if(share)throw Error('回收站操作不接受分享令牌')
 let session=sessions.get(pane);if(session&&session.epoch===epoch&&session.owner!==owner&&session.jobs.size)throw Error('待确认回收站操作的账号身份已变化，请重新打开来源');if(!session||session.epoch!==epoch||session.owner!==owner){session={epoch,owner,jobs:new Map()};sessions.set(pane,session)}
 const call=async(path:string,body:unknown)=>{check();const response=await request(account,'POST','https://api.aliyundrive.com/'+path,JSON.stringify(body),{'Content-Type':'application/json'});check();if(response.status!==200)throw Error('阿里回收站尚未完成');const data=JSON.parse(text(response));if(!data||data.code)throw Error('阿里回收站请求失败');return data}
 const reslut:Array<{id:string;file_id:string}>=[],seen=new Set<string>()
 for(const raw of rows){
  check();const row=JSON.parse(raw),body=row?.body
  if(!['/recyclebin/trash','/recyclebin/restore','/file/delete'].includes(row?.url)||row.method!=='POST'||typeof row.id!=='string'||!row.id||row.id==='root'||seen.has(row.id)||body?.file_id!==row.id||typeof body?.drive_id!=='string'||!body.drive_id)throw Error('阿里回收站请求无效');seen.add(row.id)
  const encoded=JSON.stringify({driveId:body.drive_id,fileId:row.id});if(!pane.file?.(encoded))throw Error('阿里回收站文件已不在当前记录中')
  const key=JSON.stringify([row.url,body]);let job=session.jobs.get(key)
  if(!job){
   if(session.jobs.size>=128)throw Error('阿里待确认回收站操作过多')
   job={};session.jobs.set(key,job)
   const response=await call('adrive/v4/batch',{requests:[row],resource:'file'})
   if(!Array.isArray(response.responses)||response.responses.length!==1||response.responses[0]?.id!==row.id)throw Error('阿里回收站缺少匹配回执')
   const item=response.responses[0],value=item.body
   if(![200,201,204].includes(item.status)&&item.status!==202||value?.code||value?.file_id&&value.file_id!==row.id||value?.drive_id&&value.drive_id!==body.drive_id)throw Error('阿里回收站操作未确认或身份不匹配')
   if(value?.async_task_id){if(typeof value.async_task_id!=='string')throw Error('阿里回收站任务标识无效');job.task=value.async_task_id}
   if(item.status===202&&!job.task)throw Error('阿里回收站缺少异步任务标识')
   job.accepted=true
  }
  if(!job.accepted)throw Error('阿里回收站受理状态未知，请刷新确认，勿重复提交')
  if(job.task){
   let complete=false
   for(let attempt=0;attempt<60;attempt++){
    const result=await call('v2/async_task/get',{async_task_id:job.task})
    if(['Succeed','succeed','done'].includes(result.state)){complete=true;break}
    if(!['Running','running'].includes(result.state))throw Error('阿里回收站任务未成功')
    if(attempt<59){await new Promise(resolve=>setTimeout(resolve,1000));check()}
   }
   if(!complete)throw Error('阿里回收站任务仍在执行；重试继续确认原任务')
  }
  reslut.push({id:row.id,file_id:row.id});session.jobs.delete(key)
 }
 return {reslut}
}
