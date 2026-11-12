import type {Account,SourceEntry} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {apiGuangyaCopyBatch} from './electron/providers/guangyaFileCmd'
import {apiGuangyaFileDetail,getGuangyaFileId,isGuangyaDir,guangyaApiParentId} from './electron/providers/guangyaMetadata'
import {guangyaId} from './guangyaFileTransport'
import {mutationAccount} from './providerTransport'
import {listGuangya} from './guangyaListing'
type Receipt={before:Set<string>;launch?:Promise<void>;acknowledged?:boolean}
// Pending confirmation is not a transfer queue. Never resubmit an uncertain copy.
const receipts=new Map<string,Receipt>()
export async function copyGuangyaFile(account:Account,file:IAliGetFileModel,parent:string,stillCurrent:()=>boolean){
 file={...file}
 const check=()=>{mutationAccount(account.id,'guangya');if(!stillCurrent())throw Error('来源已切换，停止复制确认')}
 if(account.providerId!=='guangya'||file.drive_id!==account.id)throw Error('光鸭复制来源不匹配')
 check();guangyaId(file.file_id);parent=guangyaApiParentId(['root','backup_root'].includes(parent)?'':parent);guangyaId(parent,true)
 const scan=async()=>{const rows:SourceEntry[]=[],seen=new Set<string>();let cursor:string|undefined;do{check();const result=await listGuangya(account,parent,cursor);check();rows.push(...result.entries);cursor=result.nextCursor;if(cursor){if(seen.has(cursor))throw Error('光鸭目录分页重复');seen.add(cursor)}if(rows.length>100000)throw Error('光鸭复制确认目录过大')}while(cursor);return rows}
 const key=JSON.stringify([account.id,file.file_id,parent,file.name,file.isDir,file.size,file.content_hash]);let receipt=receipts.get(key)
 if(!receipt){
  if(receipts.size>=128)throw Error('光鸭待确认复制过多，请先确认已提交操作')
  // Reserve before the first await so repeated clicks share one submission.
  receipt={before:new Set()};receipts.set(key,receipt);const record=receipt
  record.launch=(async()=>{
   if(parent){const target=await apiGuangyaFileDetail(account.id,parent);check();if(!target||getGuangyaFileId(target)!==parent||!isGuangyaDir(target))throw Error('光鸭目标不是已确认的文件夹')}
   const before=await scan();record.before=new Set(before.map(row=>row.id));check()
   // From here a transport failure can be ambiguous; retain the receipt.
   record.acknowledged=false
   const ids=await apiGuangyaCopyBatch(account.id,[file.file_id],parent)
   if(!ids.includes(file.file_id))throw Error('光鸭复制受理状态未知，请刷新目标确认，勿重复提交')
   record.acknowledged=true
  })()
 }
 if(receipt.launch){const launch=receipt.launch;try{await launch}catch(cause){if(receipt.acknowledged===undefined&&receipts.get(key)===receipt)receipts.delete(key);throw cause}finally{if(receipt.launch===launch)delete receipt.launch}}
 check()
 if(receipt.acknowledged!==true)throw Error('光鸭复制受理状态未知，请刷新目标确认，勿重复提交')
 const candidates=(await scan()).filter(row=>{
  const model=('electronModel'in row?row.electronModel:undefined) as IAliGetFileModel|undefined
  return !receipt.before.has(row.id)&&row.id!==file.file_id&&row.name===file.name&&row.isDirectory===file.isDir&&(file.isDir||row.size===file.size)&&(!file.content_hash||model?.content_hash===file.content_hash)
 })
 if(candidates.length!==1)throw Error('光鸭复制尚未唯一确认新副本，请刷新目标确认，勿重复提交')
 if(receipts.get(key)===receipt)receipts.delete(key);return [file.file_id]
}
