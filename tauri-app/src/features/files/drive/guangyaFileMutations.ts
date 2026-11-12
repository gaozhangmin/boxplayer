import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {guangyaId} from './guangyaFileTransport'
import {apiGuangyaMkdir,apiGuangyaRename,apiGuangyaMoveBatch} from './electron/providers/guangyaFileCmd'
import {apiGuangyaFileDetail,getGuangyaFileId,getGuangyaFileName,isGuangyaDir,guangyaApiParentId} from './electron/providers/guangyaMetadata'
async function confirm(account:Account,id:string,name:string,directory:boolean,parent?:string){
 const detail=await apiGuangyaFileDetail(account.id,id);mutationAccount(account.id,'guangya')
 if(!detail||getGuangyaFileId(detail)!==id||getGuangyaFileName(detail)!==name||isGuangyaDir(detail)!==directory)throw Error('光鸭文件详情身份、名称或类型不匹配')
 const actualParent=detail.parentId??detail.parentFileId??detail.parent_file_id
 if(parent!==undefined&&(actualParent===undefined||guangyaApiParentId(guangyaId(actualParent,true))!==parent))throw Error('光鸭文件父目录未确认')
}
export async function createGuangyaFolder(account:Account,parent:string,name:string){
 mutationAccount(account.id,'guangya');parent=guangyaApiParentId(['root','backup_root'].includes(parent)?'':parent)
 const result=await apiGuangyaMkdir(account.id,parent,name);if(result.error||!result.file_id)throw Error(result.error||'光鸭未返回新目录标识');guangyaId(result.file_id)
 await confirm(account,result.file_id,name,true,parent);return result
}
export async function renameGuangyaFile(account:Account,file:{file_id:string;parent_file_id:string;isDir:boolean},name:string){
 mutationAccount(account.id,'guangya');guangyaId(file.file_id)
 const result=await apiGuangyaRename(account.id,file.file_id,name);if(!result.success)throw Error('光鸭未确认重命名')
 await confirm(account,file.file_id,name,file.isDir,guangyaApiParentId(file.parent_file_id))
 return {file_id:file.file_id,parent_file_id:file.parent_file_id,name,isDir:file.isDir}
}

export async function moveGuangyaFile(account:Account,file:{file_id:string;name:string;isDir:boolean},parent:string,stillCurrent:()=>boolean){
 mutationAccount(account.id,'guangya');guangyaId(file.file_id)
 parent=guangyaApiParentId(['root','backup_root'].includes(parent)?'':parent);guangyaId(parent,true)
 if(file.file_id===parent)throw Error('光鸭不能移动到自身')
 if(parent){const target=await apiGuangyaFileDetail(account.id,parent);mutationAccount(account.id,'guangya');if(!target||getGuangyaFileId(target)!==parent||!isGuangyaDir(target))throw Error('光鸭目标不是已确认的文件夹')}
 if(!stillCurrent())throw Error('来源已切换')
 const ids=await apiGuangyaMoveBatch(account.id,[file.file_id],parent)
 if(!ids.includes(file.file_id))throw Error('光鸭未确认移动请求')
 await confirm(account,file.file_id,file.name,file.isDir,parent)
 return ids
}
