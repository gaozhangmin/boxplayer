import {assertCloud189Operation,beginCloud189Operation,endCloud189Operation} from './cloud189OperationScope'
import type {Account,SourceEntry} from '@/features/sources/contracts'
import {cloud189,cloud189NativeScope} from '@/features/sources/cloud189'
import {cloud189FamilyId} from './electron/providers/cloud189Identity'
import {apiCloud189Rename} from './electron/providers/cloud189Rename'
import {Cloud189RenameRejected,withCloud189RenameScope} from './cloud189RenameTransport'
import {cloud189FolderId} from './cloud189FolderTransport'
import {mutationAccount} from './providerTransport'
interface Result{file_id:string;name:string;parent_file_id:string;isDir:boolean}
interface Receipt{owner:string;parent:string;name:string;isDir:boolean;submitted:boolean;promise?:Promise<Result>}
const pending=new Map<string,Receipt>(),key=(account:string,id:string)=>JSON.stringify([account,id])
export const pendingCloud189RenameName=(account:string,id:string)=>pending.get(key(account,id))?.name
export function acknowledgeCloud189Rename(account:string,result:Result){const row=pending.get(key(account,result.file_id));if(row?.name===result.name&&row.parent===result.parent_file_id&&row.isDir===result.isDir){pending.delete(key(account,result.file_id));endCloud189Operation(account,result.file_id,'rename')}}
export async function renameCloud189File(account:Account,file:{file_id:string;parent_file_id:string;name?:string;isDir:boolean},name:string,stillCurrent:()=>boolean){
 const identity=(value:Account)=>JSON.stringify([value.userId||'',value.deviceId||'',value.baseUrl]),owner=identity(account)
 const check=()=>{if(account.providerId!=='189'||identity(mutationAccount(account.id,'189'))!==owner)throw Error('天翼账号身份已变化');if(!stillCurrent())throw Error('来源已关闭或切换')}
 check();const location=cloud189NativeScope(file.file_id),parent=cloud189NativeScope(file.parent_file_id)
 if(location.families||parent.families||(location.familyId||'')!==(parent.familyId||''))throw Error('天翼文件与父目录空间不匹配')
 cloud189FolderId(location.fileId);assertCloud189Operation(account.id,file.file_id,'rename')
 const operation=key(account.id,file.file_id);let receipt=pending.get(operation)
 if(receipt&&(receipt.owner!==owner||receipt.parent!==file.parent_file_id||receipt.name!==name||receipt.isDir!==file.isDir))throw Error('天翼此前重命名尚未确认或同步，请先重试原名称')
 if(receipt?.promise)return receipt.promise
 if(!receipt){if(pending.size>=128)throw Error('天翼待确认重命名过多');receipt={owner,parent:file.parent_file_id,name,isDir:file.isDir,submitted:false};pending.set(operation,receipt);beginCloud189Operation(account.id,file.file_id,'rename')}
 const entry=receipt
 const find=async()=>{
  let cursor:string|undefined;let count=0
  do{check();const page=await cloud189.list(account,file.parent_file_id,cursor);check();count+=page.entries.length;if(count>100000)throw Error('天翼重命名确认目录过大');const found=page.entries.find(row=>row.id===file.file_id);if(found)return found;cursor=page.nextCursor}while(cursor)
  return undefined
 }
 const matches=(row:SourceEntry|undefined)=>!!row&&row.isDirectory===file.isDir
 const work=(async()=>{
  if(!entry.submitted){
   const before=await find();if(!matches(before)||file.name!==undefined&&before!.name!==file.name)throw Error('天翼原文件详情已变化，请刷新确认')
   check();const originalId=location.familyId?cloud189FamilyId(location.familyId,location.fileId):location.fileId
   await withCloud189RenameScope({account,originalId,name,file:{id:location.fileId,name:before!.name,isFolder:file.isDir,familyId:location.familyId||'',parentId:parent.fileId},check,onSubmit:()=>{entry.submitted=true}},user=>apiCloud189Rename(user,originalId,name))
  }
  const after=await find();if(!matches(after)||after!.name!==name)throw Error('天翼重命名尚未确认；重试只查询目录，不会重复提交')
  return {file_id:file.file_id,parent_file_id:file.parent_file_id,name,isDir:file.isDir}
 })()
 entry.promise=work
 try{return await work}catch(cause){if(!entry.submitted||cause instanceof Cloud189RenameRejected){pending.delete(operation);endCloud189Operation(account.id,file.file_id,'rename')};throw cause}finally{if(entry.promise===work)entry.promise=undefined}
}
