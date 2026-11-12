import {cloud189Directory,verifyCloud189Path} from './cloud189Directory'
import {assertCloud189Operation,beginCloud189Operation,endCloud189Operation} from './cloud189OperationScope'
import type {Account} from '@/features/sources/contracts'
import {cloud189NativeScope} from '@/features/sources/cloud189'
import {cloud189FamilyId} from './electron/providers/cloud189Identity'
import {apiCloud189MoveBatch} from './electron/providers/cloud189Batch'
import {withCloud189BatchScope,Cloud189BatchRejected} from './cloud189BatchTransport'
import {cloud189FolderId} from './cloud189FolderTransport'
import {mutationAccount} from './providerTransport'
export interface Cloud189MoveFile{file_id:string;parent_file_id:string;name:string;isDir:boolean}
interface Receipt{owner:string;parent:string;target:string;name:string;isDir:boolean;ancestors:string[];submitted:boolean;taskId?:string;promise?:Promise<string[]>}
const pending=new Map<string,Receipt>()
export function pendingCloud189Moves(account:Account){
 const prefix=JSON.stringify([account.id]).slice(0,-1)+','
 return [...pending].filter(([key])=>key.startsWith(prefix)).map(([key,row])=>({file_id:JSON.parse(key)[1] as string,parent_file_id:row.parent,name:row.name,isDir:row.isDir,target:row.target,ancestors:[...row.ancestors]}))
}
export function acknowledgeCloud189Move(account:string,id:string,target:string){const key=JSON.stringify([account,id]),row=pending.get(key);if(row?.target===target){pending.delete(key);endCloud189Operation(account,id,'move')}}
export async function moveCloud189File(account:Account,file:Cloud189MoveFile,destination:string,stillCurrent:()=>boolean,ancestors?:ReadonlyArray<string>){
 const identity=(value:Account)=>JSON.stringify([value.userId||'',value.deviceId||'',value.baseUrl]),owner=identity(account)
 const check=()=>{if(account.providerId!=='189'||identity(mutationAccount(account.id,'189'))!==owner)throw Error('天翼账号身份已变化');if(!stillCurrent())throw Error('来源已关闭或切换')}
 check();const location=cloud189NativeScope(file.file_id),parent=cloud189NativeScope(file.parent_file_id),target=cloud189NativeScope(destination)
 cloud189FolderId(location.fileId);assertCloud189Operation(account.id,file.file_id,'move')
 if(location.families||parent.families||target.families||(location.familyId||'')!==(parent.familyId||'')||(location.familyId||'')!==(target.familyId||''))throw Error('天翼移动文件与目标空间不匹配')
 if(destination===file.parent_file_id||destination===file.file_id)throw Error('天翼不能移动到原位置或自身')
 const path=ancestors?[...ancestors]:undefined
 if(!path?.length||path[0]!==''||path.at(-1)!==destination||new Set(path).size!==path.length||file.isDir&&path.includes(file.file_id))throw Error('天翼目标目录路径无效或位于源文件夹内部')
 const key=JSON.stringify([account.id,file.file_id]);let receipt=pending.get(key)
 if(receipt&&(receipt.owner!==owner||receipt.parent!==file.parent_file_id||receipt.target!==destination||receipt.name!==file.name||receipt.isDir!==file.isDir||JSON.stringify(receipt.ancestors)!==JSON.stringify(path)))throw Error('天翼此前移动尚未确认，请重试原目标')
 if(receipt?.promise)return receipt.promise
 if(!receipt){if(pending.size>=128)throw Error('天翼待确认移动过多');receipt={owner,parent:file.parent_file_id,target:destination,name:file.name,isDir:file.isDir,ancestors:path,submitted:false};pending.set(key,receipt);beginCloud189Operation(account.id,file.file_id,'move')}
 const entry=receipt
 const directory=(id:string)=>cloud189Directory(account,id,check)
 const verifyPath=()=>verifyCloud189Path(account,entry.ancestors,check)
 const work=(async()=>{
  if(!entry.submitted){
   const before=(await directory(entry.parent)).find(row=>row.id===file.file_id)
   if(!before||before.name!==file.name||before.isDirectory!==file.isDir)throw Error('天翼原文件详情已变化，请刷新确认')
   await verifyPath()
  }
  if(!entry.submitted||entry.taskId){
   const originalId=location.familyId?cloud189FamilyId(location.familyId,location.fileId):location.fileId,originalTarget=target.familyId?cloud189FamilyId(target.familyId,target.fileId):target.fileId
   await withCloud189BatchScope({account,type:'MOVE',originalId,target:originalTarget,file:{id:location.fileId,name:entry.name,isFolder:entry.isDir,familyId:location.familyId||''},check,taskId:()=>entry.taskId,submitted:()=>{entry.submitted=true},created:id=>{entry.taskId=id}},user=>apiCloud189MoveBatch(user,[originalId],originalTarget))
  }
  await verifyPath()
  const after=(await directory(entry.target)).find(row=>row.id===file.file_id)
  if(!after||after.name!==entry.name||after.isDirectory!==entry.isDir||(await directory(entry.parent)).some(row=>row.id===file.file_id))throw Error('天翼移动尚未确认；重试只查询原任务和目录，不会重复提交')
  check();return [file.file_id]
 })()
 entry.promise=work
 try{return await work}catch(cause){if(!entry.submitted||cause instanceof Cloud189BatchRejected){pending.delete(key);endCloud189Operation(account.id,file.file_id,'move')};throw cause}finally{if(entry.promise===work)entry.promise=undefined}
}
