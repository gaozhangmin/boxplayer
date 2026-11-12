// Protocol slices ported from Electron src/{onedrive,dropbox,box,google,cloud123}.
// Account and transport dependencies are replaced; no Electron stores are imported.
import type { Account, SourceDriver, SourceEntry, ResolvedMedia } from './contracts'
import { json, playable } from './transport'
import {buildOneDriveChildrenPath,mapOneDriveItemToAliModel,type OneDriveItem} from '@/features/files/drive/electron/providers/oneDriveListModel'
import {mapDropboxFileToAliModel} from '@/features/files/drive/electron/providers/dropboxListModel'
import type {DropboxMetadata} from '@/features/files/drive/electron/providers/dropboxMetadata'
import {buildBoxChildrenPath,mapBoxItemToAliModel} from '@/features/files/drive/electron/providers/boxListModel'
import type {BoxItem} from '@/features/files/drive/electron/providers/boxMetadata'
import {buildGoogleFilesListPath,buildGoogleSharedDriveFilesListPath,buildGoogleSharedWithMeListPath,mapGoogleFileToAliModel} from '@/features/files/drive/electron/providers/googleListModel'
import type {GoogleDriveFile} from '@/features/files/drive/electron/providers/googleMetadata'
import type {IAliGetFileModel} from '@/features/files/drive/electron/aliapi/alimodels'
import {cloud123DirectoryEntry} from '@/features/files/drive/cloud123DirectoryModel'
import {cloud123Id} from '@/features/files/drive/cloud123FileTransport'
const seg=encodeURIComponent
function media(account:Account,fileId:string,url:string):ResolvedMedia {
 const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('提供商返回的媒体地址无效')
 return{schemaVersion:1,sourceId:account.id,accountId:account.id,fileId,url:u.href,headers:{}}
}
function entry(id:string,name:string,folder:boolean,size:number):SourceEntry{return{id,name,isDirectory:folder,size,playable:!folder&&playable(name)}}
function originalEntry(model:IAliGetFileModel):SourceEntry&{electronModel:IAliGetFileModel}{
 if(!model.file_id||!model.name||!Number.isSafeInteger(model.size)||model.size<0)throw Error('来源文件模型标识或大小无效')
 return {...entry(model.file_id,model.name,model.isDir,model.size),electronModel:model}
}
type GraphItem=OneDriveItem
const graph='https://graph.microsoft.com/v1.0'
export const onedrive:SourceDriver={
 async list(account,parent,cursor){
  const url=cursor||graph+buildOneDriveChildrenPath(parent,200)
  const parsed=new URL(url);if(parsed.origin!=='https://graph.microsoft.com'||!parsed.pathname.startsWith('/v1.0/'))throw new Error('OneDrive 分页地址无效')
  const data=await json<{value:GraphItem[];'@odata.nextLink'?:string}>(account,'GET',url)
  return{entries:data.value.map(i=>originalEntry(mapOneDriveItemToAliModel(i,account.id,parent))),nextCursor:data['@odata.nextLink']}
 },
 async resolve(account,item){const data=await json<GraphItem>(account,'GET',`${graph}/me/drive/items/${seg(item.id)}`);return media(account,item.id,data['@microsoft.graph.downloadUrl']||data['@content.downloadUrl']||'')}
}
const dbx='https://api.dropboxapi.com/2'
export const dropbox:SourceDriver={
 async list(account,parent,cursor){
  const data=await json<{entries:DropboxMetadata[];cursor:string;has_more:boolean}>(account,'POST',`${dbx}/files/list_folder${cursor?'/continue':''}`,cursor?{cursor}:{path:parent||'',limit:200,recursive:false,include_deleted:false})
  return{entries:data.entries.filter(i=>i['.tag']!=='deleted').map(i=>originalEntry(mapDropboxFileToAliModel(i,account.id,parent))),nextCursor:data.has_more?data.cursor:undefined}
 },
 async resolve(account,item){const data=await json<{link:string}>(account,'POST',`${dbx}/files/get_temporary_link`,{path:item.id});return media(account,item.id,data.link)}
}
const boxApi='https://api.box.com/2.0'
export const box:SourceDriver={
 async list(account,parent,cursor){
  const offset=Number(cursor||0);if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Box 分页参数无效')
  const data=await json<{entries:BoxItem[];total_count:number;limit:number}>(account,'GET',boxApi+buildBoxChildrenPath(parent,200,offset),undefined,JSON.parse,{'x-rep-hints':'[jpg?dimensions=320x320]'})
  return{entries:data.entries.map(i=>originalEntry(mapBoxItemToAliModel(i,account.id,parent))),nextCursor:offset+data.entries.length<data.total_count?String(offset+data.entries.length):undefined}
 },
 async resolve(account,item){return media(account,item.id,`${boxApi}/files/${seg(item.id)}/content`)}
}
const googleApi='https://www.googleapis.com/drive/v3'
// Scope shared-drive folder ancestry to exact account metadata, not a global file-id cache.
const googleSharedFolders=new Map<string,Map<string,string>>()
export const google:SourceDriver={
 async list(account,parent,cursor){
  const owner=JSON.stringify(account);let folders=googleSharedFolders.get(owner)
  if(!folders){folders=new Map();googleSharedFolders.set(owner,folders)}
  if(parent==='google_shared_drives'){
   const params=new URLSearchParams({pageSize:'100',fields:'nextPageToken,drives(id,name)'})
   if(cursor)params.set('pageToken',cursor)
   const data=await json<{drives:{id:string;name:string}[];nextPageToken?:string}>(account,'GET',googleApi+'/drives?'+params)
   if(!Array.isArray(data.drives)||data.nextPageToken&&data.nextPageToken===cursor)throw Error('Google共享硬盘分页响应无效')
   const ids=new Set<string>()
   const entries=data.drives.map(d=>{if(typeof d.id!=='string'||!d.id||typeof d.name!=='string'||!d.name||ids.has(d.id))throw Error('Google共享硬盘身份无效');ids.add(d.id);folders!.set(d.id,d.id);return originalEntry(mapGoogleFileToAliModel({id:d.id,name:d.name,mimeType:'application/vnd.google-apps.folder'},account.id,parent))})
   return {entries,nextCursor:data.nextPageToken}
  }
  const shared=folders.get(parent)
  const path=parent==='google_shared'?buildGoogleSharedWithMeListPath(cursor||'',200):shared?buildGoogleSharedDriveFilesListPath(shared,parent,cursor||''):buildGoogleFilesListPath(parent,cursor||'',200)
  const data=await json<{files:GoogleDriveFile[];nextPageToken?:string}>(account,'GET',googleApi+path)
  if(!Array.isArray(data.files)||data.nextPageToken&&data.nextPageToken===cursor)throw Error('Google文件分页响应无效')
  if(shared)for(const file of data.files)folders.set(file.shortcutDetails?.targetId||file.id,shared)
  const entries=data.files.map(i=>originalEntry(mapGoogleFileToAliModel(i,account.id,parent)))
  if(parent==='google_shared'&&!cursor)entries.unshift(originalEntry(mapGoogleFileToAliModel({id:'google_shared_drives',name:'共享云端硬盘',mimeType:'application/vnd.google-apps.folder'},account.id,parent)))
  return{entries,nextCursor:data.nextPageToken}
 },
 async resolve(account,item){return media(account,item.id,`${googleApi}/files/${seg(item.id)}?alt=media&supportsAllDrives=true`)}
}
interface Cloud123Result<T>{code:number;message:string;data:T}
function unwrap123<T>(data:Cloud123Result<T>):T{if(data.code!==0)throw new Error(`123 请求失败（${data.code}）`);return data.data}
export const cloud123:SourceDriver={
 async list(account,parent,cursor){
  const q=new URLSearchParams({parentFileId:cloud123Id(parent||'0',true),limit:'100',trashed:'0'});if(cursor)q.set('lastFileId',cloud123Id(cursor,true))
  const data=unwrap123(await json<Cloud123Result<{fileList:unknown[];lastFileId:number}>>(account,'GET',`https://open-api.123pan.com/api/v2/file/list?${q}`,undefined,JSON.parse,{Platform:'open_platform'}))
  const last=data?.lastFileId??-1
  if(!data||!Array.isArray(data.fileList)||!Number.isSafeInteger(last)||last< -1||last>=0&&String(last)===cursor||!data.fileList.length&&last>=0)throw Error('123 目录分页响应无效或游标重复')
  const entries=data.fileList.filter(row=>!row||typeof row!=='object'||!('trashed'in row)||row.trashed!==1).map(row=>cloud123DirectoryEntry(account,parent,row))
  if(new Set(entries.map(row=>row.id)).size!==entries.length)throw Error('123 目录返回重复文件')
  return{entries,nextCursor:last>=0?String(last):undefined}
 },
 async resolve(account,item){const data=unwrap123(await json<Cloud123Result<{downloadUrl:string}>>(account,'GET',`https://open-api.123pan.com/api/v1/file/download_info?fileId=${seg(item.id)}`));return media(account,item.id,data.downloadUrl)}
}

export const drive115:SourceDriver={
 async search(account,query,cursor){const {searchDrive115}=await import('@/features/files/drive/drive115Search');return searchDrive115(account,query,cursor)},
 async list(account,parent,cursor){const {listDrive115}=await import('@/features/files/drive/drive115Listing');return listDrive115(account,parent,cursor)},
 async resolve(account,item){const {nativeCall}=await import('@/platform/native');return nativeCall<ResolvedMedia>('resolve_protected_media',{accountId:account.id,fileId:item.id})}
}

export const quark:SourceDriver={
 async list(account,parent,cursor){const {listQuark}=await import('@/features/files/drive/quarkListing');return listQuark(account,parent,cursor)},
 async search(account,query,cursor){const {searchQuark}=await import('@/features/files/drive/quarkListing');return searchQuark(account,query,cursor)},
 async resolve(account,item){const{nativeCall}=await import('@/platform/native');return nativeCall<ResolvedMedia>('resolve_protected_media',{accountId:account.id,fileId:item.id})}
}

export const baidu:SourceDriver={
 async list(account,parent,cursor){const {listBaidu}=await import('@/features/files/drive/baiduListing');return listBaidu(account,parent,cursor)},
 async search(account,query,cursor){const {searchBaidu}=await import('@/features/files/drive/baiduListing');return searchBaidu(account,query,cursor)},
 async resolve(account,item){const{nativeCall}=await import('@/platform/native');return nativeCall<ResolvedMedia>('resolve_protected_media',{accountId:account.id,fileId:item.id})}
}
