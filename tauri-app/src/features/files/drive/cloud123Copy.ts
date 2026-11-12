import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {apiCloud123CopySingle,apiCloud123FileDetail} from './electron/providers/cloud123FileCmd'
import {cloud123Id} from './cloud123FileTransport'
import {getDrivePane} from './ports'
import {mutationAccount} from './providerTransport'
type Receipt={owner:string;target?:string;launch?:Promise<void>}
// Retain only unresolved file-command receipts across pane remount/source changes.
// No credentials, file content, background execution or persistent transfer queue.
const receipts=new Map<string,Receipt>()
export async function copyCloud123Single(account:Account,file:IAliGetFileModel,parent:string,stillCurrent:()=>boolean){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{if(!stillCurrent()||getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(account)!==owner||JSON.stringify(mutationAccount(account.id,'123'))!==owner)throw Error('来源已切换或账号已变化，停止复制确认')}
 check();cloud123Id(file.file_id);cloud123Id(parent,true)
 const current=pane.file?.(file.file_id)
 if(account.providerId!=='123'||file.drive_id!==account.id||!current||current.file_id!==file.file_id||current.drive_id!==file.drive_id||current.name!==file.name||current.isDir!==file.isDir||current.parent_file_id!==file.parent_file_id)throw Error('123 复制文件来源不匹配')
 const key=JSON.stringify([account.id,file.file_id,parent,file.name,file.isDir]);let receipt=receipts.get(key)
 if(receipt&&receipt.owner!==owner)throw Error('123 复制账号身份已变化，请核对原账号操作，勿重复提交')
 if(!receipt){
  if(receipts.size>=128)throw Error('123 待确认复制过多，请先确认已提交的操作')
  receipt={owner};receipts.set(key,receipt)
  const record=receipt
  record.launch=(async()=>{
   const ids=await apiCloud123CopySingle(account.id,file.file_id,parent)
   // Save the acknowledged target before checking the initiating pane lifecycle.
   if(ids.length!==1||ids[0]===file.file_id)throw Error('123 复制未返回新文件标识，请刷新确认，勿重复提交')
   record.target=cloud123Id(ids[0]!)
  })()
 }
 if(receipt.launch){const launch=receipt.launch;try{await launch}finally{if(receipt.launch===launch)delete receipt.launch}}
 check()
 if(!receipt.target)throw Error('123 复制受理状态未知，请刷新目标确认，勿重复提交')
 const detail=await apiCloud123FileDetail(account.id,receipt.target);check()
 const id=String(detail?.fileId??detail?.fileID??detail?.file_id??''),target=String(detail?.parentFileId??detail?.parentFileID??detail?.parent_file_id??'')
 if(id!==receipt.target||target!==parent||detail?.filename!==file.name||detail?.trashed===1||![0,1].includes(detail?.type)||(detail.type===1)!==file.isDir)throw Error('123 复制结果标识、名称、类型或目标不匹配')
 receipts.delete(key)
 return [file.file_id]
}
