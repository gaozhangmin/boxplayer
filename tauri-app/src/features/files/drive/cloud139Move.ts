import {Cloud139RequestRejected} from '@/features/sources/cloud139Errors'
import type {Account} from '@/features/sources/contracts'
import {cloud139Id,withCloud139MutationScope} from './cloud139FileTransport'
import {cloud139Guard,cloud139Directory} from './cloud139FileMutations'
import {apiCloud139MoveBatch} from './electron/providers/cloud139FileCmd'
import {assertCloud139Operation,beginCloud139Operation,endCloud139Operation} from './cloud139OperationScope'
interface Receipt{owner:string;parent:string;target:string;name:string;isDir:boolean;ancestors:string[];submitted:boolean;promise?:Promise<string[]>}
const pending=new Map<string,Receipt>()
export async function moveCloud139File(account:Account,file:{file_id:string;parent_file_id:string;name:string;isDir:boolean},destination:string,stillCurrent:()=>boolean,ancestors?:ReadonlyArray<string>){
 const check=cloud139Guard(account,stillCurrent);check()
 const id=cloud139Id(file.file_id),parent=cloud139Id(file.parent_file_id,true),target=cloud139Id(destination,true),key=JSON.stringify([account.id,id]),owner=JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl])
 assertCloud139Operation(account.id,id,'move')
 if(target===parent||target===id)throw Error('139 不能移动到原位置或自身')
 const path=ancestors?[...ancestors]:target==='/'?['']:undefined
 if(!path||!path.length||path[0]!==''||cloud139Id(path.at(-1),true)!==target||path.some((value,index)=>typeof value!=='string'||index>0&&cloud139Id(value,true)==='/')||new Set(path).size!==path.length||file.isDir&&path.includes(id))throw Error('139 目标目录路径无效或位于源文件夹内部')
 let receipt=pending.get(key)
 if(receipt&&(receipt.owner!==owner||receipt.parent!==parent||receipt.target!==target||receipt.name!==file.name||receipt.isDir!==file.isDir||JSON.stringify(receipt.ancestors)!==JSON.stringify(path)))throw Error('139 此前移动尚未确认，请重试原目标')
 if(receipt?.promise)return receipt.promise
 if(!receipt){if(pending.size>=128)throw Error('139 待确认移动过多');receipt={owner,parent,target,name:file.name,isDir:file.isDir,ancestors:path,submitted:false};pending.set(key,receipt);beginCloud139Operation(account.id,id,'move')}
 const entry=receipt
 const verifyPath=async()=>{
  let previous='/'
  for(const ancestor of entry.ancestors.slice(1)){
   const actual=(await cloud139Directory(account,previous,check)).find(row=>row.id===ancestor)
   if(!actual?.isDirectory)throw Error('139 目标目录层级已变化，请重新加载目录选择器')
   previous=ancestor
  }
 }
 const work=(async()=>{
  if(!entry.submitted){
   const before=(await cloud139Directory(account,parent,check)).find(row=>row.id===id)
   if(!before||before.name!==file.name||before.isDirectory!==file.isDir)throw Error('139 原文件详情已变化，请刷新确认')
   await verifyPath();check()
   // Original batch API catches transport errors. Confirm actual directories,
   // rather than treating its returned input IDs as completion.
   await withCloud139MutationScope({account,endpoint:'/file/batchMove',body:{fileIds:[id],parentFileId:target},check,onSubmit:()=>{entry.submitted=true}},user=>apiCloud139MoveBatch(user,[id],target))
  }
  await verifyPath()
  const actual=(await cloud139Directory(account,target,check)).find(row=>row.id===id)
  if(!actual||actual.name!==entry.name||actual.isDirectory!==entry.isDir)throw Error('139 移动尚未确认；重试只查询目录，不会重复提交')
  if((await cloud139Directory(account,parent,check)).some(row=>row.id===id))throw Error('139 原目录仍返回该文件，移动尚未确认')
  await verifyPath();check();pending.delete(key);endCloud139Operation(account.id,id,'move');return [id]
 })()
 entry.promise=work
 try{return await work}catch(cause){if(!entry.submitted||cause instanceof Cloud139RequestRejected){pending.delete(key);endCloud139Operation(account.id,id,'move')}throw cause}finally{if(entry.promise===work)entry.promise=undefined}
}
