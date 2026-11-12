import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {QuarkRequestRejected,quarkId} from './quarkFileTransport'
import {apiQuarkTrashBatch} from './electron/providers/quarkFileCmd'
import {quarkTrashPage} from './quarkTrash'

interface Receipt {identity:string;name:string;isDir:boolean;promise?:Promise<boolean>}
const pending=new Map<string,Receipt>()
const identity=(account:Account)=>JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl])

// Retain uncertain submissions in this process. Retrying observes the recycle
// record, rather than issuing another delete against a potentially restored file.
export async function trashQuarkFile(account:Account,file:{file_id:string;name:string;isDir:boolean},stillCurrent:()=>boolean){
 const id=quarkId(file.file_id),key=JSON.stringify([account.id,id]),owner=identity(account)
 const check=()=>{if(identity(mutationAccount(account.id,'quark'))!==owner)throw Error('夸克账号身份已变化');if(!stillCurrent())throw Error('来源已关闭或切换')}
 check()
 let receipt=pending.get(key)
 if(receipt&&(receipt.identity!==owner||receipt.name!==file.name||receipt.isDir!==file.isDir))throw Error('夸克此前回收操作尚未确认，请先核对原文件')
 if(receipt?.promise)return receipt.promise
 const submit=!receipt
 if(!receipt){if(pending.size>=128)throw Error('夸克待确认回收操作过多，请先确认已有操作');receipt={identity:owner,name:file.name,isDir:file.isDir};pending.set(key,receipt)}
 const entry=receipt
 const work=(async()=>{
  if(submit){check();try{await apiQuarkTrashBatch(account.id,[id])}catch(cause){if(cause instanceof QuarkRequestRejected){pending.delete(key);throw cause}/* Unknown submission: query only. */}}
  check()
  let cursor:string|undefined
  const seen=new Set<string>()
  do{
   const page=await quarkTrashPage(account,cursor);check()
   for(const row of page.entries){
    if(seen.has(row.id))throw Error('夸克回收记录跨页重复，请刷新确认')
    seen.add(row.id)
    if(row.id!==id)continue
    const marker=row.electronModel.description.match(/;quark_record:([^;]+)$/)?.[1]
    if(row.name!==entry.name||row.isDirectory!==entry.isDir||!marker)throw Error('夸克回收记录名称、类型或记录标识不匹配')
    quarkId(marker)
    pending.delete(key)
    return true
   }
   cursor=page.nextCursor
  }while(cursor)
  throw Error('夸克移入回收站尚未确认；重试只查询回收记录，不会重复提交')
 })()
 entry.promise=work
 try{return await work}finally{if(entry.promise===work)entry.promise=undefined}
}
