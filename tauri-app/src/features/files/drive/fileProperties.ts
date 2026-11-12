import {humanSize} from './electron/utils/format'
import {ApiFileInfo as aliFileInfo,ApiFileGetFolderSize as aliFolderSize,ApiFileGetPathString as aliPath} from './electron/providers/aliMetadata'
import {withAliMetadataContext} from './aliMetadataPorts'
import {apiCloud123FileDetail} from './electron/providers/cloud123FileCmd'
import {mapCloud123InfoToAliModel} from './electron/providers/cloud123ListModel'
import {cloud123Id} from './cloud123FileTransport'
import {readOriginalProviderProperties} from './providerFileProperties'
import {cloud139Directory} from './cloud139FileMutations'
import {cloud139Id} from './cloud139FileTransport'
import {withPikpakDetailScope} from './pikpakFileTransport'
import {apiPikPakFileDetail,mapPikPakFileToAliModel} from './electron/providers/pikpakMetadata'
import {readDrive115Metadata} from './drive115FileTransport'
import {mapDrive115DetailToAliModel} from './electron/providers/drive115Search'
import * as dropboxVersions from './electron/providers/dropboxRevisions'
import * as oneDriveVersions from './electron/providers/oneDriveRevisions'
import {apiDropboxFileDetail} from './electron/providers/dropboxMetadata'
import * as boxVersions from './electron/providers/boxRevisions'
import * as googleVersions from './electron/providers/googleRevisions'
import * as googlePermissions from './electron/providers/googlePermissions'
import {getDrivePane} from './ports'
import {nativeCall} from '@/platform/native'
import type {LocalListing} from '@/platform/contracts'
import type {ResolvedMedia} from '@/features/sources/contracts'
import type {IAliFileItem,IAliGetFileModel,IAliGetForderSizeModel} from './electron/aliapi/alimodels'
import {apiBoxFileDetail} from './electron/providers/boxMetadata'
import {apiGoogleFileDetail} from './electron/providers/googleMetadata'
import {graphJson,mutationAccount} from './providerTransport'
import {createFileWalk} from './fileWalk'
import {driver} from '@/features/sources/drivers'
function projection(file:IAliGetFileModel,values:Partial<IAliFileItem>):IAliFileItem{
 return {drive_id:file.drive_id,domain_id:'',file_id:file.file_id,name:file.name,type:file.isDir?'folder':'file',content_type:'',created_at:'',updated_at:'',hidden:false,size:file.size,starred:file.starred,status:'',upload_id:'',parent_file_id:file.parent_file_id,crc64_hash:'',content_hash:'',content_hash_name:'',download_url:'',url:'',category:file.category,encrypt_mode:'',punish_flag:0,mime_extension:file.ext,mime_type:file.mime_type,play_cursor:'',duration:'',...values}
}
export function createFileProperties(){
 const pane=getDrivePane(),source=pane.sourceId,context=pane.context
 const ownerProvider=pane.account?.providerId,owner=(value:typeof pane.account)=>value?JSON.stringify([value.id,value.providerId,value.userId||'',value.deviceId||'',value.baseUrl]):''
 const ownerIdentity=owner(pane.account),walk=createFileWalk(check)
 let disposed=false
 const detailPaths=new Map<string,string>()
 function check(){if(disposed||getDrivePane()!==pane||pane.sourceId!==source||pane.context!==context)throw Error('属性窗口已关闭或来源已切换');if(ownerProvider&&owner(mutationAccount(source,ownerProvider))!==ownerIdentity)throw Error('属性账号身份已变化')}
 async function folderStats(id:string,name:string){
  const result=await walk.ApiWalkFileList(source,source,id,name,'name asc','',5000);check()
  let size=0,files=0,folders=0
  for(const row of result.items){
   if(row.isDir){folders++;continue}
   if(!Number.isSafeInteger(row.size)||row.size<0||!Number.isSafeInteger(size+row.size))throw Error('文件夹统计大小无效或超出安全范围')
   size+=row.size;files++
  }
  return {size,file_count:files,folder_count:folders}
 }
 function pathFor(parent:string){
  if(!parent||parent==='backup_root')return '/'
  const names:string[]=[],seen=new Set<string>();let current=parent
  while(current){if(seen.has(current))return '路径暂不可用';seen.add(current);const row=pane.file?.(current);if(!row||row.file_id!==current||!row.isDir)return '路径暂不可用';names.unshift(row.name);current=row.parent_file_id}
  return '/'+names.join('/')
 }
 return {
  dispose(){disposed=true;walk.dispose()},check,
  async read(file:IAliGetFileModel){
   check();if(file.drive_id!==source||!file.file_id)throw Error('属性来源不匹配')
   let info:IAliFileItem,dirInfo:IAliGetForderSizeModel|undefined,path=pathFor(file.parent_file_id),provider=pane.account?.providerId
   if(pane.local){
    const listing=await nativeCall<LocalListing>('local_list',{sourceId:source,relativePath:file.parent_file_id});check()
    if(listing.sourceId!==source)throw Error('属性来源不匹配')
    const row=listing.entries.find(row=>row.relativePath===file.file_id);if(!row)throw Error('文件已不存在，请刷新列表')
    info=projection(file,{name:row.name,type:row.isDirectory?'folder':'file',size:row.isDirectory?0:row.size,updated_at:row.modified?new Date(row.modified<1e12?row.modified*1000:row.modified).toISOString():''})
    if(row.isDirectory){
     dirInfo=await folderStats(row.relativePath,row.name);Object.assign(info,{size:dirInfo.size,file_count:dirInfo.file_count,sizeStr:humanSize(dirInfo.size)})
    }
   }else{
    const account=pane.account;if(!account)throw Error('来源账号不存在');mutationAccount(source,account.providerId)
    if(provider==='123'){
     if(pane.store?.SelectDirType==='trash')throw Error('回收站不提供此属性入口')
     const id=cloud123Id(file.file_id),detail=await apiCloud123FileDetail(source,id);check()
     if(!detail||cloud123Id(String(detail.fileId??detail.fileID??detail.file_id??''))!==id||![0,1].includes(detail.type)||(detail.type===1)!==file.isDir||detail.trashed===1||typeof detail.filename!=='string'||!detail.filename)throw Error('123 属性文件身份或类型不匹配')
     const parent=cloud123Id(String(detail.parentFileId??detail.parentFileID??detail.parent_file_id??''),true)
     if(!Number.isSafeInteger(detail.size)||detail.size<0)throw Error('123 属性大小无效')
     for(const key of ['createAt','create_at','updateAt','update_at'])if(detail[key]!==undefined&&(typeof detail[key]!=='string'||detail[key]!==''&&!Number.isFinite(Date.parse(detail[key]))))throw Error('123 属性日期无效')
     const mapped=mapCloud123InfoToAliModel(detail),nativeParent=parent==='0'?'':parent
     info=projection(file,{...mapped,drive_id:source,file_id:id,parent_file_id:nativeParent,type:file.isDir?'folder':'file',created_at:detail.createAt||detail.create_at||'',updated_at:detail.updateAt||detail.update_at||''})
     path=pathFor(nativeParent)
    }else if(provider==='aliyun'||provider==='alipan-open'){
     if(pane.store?.SelectDirType==='trash')throw Error('阿里回收站属性详情尚未接入')
     let identity:{driveId:string;fileId:string}
     try{identity=JSON.parse(file.file_id)}catch{throw Error('阿里属性文件标识无效')}
     if(!identity||typeof identity.driveId!=='string'||!identity.driveId||typeof identity.fileId!=='string'||!identity.fileId||file.file_id!==JSON.stringify({driveId:identity.driveId,fileId:identity.fileId}))throw Error('阿里属性文件标识无效')
     const detail=await withAliMetadataContext(source,check,()=>aliFileInfo(source,identity.driveId,identity.fileId,provider==='aliyun'));check()
     if(!detail||typeof detail!=='object'||detail.type!==(file.isDir?'folder':'file'))throw Error('阿里属性文件类型不匹配')
     const root=identity.fileId==='root'
     const parent=root?'':JSON.stringify({driveId:identity.driveId,fileId:detail.parent_file_id})
     info=projection(file,{...detail,drive_id:source,file_id:file.file_id,parent_file_id:parent})
     path=root?'/'+detail.name:detail.parent_file_id==='root'?'/':pathFor(parent)
     if(provider==='aliyun'&&!root)path='/'+await withAliMetadataContext(source,check,()=>aliPath(source,identity.driveId,identity.fileId,'/'))
     if(file.isDir){
      dirInfo=provider==='aliyun'?await withAliMetadataContext(source,check,()=>aliFolderSize(source,identity.driveId,identity.fileId)):await folderStats(file.file_id,detail.name);check()
      if(!dirInfo)throw Error('阿里目录统计结果缺失')
      Object.assign(info,{size:dirInfo.size,file_count:dirInfo.file_count,sizeStr:humanSize(dirInfo.size)})
     }
    }else if(provider==='quark'||provider==='baidu'||provider==='guangya'||provider==='189'){
     const detail=await readOriginalProviderProperties(account,file,pane.store?.SelectDirType==='trash',check);check()
     info=projection(file,{...detail.model,type:detail.model.isDir?'folder':'file',created_at:detail.created,updated_at:detail.updated,...('duration'in detail?{duration:detail.duration}:{})})
     path='path'in detail&&detail.path?detail.path:pathFor(detail.parent)
     if(detail.model.isDir&&pane.store?.SelectDirType!=='trash'){dirInfo=await folderStats(detail.model.file_id,detail.model.name);Object.assign(info,{size:dirInfo.size,file_count:dirInfo.file_count,sizeStr:humanSize(dirInfo.size)})}
     // Recycle folders cannot be traversed through normal directory endpoints.
    }else if(provider==='139'){
     const parent=cloud139Id(file.parent_file_id,true),id=cloud139Id(file.file_id)
     const actual=(await cloud139Directory(account,parent,check)).find(row=>row.id===id);check()
     const mapped=actual&&'electronModel'in actual?actual.electronModel as IAliGetFileModel:undefined
     if(!actual||!mapped||mapped.file_id!==id||mapped.drive_id!==source||actual.isDirectory!==file.isDir)throw Error('139 属性详情缺失或类型不匹配')
     info=projection(file,{...mapped,type:mapped.isDir?'folder':'file',updated_at:mapped.time?new Date(mapped.time).toISOString():''})
     if(actual.isDirectory){
      dirInfo=await folderStats(id,actual.name);Object.assign(info,{size:dirInfo.size,file_count:dirInfo.file_count,sizeStr:humanSize(dirInfo.size)})
     }
    }else if(provider==='pikpak'){
     const detail=await withPikpakDetailScope(source,pane.store?.SelectDirType==='trash',()=>apiPikPakFileDetail(source,file.file_id));check()
     if(!detail||(detail.kind==='drive#folder')!==file.isDir)throw Error('PikPak 属性详情缺失或类型不匹配')
     const mapped=mapPikPakFileToAliModel(detail,source,detail.parent_id||'')
     info=projection(file,{...mapped,type:mapped.isDir?'folder':'file',created_at:detail.created_time||'',updated_at:detail.modified_time||detail.created_time||''})
     path=pathFor(detail.parent_id||'')
    }else if(provider==='115'){
     const detail=await readDrive115Metadata(source,file.file_id);check();if(detail.isDir!==file.isDir)throw Error('115 属性文件类型不匹配')
     const mapped=mapDrive115DetailToAliModel(detail,source)
     info=projection(file,{...mapped,type:detail.isDir?'folder':'file',created_at:detail.created_at||'',updated_at:detail.updated_at||'',content_hash:detail.sha1||'',content_hash_name:detail.sha1?'sha1':''})
     if(detail.isDir)dirInfo={size:detail.size||0,folder_count:detail.folder_count||0,file_count:detail.file_count||0}
     if(detail.path.length)path='/'+detail.path.map(row=>row.file_name).filter(Boolean).join('/')
    }else if(provider==='box'){
     const data=await apiBoxFileDetail(source,file.file_id,file.isDir);check()
     if(!data||data.id!==file.file_id||data.type!==(file.isDir?'folder':'file'))throw Error('属性详情标识或类型不匹配')
     info=projection(file,{name:data.name,type:data.type,size:data.size??file.size,created_at:data.created_at||'',updated_at:data.modified_at||'',parent_file_id:data.parent?.id==='0'?'':data.parent?.id||'',content_hash:data.sha1||'',content_hash_name:data.sha1?'sha1':''})
     if(data.path_collection?.entries)path='/'+data.path_collection.entries.map(row=>row.name||'').filter(Boolean).join('/')
    }else if(provider==='google'){
     const data=await apiGoogleFileDetail(source,file.file_id);check()
     info=projection(file,{name:data.name,type:data.mimeType==='application/vnd.google-apps.folder'?'folder':'file',mime_type:data.mimeType||'',size:Number(data.size)||0,created_at:data.createdTime||'',updated_at:data.modifiedTime||'',parent_file_id:data.parents?.[0]||'',content_hash:data.md5Checksum||'',content_hash_name:data.md5Checksum?'md5':''})
     if(data.parents?.[0]&&!file.parent_file_id){const root=await apiGoogleFileDetail(source,'root');check();path=data.parents[0]===root.id?'/':pathFor(data.parents[0])}
     else path=pathFor(data.parents?.[0]||'')
    }else if(provider==='onedrive'){
     const response=await graphJson<Record<string,any>>(source,`/me/drive/items/${encodeURIComponent(file.file_id)}`,'GET',undefined,'读取 OneDrive 属性失败');check();const data=response.data
     if(response.error||!data||data.id!==file.file_id)throw Error(response.error||'属性详情标识不匹配')
     info=projection(file,{name:data.name,type:data.folder?'folder':'file',size:Number(data.size)||0,created_at:data.createdDateTime||'',updated_at:data.lastModifiedDateTime||'',mime_type:data.file?.mimeType||'',content_hash:data.file?.hashes?.sha1Hash||'',content_hash_name:data.file?.hashes?.sha1Hash?'sha1':''})
     const parent=String(data.parentReference?.path||'');path=parent.includes('root:')?parent.split('root:')[1]||'/':path
    }else if(provider==='dropbox'){
     const data=await apiDropboxFileDetail(source,file.file_id);check()
     if(!data||data['.tag']!==(file.isDir?'folder':'file')||data.id!==file.file_id)throw Error('Dropbox 属性详情标识或类型不匹配')
     const fullPath=data.path_display||data.path_lower||''
     if(fullPath&&!fullPath.startsWith('/'))throw Error('Dropbox 属性路径无效')
     if(fullPath)detailPaths.set(fullPath,file.file_id)
     path=fullPath?fullPath.slice(0,fullPath.lastIndexOf('/'))||'/':path
     info=projection(file,{name:data.name,type:file.isDir?'folder':'file',size:data.size??0,updated_at:data.server_modified||'',content_hash:data.content_hash||'',content_hash_name:data.content_hash?'dropbox_content_hash':'',path:fullPath})
    }else throw Error('此来源属性详情接口尚未接入')
   }
   check();return {fileInfo:info,dirInfo,dirPath:path,provider}
  },
  async downloadUrl(fileId:string){
   check();const account=pane.account,file=pane.file?.(fileId)
   if(!account||!file||pane.local)throw Error('本地文件没有网盘下载链接')
   if(['box','google'].includes(account.providerId))throw Error('此来源链接需要账号鉴权，暂不能复制为独立下载链接')
   if(file.isDir||pane.store?.SelectDirType==='trash')throw Error('文件夹或回收站项目没有独立下载链接')
   const resolved=account.providerId==='pikpak'?await nativeCall<ResolvedMedia>('pikpak_download_url',{accountId:account.id,fileId}):await driver(account).resolve(account,{id:file.file_id,name:file.name,isDirectory:file.isDir,size:file.size,playable:file.category==='video'});check()
   if(!resolved||resolved.schemaVersion!==1||resolved.sourceId!==source||resolved.accountId!==source||resolved.fileId!==fileId||typeof resolved.url!=='string'||!resolved.headers||typeof resolved.headers!=='object'||Array.isArray(resolved.headers))throw Error('下载链接来源或文件不匹配')
   if(Object.keys(resolved.headers).length)throw Error('此来源链接需要专用请求头，暂不能复制为独立下载链接')
   let url:URL;try{url=new URL(resolved.url)}catch{throw Error('下载链接格式无效')}
   if(!['http:','https:'].includes(url.protocol))throw Error('此链接仅供原生播放器使用，暂不能复制为独立下载链接')
   if(url.username||url.password)throw Error('此链接包含账号信息，不能复制为独立下载链接')
   return {url:resolved.url}
  },
  async command<T>(name:string,...args:unknown[]):Promise<T>{
   check()
   const commands:Record<string,{provider:string;run:(...values:any[])=>Promise<unknown>}>= {
    dropboxListRevisions:{provider:'dropbox',run:dropboxVersions.apiDropboxListRevisions},dropboxRestoreRevision:{provider:'dropbox',run:dropboxVersions.apiDropboxRestoreRevision},
    oneDriveListVersions:{provider:'onedrive',run:(user,file)=>oneDriveVersions.apiOneDriveListVersions(user,file,check)},oneDriveRestoreVersion:{provider:'onedrive',run:oneDriveVersions.apiOneDriveRestoreVersion},
    boxListVersions:{provider:'box',run:(user,file)=>boxVersions.apiBoxListVersions(user,file,check)},boxPromoteVersion:{provider:'box',run:boxVersions.apiBoxPromoteVersion},boxDeleteVersion:{provider:'box',run:boxVersions.apiBoxDeleteVersion},
    googleListRevisions:{provider:'google',run:(user,file)=>googleVersions.apiGoogleListRevisions(user,file,check)},googleUpdateRevision:{provider:'google',run:googleVersions.apiGoogleUpdateRevision},googleDeleteRevision:{provider:'google',run:googleVersions.apiGoogleDeleteRevision},
    googleListPermissions:{provider:'google',run:(user,file)=>googlePermissions.apiGoogleListPermissions(user,file,check)},googleDeletePermission:{provider:'google',run:googlePermissions.apiGoogleDeletePermission}
   }
   const operation=commands[name]
   if(!operation)throw Error('此来源版本或权限管理接口尚未接入')
   if(name==='dropboxRestoreRevision'&&(typeof args[1]!=='string'||!detailPaths.has(args[1])))throw Error('属性操作来源或文件不匹配')
   if(!['boxListVersions','googleListRevisions','googleListPermissions','oneDriveListVersions','dropboxListRevisions'].includes(name)&&(typeof args[2]!=='string'||!args[2]))throw Error('版本或权限标识无效')
   if(name==='googleUpdateRevision'&&typeof args[3]!=='boolean')throw Error('版本固定状态无效')
   if(args[0]!==source||pane.account?.providerId!==operation.provider||typeof args[1]!=='string'||!pane.file?.(name==='dropboxRestoreRevision'?detailPaths.get(args[1])||'':args[1]))throw Error('属性操作来源或文件不匹配')
   const result=await operation.run(...args);check()
   if(name==='dropboxRestoreRevision'){
    const restored=result as {id?:unknown;rev?:unknown;'.tag'?:unknown}|null
    if(!restored||restored.id!==detailPaths.get(String(args[1]))||restored['.tag']!=='file')throw Error('Dropbox 版本恢复结果不匹配，请重新加载确认')
   }
   if(name==='googleUpdateRevision'){
    const revision=result as {id?:unknown;keepForever?:unknown}|null
    if(!revision||revision.id!==args[2]||revision.keepForever!==args[3])throw Error('版本更新结果不匹配，请重新加载确认')
   }
   return result as T
  }
 }
}
