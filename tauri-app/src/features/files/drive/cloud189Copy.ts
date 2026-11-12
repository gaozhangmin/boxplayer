import type {Account} from '@/features/sources/contracts'
import {cloud189NativeScope} from '@/features/sources/cloud189'
import {cloud189FamilyId} from './electron/providers/cloud189Identity'
import {apiCloud189CopyBatch} from './electron/providers/cloud189Batch'
import {withCloud189BatchScope,Cloud189BatchRejected} from './cloud189BatchTransport'
import {cloud189FolderId} from './cloud189FolderTransport'
import {cloud189Directory,verifyCloud189Path} from './cloud189Directory'
import {assertCloud189Operation,beginCloud189Operation,endCloud189Operation} from './cloud189OperationScope'
import {mutationAccount} from './providerTransport'
import type {Cloud189MoveFile} from './cloud189Move'
interface Receipt{owner:string;parent:string;target:string;name:string;isDir:boolean;ancestors:string[];submitted:boolean;taskId?:string;confirmed:boolean;before:string[];size?:number;promise?:Promise<string[]>}
const pending=new Map<string,Receipt>()
export async function copyCloud189File(account:Account,file:Cloud189MoveFile,destination:string,stillCurrent:()=>boolean,ancestors?:ReadonlyArray<string>){
 const identity=(value:Account)=>JSON.stringify([value.userId||'',value.deviceId||'',value.baseUrl]),owner=identity(account)
 const check=()=>{if(account.providerId!=='189'||identity(mutationAccount(account.id,'189'))!==owner)throw Error('天翼账号身份已变化');if(!stillCurrent())throw Error('来源已关闭或切换')}
 check();const location=cloud189NativeScope(file.file_id),parent=cloud189NativeScope(file.parent_file_id),target=cloud189NativeScope(destination)
 cloud189FolderId(location.fileId);assertCloud189Operation(account.id,file.file_id,'copy')
 if(location.families||parent.families||target.families||(location.familyId||'')!==(parent.familyId||'')||(location.familyId||'')!==(target.familyId||''))throw Error('天翼复制文件与目标空间不匹配')
 if(destination===file.parent_file_id||destination===file.file_id)throw Error('天翼不能复制到原位置或自身')
 const path=ancestors?[...ancestors]:undefined
 if(!path?.length||path[0]!==''||path.at(-1)!==destination||new Set(path).size!==path.length||file.isDir&&path.includes(file.file_id))throw Error('天翼目标目录路径无效或位于源文件夹内部')
 const key=JSON.stringify([account.id,file.file_id]);let receipt=pending.get(key)
 if(receipt&&(receipt.owner!==owner||receipt.parent!==file.parent_file_id||receipt.target!==destination||receipt.name!==file.name||receipt.isDir!==file.isDir||JSON.stringify(receipt.ancestors)!==JSON.stringify(path)))throw Error('天翼此前复制尚未确认，请重试原目标')
 if(receipt?.promise)return receipt.promise
 if(!receipt){if(pending.size>=128)throw Error('天翼待确认复制过多');receipt={owner,parent:file.parent_file_id,target:destination,name:file.name,isDir:file.isDir,ancestors:path,submitted:false,confirmed:false,before:[]};pending.set(key,receipt);beginCloud189Operation(account.id,file.file_id,'copy')}
 const entry=receipt,directory=(id:string)=>cloud189Directory(account,id,check),verifyPath=()=>verifyCloud189Path(account,entry.ancestors,check)
 const work=(async()=>{
  if(!entry.submitted){
   const original=(await directory(entry.parent)).find(row=>row.id===file.file_id)
   if(!original||original.name!==file.name||original.isDirectory!==file.isDir)throw Error('天翼原文件详情已变化，请刷新确认')
   await verifyPath();const targetRows=await directory(entry.target)
   if(targetRows.some(row=>row.name===entry.name))throw Error('天翼目标存在同名项目，请处理冲突后重试')
   entry.before=targetRows.map(row=>row.id);entry.size=original.size
  }
  if(!entry.confirmed&&(!entry.submitted||entry.taskId)){
   const originalId=location.familyId?cloud189FamilyId(location.familyId,location.fileId):location.fileId,originalTarget=target.familyId?cloud189FamilyId(target.familyId,target.fileId):target.fileId
   const result=await withCloud189BatchScope({account,type:'COPY',originalId,target:originalTarget,file:{id:location.fileId,name:entry.name,isFolder:entry.isDir,familyId:location.familyId||''},check,taskId:()=>entry.taskId,submitted:()=>{entry.submitted=true},created:id=>{entry.taskId=id}},user=>apiCloud189CopyBatch(user,[originalId],originalTarget))
   entry.confirmed=result.includes(originalId)
  }
  await verifyPath()
  const source=(await directory(entry.parent)).find(row=>row.id===file.file_id)
  const targetRows=await directory(entry.target),candidates=targetRows.filter(row=>!entry.before.includes(row.id)&&row.id!==file.file_id&&row.name===entry.name&&row.isDirectory===entry.isDir)
  if(!entry.confirmed||!source||source.name!==entry.name||source.isDirectory!==entry.isDir||candidates.length!==1||!entry.isDir&&(source.size!==entry.size||candidates[0]!.size!==entry.size))throw Error('天翼复制尚未确认；重试只查询原任务和目录，不会重复提交')
  check();pending.delete(key);endCloud189Operation(account.id,file.file_id,'copy');return [file.file_id]
 })()
 entry.promise=work
 try{return await work}catch(cause){if(!entry.submitted||cause instanceof Cloud189BatchRejected){pending.delete(key);endCloud189Operation(account.id,file.file_id,'copy')};throw cause}finally{if(entry.promise===work)entry.promise=undefined}
}
