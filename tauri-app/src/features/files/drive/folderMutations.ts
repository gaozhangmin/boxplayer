import {createCloud189Folder} from './cloud189FolderMutations'
import {createCloud139Folder} from './cloud139FileMutations'
import {createBaiduFolder} from './baiduFolderMutations'
import {createQuarkFolder} from './quarkFileMutations'
import {createGuangyaFolder} from './guangyaFileMutations'
import type {Account} from '@/features/sources/contracts'
import {json} from '@/features/sources/transport'
import {apiOneDriveMkdir} from './electron/providers/onedrive'
import {apiDropboxMkdir} from './electron/providers/dropbox'
import {apiBoxMkdir} from './electron/providers/box'
import {apiGoogleMkdir} from './electron/providers/google'
import {mutationAccount} from './providerTransport'
import {apiCloud123Mkdir} from './electron/providers/cloud123FileCmd'
import {cloud123Id} from './cloud123FileTransport'
import {createPikPakFolder} from './pikpakFileMutations'
import {createDrive115Folder} from './drive115FileMutations'
import {createAliFolder} from './aliFolderMutations'
export function supportsRemoteFolderCreation(account:Account){return ['onedrive','dropbox','box','google','123','aliyun','alipan-open','115','pikpak','guangya','quark','baidu','139','189'].includes(account.providerId)}
export async function createRemoteFolder(account:Account,parent:string,name:string,stillCurrent:()=>boolean=()=>true):Promise<{file_id:string;error:string}>{
 if(!supportsRemoteFolderCreation(account))throw Error('此来源的新建文件夹接口尚未接入')
 const selected=mutationAccount(account.id,account.providerId)
 if(!name.trim()||/[\u0000-\u001f/\\]/.test(name)||name==='.'||name==='..')throw Error('文件夹名称无效')
 let result:{file_id:string;error:string}
 if(account.providerId==='189')result=await createCloud189Folder(selected,parent,name,stillCurrent)
 else if(account.providerId==='139')result=await createCloud139Folder(selected,parent,name,stillCurrent)
 else if(account.providerId==='baidu')result=await createBaiduFolder(selected,parent,name,stillCurrent)
 else if(account.providerId==='quark')result=await createQuarkFolder(selected,parent,name)
 else if(account.providerId==='guangya')result=await createGuangyaFolder(selected,parent,name)
 else if(['aliyun','alipan-open'].includes(account.providerId))result=await createAliFolder(selected,parent,name,stillCurrent)
 else if(account.providerId==='pikpak')result=await createPikPakFolder(selected,parent,name)
 else if(account.providerId==='115')result=await createDrive115Folder(selected,parent,name)
 else if(account.providerId==='123')result=await apiCloud123Mkdir(selected.id,cloud123Id(['','root','backup_root','cloud123_root'].includes(parent)?'0':parent,true),name)
 else if(account.providerId==='onedrive')result=await apiOneDriveMkdir(selected.id,parent||'onedrive_root',name)
 else if(account.providerId==='box')result=await apiBoxMkdir(selected.id,parent||'box_root',name)
 else if(account.providerId==='google')result=await apiGoogleMkdir(selected.id,parent||'google_root',name)
 else{
  let path=parent==='dropbox_root'?'':parent
  if(path&&!path.startsWith('/')){
   const metadata=await json<{'.tag'?:string;id?:string;path_display?:string;path_lower?:string}>(selected,'POST','https://api.dropboxapi.com/2/files/get_metadata',{path})
   if(metadata['.tag']!=='folder')throw Error('Dropbox 目标不是文件夹')
   if(parent.startsWith('id:')&&metadata.id!==parent)throw Error('Dropbox 文件夹标识不匹配')
   path=metadata.path_display||metadata.path_lower||''
   if(!path.startsWith('/'))throw Error('无法读取 Dropbox 文件夹路径')
  }
  result=await apiDropboxMkdir(selected.id,path,name)
 }
 if(result.error||typeof result.file_id!=='string'||!result.file_id)throw Error(result.error||'提供商未返回新文件夹标识')
 if(account.providerId==='123')cloud123Id(result.file_id)
 return result
}
