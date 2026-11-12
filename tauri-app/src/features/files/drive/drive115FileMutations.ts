import type {Account} from '@/features/sources/contracts'
import {apiDrive115Mkdir} from './electron/providers/drive115Folders'
import {apiDrive115Rename} from './electron/providers/drive115Rename'
import {drive115Detail,drive115Id,drive115Parent} from './drive115FileTransport'
export async function createDrive115Folder(account:Account,parent:string,name:string){
 const result=await apiDrive115Mkdir(account.id,drive115Parent(parent),name)
 if(result.error||!result.file_id)throw Error(result.error||'115 未返回新文件夹标识')
 const detail=await drive115Detail(account.id,result.file_id)
 if(!detail.isDir||detail.name!==name)throw Error('115 新文件夹名称或类型未确认，请刷新确认')
 return result
}
export async function renameDrive115File(account:Account,file:{file_id:string;isDir:boolean},name:string){
 drive115Id(file.file_id)
 const result=await apiDrive115Rename(account.id,file.file_id,name)
 if(!result.success||result.file_id!==file.file_id||result.name!==name)throw Error('115 未确认重命名结果，请刷新确认')
 const detail=await drive115Detail(account.id,file.file_id)
 if(detail.name!==name||detail.isDir!==file.isDir)throw Error('115 重命名名称或类型未确认，请刷新确认')
 return {...result,error:''}
}
