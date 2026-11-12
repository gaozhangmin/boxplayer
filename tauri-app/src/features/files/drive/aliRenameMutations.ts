import type {Account} from '@/features/sources/contracts'
import {ApiRenameBatch} from './electron/providers/aliFileCmd'
import {getDrivePane} from './ports'
import {aliFolderAccount as aliRenameAccount} from './aliFolderTransport'
import {withAliRenameContext} from './aliRenameContext'
export async function renameAliFile(account:Account,file:{file_id:string;parent_file_id:string;isDir:boolean},name:string,stillCurrent:()=>boolean=()=>true){
 const pane=getDrivePane(),epoch=pane.context,owner=JSON.stringify(account)
 const check=()=>{if(!stillCurrent()||getDrivePane()!==pane||pane.context!==epoch||pane.sourceId!==account.id||!['aliyun','alipan-open'].includes(account.providerId)||JSON.stringify(account)!==owner||JSON.stringify(aliRenameAccount(account.id))!==owner)throw Error('阿里重命名来源已切换或账号已变化')}
 check();const known=pane.file?.(file.file_id);if(!known)throw Error('文件已不在当前来源记录中')
 if(account.providerId==='alipan-open'&&(known.drive_id!==account.id||known.file_id!==file.file_id||known.parent_file_id!==file.parent_file_id||known.isDir!==file.isDir))throw Error('阿里开放重命名文件身份已变化')
 let location:any;try{location=JSON.parse(file.file_id)}catch{throw Error('阿里文件位置无效')}
 if(typeof location?.driveId!=='string'||!location.driveId||typeof location?.fileId!=='string'||!location.fileId||location.fileId==='root')throw Error('不能重命名虚拟根或网盘根目录')
 let parent:any;try{parent=JSON.parse(file.parent_file_id)}catch{throw Error('原文件父目录位置无效，请刷新确认')}
 if(parent?.driveId!==location.driveId||typeof parent?.fileId!=='string'||!parent.fileId)throw Error('原文件父目录位置无效')
 const result=await withAliRenameContext(account.id,check,()=>ApiRenameBatch(account.id,location.driveId,[location.fileId],[name]));check()
 const row=result.find(row=>row.file_id===location.fileId)
 if(!row||row.name!==name)throw Error('阿里未确认重命名完成，请刷新后重试')
 if(parent?.driveId!==location.driveId||parent?.fileId!==row.parent_file_id)throw Error('重命名返回父目录不匹配，请刷新确认')
 if(row.isDir!==!file.isDir)throw Error('重命名返回文件类型不匹配，请刷新确认')
 // The original method's isDir expression is inverted. Keep its source intact;
 // the native boundary preserves the already-read file type instead.
 return {file_id:file.file_id,parent_file_id:file.parent_file_id,name,isDir:file.isDir}
}
