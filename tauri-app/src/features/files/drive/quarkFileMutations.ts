import type {Account} from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {quarkId} from './quarkFileTransport'
import {apiQuarkMkdir,apiQuarkRename,apiQuarkMoveBatch} from './electron/providers/quarkFileCmd'
import {apiQuarkFileDetail} from './electron/providers/quarkMetadata'

async function confirm(account:Account,id:string,name:string,directory:boolean,parent:string){
 const detail=await apiQuarkFileDetail(account.id,id)
 mutationAccount(account.id,'quark')
 if(!detail||quarkId(detail.fid)!==id||detail.file_name!==name||detail.pdir_fid===undefined||quarkId(detail.pdir_fid,true)!==parent)throw Error('夸克文件详情标识、名称或父目录不匹配，请刷新确认')
 const type=detail.file_type
 if(type!==undefined&&type!==0&&type!==1||detail.dir!==undefined&&typeof detail.dir!=='boolean'||type===undefined&&detail.dir===undefined)throw Error('夸克文件类型未确认')
 const isDir=detail.dir??type===0
 if(type!==undefined&&detail.dir!==undefined&&detail.dir!==(type===0)||isDir!==directory)throw Error('夸克文件类型不匹配，请刷新确认')
}
export async function createQuarkFolder(account:Account,parent:string,name:string){
 mutationAccount(account.id,'quark');parent=quarkId(parent,true)
 const result=await apiQuarkMkdir(account.id,parent,name)
 if(result.error||!result.file_id)throw Error(result.error||'夸克未返回新文件夹标识')
 quarkId(result.file_id)
 await confirm(account,result.file_id,name,true,parent)
 return result
}
export async function renameQuarkFile(account:Account,file:{file_id:string;parent_file_id:string;isDir:boolean},name:string){
 mutationAccount(account.id,'quark');quarkId(file.file_id)
 const parent=quarkId(file.parent_file_id,true)
 const result=await apiQuarkRename(account.id,file.file_id,name)
 if(!result.success)throw Error('夸克未确认重命名')
 // The original rename response may omit file_type; verify the actual detail instead.
 await confirm(account,file.file_id,name,file.isDir,parent)
 return {file_id:file.file_id,name,parent_file_id:file.parent_file_id,isDir:file.isDir}
}
export async function moveQuarkFile(account:Account,file:{file_id:string;name:string;isDir:boolean},destination:string,stillCurrent:()=>boolean){
 const {file_id:id,name,isDir}=file,parent=quarkId(destination,true)
 mutationAccount(account.id,'quark');quarkId(id)
 if(parent===id)throw Error('夸克不能移动到自身')
 if(parent!=='0'){
  const target=await apiQuarkFileDetail(account.id,parent)
  mutationAccount(account.id,'quark')
  if(!target||quarkId(target.fid)!==parent||!(target.dir===true||target.file_type===0)||target.dir===false||target.file_type!==undefined&&target.file_type!==0)throw Error('夸克目标不是已确认的文件夹')
 }
 if(!stillCurrent())throw Error('来源已切换')
 const ids=await apiQuarkMoveBatch(account.id,[id],parent)
 if(!ids.includes(id))throw Error('夸克未确认移动请求')
 await confirm(account,id,name,isDir,parent)
 return ids
}
