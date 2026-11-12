import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {getDrivePane} from './ports'
import {mutationAccount} from './providerTransport'
import {cloud123Id} from './cloud123FileTransport'
import {apiCloud123CopyBatch,apiCloud123FileDetail} from './electron/providers/cloud123FileCmd'
import {withCloud123BatchScope} from './cloud123BatchScope'
type Receipt={owner:string;source:string;parent:string;files:IAliGetFileModel[];before:Set<string>;submitted:boolean;accepted:boolean;confirmed:Set<string>;targets:Set<string>;launch?:Promise<void>}
// Foreground command receipts only: no transfer queue or background task runner.
const receipts=new Set<Receipt>()
export const hasCloud123BatchCopy=(source:string,files:IAliGetFileModel[],parent:string)=>[...receipts].some(row=>row.source===source&&row.parent===parent&&row.files.some(old=>files.some(file=>file.file_id===old.file_id)))
export async function copyCloud123Batch(account:Account,selected:IAliGetFileModel[],parent:string,stillCurrent:()=>boolean){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account),files=selected.map(file=>({...file}))
 const check=()=>{if(!stillCurrent()||getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(account)!==owner||JSON.stringify(mutationAccount(account.id,'123'))!==owner)throw Error('来源已切换或账号已变化，停止批量复制确认')}
 check();cloud123Id(parent,true)
 if(files.length<1||new Set(files.map(file=>file.file_id)).size!==files.length)throw Error('123 批量复制选择无效')
 for(const file of files){cloud123Id(file.file_id);const row=pane.file?.(file.file_id);if(file.drive_id!==account.id||!row||row.file_id!==file.file_id||row.drive_id!==file.drive_id||row.name!==file.name||row.isDir!==file.isDir||row.parent_file_id!==file.parent_file_id)throw Error('123 批量复制文件来源不匹配')}
 const overlaps=[...receipts].filter(row=>row.source===account.id&&row.parent===parent&&row.files.some(old=>files.some(file=>file.file_id===old.file_id)))
 if(overlaps.length>1)throw Error('123 存在重叠待确认复制，请先核对原操作')
 let receipt=overlaps[0]
 if(receipt&&(receipt.owner!==owner||files.some(file=>!receipt!.files.some(old=>old.file_id===file.file_id&&old.name===file.name&&old.isDir===file.isDir&&old.parent_file_id===file.parent_file_id&&old.size===file.size&&old.content_hash===file.content_hash))))throw Error('123 待确认复制身份或选择已变化，勿重复提交')
 const scan=async()=>{check();const rows=await pane.list(account.id,account.id,parent,check);check();if(new Set(rows.map(row=>row.file_id)).size!==rows.length||rows.some(row=>row.drive_id!==account.id))throw Error('123 目标目录列表身份无效');return rows}
 if(!receipt){
  if(files.length<2)throw Error('123 新批量复制至少选择两项')
  if(receipts.size>=128)throw Error('123 待确认复制过多，请先核对原操作')
  receipt={owner,source:account.id,parent,files,before:new Set(),submitted:false,accepted:false,confirmed:new Set(),targets:new Set()};receipts.add(receipt)
  const record=receipt
  record.launch=(async()=>{
   if(parent!=='0'){const folder=await apiCloud123FileDetail(account.id,parent);check();if(String(folder?.fileId??folder?.fileID??'')!==parent||folder?.type!==1||folder?.trashed!==0)throw Error('123 复制目标不是有效文件夹')}
   record.before=new Set((await scan()).map(row=>row.file_id));check()
   const result=await withCloud123BatchScope(account.id,files.map(file=>file.file_id),parent,check,()=>apiCloud123CopyBatch(account.id,files.map(file=>file.file_id),parent))
   record.submitted=result.sent
   if(!result.sent)throw Error('123 批量复制已在提交前取消')
   if(result.rejected){receipts.delete(record);throw Error('123 已明确拒绝批量复制，请修正后重试')}
   const accepted=result.value
   record.accepted=accepted.length===files.length&&files.every(file=>accepted.includes(file.file_id))
   if(!record.accepted)throw Error('123 批量复制受理状态未知，请核对目标，勿重复提交')
  })()
 }
 if(receipt.launch){const launch=receipt.launch;try{await launch}catch(error){if(!receipt.submitted)receipts.delete(receipt);throw error}finally{if(receipt.launch===launch)delete receipt.launch}}
 check()
 if(!receipt.accepted)throw Error('123 批量复制受理状态未知，请核对目标，勿重复提交')
 const rows=await scan(),used=new Set<string>(),success:string[]=[],failures:string[]=[]
 for(const file of receipt.files){
  check()
  if(receipt.confirmed.has(file.file_id)){if(files.some(row=>row.file_id===file.file_id))success.push(file.file_id);continue}
  const candidates=rows.filter(row=>!receipt.before.has(row.file_id)&&!receipt.targets.has(row.file_id)&&!receipt!.files.some(old=>old.file_id===row.file_id)&&row.name===file.name&&row.isDir===file.isDir&&(file.isDir||row.size===file.size)&&(!file.content_hash||row.content_hash===file.content_hash))
  const sameSelection=receipt.files.filter(old=>old.name===file.name&&old.isDir===file.isDir&&(file.isDir||old.size===file.size)&&old.content_hash===file.content_hash)
  if(sameSelection.length!==1||candidates.length!==1||used.has(candidates[0]!.file_id)){failures.push(file.name+'：批量复制新副本尚未唯一确认，勿重复提交');continue}
  const candidate=candidates[0]!,detail=await apiCloud123FileDetail(account.id,candidate.file_id);check()
  if(String(detail?.fileId??detail?.fileID??'')!==candidate.file_id||String(detail?.parentFileId??detail?.parentFileID??'')!==parent||detail?.filename!==file.name||detail?.type!==(file.isDir?1:0)||detail?.trashed!==0){failures.push(file.name+'：批量复制详情尚未确认');continue}
  used.add(candidate.file_id);receipt.targets.add(candidate.file_id);receipt.confirmed.add(file.file_id);if(files.some(row=>row.file_id===file.file_id))success.push(file.file_id)
 }
 if(receipt.confirmed.size===receipt.files.length)receipts.delete(receipt)
 return {success,failures}
}
