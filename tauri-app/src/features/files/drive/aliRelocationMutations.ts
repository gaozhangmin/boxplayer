import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {getDrivePane} from './ports'
import {ApiMoveBatch,ApiCopyBatch} from './electron/providers/aliFileCmd'
import {aliRelocationReceipt} from './aliRelocationTransport'
import {withAliRelocationContext} from './aliRelocationContext'
import {aliFolderAccount as aliRelocationAccount} from './aliFolderTransport'
import {acknowledgeOpenAliCopy} from './aliOpenRelocation'
import {withAliCrossDriveObservation} from './aliCrossDriveObservationScope'
import type {AliCrossDriveReceipt} from './aliRelocationTransport'
function location(id:string){let value:any;try{value=JSON.parse(id)}catch{throw Error('请选择实际资源盘、备份盘或盘内目录')};if(typeof value?.driveId!=='string'||!value.driveId||typeof value?.fileId!=='string'||!value.fileId)throw Error('阿里文件位置无效');return value as {driveId:string;fileId:string}}
export async function relocateAliFile(account:Account,file:IAliGetFileModel,target:string,copy:boolean,stillCurrent:()=>boolean,synchronize?:(receipt:AliCrossDriveReceipt)=>Promise<void>){
 const pane=getDrivePane(),source=location(file.file_id),destination=location(target),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{if(!stillCurrent()||getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(aliRelocationAccount(account.id))!==owner)throw Error('来源已切换或账号已变化')}
 check()
 if(!['aliyun','alipan-open'].includes(account.providerId)||!pane.file?.(file.file_id)||!pane.file?.(target)?.isDir||source.fileId==='root')throw Error('阿里移动/复制来源或目标无效')
 const crossDrive=!copy&&source.driveId!==destination.driveId
 if(crossDrive&&account.providerId==='alipan-open')throw Error('阿里开放接口仅支持当前盘移动，不支持跨盘移动')
 if(crossDrive&&!synchronize)throw Error('阿里跨盘移动的文件/媒体库身份对账尚未接入；未提交请求')
 const work=async()=>{
 const result=await withAliRelocationContext(account.id,check,()=> (copy?ApiCopyBatch:ApiMoveBatch)(account.id,source.driveId,[source.fileId],destination.driveId,destination.fileId))
 check()
 if(!result.includes(source.fileId))throw Error('阿里未确认移动/复制完成')
 const receipt=aliRelocationReceipt(file.file_id);if(!receipt)throw Error('阿里缺少目标名称回执')
 if(crossDrive){if(!receipt.crossDrive)throw Error('跨盘移动缺少完整身份回执');await synchronize!(receipt.crossDrive);check()}
 if(copy&&account.providerId==='alipan-open')acknowledgeOpenAliCopy(account,file.file_id,target)
 return {ids:[file.file_id],name:receipt.name,identitySynced:crossDrive}
 }
 return crossDrive?withAliCrossDriveObservation(account,file.file_id,target,check,work):work()
}
