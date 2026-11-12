import {Cloud139RequestRejected} from '@/features/sources/cloud139Errors'
import {assertCloud139Operation,beginCloud139Operation,endCloud139Operation} from './cloud139OperationScope'
import type {Account,SourceEntry} from '@/features/sources/contracts'
import {cloud139} from '@/features/sources/cloud139'
import {mutationAccount} from './providerTransport'
import {cloud139Id,withCloud139MutationScope} from './cloud139FileTransport'
import {apiCloud139Mkdir,apiCloud139Rename} from './electron/providers/cloud139FileCmd'
const identity=(account:Account)=>JSON.stringify([account.userId||'',account.deviceId||'',account.baseUrl])
export function cloud139Guard(account:Account,stillCurrent:()=>boolean){
 const owner=identity(account)
 return ()=>{if(account.providerId!=='139'||identity(mutationAccount(account.id,'139'))!==owner)throw Error('139 账号身份已变化');if(!stillCurrent())throw Error('来源已关闭或切换')}
}
export async function cloud139Directory(account:Account,parent:string,check:()=>void){
 const entries:SourceEntry[]=[],ids=new Set<string>(),cursors=new Set<string>();let cursor:string|undefined
 do{
  check();const page=await cloud139.list(account,parent,cursor);check()
  for(const row of page.entries){cloud139Id(row.id);if(ids.has(row.id))throw Error('139 目录存在重复标识');ids.add(row.id);entries.push(row)}
  if(entries.length>100000)throw Error('139 操作确认目录过大')
  cursor=page.nextCursor;if(cursor){if(cursors.has(cursor))throw Error('139 目录分页重复');cursors.add(cursor)}
 }while(cursor)
 return entries
}
export async function createCloud139Folder(account:Account,parent:string,name:string,stillCurrent:()=>boolean=()=>true){
 const check=cloud139Guard(account,stillCurrent);check();parent=cloud139Id(parent,true)
 const result=await withCloud139MutationScope({account,endpoint:'/file/create',body:{parentFileId:parent,name,description:'',type:'folder',fileRenameMode:'force_rename'},check,onSubmit:()=>{}},user=>apiCloud139Mkdir(user,parent,name));check()
 if(result.error||!result.file_id)throw Error(result.error||'139 未返回新文件夹标识')
 cloud139Id(result.file_id)
 const actual=(await cloud139Directory(account,parent,check)).find(row=>row.id===result.file_id)
 // force_rename belongs to the original provider request: a conflict may return
 // a different name. Keep that actual directory, never manufacture its ID.
 if(!actual||!actual.isDirectory)throw Error('139 新文件夹尚未在目标目录确认，请刷新后核对')
 return {file_id:actual.id,error:''}
}
interface RenameReceipt{owner:string;parent:string;name:string;isDir:boolean;submitted:boolean;promise?:Promise<{file_id:string;name:string;parent_file_id:string;isDir:boolean}>}
const renames=new Map<string,RenameReceipt>()
export async function renameCloud139File(account:Account,file:{file_id:string;parent_file_id:string;name?:string;isDir:boolean},name:string,stillCurrent:()=>boolean){
 const check=cloud139Guard(account,stillCurrent);check()
 const id=cloud139Id(file.file_id),parent=cloud139Id(file.parent_file_id,true),owner=identity(account),key=JSON.stringify([account.id,id])
 assertCloud139Operation(account.id,id,'rename')
 let receipt=renames.get(key)
 if(receipt&&(receipt.owner!==owner||receipt.parent!==parent||receipt.name!==name||receipt.isDir!==file.isDir))throw Error('139 此前重命名尚未确认，请先重试原目标名称')
 if(receipt?.promise)return receipt.promise
 if(!receipt){if(renames.size>=128)throw Error('139 待确认重命名过多');receipt={owner,parent,name,isDir:file.isDir,submitted:false};renames.set(key,receipt);beginCloud139Operation(account.id,id,'rename')}
 const entry=receipt
 const work=(async()=>{
  if(!entry.submitted){
   const before=(await cloud139Directory(account,parent,check)).find(row=>row.id===id)
   if(!before||before.isDirectory!==file.isDir||file.name!==undefined&&before.name!==file.name)throw Error('139 原文件详情已变化，请刷新确认')
   // The original API catches unknown errors; confirm actual metadata. Mark
   // submission only at the scoped native boundary, after parameter checks.
   await withCloud139MutationScope({account,endpoint:'/file/update',body:{fileId:id,fileName:name},check,onSubmit:()=>{entry.submitted=true}},user=>apiCloud139Rename(user,id,name))
  }
  const actual=(await cloud139Directory(account,parent,check)).find(row=>row.id===id)
  if(!actual||actual.name!==name||actual.isDirectory!==file.isDir)throw Error('139 重命名尚未确认；重试只查询目录，不会重复提交')
  renames.delete(key);endCloud139Operation(account.id,id,'rename')
  return {file_id:id,name,parent_file_id:file.parent_file_id,isDir:file.isDir}
 })()
 entry.promise=work
 try{return await work}catch(cause){if(!entry.submitted||cause instanceof Cloud139RequestRejected){renames.delete(key);endCloud139Operation(account.id,id,'rename')};throw cause}finally{if(entry.promise===work)entry.promise=undefined}
}
