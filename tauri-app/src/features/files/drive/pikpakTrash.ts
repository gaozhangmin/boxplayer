import {clearOriginalPikpakTrash} from './electron/providers/pikpakEmptyTrash'
import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {apiPikPakTrashBatch,apiPikPakTrashRestore,apiPikPakTrashDelete} from './electron/providers/pikpakFileCmd'
import {apiPikPakFileDetail} from './electron/providers/pikpakMetadata'
import {listPikPak} from './pikpakListing'
import {pikpakFileCheck,pikpakId} from './pikpakFileTransport'
import {withPikpakBatchScope,finishPikpakBatch} from './pikpakBatchTransport'
export async function mutatePikpakTrash(account:Account,file:IAliGetFileModel,operation:'trash'|'restore'|'purge'|'permanent',stillCurrent:()=>boolean){
 const check=()=>{if(!stillCurrent())throw Error('PikPak 回收操作来源已切换');pikpakFileCheck(account.id)};check();pikpakId(file.file_id)
 const action=operation==='trash'?'batchTrash':operation==='restore'?'batchUntrash':'batchDelete'
 const method=operation==='trash'?apiPikPakTrashBatch:operation==='restore'?apiPikPakTrashRestore:apiPikPakTrashDelete
 const ids=await withPikpakBatchScope(account.id,check,()=>method(account.id,[file.file_id]));check()
 if(!ids.includes(file.file_id))throw Error('PikPak 未确认回收站操作')
 if(operation==='trash'){
  let cursor:string|undefined,found=false
  do{const page=await listPikPak(account,'',cursor,true);check();const row=page.entries.find(row=>row.id===file.file_id);if(row){if(row.isDirectory!==file.isDir)throw Error('PikPak 已删除条目类型不匹配');found=true;break}cursor=page.nextCursor}while(cursor)
  if(!found)throw Error('PikPak 回收站尚未确认已删除条目，请刷新确认')
 }else if(operation==='restore'){
  const detail=await apiPikPakFileDetail(account.id,file.file_id);check()
  if(!detail||(detail.kind==='drive#folder')!==file.isDir)throw Error('PikPak 还原条目身份或类型未确认')
 }
 finishPikpakBatch(account.id,action,[file.file_id],'')
 return true
}

// Native boundary for Electron topTrashDeleteAll's PikPak branch: snapshot all
// pages before deleting in chunks of 100. Never mutate while enumerating pages.
export async function emptyPikpakTrash(account:Account,stillCurrent:()=>boolean,onListed:(row:Awaited<ReturnType<typeof listPikPak>>['entries'][number])=>void){
 const success:string[]=[],failures:string[]=[],seen=new Set<string>()
 const check=()=>{if(!stillCurrent())throw Error('PikPak 回收操作来源已切换');pikpakFileCheck(account.id)}
 try{
  await clearOriginalPikpakTrash(account.id,async token=>{
   check();const page=await listPikPak(account,'',token||undefined,true);check()
   for(const row of page.entries){if(seen.has(row.id))throw Error('PikPak 回收站分页重复项目');seen.add(row.id);onListed(row)}
   return {items:page.entries,nextPageToken:page.nextCursor||''}
  },async ids=>{
   check();const deleted=await withPikpakBatchScope(account.id,check,()=>apiPikPakTrashDelete(account.id,ids))
   if(deleted.length!==ids.length||ids.some(id=>!deleted.includes(id)))throw Error('部分 PikPak 回收站文件删除失败')
   success.push(...deleted);finishPikpakBatch(account.id,'batchDelete',ids,'')
   check();return deleted
  })
 }catch(cause){failures.push(cause instanceof Error?cause.message:'清空 PikPak 回收站失败')}
 return {success,failures}
}
