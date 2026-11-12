import {request,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
// Protocol reference (not copied code): rclone/backend/pikpak/helper.go,
// requestBatchAction/getTask/waitTask. This confirms one file command only;
// it is not a persistent transfer queue.
let binding:{user:string;check:()=>void}|undefined
export function withPikpakBatchScope<T>(user:string,check:()=>void,run:()=>T){const old=binding;binding={user,check};try{return run()}finally{binding=old}}
interface Receipt {submitted:boolean;taskId?:string;complete?:boolean;running?:Promise<{task_id:string}>}
const receipts=new Map<string,Receipt>()
const keyFor=(user:string,action:string,ids:string[],parent:string)=>JSON.stringify([user,action,[...ids].sort(),parent])
const validId=(id:unknown):id is string=>typeof id==='string'&&!!id&&id.length<=4096&&!/[\u0000-\u001f]/.test(id)
export function finishPikpakBatch(user:string,action:'batchMove'|'batchCopy'|'batchTrash'|'batchUntrash'|'batchDelete',ids:string[],parent:string){const key=keyFor(user,action,ids,parent);const receipt=receipts.get(key);if(!receipt)return;if(!receipt.complete)throw Error('PikPak 缺少已完成任务回执');receipts.delete(key)}
export async function pikpakBatchFetch(user:string,url:string,init:RequestInit){
 // All original batch/request methods invoke this port before their first await.
 // Capture the caller's guard now, while the short synchronous binding is active.
 const scope=binding;if(!scope||scope.user!==user)throw Error('PikPak 批量操作未绑定当前来源')
 const check=()=>{scope.check();mutationAccount(user,'pikpak')};check()
 const account=mutationAccount(user,'pikpak'),target=new URL(url),action=target.pathname.slice('/drive/v1/files:'.length)
 if(target.origin!=='https://api-drive.mypikpak.com'||!['batchMove','batchCopy','batchTrash','batchUntrash','batchDelete'].includes(action)||target.pathname!=='/drive/v1/files:'+action||target.search||init.method!=='POST'||typeof init.body!=='string')throw Error('PikPak 批量请求无效')
 const body=JSON.parse(init.body),ids=body?.ids,parent=body?.to?.parent_id??''
 const relocation=['batchMove','batchCopy'].includes(action)
 if(!Array.isArray(ids)||!ids.length||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length||relocation&&(!body.to||typeof body.to!=='object'||Array.isArray(body.to)||parent!==''&&!validId(parent)||Object.keys(body.to).some(key=>key!=='parent_id'))||!relocation&&body.to!==undefined||Object.keys(body).some(key=>!(relocation?['ids','to']:['ids']).includes(key)))throw Error('PikPak 批量选择或目标无效')
 const key=keyFor(user,action,ids,parent);let receipt=receipts.get(key)
 if(!receipt){receipt={submitted:false};receipts.set(key,receipt)}
 const record=receipt
 let running=record.running
 if(!running){
  running=(async()=>{
   if(!record.taskId){
    if(record.submitted)throw Error('PikPak 上次提交未取得可核验回执，请刷新确认；未重复提交')
    check();record.submitted=true
    const response=await request(account,'POST',url,init.body as string,{'Content-Type':'application/json'}),data=JSON.parse(text(response))
    if(data?.error){receipts.delete(key);throw Error(data.error_description||data.message||'PikPak 批量操作被拒绝')}
    if(!validId(data?.task_id))throw Error('PikPak 已接收请求但缺少任务标识，请刷新确认；未认定完成')
    record.taskId=data.task_id
   }
   for(let attempt=0;attempt<40;attempt++){
    check()
    if(record.complete)return {task_id:record.taskId!}
    const response=await request(account,'GET','https://api-drive.mypikpak.com/drive/v1/tasks/'+encodeURIComponent(record.taskId!)),task=JSON.parse(text(response));check()
    if(task?.error)throw Error(task.error_description||task.message||'PikPak 任务查询失败')
    if(task?.id!==record.taskId||task.kind!==undefined&&task.kind!=='drive#task'||task.user_id!==undefined&&task.user_id!==account.userId||!['PHASE_TYPE_PENDING','PHASE_TYPE_RUNNING','PHASE_TYPE_COMPLETE','PHASE_TYPE_ERROR'].includes(task.phase))throw Error('PikPak 任务身份或状态无效')
    if(task.phase==='PHASE_TYPE_ERROR'){receipts.delete(key);throw Error(task.message||'PikPak 文件任务失败')}
    if(task.phase==='PHASE_TYPE_COMPLETE'){record.complete=true;return {task_id:record.taskId!}}
    if(attempt<39)await new Promise<void>(resolve=>setTimeout(resolve,1000))
   }
   throw Error('PikPak 任务仍在处理中；重试只继续核验，不重复提交')
  })();record.running=running
 }
 try{const data=await running;check();return {ok:true,json:async()=>data}}finally{if(record.running===running)delete record.running}
}
