import type {Account} from '@/features/sources/contracts'
import {cloud189,cloud189NativeScope,cloud189NativeId} from '@/features/sources/cloud189'
import {mutationAccount} from './providerTransport'
import {apiCloud189Mkdir} from './electron/providers/cloud189Folder'
import {cloud189FamilyId,cloud189Scope} from './electron/providers/cloud189Identity'
import {cloud189FolderId,withCloud189FolderScope} from './cloud189FolderTransport'
export async function createCloud189Folder(account:Account,parent:string,name:string,stillCurrent:()=>boolean){
 if(account.providerId!=='189'||!parent)throw Error('请先选择天翼个人空间或具体家庭空间')
 const target=cloud189NativeScope(parent)
 if(target.families)throw Error('请先选择具体家庭空间')
 if(target.familyId===undefined&&!target.fileId)throw Error('天翼个人目录标识无效')
 if(target.fileId&&target.fileId!=='-11')cloud189FolderId(target.fileId)
 if(target.familyId!==undefined&&!/^\d+$/.test(target.familyId))throw Error('天翼家庭空间标识无效')
 const identity=(value:Account)=>JSON.stringify([value.userId||'',value.deviceId||'',value.baseUrl]),owner=identity(account)
 const check=()=>{if(identity(mutationAccount(account.id,'189'))!==owner)throw Error('天翼账号身份已变化');if(!stillCurrent())throw Error('来源已关闭或切换')}
 check()
 const originalParent=target.familyId!==undefined?cloud189FamilyId(target.familyId,target.fileId):target.fileId
 const scope=cloud189Scope(originalParent)
 const result=await withCloud189FolderScope({account,parent:scope.rawId,family:scope.familyId,check},key=>apiCloud189Mkdir(key,originalParent,name));check()
 if(result.error||!result.file_id)throw Error(result.error||'天翼未返回新文件夹标识')
 const actualScope=cloud189Scope(result.file_id)
 if(actualScope.familyId!==(target.familyId||''))throw Error('天翼新文件夹空间不匹配')
 const raw=cloud189FolderId(actualScope.rawId),id=cloud189NativeId({fileId:raw,...(target.familyId!==undefined?{familyId:target.familyId}:{})})
 let cursor:string|undefined;const seen=new Set<string>(),ids=new Set<string>();let found=false
 do{
  check();const page=await cloud189.list(account,parent,cursor);check()
  for(const row of page.entries){if(ids.has(row.id))throw Error('天翼确认列表存在重复目录标识');ids.add(row.id);if(row.id===id){if(!row.isDirectory||row.name!==name)throw Error('天翼新目录名称或类型不匹配');found=true}}
  cursor=page.nextCursor;if(cursor){if(seen.has(cursor))throw Error('天翼确认列表分页重复');seen.add(cursor)}
  if(ids.size>100000)throw Error('天翼新建确认目录过大')
 }while(cursor&&!found)
 if(!found)throw Error('天翼新文件夹尚未在目标空间确认，请刷新后核对')
 return {file_id:id,error:''}
}
