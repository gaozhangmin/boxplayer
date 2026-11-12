import type {Account} from '@/features/sources/contracts'
import {cloud189NativeScope} from '@/features/sources/cloud189'
import {cloud189FamilyId} from './electron/providers/cloud189Identity'
import {apiCloud189TrashBatch} from './electron/providers/cloud189Batch'
import {withCloud189BatchScope,Cloud189BatchRejected} from './cloud189BatchTransport'
import {cloud189FolderId} from './cloud189FolderTransport'
import {cloud189Directory} from './cloud189Directory'
import {assertCloud189Operation,beginCloud189Operation,endCloud189Operation} from './cloud189OperationScope'
import {mutationAccount} from './providerTransport'
import type {Cloud189MoveFile} from './cloud189Move'
interface Receipt{owner:string;parent:string;name:string;isDir:boolean;submitted:boolean;confirmed:boolean;taskId?:string;promise?:Promise<boolean>}
const pending=new Map<string,Receipt>()
export function pendingCloud189Trash(account:Account){
 const prefix=JSON.stringify([account.id]).slice(0,-1)+','
 return [...pending].filter(([key])=>key.startsWith(prefix)).map(([key,row])=>({file_id:JSON.parse(key)[1] as string,parent_file_id:row.parent,name:row.name,isDir:row.isDir}))
}
export function acknowledgeCloud189Trash(account:string,id:string){const key=JSON.stringify([account,id]);pending.delete(key);endCloud189Operation(account,id,'trash')}
export async function trashCloud189File(account:Account,file:Cloud189MoveFile,stillCurrent:()=>boolean){
 const identity=(value:Account)=>JSON.stringify([value.userId||'',value.deviceId||'',value.baseUrl]),owner=identity(account)
 const check=()=>{if(account.providerId!=='189'||identity(mutationAccount(account.id,'189'))!==owner)throw Error('天翼账号身份已变化');if(!stillCurrent())throw Error('来源已关闭或切换')}
 check();const location=cloud189NativeScope(file.file_id),parent=cloud189NativeScope(file.parent_file_id)
 cloud189FolderId(location.fileId);assertCloud189Operation(account.id,file.file_id,'trash')
 if(location.families||parent.families||(location.familyId||'')!==(parent.familyId||''))throw Error('天翼回收文件与父目录空间不匹配')
 const key=JSON.stringify([account.id,file.file_id]);let receipt=pending.get(key)
 if(receipt&&(receipt.owner!==owner||receipt.parent!==file.parent_file_id||receipt.name!==file.name||receipt.isDir!==file.isDir))throw Error('天翼此前回收操作尚未确认，请核对原文件')
 if(receipt?.promise)return receipt.promise
 if(!receipt){if(pending.size>=128)throw Error('天翼待确认回收操作过多');receipt={owner,parent:file.parent_file_id,name:file.name,isDir:file.isDir,submitted:false,confirmed:false};pending.set(key,receipt);beginCloud189Operation(account.id,file.file_id,'trash')}
 const entry=receipt,directory=()=>cloud189Directory(account,entry.parent,check)
 const work=(async()=>{
  if(!entry.submitted){
   const before=(await directory()).find(row=>row.id===file.file_id)
   if(!before||before.name!==entry.name||before.isDirectory!==entry.isDir)throw Error('天翼原文件详情已变化，请刷新确认')
  }
  if(!entry.confirmed&&(!entry.submitted||entry.taskId)){
   const originalId=location.familyId?cloud189FamilyId(location.familyId,location.fileId):location.fileId
   const result=await withCloud189BatchScope({account,type:'DELETE',originalId,file:{id:location.fileId,name:entry.name,isFolder:entry.isDir,familyId:location.familyId||''},check,taskId:()=>entry.taskId,submitted:()=>{entry.submitted=true},created:id=>{entry.taskId=id}},user=>apiCloud189TrashBatch(user,[originalId]))
   entry.confirmed=result.includes(originalId)
  }
  const present=(await directory()).some(row=>row.id===file.file_id)
  if(!entry.confirmed||present)throw Error('天翼移入回收站尚未确认；重试只查询原任务和目录，不会重复提交')
  check();return true
 })()
 entry.promise=work
 try{return await work}catch(cause){if(!entry.submitted||cause instanceof Cloud189BatchRejected){pending.delete(key);endCloud189Operation(account.id,file.file_id,'trash')};throw cause}finally{if(entry.promise===work)entry.promise=undefined}
}
