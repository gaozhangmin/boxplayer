import {withAliTrashContext} from './aliTrashContext'
import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import type {TrashOperation} from './trashMutations'
import {ApiTrashBatch,ApiDeleteBatch,ApiTrashCleanBatch,ApiTrashRestoreBatch} from './electron/providers/aliFileCmd'
import {request,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
import {getDrivePane} from './ports'
export async function mutateAliTrash(account:Account,file:IAliGetFileModel,operation:TrashOperation,stillCurrent:()=>boolean=()=>true){
 let location:any;try{location=JSON.parse(file.file_id)}catch{throw Error('阿里文件位置无效')}
 if(typeof location?.driveId!=='string'||!location.driveId||typeof location?.fileId!=='string'||!location.fileId||location.fileId==='root')throw Error('不能删除或还原网盘根目录')
 if(account.providerId==='alipan-open'&&!['trash','permanent'].includes(operation))throw Error('阿里开放回收站仅接入放入操作')
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account),check=()=>{if(!stillCurrent()||getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||JSON.stringify(mutationAccount(account.id,account.providerId))!==owner)throw Error('阿里回收站来源或账号已变化')}
 const ids=[location.fileId],result=await withAliTrashContext(account.id,check,async()=>operation==='trash'?await ApiTrashBatch(account.id,location.driveId,ids):operation==='restore'?await ApiTrashRestoreBatch(account.id,location.driveId,true,ids):operation==='purge'?await ApiTrashCleanBatch(account.id,location.driveId,true,ids):await ApiDeleteBatch(account.id,location.driveId,ids))
 return result.includes(location.fileId)
}
export async function restoredAliDetail(account:Account,file:IAliGetFileModel){
 const pane=getDrivePane(),epoch=pane.context
 const check=()=>{mutationAccount(account.id,'aliyun');if(getDrivePane()!==pane||pane.sourceId!==account.id||pane.context!==epoch)throw Error('阿里还原来源已切换')}
 check()
 const location=JSON.parse(file.file_id),selected=mutationAccount(account.id,'aliyun')
 if(typeof location?.driveId!=='string'||!location.driveId||typeof location?.fileId!=='string'||!location.fileId)throw Error('阿里还原文件位置无效')
 const response=await request(selected,'POST','https://api.aliyundrive.com/v2/file/get',JSON.stringify({drive_id:location.driveId,file_id:location.fileId}),{'Content-Type':'application/json'}),row=JSON.parse(text(response))
 check()
 if(response.status!==200||row?.code||row.file_id!==location.fileId||row.drive_id!==location.driveId||typeof row.parent_file_id!=='string'||!row.parent_file_id||row.type!==(file.isDir?'folder':'file')||typeof row.name!=='string'||!row.name||row.trashed===true)throw Error('阿里已还原文件详情不匹配')
 return {...file,parent_file_id:JSON.stringify({driveId:location.driveId,fileId:row.parent_file_id}),name:row.name}
}
