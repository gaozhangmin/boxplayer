import {copyBaiduFile} from './baiduBatchMutations'
import {copyCloud139File} from './cloud139BatchMutations'
import {copyCloud189File} from './cloud189Copy'
import {moveCloud189File} from './cloud189Move'
import {moveCloud139File} from './cloud139Move'
import {moveBaiduFile,type BaiduMoveResult} from './baiduMoveMutations'
import {moveQuarkFile} from './quarkFileMutations'
import {quarkId} from './quarkFileTransport'
import {copyGuangyaFile} from './guangyaCopy'
import {moveGuangyaFile} from './guangyaFileMutations'
import {relocatePikPakFile} from './pikpakRelocation'
import type {Account} from '@/features/sources/contracts'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import {mutationAccount} from './providerTransport'
import {apiBoxMoveBatch,apiBoxCopyBatch} from './electron/providers/box'
import {apiGoogleMoveBatch,apiGoogleCopyBatch} from './electron/providers/google'
import {apiGoogleFileDetail} from './electron/providers/googleMetadata'
import {apiDropboxMoveBatch,apiDropboxCopyBatch} from './electron/providers/dropbox'
import {resolveDropboxRenamePath} from './dropboxRenamePorts'
import {dropboxRelocationReceipt} from './dropboxBatchPorts'
import {apiOneDriveMoveBatch,apiOneDriveCopyBatch} from './electron/providers/onedrive'
import {json} from '@/features/sources/transport'
import {apiCloud123MoveBatch} from './electron/providers/cloud123FileCmd'
import {cloud123Id} from './cloud123FileTransport'
import {copyCloud123Single} from './cloud123Copy'
import {copyCloud123Batch,hasCloud123BatchCopy} from './cloud123BatchCopy'
import {apiDrive115MoveBatch} from './electron/providers/drive115Move'
import {apiDrive115CopyBatch} from './electron/providers/drive115Copy'
import {drive115Id,drive115Parent,drive115Detail} from './drive115FileTransport'
import {relocateAliFile} from './aliRelocationMutations'
import type {AliCrossDriveReceipt} from './aliRelocationTransport'
export const supportsRemoteRelocation=(account:Account)=>['box','google','dropbox','onedrive','123','aliyun','alipan-open','115','pikpak','guangya','quark','baidu','139','189'].includes(account.providerId)
export const supportsRemoteCopy=(account:Account)=>!['quark'].includes(account.providerId)&&supportsRemoteRelocation(account)
export async function relocateRemoteFiles(account:Account,files:IAliGetFileModel[],destination:string,copy:boolean,stillCurrent:()=>boolean,ancestors?:ReadonlyArray<string>,synchronize?:(file:IAliGetFileModel,receipt:AliCrossDriveReceipt)=>Promise<void>):Promise<{success:string[];failures:string[];names?:Record<string,string>;baidu?:BaiduMoveResult[];identitySynced?:string[]}>{
 mutationAccount(account.id,account.providerId)
 if(!supportsRemoteRelocation(account))throw Error('此来源移动/复制接口尚未接入')
 if(copy&&!supportsRemoteCopy(account))throw Error('此来源复制接口尚未接入')
 if(!files.length||new Set(files.map(file=>file.file_id)).size!==files.length||files.some(file=>!file.file_id||file.drive_id!==account.id))throw Error('文件操作来源或选择无效')
 if(account.providerId==='quark'){quarkId(destination,true);files.forEach(file=>quarkId(file.file_id))}
 let parent=destination
 if(account.providerId==='115'){parent=drive115Parent(parent);for(const file of files)drive115Id(file.file_id);if(parent!=='0'){const target=await drive115Detail(account.id,parent);if(!target.isDir)throw Error('115 目标不是文件夹');if(!stillCurrent())throw Error('来源已切换')}}
 if(account.providerId==='123'){parent=cloud123Id(['','root','backup_root','cloud123_root'].includes(parent)?'0':parent,true);for(const file of files)cloud123Id(file.file_id)}
 if(copy&&account.providerId==='123'&&(files.length>1||hasCloud123BatchCopy(account.id,files,parent)))return copyCloud123Batch(account,files,parent,stillCurrent)
 if(account.providerId==='onedrive'&&['','root','backup_root','onedrive_root'].includes(parent)){
  const root=await json<{id?:unknown;folder?:unknown;deleted?:unknown}>(account,'GET','https://graph.microsoft.com/v1.0/me/drive/root?$select=id,folder,deleted')
  if(!root||typeof root.id!=='string'||!root.id||!root.folder||root.deleted)throw Error('OneDrive 根目录无效')
  if(!stillCurrent())throw Error('来源已切换')
  parent=root.id
 }
 if(account.providerId==='dropbox'){
  parent=['','root','backup_root','dropbox_root'].includes(parent)?'':await resolveDropboxRenamePath(account.id,parent,true)
  if(!stillCurrent())throw Error('来源已切换')
 }
 if(account.providerId==='box'&&['','root','backup_root','box_root'].includes(parent))parent='box_root'
 if(account.providerId==='google'&&['','root','backup_root','google_root'].includes(parent)){
  const root=await apiGoogleFileDetail(account.id,'root')
  if(root.mimeType!=='application/vnd.google-apps.folder'||root.trashed)throw Error('Google Drive 根目录无效')
  parent=root.id
 }
 const identitySynced:string[]=[],success:string[]=[],failures:string[]=[],names:Record<string,string>={},baidu:BaiduMoveResult[]=[]
 for(const file of files){
  if(!stillCurrent()){failures.push('浏览器已关闭或切换，停止后续文件操作');break}
  try{
   if(copy&&account.providerId==='google'&&file.isDir)throw Error('Google Drive 不支持直接复制文件夹')
   const baiduResult=account.providerId==='baidu'&&!copy?await moveBaiduFile(account,file,parent,stillCurrent,ancestors):undefined
   const pikpak=account.providerId==='pikpak'?await relocatePikPakFile(account,file,parent,copy,stillCurrent):undefined
   const ali=['aliyun','alipan-open'].includes(account.providerId)?await relocateAliFile(account,file,parent,copy,stillCurrent,synchronize?receipt=>synchronize(file,receipt):undefined):undefined
   const result=account.providerId==='baidu'&&copy?await copyBaiduFile(account,file,parent,stillCurrent,ancestors):account.providerId==='189'?await (copy?copyCloud189File:moveCloud189File)(account,file,parent,stillCurrent,ancestors):account.providerId==='139'?await (copy?copyCloud139File:moveCloud139File)(account,file,parent,stillCurrent,ancestors):baiduResult?[baiduResult.file_id]:account.providerId==='quark'?await moveQuarkFile(account,file,parent,stillCurrent):account.providerId==='guangya'?(copy?await copyGuangyaFile(account,file,parent,stillCurrent):await moveGuangyaFile(account,file,parent,stillCurrent)):pikpak?pikpak.ids:ali?ali.ids:account.providerId==='115'?await (copy?apiDrive115CopyBatch:apiDrive115MoveBatch)(account.id,[file.file_id],parent):account.providerId==='123'
    ?copy?await copyCloud123Single(account,file,parent,stillCurrent):await apiCloud123MoveBatch(account.id,[file.file_id],parent)
    :account.providerId==='onedrive'
    ?copy?await apiOneDriveCopyBatch(account.id,parent,[file]):await apiOneDriveMoveBatch(account.id,parent,[file.file_id])
    :account.providerId==='dropbox'
    ?await (copy?apiDropboxCopyBatch:apiDropboxMoveBatch)(account.id,[file.file_id],parent||'dropbox_root','',()=>{if(!stillCurrent())throw Error('来源已切换')})
    :account.providerId==='google'
    ?await (copy?apiGoogleCopyBatch:apiGoogleMoveBatch)(account.id,[file.file_id],parent)
    :await (copy?apiBoxCopyBatch:apiBoxMoveBatch)(account.id,[file.file_id],parent,{[file.file_id]:file.isDir?'folder':'file'})
   if(!result.includes(file.file_id))throw Error('提供商未确认文件操作')
   if(pikpak?.name)names[file.file_id]=pikpak.name
   if(ali){names[file.file_id]=ali.name;if(ali.identitySynced)identitySynced.push(file.file_id)}
   if(account.providerId==='dropbox'){const receipt=dropboxRelocationReceipt(file.file_id);if(!receipt)throw Error('Dropbox 缺少文件名称回执');names[file.file_id]=receipt.name}
   if(baiduResult){baidu.push(baiduResult);names[file.file_id]=baiduResult.name}
   success.push(file.file_id)
  }catch(cause){failures.push(file.name+'：'+(cause instanceof Error?cause.message:'文件操作失败'))}
 }
 return {success,failures,...(identitySynced.length?{identitySynced}:{}),...(['dropbox','aliyun','alipan-open','pikpak','baidu'].includes(account.providerId)?{names}: {}),...(account.providerId==='baidu'?{baidu}: {})}
}
