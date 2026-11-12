import {trashBaiduFile} from './baiduBatchMutations'
import {trashCloud139File} from './cloud139BatchMutations'
import {trashCloud189File} from './cloud189Trash'
import {quarkTrashPage} from './quarkTrash'
import {trashQuarkFile} from './quarkTrashMutation'
import {apiGuangyaTrashBatch} from './electron/providers/guangyaFileCmd'
import {guangyaId} from './guangyaFileTransport'
import {mutatePikpakTrash} from './pikpakTrash'
import {listPikPak} from './pikpakListing'
import {apiPikPakFileDetail} from './electron/providers/pikpakMetadata'
import type {Account,SourceEntry} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {playable} from '@/features/sources/transport'
import {mutationAccount,googleDriveRequest,boxApiRequest} from './providerTransport'
import {apiBoxDeleteBatch,apiBoxTrashListPage,apiBoxTrashRestore,apiBoxTrashPurge} from './electron/providers/box'
import {apiGoogleTrashBatch,apiGoogleTrashRestoreBatch,apiGoogleDeleteBatch,apiGoogleEmptyTrash} from './electron/providers/google'
import {buildGoogleTrashListPath,apiGoogleFileDetail} from './electron/providers/googleMetadata'
import {apiDropboxDeleteBatch} from './electron/providers/dropbox'
import {apiOneDriveDeleteBatch} from './electron/providers/onedrive'
import {apiCloud123TrashBatch,apiCloud123RecoverBatch,apiCloud123FileDetail,apiCloud123TrashDeleteAll} from './electron/providers/cloud123FileCmd'
import {apiCloud123FileListPage} from './electron/providers/cloud123List'
import {cloud123Id} from './cloud123FileTransport'
import {mutateAliTrash,restoredAliDetail} from './aliTrashMutations'
import {apiDrive115TrashBatch,apiDrive115TrashList,apiDrive115TrashRestore,apiDrive115TrashDelete,apiDrive115TrashClear} from './electron/providers/drive115Trash'
import {drive115Id,drive115Detail} from './drive115FileTransport'
import {aliTrashPage} from './aliTrashListing'
export type TrashOperation='trash'|'restore'|'purge'|'permanent'
export const supportsRemoteTrash=(account:Account)=>['box','google','123','aliyun','115','pikpak','quark'].includes(account.providerId)
export const supportsRemoteTrashRestore=(account:Account)=>account.providerId!=='quark'&&supportsRemoteTrash(account)
export const supportsRemoteTrashDelete=(account:Account)=>['box','google','aliyun','115','pikpak'].includes(account.providerId)
export const supportsRemoteDirectDelete=(account:Account)=>account.providerId==='alipan-open'||supportsRemoteTrashDelete(account)&&!['box','115'].includes(account.providerId)
export const supportsRemoteTrashEmpty=(account:Account)=>['box','google','aliyun','115','pikpak','123'].includes(account.providerId)
export const supportsRemoteTrashMove=(account:Account)=>supportsRemoteTrash(account)||['dropbox','onedrive','123','aliyun','alipan-open','115','guangya','189','139','baidu'].includes(account.providerId)
export interface TrashEntry extends SourceEntry{originalParent:string;modified?:number}
function entry(id:unknown,name:unknown,isDir:boolean,size:unknown,parent:unknown,modified:unknown):TrashEntry{
 if(typeof id!=='string'||!id||typeof name!=='string'||!name)throw Error('回收站项目缺少标识或名称')
 return {id,name,isDirectory:isDir,size:Number(size)||0,playable:!isDir&&playable(name),originalParent:typeof parent==='string'&&parent!=='0'?parent:'',modified:typeof modified==='string'?Date.parse(modified)||0:0}
}
export async function trashPage(account:Account,cursor?:string):Promise<{entries:TrashEntry[];nextCursor?:string}>{
 mutationAccount(account.id,account.providerId)
 if(!supportsRemoteTrash(account))throw Error('此来源回收站尚未接入')
 if(account.providerId==='quark')return quarkTrashPage(account,cursor)
 if(account.providerId==='pikpak')return listPikPak(account,'',cursor,true)
 if(account.providerId==='aliyun')return aliTrashPage(account,cursor)
 if(account.providerId==='115'){
  if(cursor&&!/^(0|[1-9]\d*)$/.test(cursor))throw Error('115 回收站游标无效');const offset=Number(cursor||0);if(!Number.isSafeInteger(offset)||offset<0)throw Error('115 回收站游标无效')
  const page=await apiDrive115TrashList(account.id,200,offset)
  return {entries:page.items.map(row=>{const time=Number(row.dtime),modified=Number.isFinite(time)&&time>0?new Date(time<1e12?time*1000:time).toISOString():'';return entry(String(row.id),row.file_name,String(row.type)==='2',row.file_size,row.cid===undefined?'':String(row.cid),modified)}),nextCursor:offset+page.items.length<page.total?String(offset+page.items.length):undefined}
 }
 if(account.providerId==='123'){
  if(cursor)cloud123Id(cursor,true)
  const page=await apiCloud123FileListPage(account.id,'0',100,true,'',0,cursor||'',true)
  if(cursor&&String(page.lastFileId)===cursor)throw Error('123 回收站分页游标重复')
  return {entries:page.items.map(row=>entry(String(row.fileId),row.filename,row.type===1,row.size,String(row.parentFileId),row.updateAt||row.createAt)),nextCursor:page.lastFileId<0?undefined:String(page.lastFileId)}
 }
 if(account.providerId==='box'){
  const page=await apiBoxTrashListPage(account.id,cursor||'')
  return {entries:page.items.map(item=>{if(item.type!=='file'&&item.type!=='folder')throw Error('回收站项目类型无效');return entry(item.id,item.name,item.type==='folder',item.size,item.parent?.id,item.modified_at)}),nextCursor:page.nextMarker||undefined}
 }
 const page=await googleDriveRequest<{files?:Array<Record<string,any>>;nextPageToken?:unknown}>(account.id,buildGoogleTrashListPath(cursor||''),{method:'GET'},'读取回收站失败')
 if(!Array.isArray(page?.files)||page.nextPageToken!==undefined&&typeof page.nextPageToken!=='string')throw Error('Google Drive 回收站列表响应无效')
 return {entries:page.files.map(item=>{if(item.trashed!==true)throw Error('回收站列表包含非回收项目');return entry(item.id,item.name,item.mimeType==='application/vnd.google-apps.folder',item.size,item.parents?.[0],item.modifiedTime)}),nextCursor:typeof page.nextPageToken==='string'?page.nextPageToken||undefined:undefined}
}
export async function mutateTrash(account:Account,files:IAliGetFileModel[],operation:TrashOperation,stillCurrent:()=>boolean){
 mutationAccount(account.id,account.providerId)
 if(!(operation==='trash'?supportsRemoteTrashMove(account):operation==='permanent'?supportsRemoteDirectDelete(account):supportsRemoteTrash(account))||operation==='permanent'&&['box','115'].includes(account.providerId))throw Error('此来源不支持该删除操作')
 if(operation==='restore'&&!supportsRemoteTrashRestore(account))throw Error('此来源不支持还原操作')
 if(operation==='purge'&&!supportsRemoteTrashDelete(account))throw Error('此来源不支持该删除操作')
 if(!files.length||new Set(files.map(file=>file.file_id)).size!==files.length||files.some(file=>!file.file_id||file.drive_id!==account.id))throw Error('回收站操作来源或选择无效')
 const success:string[]=[],failures:string[]=[]
 for(const file of files){
  if(!stillCurrent()){failures.push('来源已关闭或切换，停止后续操作');break}
  try{
   let confirmed=false
   if(account.providerId==='baidu'){confirmed=await trashBaiduFile(account,file,stillCurrent)
   }else if(account.providerId==='139'){confirmed=await trashCloud139File(account,file,stillCurrent)
   }else if(account.providerId==='189'){confirmed=await trashCloud189File(account,file,stillCurrent)
   }else if(account.providerId==='quark'){confirmed=await trashQuarkFile(account,file,stillCurrent)
   }else if(account.providerId==='pikpak'){confirmed=await mutatePikpakTrash(account,file,operation,stillCurrent)
   }else if(['aliyun','alipan-open'].includes(account.providerId)){confirmed=await mutateAliTrash(account,file,operation,stillCurrent)
   }else if(account.providerId==='115'){
    confirmed=(await (operation==='trash'?apiDrive115TrashBatch:operation==='restore'?apiDrive115TrashRestore:apiDrive115TrashDelete)(account.id,[drive115Id(file.file_id)])).includes(file.file_id)
   }else if(account.providerId==='123'){
    confirmed=(await (operation==='restore'?apiCloud123RecoverBatch:apiCloud123TrashBatch)(account.id,[cloud123Id(file.file_id)])).includes(file.file_id)
   }else if(account.providerId==='guangya'){
    confirmed=(await apiGuangyaTrashBatch(account.id,[guangyaId(file.file_id)])).includes(file.file_id)
   }else if(account.providerId==='onedrive'){
    confirmed=(await apiOneDriveDeleteBatch(account.id,[file.file_id])).includes(file.file_id)
   }else if(account.providerId==='dropbox'){
    confirmed=(await apiDropboxDeleteBatch(account.id,[file.file_id],()=>{if(!stillCurrent())throw Error('来源已切换')})).includes(file.file_id)
   }else if(account.providerId==='box'){
    const type=file.isDir?'folder':'file'
    confirmed=operation==='trash'?!(await apiBoxDeleteBatch(account.id,[file.file_id],{[file.file_id]:type})).includes(file.file_id):operation==='restore'?await apiBoxTrashRestore(account.id,file.file_id,type):await apiBoxTrashPurge(account.id,file.file_id,type)
   }else{
    const result=await (operation==='trash'?apiGoogleTrashBatch:operation==='restore'?apiGoogleTrashRestoreBatch:apiGoogleDeleteBatch)(account.id,[file.file_id])
    confirmed=operation==='trash'?!result.includes(file.file_id):result.includes(file.file_id)
   }
   if(!confirmed)throw Error('提供商未确认操作成功')
   success.push(file.file_id)
  }catch(cause){failures.push(file.name+'：'+(cause instanceof Error?cause.message:'操作失败'))}
 }
 return {success,failures}
}
export async function emptyDrive115Trash(account:Account,stillCurrent:()=>boolean){if(account.providerId!=='115')throw Error('115 回收站来源不匹配');if(!stillCurrent())throw Error('来源已切换');mutationAccount(account.id,'115');if(!await apiDrive115TrashClear(account.id))throw Error('115 未确认清空回收站')}
export async function emptyGoogleTrash(account:Account){if(account.providerId!=='google')throw Error('回收站来源不匹配');mutationAccount(account.id,'google');if(!await apiGoogleEmptyTrash(account.id))throw Error('Google Drive 未确认清空回收站')}
export async function emptyCloud123Trash(account:Account,stillCurrent:()=>boolean){
 const owner=JSON.stringify(account)
 const check=()=>{if(account.providerId!=='123'||!stillCurrent()||JSON.stringify(account)!==owner||JSON.stringify(mutationAccount(account.id,'123'))!==owner)throw Error('来源或账号已变化，停止清空回收站')}
 check();if(!await apiCloud123TrashDeleteAll(account.id))throw Error('123 未确认清空回收站，请刷新核对')
 check();const page=await trashPage(account);check()
 if(page.entries.length||page.nextCursor)throw Error('123 回收站仍有项目或未完成分页，请刷新核对')
}
export async function restoredDetails(account:Account,files:IAliGetFileModel[]){
 const result:IAliGetFileModel[]=[]
 for(const file of files){
  if(account.providerId==='pikpak'){const detail=await apiPikPakFileDetail(account.id,file.file_id);if(!detail||(detail.kind==='drive#folder')!==file.isDir)throw Error('PikPak 已还原条目详情不匹配');result.push({...file,name:detail.name,parent_file_id:detail.parent_id||''});continue}
  if(account.providerId==='aliyun'){result.push(await restoredAliDetail(account,file));continue}
  if(account.providerId==='115'){const detail=await drive115Detail(account.id,file.file_id);if(detail.isDir!==file.isDir)throw Error('115 已还原文件类型不匹配');result.push({...file,name:detail.name,parent_file_id:''});continue}
  if(account.providerId==='123'){
   const row=await apiCloud123FileDetail(account.id,cloud123Id(file.file_id)),id=String(row?.fileId??row?.fileID??row?.file_id??''),parent=String(row?.parentFileId??row?.parentFileID??row?.parent_file_id??'')
   cloud123Id(id);cloud123Id(parent,true)
   if(id!==file.file_id||row?.trashed===1||typeof row?.filename!=='string'||!row.filename||![0,1].includes(row?.type)||Boolean(row.type===1)!==file.isDir)throw Error('123 已还原文件详情不匹配')
   result.push({...file,name:row.filename,parent_file_id:parent==='0'?'':parent});continue
  }
  const detail=account.providerId==='google'?await apiGoogleFileDetail(account.id,file.file_id):await boxApiRequest<{id:string;name:string;parent?:{id?:string}}>(account.id,`/${file.isDir?'folders':'files'}/${encodeURIComponent(file.file_id)}?fields=id,name,parent`,{method:'GET'},'读取已还原目录失败')
  if(detail.id!==file.file_id)throw Error('已还原文件标识不匹配')
  const parent='parents'in detail?(detail.parents as string[]|undefined)?.[0]:(detail as {parent?:{id?:string}}).parent?.id
  result.push({...file,parent_file_id:parent==='0'?'':parent||'',name:detail.name||file.name})
 }
 return result
}
