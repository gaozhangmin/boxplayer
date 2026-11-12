import type {Account,SourceEntry} from '@/features/sources/contracts'
import {driver} from '@/features/sources/drivers'
import {getDrivePane} from './ports'
import {aliFolderAccount} from './aliFolderTransport'
import {withAliMetadataContext} from './aliMetadataPorts'
import {ApiFileInfo} from './electron/providers/aliMetadata'
import {validateAliCrossDriveIdentity,type AliMoveNode,type AliMovePair} from './aliCrossDriveIdentity'

interface Root {id:string;parent:string}
function location(id:string){
 let value:any;try{value=JSON.parse(id)}catch{throw Error('移动快照位置无效')}
 if(!value||typeof value.driveId!=='string'||!value.driveId||typeof value.fileId!=='string'||!value.fileId||JSON.stringify({driveId:value.driveId,fileId:value.fileId})!==id)throw Error('移动快照位置无效')
 return value as {driveId:string;fileId:string}
}
function node(id:string,parent:string,name:unknown,isDirectory:unknown,size:unknown,hash:unknown):AliMoveNode{
 const current=location(id),container=location(parent)
 if(current.fileId==='root'||current.driveId!==container.driveId||id===parent||typeof name!=='string'||!name||typeof isDirectory!=='boolean'||!Number.isSafeInteger(size)||Number(size)<0||hash!==undefined&&typeof hash!=='string')throw Error('移动快照文件身份无效')
 return {id,parent,name,isDirectory,size:Number(size),...(hash?{contentHash:String(hash)}:{})}
}
/** Exhaustive read only. Roots must come from source records or accepted target receipts. */
export async function readAliMoveSnapshot(account:Account,roots:Root[],stillCurrent:()=>void){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account),result:AliMoveNode[]=[],seen=new Set<string>(),queue:Array<{id:string;depth:number}>=[]
 const check=()=>{stillCurrent();if(!['aliyun','alipan-open'].includes(account.providerId)||getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(aliFolderAccount(account.id))!==owner)throw Error('移动快照来源已切换或账号已变化')}
 check();if(!roots.length||new Set(roots.map(root=>root.id)).size!==roots.length)throw Error('移动快照所选根无效')
 const add=(value:AliMoveNode,depth:number)=>{if(depth>512||seen.has(value.id)||result.length>=100000)throw Error('移动快照重复、目录成环或超出范围');seen.add(value.id);result.push(value);if(value.isDirectory)queue.push({id:value.id,depth})}
 for(const root of roots){
  check();const identity=location(root.id),parent=location(root.parent)
  if(identity.fileId==='root'||identity.driveId!==parent.driveId)throw Error('移动快照不能选中虚拟盘根')
  const detail=await withAliMetadataContext(account.id,check,()=>ApiFileInfo(account.id,identity.driveId,identity.fileId,account.providerId==='aliyun'));check()
  if(!detail||detail.file_id!==identity.fileId||detail.drive_id!==identity.driveId||detail.parent_file_id!==parent.fileId||!['file','folder'].includes(detail.type)||detail.trashed)throw Error('移动快照所选根身份或父目录已变化')
  add(node(root.id,root.parent,detail.name,detail.type==='folder',detail.size??0,detail.content_hash),0)
 }
 const protocol=driver(account)
 for(let index=0;index<queue.length;index++){
  const folder=queue[index]!,cursors=new Set<string>();let cursor:string|undefined
  do{
   check();const page=await protocol.list(account,folder.id,cursor);check()
   if(!Array.isArray(page.entries)||page.nextCursor!==undefined&&typeof page.nextCursor!=='string')throw Error('移动快照目录分页无效')
   for(const entry of page.entries){
    const row=(entry as SourceEntry&{electronModel?:Record<string,unknown>}).electronModel
    if(!row||row.file_id!==entry.id||row.drive_id!==account.id||row.parent_file_id!==folder.id||row.name!==entry.name||row.isDir!==entry.isDirectory||row.size!==entry.size)throw Error('移动快照原目录模型身份不匹配')
    add(node(entry.id,folder.id,entry.name,entry.isDirectory,entry.size,row.content_hash),folder.depth+1)
   }
   cursor=page.nextCursor||undefined
   if(cursor){if(cursors.has(cursor))throw Error('移动快照分页游标重复');cursors.add(cursor)}
  }while(cursor)
 }
 check();return result
}

/** Pair only IDs actually present in both observations; never match by filename. */
export function pairObservedAliMoveNodes(before:AliMoveNode[],after:AliMoveNode[],rootReceipts:AliMovePair[],destination:string){
 const target=location(destination),roots=new Map(rootReceipts.map(pair=>[pair.from,pair.to]))
 if(roots.size!==rootReceipts.length)throw Error('移动根回执重复')
 const observed=new Map(after.map(row=>[row.id,row])),pairs:AliMovePair[]=[]
 for(const row of before){
  const explicit=roots.get(row.id),fileId=location(row.id).fileId
  const actual=observed.get(explicit||JSON.stringify({driveId:target.driveId,fileId}))
  if(!actual)throw Error('提供商未给出可验证的后代身份，不能按名称推测')
  pairs.push({from:row.id,to:actual.id})
 }
 validateAliCrossDriveIdentity(before,after,[...roots.keys()],destination,pairs)
 return pairs
}
