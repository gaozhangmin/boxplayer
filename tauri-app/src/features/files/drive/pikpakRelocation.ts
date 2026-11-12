import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {apiPikPakMoveBatch,apiPikPakCopyBatch} from './electron/providers/pikpakFileCmd'
import {apiPikPakFileDetail} from './electron/providers/pikpakMetadata'
import {pikpakParent,pikpakId,pikpakFileCheck} from './pikpakFileTransport'
import {withPikpakBatchScope,finishPikpakBatch} from './pikpakBatchTransport'
export async function relocatePikPakFile(account:Account,file:IAliGetFileModel,parent:string,copy:boolean,stillCurrent:()=>boolean){
 const check=()=>{if(!stillCurrent())throw Error('PikPak 文件操作来源已切换');pikpakFileCheck(account.id)};check();pikpakId(file.file_id)
 const location=pikpakParent(parent),destination=location==='pikpak_root'?'':location
 if(destination){const target=await apiPikPakFileDetail(account.id,destination);check();if(!target||target.kind!=='drive#folder')throw Error('PikPak 目标不是文件夹')}
 const ids=await withPikpakBatchScope(account.id,check,()=> (copy?apiPikPakCopyBatch:apiPikPakMoveBatch)(account.id,[file.file_id],location));check()
 if(!ids.includes(file.file_id))throw Error('PikPak 未确认文件操作')
 let name:string|undefined
 if(!copy){const detail=await apiPikPakFileDetail(account.id,file.file_id);check();if(!detail||(detail.kind==='drive#folder')!==file.isDir||(detail.parent_id||'')!==destination)throw Error('PikPak 移动位置或类型未确认，请刷新确认');name=detail.name}
 finishPikpakBatch(account.id,copy?'batchCopy':'batchMove',[file.file_id],destination)
 return {ids,name}
}
