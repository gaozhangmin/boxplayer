import type {Account} from '@/features/sources/contracts'
import {getDrivePane} from './ports'
import {ApiRecoverBatch} from './electron/providers/aliFileCmd'
export async function recoverAliBatch(account:Account,list:unknown){
 const pane=getDrivePane(),epoch=pane.context
 if(account.providerId!=='aliyun'||pane.sourceId!==account.id||pane.store.SelectDirType!=='recover'||!Array.isArray(list)||!list.length||list.length>100)throw Error('恢复来源或选择无效')
 const selected=new Map<string,string>(),rows=list.map(row=>{
  if(!row||row.drive_id!==account.id||typeof row.file_id!=='string')throw Error('恢复文件来源无效')
  const file=pane.file?.(row.file_id),position=JSON.parse(row.file_id)
  if(!file||file.name!==row.name||file.description!==row.content_hash||file.size!==row.size||!row.content_hash||!position.driveId||!position.fileId||selected.has(position.fileId))throw Error('恢复文件已不在当前记录中')
  selected.set(position.fileId,row.file_id);return {...row,drive_id:position.driveId,file_id:position.fileId}
 })
 const result=await ApiRecoverBatch(account.id,rows)
 if(getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id)throw Error('恢复来源已切换')
 return typeof result==='string'?result:result.map(id=>{const original=selected.get(id);if(!original)throw Error('恢复回执不属于当前选择');return original})
}
