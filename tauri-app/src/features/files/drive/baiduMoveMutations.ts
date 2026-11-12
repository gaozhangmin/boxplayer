import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {baiduFileId} from './baiduListTransport'
import {baiduFileMetadata,baiduDirectoryLocation} from './baiduMetadata'
import {apiBaiduMove} from './electron/providers/baiduRename'
import {BaiduRenameRejected} from './baiduRenameTransport'
import {assertBaiduOperation,beginBaiduOperation,endBaiduOperation} from './baiduOperationScope'
import type {BaiduRenameResult} from './baiduRenameMutations'
export interface BaiduMoveResult extends BaiduRenameResult {destinationPath:string}
interface Receipt {account:string;fileId:string;identity:string;target:string;isDir:boolean;ancestors?:string[];name?:string;from?:string;to?:string;destinationPath?:string;submitted:boolean;promise?:Promise<BaiduMoveResult>}
const pending=new Map<string,Receipt>()
const signature=(value:Account)=>JSON.stringify([value.userId||'',value.deviceId||'',value.baseUrl])
export async function verifyBaiduAncestors(account:Account,path:string,ancestors:ReadonlyArray<string>|undefined,check:()=>void){
 if(!ancestors)return
 const parts=path.split('/').filter(Boolean)
 if(ancestors.length!==parts.length+1)throw Error('百度目标目录层级已变化，请刷新目录后确认')
 for(let index=1;index<ancestors.length-1;index++){
  const actual=await baiduDirectoryLocation(account,ancestors[index]!);check()
  if(actual!=='/'+parts.slice(0,index).join('/'))throw Error('百度目标祖先目录已变化，请刷新目录后确认')
 }
}
export function pendingBaiduMoves(account:Account){
 return [...pending.values()].filter(row=>row.account===account.id&&row.identity===signature(account)&&row.submitted).map(row=>({fileId:row.fileId,name:row.name!,isDir:row.isDir,target:row.target,ancestors:row.ancestors?[...row.ancestors]:undefined}))
}
export async function confirmPendingBaiduMove(account:Account,id:string,stillCurrent:()=>boolean){
 const receipt=pending.get(JSON.stringify([account.id,id]))
 if(!receipt?.submitted||receipt.identity!==signature(account))throw Error('待确认移动已变化或账号身份不匹配')
 return moveBaiduFile(account,{file_id:id,name:receipt.name!,isDir:receipt.isDir},receipt.target,stillCurrent)
}
export function acknowledgeBaiduMove(account:string,result:BaiduMoveResult){
 const key=JSON.stringify([account,result.file_id]),entry=pending.get(key)
 if(entry?.from===result.previousPath&&entry.to===result.path&&entry.target===result.parent_file_id){pending.delete(key);endBaiduOperation(account,result.file_id,'move')}
}
export async function moveBaiduFile(account:Account,file:{file_id:string;name:string;isDir:boolean;path?:string},destination:string,stillCurrent:()=>boolean,ancestors?:ReadonlyArray<string>){
 if(account.providerId!=='baidu')throw Error('百度移动来源不匹配')
 const id=baiduFileId(file.file_id),isDir=file.isDir,name=file.name,path=file.path,target=['','/','root','backup_root','baidu_root'].includes(destination)?'':destination,key=JSON.stringify([account.id,id])
 const identity=signature(account)
 const check=()=>{const current=mutationAccount(account.id,'baidu');if(signature(current)!==identity)throw Error('百度账号身份已变化');if(!stillCurrent())throw Error('来源已关闭或切换')}
 check();assertBaiduOperation(account.id,id,'move')
 if(ancestors&&(!ancestors.length||ancestors[0]!==''||ancestors.at(-1)!==target||ancestors.some(value=>typeof value!=='string')||new Set(ancestors).size!==ancestors.length))throw Error('百度目标目录祖先上下文无效')
 let entry=pending.get(key)
 if(entry&&(entry.identity!==identity||entry.target!==target||entry.isDir!==isDir))throw Error('此前移动尚未确认或同步，请先重试原目标')
 if(entry?.promise)return entry.promise
 if(!entry){if(pending.size>=128)throw Error('待确认移动过多，请先确认已有操作');entry={account:account.id,fileId:id,identity,target,isDir,ancestors:ancestors?[...ancestors]:undefined,submitted:false};beginBaiduOperation(account.id,id,'move');pending.set(key,entry)}
 else if(!entry.ancestors&&ancestors)entry.ancestors=[...ancestors]
 const receipt=entry
 const work=(async()=>{
  if(!receipt.submitted){
   const before=await baiduFileMetadata(account,id);check()
   if(before.isdir!==(isDir?1:0)||before.filename!==name||path!==undefined&&before.path!==path)throw Error('百度原文件详情已变化，请刷新确认')
   const parent=await baiduDirectoryLocation(account,target);check()
   await verifyBaiduAncestors(account,parent,receipt.ancestors,check);check()
   if((before.path!.slice(0,before.path!.lastIndexOf('/'))||'/')===parent||isDir&&(parent===before.path||parent.startsWith(before.path!+'/')))throw Error('不能移动到原位置、自己或子目录')
   receipt.from=before.path!;receipt.destinationPath=parent;receipt.name=before.filename;receipt.to=(parent==='/'?'':parent)+'/'+receipt.name
   receipt.submitted=true
   try{await apiBaiduMove(account.id,[receipt.from],parent)}catch(cause){if(cause instanceof BaiduRenameRejected)throw cause}
  }
  check();const after=await baiduFileMetadata(account,id);check()
  if(after.path!==receipt.to||after.filename!==receipt.name||after.isdir!==(isDir?1:0))throw Error('百度移动尚未确认；重试只查询原文件，不会重复提交')
  const actualTarget=await baiduDirectoryLocation(account,target);check()
  if(actualTarget!==receipt.destinationPath)throw Error('百度目标目录位置已变化，移动结果尚未确认')
  await verifyBaiduAncestors(account,actualTarget,receipt.ancestors,check);check()
  return {file_id:id,parent_file_id:target,name:receipt.name!,isDir,path:receipt.to!,previousPath:receipt.from!,destinationPath:receipt.destinationPath!,description:`baidu_fsid:${id};baidu_path:${receipt.to}`} as BaiduMoveResult
 })()
 receipt.promise=work
 try{return await work}catch(cause){if(!receipt.submitted||cause instanceof BaiduRenameRejected){if(pending.get(key)===receipt){pending.delete(key);endBaiduOperation(account.id,id,'move')}}throw cause}finally{if(receipt.promise===work)receipt.promise=undefined}
}
