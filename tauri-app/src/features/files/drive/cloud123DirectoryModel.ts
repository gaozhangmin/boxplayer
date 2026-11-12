import type {Account,SourceEntry} from '@/features/sources/contracts'
import {playable} from '@/features/sources/transport'
import {cloud123Id} from './cloud123FileTransport'
import {mapCloud123FileToAliModel} from './electron/providers/cloud123ListModel'
import type {Cloud123FileItem} from './electron/providers/cloud123List'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'

export function cloud123DirectoryEntry(account:Account,parent:string,value:unknown):SourceEntry&{electronModel:IAliGetFileModel}{
 if(account.providerId!=='123'||!value||typeof value!=='object'||Array.isArray(value))throw Error('123 目录模型来源无效')
 const row=value as Partial<Cloud123FileItem>,file=cloud123Id(String(row.fileId)),directory=cloud123Id(parent||'0',true)
 if(typeof row.filename!=='string'||!row.filename||![0,1].includes(row.type!)||row.trashed===1||row.parentFileId!==undefined&&cloud123Id(String(row.parentFileId),true)!==directory)throw Error('123 目录文件状态或父目录不匹配')
 if(row.size!==undefined&&(!Number.isSafeInteger(row.size)||row.size<0))throw Error('123 目录文件大小无效')
 for(const key of ['createAt','updateAt'] as const)if(row[key]!==undefined&&(typeof row[key]!=='string'||row[key]!==''&&!Number.isFinite(Date.parse(row[key]!))))throw Error('123 目录日期无效')
 const model=mapCloud123FileToAliModel({...row,fileId:Number(file),parentFileId:Number(directory),size:row.size??0} as Cloud123FileItem)
 return {id:file,name:model.name,isDirectory:model.isDir,size:model.size,playable:!model.isDir&&playable(model.name),electronModel:{...model,drive_id:account.id,file_id:file,parent_file_id:directory==='0'?'':directory,time:Number.isFinite(model.time)?model.time:0}}
}
