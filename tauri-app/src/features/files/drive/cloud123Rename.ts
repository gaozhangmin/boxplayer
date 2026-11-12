import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {cloud123Id} from './cloud123FileTransport'
import {apiCloud123FileDetail,apiCloud123Rename,apiCloud123RenameBatch} from './electron/providers/cloud123FileCmd'
import {withCloud123RenameScope} from './cloud123RenameScope'

// Single-file requests retain their original PUT protocol.
export async function renameCloud123File(account:Account,file:{file_id:string;parent_file_id:string;isDir:boolean;name?:string},name:string,stillCurrent:()=>boolean){
 const owner=JSON.stringify(account)
 const check=()=>{if(!stillCurrent()||JSON.stringify(mutationAccount(account.id,'123'))!==owner)throw Error('123 重命名来源或账号已变化')}
 cloud123Id(file.file_id)
 const detail=async()=>{
  check()
  const row=await apiCloud123FileDetail(account.id,file.file_id)
  check()
  const id=String(row?.fileId??row?.fileID??row?.file_id??''),parent=String(row?.parentFileId??row?.parentFileID??row?.parent_file_id??'')
  cloud123Id(id);cloud123Id(parent,true)
  if(id!==file.file_id||parent!==(file.parent_file_id||'0')||row?.trashed===1||![0,1].includes(row?.type)||(row.type===1)!==file.isDir||typeof row.filename!=='string'||!row.filename)throw Error('123 重命名详情身份不匹配')
  return row.filename as string
 }
 const previous=await detail()
 if(previous!==name){
  if(previous!==file.name)throw Error('123 文件名称已变化，请刷新后重试')
  check()
  const result=await apiCloud123Rename(account.id,file.file_id,name)
  check()
  if(!result.success)throw Error(result.error||'123 未确认重命名')
  if(await detail()!==name)throw Error('123 未确认重命名后的名称，请刷新确认')
 }
 return {file_id:file.file_id,parent_file_id:file.parent_file_id,name,isDir:file.isDir}
}

export async function renameCloud123Batch(account:Account,files:Array<{file_id:string;parent_file_id:string;isDir:boolean;name:string}>,names:string[],stillCurrent:()=>boolean){
 const owner=JSON.stringify(account),check=()=>{if(!stillCurrent()||JSON.stringify(mutationAccount(account.id,'123'))!==owner)throw Error('123 批量重命名来源或账号已变化')}
 if(!files.length||files.length!==names.length||new Set(files.map(file=>file.file_id)).size!==files.length)throw Error('123 批量重命名参数无效')
 for(let index=0;index<files.length;index++){
  cloud123Id(files[index]!.file_id);cloud123Id(files[index]!.parent_file_id||'0',true)
  if(!names[index]?.trim()||/[\u0000-\u001f/\\|]/.test(names[index]!)||['.','..'].includes(names[index]!))throw Error('123 批量重命名名称无效')
 }
 const detail=async(index:number)=>{
  check();const file=files[index]!,row=await apiCloud123FileDetail(account.id,file.file_id);check()
  const id=String(row?.fileId??row?.fileID??row?.file_id??''),parent=String(row?.parentFileId??row?.parentFileID??row?.parent_file_id??'')
  cloud123Id(id);cloud123Id(parent,true)
  if(id!==file.file_id||parent!==(file.parent_file_id||'0')||row?.trashed===1||![0,1].includes(row?.type)||(row.type===1)!==file.isDir||typeof row.filename!=='string'||!row.filename)throw Error('123 批量重命名详情身份不匹配')
  return row.filename as string
 }
 // Validate the complete batch before any write. Explicit retries recognize
 // already-applied names and only submit rows still at their original name.
 const pending:number[]=[]
 for(let index=0;index<files.length;index++){const actual=await detail(index);if(actual===names[index])continue;if(actual!==files[index]!.name)throw Error('123 文件名称已变化，请刷新后重试');pending.push(index)}
 if(pending.length){
  const ids=pending.map(index=>files[index]!.file_id),values=pending.map(index=>names[index]!)
  await withCloud123RenameScope(account.id,ids.map((id,index)=>`${id}|${values[index]}`),check,()=>apiCloud123RenameBatch(account.id,ids,values))
 }
 check()
 const success:Array<{file_id:string;parent_file_id:string;name:string;isDir:boolean}>=[],failures:string[]=[]
 for(let index=0;index<files.length;index++){
  try{if(await detail(index)!==names[index])throw Error('123 未确认重命名后的名称');const file=files[index]!;success.push({file_id:file.file_id,parent_file_id:file.parent_file_id,name:names[index]!,isDir:file.isDir})}
  catch(cause){check();failures.push(files[index]!.name+'：'+(cause instanceof Error?cause.message:'123 未确认重命名'))}
 }
 return {success,failures}
}
