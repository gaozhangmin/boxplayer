import {renameCloud189File} from './cloud189Rename'
import {renameCloud123File} from './cloud123Rename'
import {renameCloud139File} from './cloud139FileMutations'
import {renameBaiduFile} from './baiduRenameMutations'
import {renameQuarkFile} from './quarkFileMutations'
import {renameGuangyaFile} from './guangyaFileMutations'
import type{Account}from '@/features/sources/contracts'
import {mutationAccount} from './providerTransport'
import {apiOneDriveRename} from './electron/providers/onedrive'
import {apiGoogleRename} from './electron/providers/google'
import {apiBoxRename} from './electron/providers/box'
import {apiDropboxRename} from './electron/providers/dropbox'
import {renamePikPakFile} from './pikpakFileMutations'
import {renameDrive115File} from './drive115FileMutations'
import {renameAliFile} from './aliRenameMutations'
export const supportsRemoteRename=(account:Account)=>['onedrive','google','box','dropbox','123','aliyun','alipan-open','115','pikpak','guangya','quark','baidu','139','189'].includes(account.providerId)
export interface RemoteRenameResult {file_id:string;parent_file_id:string;name:string;isDir:boolean;path?:string;previousPath?:string;description?:string}
export async function renameRemoteFile(account:Account,file:{file_id:string;parent_file_id:string;isDir:boolean;path?:string;name?:string},name:string,stillCurrent:()=>boolean=()=>true):Promise<RemoteRenameResult>{
 const selected=mutationAccount(account.id,account.providerId)
 if(account.providerId==='alipan-open'&&JSON.stringify(account)!==JSON.stringify(selected))throw Error('阿里开放重命名账号已变化')
 if(!supportsRemoteRename(selected))throw Error('此来源重命名接口尚未接入')
 if(!file.file_id||!name.trim()||/[\u0000-\u001f/\\]/.test(name)||name==='.'||name==='..')throw Error('文件名或标识无效')
 if(selected.providerId==='189')return renameCloud189File(selected,file,name,stillCurrent)
 if(selected.providerId==='123')return renameCloud123File(account,file,name,stillCurrent)
 if(selected.providerId==='139')return renameCloud139File(selected,file,name,stillCurrent)
 if(selected.providerId==='baidu')return renameBaiduFile(selected,file,name,stillCurrent)
 const result=selected.providerId==='quark'?await renameQuarkFile(selected,file,name):selected.providerId==='guangya'?await renameGuangyaFile(selected,file,name):selected.providerId==='pikpak'?await renamePikPakFile(selected,file,name):selected.providerId==='115'?await renameDrive115File(selected,file,name):['aliyun','alipan-open'].includes(selected.providerId)?await renameAliFile(selected,file,name,stillCurrent):selected.providerId==='dropbox'?await apiDropboxRename(selected.id,file.file_id,name):selected.providerId==='onedrive'?await apiOneDriveRename(selected.id,file.file_id,name):selected.providerId==='google'?await apiGoogleRename(selected.id,file.file_id,name):await apiBoxRename(selected.id,file.file_id,name,file.isDir?'folder':'file')
 if(!result)throw Error('重命名结果无效')
 if(selected.providerId==='dropbox'&&'success'in result&&(!result.success||!('isDir'in result)||result.isDir!==file.isDir))throw Error('Dropbox 未确认重命名结果，请刷新确认')
 if('error'in result&&result.error)throw Error(result.error)
 if(result.file_id!==file.file_id)throw Error('重命名返回标识不匹配')
 if('name'in result&&result.name!==name)throw Error('提供商返回的名称不匹配，请刷新确认')
 return {file_id:file.file_id,parent_file_id:file.parent_file_id,name,isDir:file.isDir}
}
