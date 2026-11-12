import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {request,text} from '@/features/sources/transport'
import {getDrivePane} from './ports'
import {aliFolderAccount} from './aliFolderTransport'
import {checkAliTrashContext} from './aliTrashContext'
type Receipt={operation:string;owner:string;known:IAliGetFileModel;submitted:boolean;accepted:boolean;rejected?:boolean;task?:string;done:boolean;running?:Promise<{id:string;file_id:string}>}
const receipts=new Map<string,Receipt>()
const key=(account:Account,id:string)=>JSON.stringify([account.id,id])
export function acknowledgeOpenAliTrash(account:Account,id:string){const receipt=receipts.get(key(account,id));if(receipt?.owner===JSON.stringify(account)&&receipt.done)receipts.delete(key(account,id))}
export async function openAliTrashBatch(account:Account,rows:string[],share:string){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{checkAliTrashContext(account.id);if(account.providerId!=='alipan-open'||getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(aliFolderAccount(account.id))!==owner)throw Error('阿里开放回收站来源或账号已变化')}
 check();if(share)throw Error('回收站不接受分享令牌')
 const seen=new Set<string>(),prepared=rows.map(raw=>{
  const row=JSON.parse(raw),body=row?.body
  if(!['/recyclebin/trash','/file/delete'].includes(row?.url)||row.method!=='POST'||typeof row.id!=='string'||!row.id||row.id==='root'||seen.has(row.id)||body?.file_id!==row.id||typeof body.drive_id!=='string'||!body.drive_id||Object.keys(body).some(key=>!['drive_id','file_id'].includes(key)))throw Error('阿里开放放回收站请求无效');seen.add(row.id)
  const id=JSON.stringify({driveId:body.drive_id,fileId:row.id}),known=pane.file?.(id)
  if(!known||known.drive_id!==account.id||known.file_id!==id||!known.name)throw Error('阿里开放文件不在当前来源记录中')
  let parent:any;try{parent=JSON.parse(known.parent_file_id)}catch{throw Error('阿里开放原目录无效')}
  if(parent?.driveId!==body.drive_id||typeof parent.fileId!=='string'||!parent.fileId)throw Error('阿里开放原目录身份不匹配')
  return {row,body,id,known:{...known},parent:parent.fileId as string}
 })
 const result:Array<{id:string;file_id:string}>=[]
 for(const input of prepared){
  check();const receiptKey=key(account,input.id);let receipt=receipts.get(receiptKey)
  if(receipt&&(receipt.operation!==input.row.url||receipt.owner!==owner||receipt.known.name!==input.known.name||receipt.known.isDir!==input.known.isDir||receipt.known.parent_file_id!==input.known.parent_file_id))throw Error('阿里开放待确认删除身份已变化，勿重复提交')
  if(!receipt){if(receipts.size>=128)throw Error('阿里开放待确认操作过多，请先核对原操作');receipt={operation:input.row.url,owner,known:input.known,submitted:false,accepted:false,done:false};receipts.set(receiptKey,receipt)}
  const entry=receipt
  const call=async(path:string,body:unknown,received?:(status:number,data:any)=>void)=>{
   check();const response=await request(account,'POST','https://openapi.alipan.com/adrive/v1.0/openFile/'+path,JSON.stringify(body),{'Content-Type':'application/json'})
   const data=response.body.length?JSON.parse(text(response)):{};if(!data||typeof data!=='object'||Array.isArray(data))throw Error('阿里开放回收站响应无效')
   received?.(response.status,data);check();return {status:response.status,data}
  }
  if(!entry.running)entry.running=(async()=>{
   if(entry.done)return {id:input.row.id,file_id:input.row.id}
   if(!entry.submitted){
    const before=await call('get',{drive_id:input.body.drive_id,file_id:input.row.id}),file=before.data
    if(before.status!==200||file.code||file.file_id!==input.row.id||file.drive_id!==input.body.drive_id||file.parent_file_id!==input.parent||file.name!==input.known.name||file.type!==(input.known.isDir?'folder':'file')||file.trashed===true)throw Error('阿里开放删除前文件身份未确认')
    check();entry.submitted=true
    const deleting=input.row.url==='/file/delete'
    await call(deleting?'delete':'recyclebin/trash',input.body,(status,data)=>{
     if(deleting&&[200,202,204].includes(status)&&(![200,202].includes(status)||data.file_id!==input.row.id||data.drive_id!==input.body.drive_id))throw Error('阿里开放文件删除回执身份不匹配')
     if(![200,202,204].includes(status)||data.code||data.file_id!==undefined&&data.file_id!==input.row.id||data.drive_id!==undefined&&data.drive_id!==input.body.drive_id){if([400,401,403,429].includes(status)&&['QuotaExhausted.Drive','AccessTokenExpired','InvalidAccessToken','AccessTokenInvalid'].includes(data.code)&&!data.async_task_id)entry.rejected=true;throw Error('阿里开放回收站未确认受理')}
     if(data.async_task_id!==undefined&&data.async_task_id!==''){if(typeof data.async_task_id!=='string'||!data.async_task_id||data.async_task_id.length>4096||/[\u0000-\u001f/\\]/.test(data.async_task_id))throw Error('阿里开放回收站任务标识无效');entry.task=data.async_task_id}
     if(status===202&&!entry.task)throw Error('阿里开放回收站缺少异步任务标识');entry.accepted=true
    })
   }
   if(!entry.accepted)throw Error('阿里开放回收站受理状态未知，请刷新确认，勿重复提交')
   if(entry.task){let complete=false
    for(let attempt=0;attempt<60;attempt++){const task=await call('async_task/get',{async_task_id:entry.task});if(task.status!==200||task.data.code)throw Error('阿里开放回收站任务尚未确认');if(task.data.state==='Succeed'){complete=true;break}if(task.data.state!=='Running')throw Error('阿里开放回收站任务未成功');if(attempt<59){await new Promise(resolve=>setTimeout(resolve,1000));check()}}
    if(!complete)throw Error('阿里开放回收站任务仍在执行；重试只确认原任务')
   }
   const after=await call('get',{drive_id:input.body.drive_id,file_id:input.row.id})
   const absent=after.status===404&&['FileIdNotFound','NotFound.File','NotFound.FileId'].includes(after.data.code)
   const trashed=after.status===200&&!after.data.code&&after.data.file_id===input.row.id&&after.data.drive_id===input.body.drive_id&&after.data.name===input.known.name&&after.data.type===(input.known.isDir?'folder':'file')&&after.data.trashed===true
   if(!absent&&(input.row.url==='/file/delete'||!trashed))throw Error('阿里开放文件仍未确认移出原目录，请刷新核对')
   entry.done=true;return {id:input.row.id,file_id:input.row.id}
  })()
  const pending=entry.running;try{result.push(await pending)}finally{if(entry.running===pending)entry.running=undefined;if(entry.rejected&&receipts.get(receiptKey)===entry)receipts.delete(receiptKey)}
 }
 return {reslut:result}
}
