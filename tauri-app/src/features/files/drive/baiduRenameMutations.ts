import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {baiduFileId} from './baiduListTransport'
import {baiduFileMetadata,baiduDirectoryLocation} from './baiduMetadata'
import {apiBaiduRename} from './electron/providers/baiduRename'
import {BaiduRenameRejected} from './baiduRenameTransport'
import {assertBaiduOperation,beginBaiduOperation,endBaiduOperation} from './baiduOperationScope'
export interface BaiduRenameResult {file_id:string;parent_file_id:string;name:string;isDir:boolean;path:string;previousPath:string;description:string}
interface Receipt {identity:string;name:string;isDir:boolean;from?:string;to?:string;submitted:boolean;promise?:Promise<BaiduRenameResult>}
const pending=new Map<string,Receipt>()
export function pendingBaiduRenameName(account:string,id:string){const row=pending.get(JSON.stringify([account,id]));return row?.submitted?row.name:undefined}
export function acknowledgeBaiduRename(account:string,result:BaiduRenameResult){
 const key=JSON.stringify([account,result.file_id]),entry=pending.get(key)
 if(entry?.from===result.previousPath&&entry.to===result.path&&entry.name===result.name){pending.delete(key);endBaiduOperation(account,result.file_id,'rename')}
}
export async function renameBaiduFile(account:Account,file:{file_id:string;parent_file_id:string;isDir:boolean;path?:string;name?:string},name:string,stillCurrent:()=>boolean){
 if(account.providerId!=='baidu')throw Error('百度重命名来源不匹配')
 const id=baiduFileId(file.file_id),parentId=file.parent_file_id,isDir=file.isDir,oldPath=file.path,oldName=file.name,key=JSON.stringify([account.id,id])
 if(!name.trim()||/[\u0000-\u001f/\\]/.test(name)||['.','..'].includes(name))throw Error('百度文件名无效')
 const signature=(value:Account)=>JSON.stringify([value.userId||'',value.deviceId||'',value.baseUrl]);const identity=signature(account)
 const check=()=>{const actual=mutationAccount(account.id,'baidu');if(signature(actual)!==identity)throw Error('百度账号身份已变化');if(!stillCurrent())throw Error('来源已关闭或切换')}
 check()
 assertBaiduOperation(account.id,id,'rename')
 let entry=pending.get(key)
 if(entry&&(entry.identity!==identity||entry.name!==name||entry.isDir!==isDir))throw Error('此前重命名尚未同步，请先重试原名称以确认结果')
 if(entry?.promise)return entry.promise
 if(!entry){if(pending.size>=128)throw Error('待确认重命名过多，请先确认已有操作');entry={identity,name,isDir,submitted:false};beginBaiduOperation(account.id,id,'rename');pending.set(key,entry)}
 const receipt=entry
 const work=(async()=>{
  if(!receipt.submitted){
   const before=await baiduFileMetadata(account,id);check()
   if(before.isdir!==(isDir?1:0)||oldPath!==undefined&&oldPath!==before.path||oldName!==undefined&&oldName!==before.filename)throw Error('百度原文件详情已变化，请刷新确认')
   const parent=await baiduDirectoryLocation(account,parentId);check()
   if((before.path!.slice(0,before.path!.lastIndexOf('/'))||'/')!==parent)throw Error('百度原文件父目录不匹配')
   receipt.from=before.path!;receipt.to=(parent==='/'?'':parent)+'/'+name
   if(before.filename!==name){receipt.submitted=true;try{await apiBaiduRename(account.id,receipt.from,name)}catch(cause){if(cause instanceof BaiduRenameRejected)throw cause;/* Unknown submission: confirm by stable ID; never blindly repost. */}}
  }
  check();const after=await baiduFileMetadata(account,id);check()
  if(after.path!==receipt.to||after.filename!==name||after.isdir!==(isDir?1:0))throw Error('百度重命名尚未确认；重试只查询原文件，不会重复提交')
  return {file_id:id,parent_file_id:parentId,name,isDir,path:receipt.to!,previousPath:receipt.from!,description:`baidu_fsid:${id};baidu_path:${receipt.to}`} as BaiduRenameResult
 })()
 receipt.promise=work
 try{return await work}catch(cause){if(!receipt.submitted||cause instanceof BaiduRenameRejected){if(pending.get(key)===receipt){pending.delete(key);endBaiduOperation(account.id,id,'rename')}}throw cause}finally{if(receipt.promise===work)receipt.promise=undefined}
}
