import type {Account} from '@/features/sources/contracts'
import {apiPikPakMkdir,apiPikPakRename} from './electron/providers/pikpakFileCmd'
import {apiPikPakFileDetail} from './electron/providers/pikpakMetadata'
import {pikpakId,pikpakParent} from './pikpakFileTransport'
export async function createPikPakFolder(account:Account,parent:string,name:string){
 const location=pikpakParent(parent),result=await apiPikPakMkdir(account.id,location,name)
 if(result.error||!result.file_id)throw Error(result.error||'PikPak 未返回文件夹标识');pikpakId(result.file_id)
 const detail=await apiPikPakFileDetail(account.id,result.file_id)
 if(!detail||detail.name!==name||detail.kind!=='drive#folder'||(detail.parent_id||'')!==(location==='pikpak_root'?'':location))throw Error('PikPak 新文件夹名称、类型或位置未确认，请刷新确认')
 return result
}
export async function renamePikPakFile(account:Account,file:{file_id:string;isDir:boolean;parent_file_id:string},name:string){
 pikpakId(file.file_id);const result=await apiPikPakRename(account.id,file.file_id,name)
 if(!result.success||result.name!==name)throw Error('PikPak 未确认重命名结果，请刷新确认')
 const detail=await apiPikPakFileDetail(account.id,file.file_id),parent=pikpakParent(file.parent_file_id)
 if(!detail||detail.name!==name||(detail.kind==='drive#folder')!==file.isDir||(detail.parent_id||'')!==(parent==='pikpak_root'?'':parent))throw Error('PikPak 重命名名称、类型或位置未确认，请刷新确认')
 return {file_id:file.file_id,name:detail.name,error:''}
}
