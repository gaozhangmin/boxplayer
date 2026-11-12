<script setup lang="ts">
import {startAliDirectorySizeRefresh} from './aliDirectorySizeRefresh'
import FolderPreviewPopover from './FolderPreviewPopover.vue'
import type {FolderPreviewParams} from './folderPreview'
import {cancelTextCreationScope} from './textCreationScope'
import {installDriveImageErrors} from './imageErrors'
import {remoteDirectoryPath} from './directoryRoots'
import {aliVideoPage} from './aliVideoListing'
import {clearAliHistory} from './aliHistory'
import {localDirectoryKey,localDirectoryPath} from './localDirectoryKeys'
import {renameLocalFile,moveLocalFile} from './localRename'
import type {Recovery} from '../localRecovery'
import './fileitem.css'
import './global.css'
import './theme.css'
import { computed, reactive, ref, markRaw, watch, onMounted, onUnmounted, nextTick } from 'vue'
import DriveDialogs,{type DriveDialog} from './DriveDialogs.vue'
import OriginalPanRight from './electron/pan/PanRight.vue'
import {onHideRightMenu} from './electron/utils/keyboardhelper'
import useOriginalFileStore from './electron/pan/panfilestore'
import type { IAliGetFileModel } from './electron/aliapi/alimodels'
import { bindDrivePane, createDriveSettings, createDriveTree, sendDriveKeyboard, sendDriveMouse, type DrivePanePort } from './ports'
import { nativeCall, asAppError } from '@/platform/native'
import type { LocalListing } from '@/platform/contracts'
import type { SourceEntry } from '@/features/sources/contracts'
import type { DriveOperation } from '../electron/drive/services/agent/providerCapabilityTypes'
import { driver, playSource } from '@/features/sources/drivers'
import {electronProviderCapabilities} from '../adapters/providerCapabilities'
import {submitTransferEntry,transferEntryScope} from './transferEntry'
import {acknowledgeBaiduRename,pendingBaiduRenameName,type BaiduRenameResult} from './baiduRenameMutations'
import {recoverBaiduMoves,recoveredBaiduLocation} from './baiduMoveRecovery'
import {acknowledgeCloud189Move} from './cloud189Move'
import {acknowledgeBaiduTrash} from './baiduBatchMutations'
import {recoverBaiduTrash} from './baiduTrashRecovery'
import {acknowledgeCloud139Trash} from './cloud139BatchMutations'
import {recoverCloud139Trash} from './cloud139TrashRecovery'
import {acknowledgeCloud189Trash} from './cloud189Trash'
import {recoverCloud189Trash} from './cloud189TrashRecovery'
import {recoverCloud189Moves} from './cloud189MoveRecovery'
import {acknowledgeBaiduMove} from './baiduMoveMutations'
import {applyBaiduModelRename,updateBaiduRenameCatalog,updateBaiduMoveCatalog,baiduRenamedPreferences} from './baiduRenameReferences'
import {renameRemoteFile,supportsRemoteRename,type RemoteRenameResult} from './renameMutations'
import {renameCloud123Batch} from './cloud123Rename'
import {createRemoteText,supportsRemoteTextCreation} from './textCreation'
import {acknowledgeOpenAliMove} from './aliOpenRelocation'
import {commitAliCrossDrive,acknowledgeAliCrossDriveCommit} from './aliCrossDriveCommit'
import {acknowledgeWebAliMove} from './aliRelocationTransport'
import {relocateRemoteFiles,supportsRemoteRelocation,supportsRemoteCopy} from './relocationMutations'
import {updateMovedCatalogItems} from './relocationCatalog'
import {menuCopySelectedFile,dropMoveSelectedFile} from './electron/pan/topbtns/relocation'
import {menuTrashSelectFile,topRestoreSelectedFile,topTrashDeleteAll} from './electron/pan/topbtns/trash'
import {trashPage,mutateTrash,supportsRemoteTrash,supportsRemoteTrashRestore,supportsRemoteTrashMove,supportsRemoteTrashDelete,supportsRemoteDirectDelete,supportsRemoteTrashEmpty,emptyGoogleTrash,emptyDrive115Trash,emptyCloud123Trash,restoredDetails,type TrashOperation} from './trashMutations'
import {acknowledgeOpenAliTrash} from './aliOpenTrash'
import {purgeDeletedCatalog} from './trashCatalog'
import {t} from '../electron/i18n'
import {emptyAliTrash} from './aliEmptyTrash'
import {emptyPikpakTrash} from './pikpakTrash'
import {aliTrashPage} from './aliTrashListing'
import {recoverAliBatch} from './aliRecoverMutations'
import {favorAliFile} from './aliFavoriteMutations'
import {colorAliFile} from './aliColorMutations'
import {menuDrive115VideoPush} from './electron/pan/topbtns/video115'
import {aliColorPage,aliSearchPage} from './aliColorListing'
import {menuFileColorChange} from './electron/pan/topbtns/color'
import {menuFavSelectFile,topFavorDeleteAll} from './electron/pan/topbtns/favorites'
import {topRecoverSelectedFile} from './electron/pan/topbtns/recover'
import {pendingCloud189RenameName,acknowledgeCloud189Rename} from './cloud189Rename'
import {createRemoteFolder,supportsRemoteFolderCreation} from './folderMutations'
import {createShareImportSession} from './importShareSession'
import {createShareImportWriter} from './importShareWriter'
import {createQuarkImportWriter} from './quarkImportWriter'
import {createGuangyaImportWriter} from './guangyaImportWriter'
import {createPikpakImportWriter} from './pikpakImportWriter'
import type {ShareImportUiPort} from './shareImportUiPorts'
import { supportsSourceShare } from '@/features/sources/share'
import { useFileSourcesStore } from '@/stores/fileSources'
import { useVideoCatalog } from '@/features/library/catalog'
import { toggleFolderFavorite } from '../folderFavorites'
const props=defineProps<{sourceId:string;local?:boolean;initialPath?:string;name:string}>()
const emit=defineEmits<{favorite:[file:IAliGetFileModel]}>()
const sources=useFileSourcesStore(),catalog=useVideoCatalog()
const account=computed(()=>sources.accounts.find(account=>account.id===props.sourceId))
const store=useOriginalFileStore();store.$reset()
const tree=createDriveTree(),settings=createDriveSettings()
const root=ref<HTMLElement>(),error=ref(''),operationError=ref(''),dialog=ref<DriveDialog>()
let relocationRetry:(()=>Promise<unknown>)|undefined
async function retryError(){
 try{if(relocationRetry)await relocationRetry();else await load(props.sourceId,'refresh',false)}
 catch(cause){operationError.value=asAppError(cause).message}
}
const folderPreview=ref<InstanceType<typeof FolderPreviewPopover>>()
let sizeRefresh:ReturnType<typeof startAliDirectorySizeRefresh>|undefined
const withDirectorySize=(file:IAliGetFileModel)=>settings.uiFolderSize&&sizeRefresh?sizeRefresh.apply(file):file
let disposed=false,generation=0,sourceGeneration=0,cursor:string|undefined,query='',currentPath=props.initialPath||''
let rawEntries=new Map<string,SourceEntry>()
let importing:ReturnType<typeof createShareImportSession>|undefined
let clearingFavorites:{source:string;context:number;removed:Set<string>}|undefined
const commandRows=new Map<string,IAliGetFileModel>()
const localTransitions:Recovery[]=[]
function localPath(path:string){for(const row of localTransitions){if(path===row.from)path=row.to!;else if(row.directory&&path.startsWith(row.from!+'/'))path=row.to+path.slice(row.from!.length)}return path}
const history:Array<{path:string;query:string;title:string}>=[]
const crumbs:Array<{path:string;title:string}>=[]
const seenCursors=new Set<string>()
function model(row:SourceEntry,parent:string):IAliGetFileModel{
 // Keep the source model; adapt root identity and native video capability flags.
 if(!props.local&&['123','115','pikpak','guangya','aliyun','alipan-open','quark','baidu','139','189','webdav','alist','onedrive','dropbox','box','google'].includes(account.value?.providerId||'')&&'electronModel'in row){const original=row.electronModel as IAliGetFileModel;if(!original||original.file_id!==row.id||original.drive_id!==props.sourceId||original.name!==row.name||original.isDir!==row.isDirectory)throw Error('来源原文件模型身份无效');return withDirectorySize({...original,parent_file_id:account.value?.providerId==='115'&&original.parent_file_id==='0'||account.value?.providerId==='guangya'&&['0','guangya_root'].includes(original.parent_file_id)||account.value?.providerId==='139'&&['/','0','cloud139_root'].includes(original.parent_file_id)?'':original.parent_file_id,category:original.category==='video2'&&row.playable?'video':original.category})}
 const ext=row.isDirectory?'':row.name.split('.').at(-1)?.toLowerCase()||''
 const local='relativePath'in row
 const id=local?String(row.relativePath):row.id
 const modified='modified'in row?Number(row.modified)||0:0
 return withDirectorySize({__v_skip:true,file_id:id,drive_id:props.sourceId,parent_file_id:'originalParent'in row&&typeof row.originalParent==='string'?row.originalParent:parent,name:row.name,namesearch:row.name,path:id,isDir:row.isDirectory,ext,mime_type:'',mime_extension:ext,category:row.playable?'video':'',icon:row.isDirectory?'iconfile-folder':row.playable?'iconfile_video':'iconfile-txt',size:row.size,sizeStr:row.size>=1024**3?(row.size/1024**3).toFixed(1)+' GB':row.size>=1024**2?(row.size/1024**2).toFixed(1)+' MB':Math.ceil(row.size/1024)+' KB',time:modified,timeStr:modified?new Date(modified<1e12?modified*1000:modified).toLocaleDateString():'',starred:row.favorite===true,description:'description'in row&&typeof row.description==='string'?row.description:'contentHash'in row&&typeof row.contentHash==='string'?row.contentHash:'',thumbnail:''})
}
const titleFor=(path:string)=>!props.local&&account.value?.providerId==='aliyun'&&['video','video.recentplay','video.compilation'].includes(path)?t(path==='video.compilation'?'file.allAlbums':'file.nowWatching'):!props.local&&path==='trash'?t('pan.trash'):!props.local&&path==='recover'?t('tree.recover'):!props.local&&path==='favorite'?t('tree.favorites'):store.ListDataRaw.find(file=>file.file_id===path)?.name||crumbs.find(crumb=>crumb.path===path)?.title||props.name
async function page(path:string,next?:string){
 if(props.local){const listing=await nativeCall<LocalListing>('local_list',{sourceId:props.sourceId,relativePath:path});if(listing.sourceId!==props.sourceId)throw Error('文件列表来源不匹配');return {entries:listing.entries as SourceEntry[],nextCursor:undefined}}
 const source=account.value;if(!source)throw Error('来源已移除')
 if(path.startsWith('video')&&source.providerId==='aliyun')return aliVideoPage(source,path,next)
 if(path==='trash')return trashPage(source,next)
 if(!props.local&&path.startsWith('search')&&source.providerId==='aliyun')return aliSearchPage(source,path,next)
 if(path.startsWith('color'))return aliColorPage(source,path,next)
 if(path==='favorite'){if(!['aliyun','alipan-open'].includes(source.providerId))throw Error('此来源收藏视图尚未接入');return aliTrashPage(source,next,false,true)}
 if(path==='recover'){if(source.providerId!=='aliyun')throw Error('此来源不支持独立恢复视图');return aliTrashPage(source,next,true)}
 const protocol=driver(source)
 if(query&&!protocol.search)throw Error('此来源不支持搜索')
 return query?protocol.search!(source,query,next):protocol.list(source,path,next)
}
function breadcrumbKey(path:string){return props.local?localDirectoryKey(path):path||'backup_root'}
function paths(){tree.selectDirPath=crumbs.map((crumb,index)=>({...model({id:crumb.path,name:crumb.title,isDirectory:true,size:0,playable:false},index?breadcrumbKey(crumbs[index-1]!.path):''),file_id:breadcrumbKey(crumb.path),icon:!props.local&&crumb.path==='trash'?'icondelete':'iconfile-folder'}));tree.selectDir=tree.selectDirPath.at(-1)||model({id:'backup_root',name:props.name,isDirectory:true,size:0,playable:false},'');tree.navigationOptions=account.value&&supportsRemoteTrash(account.value)?[{...model({id:'trash',name:t('pan.trash'),isDirectory:true,size:0,playable:false},''),icon:'icondelete'},...(account.value.providerId==='aliyun'?[...settings.uiFileColorArray.map(color=>({...model({id:'color'+color.key,name:color.title||color.key,isDirectory:true,size:0,playable:false},''),icon:'iconwbiaoqian'})),{...model({id:'favorite',name:t('tree.favorites'),isDirectory:true,size:0,playable:false},''),icon:'iconcrown'},{...model({id:'recover',name:t('tree.recover'),isDirectory:true,size:0,playable:false},''),icon:'iconrecover'},{...model({id:'video',name:t('file.nowWatching'),isDirectory:true,size:0,playable:false},''),icon:'iconfile_video'}]:[])]:[];if(account.value?.providerId==='alipan-open')tree.navigationOptions.push({...model({id:'favorite',name:t('tree.favorites'),isDirectory:true,size:0,playable:false},''),icon:'iconcrown'});tree.PanHistoryCount=history.length}
let rootPath=props.initialPath||''
const sourceVideoRoot=(path:string)=>account.value?.providerId==='aliyun'&&['video','video.recentplay','video.compilation'].includes(path)
async function load(_drive:string,path:string,push:boolean){
 folderPreview.value?.cancel()
 if(path==='refresh')sizeRefresh?.invalidate()
 const actualLocalPath=props.local?localDirectoryPath(path):undefined
 if(!props.local&&path==='search'){query='';store.mSaveDirFileLoading(props.sourceId,'search','搜索');store.ListLoading=false;return}
 if(path.startsWith('search')&&path.length>6&&account.value?.providerId!=='aliyun'){query=path.slice(6);path=currentPath}
 let target=actualLocalPath??(path==='refresh'?currentPath:['backup_root','root'].includes(path)?rootPath:path)
 let title=titleFor(target)
 if(actualLocalPath===undefined&&path==='back'){
  const previous=history.pop();if(!previous)return
  target=previous.path;query=previous.query;title=previous.title
 }else if(push&&target!==currentPath){history.push({path:currentPath,query,title:crumbs.at(-1)?.title||props.name});query=''}
 const revision=++generation;error.value='';cursor=undefined;seenCursors.clear()
 store.mSaveDirFileLoading(props.sourceId,props.local?localDirectoryKey(target):query?'search:'+query:target||'backup_root',title)
 try{
  const recoverySource=account.value
  if(recoverySource?.providerId==='baidu'&&!props.local){
   const context=sourceGeneration,stillCurrent=()=>!disposed&&revision===generation&&context===sourceGeneration&&account.value?.id===recoverySource.id
   const recovery=await recoverBaiduMoves(recoverySource,catalog,()=>sources.preferences,stillCurrent);if(!stillCurrent())return
   if(recovery.attempted)operationError.value=recovery.failures.join('\n')
   target=recoveredBaiduLocation(target,recovery.observed);rootPath=recoveredBaiduLocation(rootPath,recovery.observed);currentPath=recoveredBaiduLocation(currentPath,recovery.observed)
   for(const row of [...history,...crumbs])row.path=recoveredBaiduLocation(row.path,recovery.observed)
   const trashRecovery=await recoverBaiduTrash(recoverySource,catalog,stillCurrent);if(!stillCurrent())return
   if(trashRecovery.attempted)operationError.value=[...recovery.failures,...trashRecovery.failures].join('\n')
   store.mSaveDirFileLoading(props.sourceId,query?'search:'+query:target||'backup_root',title)
  }
  if(recoverySource?.providerId==='189'&&!props.local){
   const context=sourceGeneration,stillCurrent=()=>!disposed&&revision===generation&&context===sourceGeneration&&account.value?.id===recoverySource.id
   const recovery=await recoverCloud189Moves(recoverySource,catalog,stillCurrent);if(!stillCurrent())return
   const trashRecovery=await recoverCloud189Trash(recoverySource,catalog,stillCurrent);if(!stillCurrent())return
   if(recovery.attempted||trashRecovery.attempted)operationError.value=[...recovery.failures,...trashRecovery.failures].join('\n')
  }
  if(recoverySource?.providerId==='139'&&!props.local){
   const context=sourceGeneration,stillCurrent=()=>!disposed&&revision===generation&&context===sourceGeneration&&account.value?.id===recoverySource.id
   const recovery=await recoverCloud139Trash(recoverySource,catalog,stillCurrent);if(!stillCurrent())return
   if(recovery.attempted)operationError.value=recovery.failures.join('\n')
  }
  const result=await page(target);if(revision!==generation)return
  rawEntries=new Map(result.entries.map(row=>[props.local&&'relativePath'in row?String(row.relativePath):row.id,row]))
  const files=result.entries.map(row=>model(row,target));for(const file of files)commandRows.set(file.file_id,file);store.ListDataRaw=files;currentPath=target;cursor=result.nextCursor
  if(!crumbs.length)crumbs.push({path:rootPath,title:props.name})
  if(!props.local&&sourceVideoRoot(target))crumbs.splice(1)
  const index=crumbs.findIndex(crumb=>crumb.path===target)
  if(index>=0)crumbs.splice(index+1);else crumbs.push({path:target,title})
  paths();store.mSaveDirFileLoadingFinish(props.sourceId,store.DirID,files)
 }catch(cause){if(revision===generation){store.ListLoading=false;error.value=asAppError(cause).message}}
}
async function more(){
 if(!cursor||store.ListLoading)return
 if(seenCursors.has(cursor)){error.value='来源分页游标重复，请刷新后重试';return}
 const marker=cursor,revision=generation;store.ListLoading=true
 try{const result=await page(currentPath,marker);if(revision!==generation)return
  const files=result.entries.map(row=>model(row,currentPath)),known=new Set(store.ListDataRaw.map(row=>row.file_id))
  for(const row of result.entries)rawEntries.set(props.local&&'relativePath'in row?String(row.relativePath):row.id,row)
  store.ListDataRaw=[...store.ListDataRaw,...files.filter(file=>!known.has(file.file_id))]
  seenCursors.add(marker);cursor=result.nextCursor;store.mRefreshListDataShow(true)
 }catch(cause){if(revision===generation)error.value=asAppError(cause).message}finally{if(revision===generation)store.ListLoading=false}
}
async function list(user:string,drive:string,path:string,validate:()=>void=()=>{}){
 validate()
 if(user!==props.sourceId||drive!==props.sourceId)throw Error('文件操作来源不匹配')
 const epoch=generation
 if(props.local){path=localPath(path);const listing=await nativeCall<LocalListing>('local_list',{sourceId:user,relativePath:path});validate();if(listing.sourceId!==user)throw Error('文件列表来源不匹配');if(disposed||epoch!==generation)throw Error('文件浏览器已切换');const rows=listing.entries.map(row=>model(row,path));for(const row of rows)commandRows.set(row.file_id,row);return rows}
 const source=account.value;if(!source)throw Error('来源已移除')
 path=remoteDirectoryPath(source.providerId,path,rootPath)
 let next:string|undefined;const seen=new Set<string>(),files:IAliGetFileModel[]=[]
 do{validate();const result=await driver(source).list(source,path,next);validate();if(disposed||epoch!==generation)throw Error('文件浏览器已切换');files.push(...result.entries.map(row=>model(row,path)));next=result.nextCursor;if(next){if(seen.has(next))throw Error('来源分页游标重复');seen.add(next)}}while(next)
 for(const row of files)commandRows.set(row.file_id,row)
 return files
}
const operations=computed(()=>{
 const values=new Set<DriveOperation>(['files.list'])
 if(account.value&&electronProviderCapabilities(account.value)?.operations['upload.local']&&(!['aliyun','alipan-open'].includes(account.value.providerId)||store.DirID.startsWith('{')))values.add('upload.local')
 if(account.value&&electronProviderCapabilities(account.value)?.operations['files.downloadZip'])values.add('files.downloadZip')
 if(account.value){if(supportsRemoteTextCreation(account.value))values.add('upload.memory');if(supportsRemoteTrash(account.value))for(const key of ['trash.move','trash.list'] as DriveOperation[])values.add(key);if(supportsRemoteTrashRestore(account.value))values.add('trash.restore');if(supportsRemoteTrashDelete(account.value)||supportsRemoteDirectDelete(account.value))values.add('trash.delete');if(supportsRemoteTrashEmpty(account.value))values.add('trash.empty');if(supportsRemoteTrashMove(account.value))values.add('trash.move');if(supportsRemoteRelocation(account.value)){values.add('files.move');if(supportsRemoteCopy(account.value))values.add('files.copy')}if(supportsRemoteRename(account.value))values.add('files.rename');if(supportsRemoteFolderCreation(account.value))values.add('files.createFolder');if(account.value.providerId==='aliyun'||driver(account.value).search)values.add('files.search');if(supportsSourceShare(account.value))values.add('share.create');if(['aliyun','quark','guangya','pikpak'].includes(account.value.providerId))values.add('share.import');values.add('files.download')}
 return values
})
let historyPending:{epoch:number;promise:Promise<string[]>}|undefined
async function action(name:string,args:unknown[]):Promise<any>{
 const files=store.GetSelected(),actionContext=sourceGeneration
 if(['renameBatch','createFolderDirect','createTextDirect','moveBatch','copyBatch','trashBatch','deleteBatch','restoreBatch','emptyTrashDirect'].includes(name))sizeRefresh?.invalidate()
 try{
  if(name==='folderPreview'){
   const params=args[0] as FolderPreviewParams,source=account.value,owner=JSON.stringify(source),epoch=generation
   if(!params||params.user_id!==props.sourceId||params.drive_id!==props.sourceId||!store.ListDataShow.some(file=>file.file_id===params.file_id&&file.isDir)||['trash','recover'].includes(store.SelectDirType))throw Error('文件夹预览来源或目录无效')
   const check=()=>{if(disposed||epoch!==generation||actionContext!==sourceGeneration||JSON.stringify(account.value)!==owner)throw Error('文件夹预览来源已切换')}
   check()
   if(props.local){const result=await nativeCall<LocalListing>('local_list',{sourceId:props.sourceId,relativePath:params.file_id});check();if(result.sourceId!==props.sourceId)throw Error('文件夹预览来源不匹配');return result.entries.slice(0,12).map(row=>model(row,params.file_id))}
   if(!source)throw Error('来源已移除')
   const result=await driver(source).list(source,params.file_id);check()
   return result.entries.slice(0,12).map(row=>model(row,params.file_id))
  }
  if(props.local&&['rename','renameBatch','createFolder','createText','createFolderDirect','createTextDirect','moveBatch','copyBatch','trashBatch','deleteBatch','restoreBatch','emptyTrashDirect','copy','dropMove'].includes(name))throw Error('本机来源仅支持浏览、预览和加入媒体库；文件管理操作用于网盘来源')
  if(name==='clearHistory'){
   const source=account.value,epoch=sourceGeneration
   if(!source||source.providerId!=='aliyun'||props.local||['trash','recover'].includes(currentPath))throw Error('此来源或目录不支持清除历史')
   if(historyPending?.epoch===epoch)return historyPending.promise
   const selected=args[0]?[tree.selectDir]:files
   const check=()=>{if(disposed||epoch!==sourceGeneration)throw Error('来源已切换')}
   const pending={epoch,promise:(async()=>{const result=await clearAliHistory(source,selected,check);check();await load(props.sourceId,'refresh',false);check();store.mCancelSelect();return result})()}
   historyPending=pending
   try{return await pending.promise}finally{if(historyPending===pending)historyPending=undefined}
  }
  if(name==='color'){error.value='';operationError.value='';return await menuFileColorChange(!!args[0],String(args[1]||''))}
  if(name==='colorBatch'){
   const source=account.value,[user,drive,,color,ids]=args,epoch=sourceGeneration
   if(source?.providerId!=='aliyun'||user!==source.id||drive!==source.id||typeof color!=='string'||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string')||['recover','trash'].includes(currentPath))throw Error('颜色标记来源或选择无效')
   const failures:string[]=[]
   for(const id of ids){if(disposed||epoch!==sourceGeneration)throw Error('来源已切换');try{const description=await colorAliFile(source,id,color);const row=rawEntries.get(id);if(row)rawEntries.set(id,{...row,description} as SourceEntry)}catch(cause){failures.push(asAppError(cause).message)}}
   if(failures.length){if(!disposed&&epoch===sourceGeneration)operationError.value=failures.join('\n');throw Error('部分颜色标记失败：'+failures.join('；'))}return
  }
  if(name==='favorite'){error.value='';operationError.value='';return await menuFavSelectFile(!!args[0],!!args[1])}
  if(name==='clearFavorites'){
   if(!account.value||!['aliyun','alipan-open'].includes(account.value.providerId)||currentPath!=='favorite')throw Error('请先进入阿里收藏夹')
   if(clearingFavorites?.source===props.sourceId&&clearingFavorites.context===sourceGeneration)return
   error.value='';operationError.value=''
   const scope={source:props.sourceId,context:sourceGeneration,removed:new Set<string>()};clearingFavorites=scope
   try{return await topFavorDeleteAll()}finally{if(clearingFavorites===scope)clearingFavorites=undefined}
  }
  if(name==='favoritePageForClear'){
   const source=account.value,epoch=sourceGeneration,scope=clearingFavorites
   if(!source||!['aliyun','alipan-open'].includes(source.providerId)||args[0]!==source.id||args[1]!==source.id||!scope||scope.source!==source.id||scope.context!==epoch)throw Error('清空收藏夹来源不匹配')
   let marker:string|undefined;const seen=new Set<string>()
   do{const page=await aliTrashPage(source,marker,false,true);if(disposed||epoch!==sourceGeneration)throw Error('来源已切换')
    if(page.entries.length){if(page.entries.some(row=>scope.removed.has(row.id)))throw Error('提供商仍返回已取消收藏的项目，停止重复操作');return page.entries.map(row=>{const file=model(row,'favorite');commandRows.set(file.file_id,file);return file})}
    marker=page.nextCursor;if(marker){if(seen.has(marker))throw Error('收藏分页游标重复');seen.add(marker)}
   }while(marker)
   return []
  }
  if(name==='favoriteBatch'){
   const source=account.value,[user,drive,starred,showMessage,ids]=args,epoch=sourceGeneration
   if(!source||!['aliyun','alipan-open'].includes(source.providerId)||user!==source.id||drive!==source.id||typeof starred!=='boolean'||typeof showMessage!=='boolean'||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw Error('收藏来源或选择无效')
   const success:string[]=[],failures:string[]=[]
   for(const id of ids){if(disposed||epoch!==sourceGeneration)throw Error('来源已切换');try{await favorAliFile(source,id,starred,showMessage);success.push(id)}catch(cause){failures.push(asAppError(cause).message)}}
   if(!disposed&&epoch===sourceGeneration){
    for(const id of success){const row=rawEntries.get(id);if(row)rawEntries.set(id,{...row,favorite:starred});const known=commandRows.get(id);if(known)commandRows.set(id,{...known,starred})}
    const scope=clearingFavorites;if(!starred&&scope?.source===source.id&&scope.context===epoch){for(const id of success){scope.removed.add(id);rawEntries.delete(id)}store.mDeleteFiles('favorite',success,false)}
    if(failures.length)operationError.value=failures.join('\n')
   }
   if(failures.length&&clearingFavorites)throw Error('收藏夹未完全清空：'+failures.join('；'))
   return success
  }
  if(name==='recover'){error.value='';operationError.value='';return await topRecoverSelectedFile()}
  if(name==='recoverBatch'){if(!account.value||args[0]!==props.sourceId)throw Error('恢复来源不匹配');return await recoverAliBatch(account.value,args[1])}
  if(name==='trash')return await menuTrashSelectFile(!!args[0],!!args[1],!!args[2])
  if(name==='restore')return await topRestoreSelectedFile()
  if(name==='emptyTrash')return await topTrashDeleteAll()
  if(name==='restoredDetails'){
   const [user,drive,ids]=args,source=account.value
   if(!source||user!==source.id||drive!==source.id||!Array.isArray(ids))throw Error('还原详情来源不匹配')
   const rows=ids.map(id=>commandRows.get(id));if(rows.some(row=>!row))throw Error('缺少已还原条目记录')
   return restoredDetails(source,rows as IAliGetFileModel[])
  }
  if(['trashBatch','deleteBatch','restoreBatch','emptyTrashDirect'].includes(name)){
   error.value='';operationError.value=''
   const [user,drive]=args,source=account.value,epoch=sourceGeneration
   if(!source||props.local||user!==source.id||drive!==source.id||!(name==='trashBatch'?supportsRemoteTrashMove(source):name==='deleteBatch'&&store.SelectDirType!=='trash'?supportsRemoteDirectDelete(source):supportsRemoteTrash(source)))throw Error('回收站操作来源不匹配')
   if(name==='restoreBatch'&&!supportsRemoteTrashRestore(source)||name==='emptyTrashDirect'&&!supportsRemoteTrashEmpty(source)||name==='deleteBatch'&&!(store.SelectDirType==='trash'?supportsRemoteTrashDelete(source):supportsRemoteDirectDelete(source)))throw Error('此来源不支持该回收站操作')
   const guardedOpen=source.providerId==='alipan-open',guardedSource=['139','189','baidu'].includes(source.providerId),guardedClear=source.providerId==='123'&&name==='emptyTrashDirect',provider=source.providerId,owner=JSON.stringify([source.userId||'',source.deviceId||'',source.baseUrl]),clearOwner=JSON.stringify(source)
   const stillCurrent=()=>!disposed&&epoch===sourceGeneration&&(!guardedSource||sources.accounts.some(row=>row.id===source.id&&row.providerId===provider&&JSON.stringify([row.userId||'',row.deviceId||'',row.baseUrl])===owner))&&(!(guardedClear||guardedOpen)||sources.accounts.some(row=>row.id===source.id&&JSON.stringify(row)===clearOwner))
   const inTrash=store.SelectDirType==='trash'
   if((name==='emptyTrashDirect'||name==='restoreBatch')&&!inTrash||name==='trashBatch'&&inTrash)throw Error('当前目录不支持该回收站操作')
   let selected:IAliGetFileModel[]=[],remoteCleared:{success:string[];failures:string[]}|undefined
   if(name==='emptyTrashDirect'&&source.providerId==='aliyun'){
    if(catalog.scanning&&catalog.scanSource===source.id)catalog.cancelScan()
    remoteCleared=await emptyAliTrash(source,stillCurrent,row=>{const file=model(row,'trash');commandRows.set(file.file_id,file);selected.push(file);return file})
   }else if(name==='emptyTrashDirect'&&source.providerId==='pikpak'){
    if(catalog.scanning&&catalog.scanSource===source.id)catalog.cancelScan()
    remoteCleared=await emptyPikpakTrash(source,stillCurrent,row=>{const file=model(row,'trash');commandRows.set(file.file_id,file);selected.push(file)})
   }else if(name==='emptyTrashDirect'){
    let cursor:string|undefined;const seen=new Set<string>(),ids=new Set<string>()
    do{if(!stillCurrent())throw Error('来源已切换');const page=await trashPage(source,cursor);if(!stillCurrent())throw Error('来源已切换');for(const row of page.entries){if(ids.has(row.id))throw Error('回收站分页存在重复项目');ids.add(row.id);selected.push(model(row,'trash'))}cursor=page.nextCursor;if(cursor){if(seen.has(cursor))throw Error('回收站分页游标重复');seen.add(cursor)}}while(cursor)
   }else{
    const ids=name==='restoreBatch'?args[3]:args[2]
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('回收站操作选择无效')
    const rows=ids.map(id=>store.ListDataRaw.find(row=>row.file_id===id));if(rows.some(row=>!row))throw Error('项目已不在当前目录');selected=rows as IAliGetFileModel[]
   }
   if(catalog.scanning&&catalog.scanSource===source.id)catalog.cancelScan()
   const operation:TrashOperation=name==='trashBatch'?'trash':name==='restoreBatch'?'restore':inTrash?'purge':'permanent'
   const result=remoteCleared|| (name==='emptyTrashDirect'&&source.providerId==='123'
    ?(await emptyCloud123Trash(source,stillCurrent),{success:selected.map(row=>row.file_id),failures:[] as string[]})
    :name==='emptyTrashDirect'&&source.providerId==='115'
    ?(await emptyDrive115Trash(source,stillCurrent),{success:selected.map(row=>row.file_id),failures:[] as string[]})
    :name==='emptyTrashDirect'&&source.providerId==='google'
    ?(await emptyGoogleTrash(source),{success:selected.map(row=>row.file_id),failures:[] as string[]})
    :selected.length?await mutateTrash(source,selected,operation,stillCurrent):{success:[] as string[],failures:[] as string[]})
   const confirmed=selected.filter(row=>result.success.includes(row.file_id))
   if(!guardedOpen&&stillCurrent())for(const row of confirmed){rawEntries.delete(row.file_id);if(operation!=='restore')commandRows.delete(row.file_id)}
   if(operation!=='restore'&&confirmed.length)try{
    await catalog.update(draft=>{if((guardedSource||guardedClear||guardedOpen)&&!stillCurrent())throw Error('来源已关闭或切换');purgeDeletedCatalog(draft,source.id,confirmed)},guardedSource||guardedClear||guardedOpen?stillCurrent:undefined)
    if(guardedSource){if(!stillCurrent())throw Error('来源已关闭或切换');for(const row of confirmed)(provider==='189'?acknowledgeCloud189Trash:provider==='139'?acknowledgeCloud139Trash:acknowledgeBaiduTrash)(source.id,row.file_id)}
    if(guardedOpen){if(!stillCurrent())throw Error('来源已关闭或切换');for(const row of confirmed){acknowledgeOpenAliTrash(source,row.file_id);rawEntries.delete(row.file_id);commandRows.delete(row.file_id)}}
   }catch(cause){if(guardedOpen)result.success.length=0;result.failures.push('远端操作已完成，但媒体库同步失败：'+asAppError(cause).message)}
   if(result.failures.length&&stillCurrent())operationError.value=result.failures.join('\n')
   if((guardedSource||guardedClear||guardedOpen)&&!stillCurrent())return []
   if(name==='emptyTrashDirect'){
    if(stillCurrent())store.mDeleteFiles('trash',result.success,false)
    if(result.failures.length)throw Error('回收站未完全清空，请检查失败项目')
    return result.success.length
   }
   return result.success
  }
  if(name==='properties'){if(!files.length)throw Error('没有选中任何文件');dialog.value={kind:'properties'};return}
  if(name==='copyTree'){if(!files.length)throw Error('没有选中任何文件');dialog.value={kind:'copyTree',files:files.map(file=>({...file}))};return}
  if(name==='copy')return menuCopySelectedFile(!!args[0],String(args[1]))
  if(name==='dropMove')return await dropMoveSelectedFile(String(args[0]||''),String(args[1]||''),!!args[2])
  if(name==='moveBatch'||name==='copyBatch'){
   if(store.SelectDirType==='trash')throw Error('请先还原回收站中的项目')
   error.value='';operationError.value=''
   const [user,drive,ids,toDrive,target]=args,source=account.value,epoch=sourceGeneration
   relocationRetry=undefined
   if(user!==props.sourceId||drive!==user||toDrive!==user||!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length||typeof target!=='string')throw Error('移动/复制来源或参数不匹配')
   if(props.local){
    if(name==='copyBatch')throw Error('本地复制尚未接入')
    const sourceId=props.sourceId,destination=['root','backup_root'].includes(target)?'':localPath(target)
    const selected=ids.map(id=>store.ListDataRaw.find(row=>row.file_id===id)||commandRows.get(id))
    if(selected.some(row=>!row))throw Error('文件已不在当前来源记录中')
    if(selected.some(row=>{const path=localPath(row!.file_id);return path.split('/').slice(0,-1).join('/')===destination||row!.isDir&&(destination===path||destination.startsWith(path+'/'))}))throw Error('不能移动到原位置、自己或子目录')
    if(catalog.scanning&&catalog.scanSource===sourceId)catalog.cancelScan()
    const success:string[]=[],failures:string[]=[],transitions:Recovery[]=[]
    const actualPath=(value:string)=>{let path=localPath(value);for(const row of transitions){if(path===row.from)path=row.to!;else if(row.directory&&path.startsWith(row.from!+'/'))path=row.to+path.slice(row.from!.length)}return path}
    for(const file of selected as IAliGetFileModel[]){
     if(disposed||epoch!==sourceGeneration){failures.push('浏览器已关闭或切换，停止后续移动');break}
     try{
      const result=await moveLocalFile(sources,sourceId,actualPath(file.file_id),actualPath(destination),file.isDir,row=>{if(row.sourceId===sourceId&&row.from&&row.to&&typeof row.directory==='boolean')transitions.push(row)})
      success.push(file.file_id)
      if(!disposed&&epoch===sourceGeneration){const updated={...file,file_id:result.path,parent_file_id:result.path.split('/').slice(0,-1).join('/'),name:result.name};commandRows.set(file.file_id,updated);commandRows.set(result.path,updated);if(file.parent_file_id===currentPath)rawEntries.delete(file.file_id)}
     }catch(cause){failures.push(file.name+'：'+asAppError(cause).message)}
    }
    if(success.length){await catalog.load();if(catalog.error)failures.push('本地移动已完成，但媒体库载入失败：'+catalog.error)}
    if(failures.length&&!disposed&&epoch===sourceGeneration)operationError.value=failures.join('\n')
    return success
   }
   if(!source)throw Error('移动/复制来源不存在')
   const relocationOwner=JSON.stringify(source),relocationStillCurrent=()=>!disposed&&epoch===sourceGeneration&&(!['aliyun','alipan-open','123'].includes(source.providerId)||sources.accounts.some(row=>row.id===source.id&&JSON.stringify(row)===relocationOwner))
   const retainRelocationRetry=(retryIds:string[])=>{if(['aliyun','alipan-open'].includes(source.providerId)&&retryIds.length)relocationRetry=async()=>{if(!relocationStillCurrent())throw Error('原移动/复制来源已变化，未重试');return action(name,[user,drive,[...retryIds],toDrive,target])}}
   const destination=remoteDirectoryPath(source.providerId,target)
   const selected=ids.map(id=>store.ListDataRaw.find(row=>row.file_id===id)||commandRows.get(id))
   if(selected.some(row=>!row))throw Error('文件已不在当前来源记录中')
   const ancestors:string[]=[],seen=new Set<string>();let parent=destination
   while(parent){if(seen.has(parent))throw Error('目标目录路径存在循环');seen.add(parent);const row=commandRows.get(parent)||store.ListDataRaw.find(row=>row.file_id===parent)||tree.selectDirPath.find(row=>row.file_id===parent);if(!row?.isDir)throw Error('请先在目录选择器中加载目标路径');ancestors.unshift(parent);parent=remoteDirectoryPath(source.providerId,row.parent_file_id)}
   ancestors.unshift('')
   if(selected.some(row=>remoteDirectoryPath(source.providerId,row!.parent_file_id)===destination||row!.isDir&&ancestors.includes(row!.file_id)))throw Error('不能移动/复制到原位置、自己或子目录')
   if(catalog.scanning&&catalog.scanSource===source.id)catalog.cancelScan()
   const result=await relocateRemoteFiles(source,selected as IAliGetFileModel[],destination,name==='copyBatch',relocationStillCurrent,ancestors,async(file,receipt)=>{await commitAliCrossDrive(source,file.file_id,receipt,ancestors,sources,()=>{if(!relocationStillCurrent())throw Error('跨盘移动来源已切换')})})
   if(name==='moveBatch'&&result.success.length){
    const moved=selected.filter(row=>result.success.includes(row!.file_id)).map(row=>({...row!,name:result.names?.[row!.file_id]||row!.name})) as IAliGetFileModel[]
    const updateMovedRows=()=>{if(!disposed&&epoch===sourceGeneration)for(const row of moved){const next={...row,parent_file_id:destination},confirmed=result.baidu?.find(value=>value.file_id===row.file_id);if(confirmed)applyBaiduModelRename(next,confirmed);commandRows.set(row.file_id,next);if(row.parent_file_id===currentPath)rawEntries.delete(row.file_id)}}
    if(!['baidu','aliyun','alipan-open'].includes(source.providerId))updateMovedRows()
    try{
     const synced=new Set(result.identitySynced||[]),referenceMoved=moved.filter(row=>!synced.has(row.file_id))
     if(synced.size){await catalog.load();if(catalog.error)throw Error(catalog.error)}
     if(referenceMoved.length)await catalog.update(draft=>{if(['aliyun','alipan-open'].includes(source.providerId)&&!relocationStillCurrent())throw Error('阿里开放移动来源或账号已变化');updateMovedCatalogItems(draft.items,source.id,referenceMoved,destination,ancestors);if(result.baidu?.length)updateBaiduMoveCatalog(draft.items,source.id,result.baidu)},['aliyun','alipan-open'].includes(source.providerId)?relocationStillCurrent:undefined)
     if(['aliyun','alipan-open'].includes(source.providerId)){if(!relocationStillCurrent())throw Error('阿里移动来源或账号已变化');updateMovedRows();for(const row of moved){if(synced.has(row.file_id)){commandRows.delete(row.file_id);rawEntries.delete(row.file_id)};(source.providerId==='aliyun'?acknowledgeWebAliMove:acknowledgeOpenAliMove)(source,row.file_id,destination);if(synced.has(row.file_id))acknowledgeAliCrossDriveCommit(source,row.file_id,destination)}}
     if(source.providerId==='189')for(const row of moved)acknowledgeCloud189Move(source.id,row.file_id,destination)
     if(result.baidu?.length){
      Object.assign(sources.preferences,baiduRenamedPreferences(sources.preferences,source.id,result.baidu))
      if(!disposed&&epoch===sourceGeneration)for(const confirmed of result.baidu){for(const row of [...store.ListDataRaw,...commandRows.values()]){applyBaiduModelRename(row,confirmed);if(row.file_id===confirmed.file_id)row.parent_file_id=confirmed.parent_file_id}for(const [id,entry] of rawEntries){if('electronModel'in entry&&entry.electronModel){const original={...(entry.electronModel as IAliGetFileModel)};applyBaiduModelRename(original,confirmed);rawEntries.set(id,{...entry,name:original.name,electronModel:original} as SourceEntry)}}}
      updateMovedRows();for(const confirmed of result.baidu)acknowledgeBaiduMove(source.id,confirmed)
     }
    }catch(cause){const message='远端移动已完成，但媒体库或收藏同步失败，请重试原目标以同步：'+asAppError(cause).message;result.failures.push(message);retainRelocationRetry(ids);operationError.value=result.failures.join('\n');if(['baidu','aliyun','alipan-open'].includes(source.providerId))throw Error(result.failures.join('\n'))}
   }
   if(result.failures.length&&!disposed&&epoch===sourceGeneration){operationError.value=result.failures.join('\n');retainRelocationRetry(ids.filter(id=>!result.success.includes(id)))}
   return result.success
  }
  if(name==='selectDirectory'){
   const [type,selected,callback]=args,epoch=sourceGeneration,user=props.sourceId
   if(!['copy','cut','selectdir','select','share'].includes(String(type))||typeof callback!=='function')throw Error('目录选择参数无效')
   const underlay=String(type)==='share'&&dialog.value?.kind==='showShare'?dialog.value:undefined
   if(String(type)==='share'&&!underlay)throw Error('导入内容窗口已关闭')
   dialog.value={kind:'selectDirectory',underlay,picker:{type:String(type),selected:String(selected||''),user,drive:user,callback:(selectedUser,selectedDrive,file)=>{
    if(disposed||epoch!==sourceGeneration)return
    if(selectedUser!==user||selectedDrive!==user){error.value='目标来源不匹配';return}
    void Promise.resolve().then(()=>{if(!disposed&&epoch===sourceGeneration)return callback(selectedUser,selectedDrive,file)}).catch(cause=>{if(!disposed&&epoch===sourceGeneration)error.value=asAppError(cause).message})
   }}};return
  }
  if(name==='rename'){
   const renameGeneration=generation,renameSource=props.sourceId
   if(account.value?.providerId==='baidu'||account.value?.providerId==='189'){
    if(!files.length)store.mKeyboardSelect(store.mGetFocus(),false,false)
    const waiting=store.GetSelected().map(file=>({id:file.file_id,name:account.value?.providerId==='189'?pendingCloud189RenameName(props.sourceId,file.file_id):pendingBaiduRenameName(props.sourceId,file.file_id)})).filter((row):row is {id:string;name:string}=>!!row.name)
    if(waiting.length){const recovered=await action('renameBatch',[props.sourceId,props.sourceId,waiting.map(row=>row.id),waiting.map(row=>row.name)]);if(disposed||generation!==renameGeneration||props.sourceId!==renameSource)return;if(operationError.value)throw Error(operationError.value);if(account.value?.providerId==='189'){store.mRenameFiles(recovered);tree.mRenameFiles(recovered)}}
   }
   dialog.value={kind:args[1]?'renameMulti':'rename'};return
  }
  if(name==='renameBatch'){
   if(store.SelectDirType==='trash')throw Error('请先还原回收站中的项目')
   error.value='';operationError.value=''
   const [user,drive,ids,names]=args
   const source=account.value
   const epoch=generation
   if(user!==props.sourceId||drive!==props.sourceId||!Array.isArray(ids)||!Array.isArray(names)||ids.length!==names.length)throw Error('重命名来源或参数不匹配')
   if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id)||names.some(name=>typeof name!=='string'||!name.trim()||/[\u0000-\u001f/\\]/.test(name)||name==='.'||name==='..'))throw Error('重命名列表含重复标识或无效名称')
   const files=ids.map(id=>store.ListDataRaw.find(file=>file.file_id===id)||commandRows.get(id));if(files.some(file=>!file))throw Error('文件已不在当前来源列表')
   if(props.local){
    const sourceId=props.sourceId,renamed:Array<{file_id:string;parent_file_id:string;name:string;isDir:boolean}>=[],failures:string[]=[]
    if(catalog.scanning&&catalog.scanSource===sourceId)catalog.cancelScan()
    for(let index=0;index<files.length;index++){
     if(disposed||epoch!==generation){failures.push('浏览器已关闭或切换，停止后续重命名');break}
     const file=files[index]!
     try{
      const actual=localPath(file.file_id)
      const result=await renameLocalFile(sources,sourceId,actual,String(names[index]),file.isDir,row=>{if(!disposed&&epoch===generation&&row.sourceId===sourceId&&row.from&&row.to&&typeof row.directory==='boolean'&&!localTransitions.some(value=>value.id===row.id))localTransitions.push(row)})
      renamed.push({file_id:file.file_id,parent_file_id:file.parent_file_id,name:result.name,isDir:file.isDir})
      if(!disposed&&epoch===generation){const old=rawEntries.get(file.file_id);if(old)rawEntries.set(file.file_id,{...old,name:result.name});commandRows.set(file.file_id,{...file,name:result.name})}
     }catch(cause){failures.push(file.name+'：'+asAppError(cause).message)}
    }
    if(renamed.length){await catalog.load();if(catalog.error)failures.push('本地重命名已完成，但媒体库载入失败：'+catalog.error)}
    if(failures.length&&!disposed&&epoch===generation)operationError.value=failures.join('\n')
    return renamed
   }
   if(!source)throw Error('重命名来源不存在')
   const renameDialog=dialog.value,renameOwner=JSON.stringify(source),renameStillCurrent=()=>!disposed&&epoch===generation&&(source.providerId!=='123'||dialog.value===renameDialog)&&(!['alipan-open','123'].includes(source.providerId)||sources.accounts.some(row=>row.id===source.id&&JSON.stringify(row)===renameOwner))
   if(catalog.scanning&&catalog.scanSource===source.id)catalog.cancelScan()
   const renamed:RemoteRenameResult[]=[]
   const failures:string[]=[]
   if(args[4]==='123-batch'){
    if(source.providerId!=='123')throw Error('123 批量重命名来源不匹配')
    try{const result=await renameCloud123Batch(source,files as IAliGetFileModel[],names as string[],renameStillCurrent);renamed.push(...result.success);failures.push(...result.failures)}catch(cause){failures.push(asAppError(cause).message)}
   }else for(let index=0;index<files.length;index++){
    if(!renameStillCurrent()){failures.push('浏览器已关闭或切换，停止后续重命名');break}
    try{
     const result=await renameRemoteFile(source,files[index]!,String(names[index]),renameStillCurrent);renamed.push(result)
     if(renameStillCurrent()&&source.providerId!=='123'){
      const old=rawEntries.get(result.file_id);if(old)rawEntries.set(result.file_id,{...old,name:result.name});const row=commandRows.get(result.file_id);if(row)commandRows.set(result.file_id,{...row,name:result.name})
      if(source.providerId==='baidu'&&result.path&&result.previousPath){
       const confirmed=result as BaiduRenameResult
       for(const row of [...store.ListDataRaw,...commandRows.values()])applyBaiduModelRename(row,confirmed)
       for(const [id,entry] of rawEntries){if('electronModel'in entry&&entry.electronModel){const original={...(entry.electronModel as IAliGetFileModel)};applyBaiduModelRename(original,confirmed);rawEntries.set(id,{...entry,name:original.name,electronModel:original} as SourceEntry)}}
      }
     }
    }catch(cause){failures.push(files[index]!.name+'：'+asAppError(cause).message)}
   }
   try{if(renamed.length){
    const baiduResults=source.providerId==='baidu'?renamed.filter(row=>!!row.path&&!!row.previousPath) as BaiduRenameResult[]:[]
    await catalog.update(draft=>{if(['alipan-open','123'].includes(source.providerId)&&!renameStillCurrent())throw Error('重命名来源或账号已变化');for(const item of draft.items){const renamedFile=renamed.find(file=>!file.isDir&&item.sourceId===source.id&&item.fileId===file.file_id);if(!renamedFile)continue;const previous=item.fileName;item.fileName=renamedFile.name;if(item.type==='unmatched'&&item.metadataSource!=='manual'&&item.name===previous)item.name=renamedFile.name}if(baiduResults.length)updateBaiduRenameCatalog(draft.items,source.id,baiduResults)},['alipan-open','123'].includes(source.providerId)?renameStillCurrent:undefined)
    if(source.providerId==='123'){if(!renameStillCurrent())throw Error('123 重命名来源或账号已变化');for(const result of renamed){const old=rawEntries.get(result.file_id);if(old)rawEntries.set(result.file_id,{...old,name:result.name});const row=commandRows.get(result.file_id);if(row)commandRows.set(result.file_id,{...row,name:result.name})}}
    if(source.providerId==='189')for(const result of renamed)acknowledgeCloud189Rename(source.id,result)
    if(baiduResults.length){Object.assign(sources.preferences,baiduRenamedPreferences(sources.preferences,source.id,baiduResults));for(const result of baiduResults)acknowledgeBaiduRename(source.id,result)}
   }}
   catch(cause){if(source.providerId==='123')renamed.length=0;failures.push('远端重命名已完成，但本机媒体库或收藏同步失败，请刷新确认：'+asAppError(cause).message)}
   if(failures.length&&!disposed&&epoch===generation)operationError.value=failures.join('\n')
   return renamed
  }
  if(name==='closeDialog'){if(dialog.value?.kind==='createText')cancelTextCreationScope(props.sourceId);if(dialog.value?.underlay){dialog.value=dialog.value.underlay;return}importing?.dispose();importing=undefined;dialog.value=undefined;if(props.local&&localTransitions.length){localTransitions.length=0;commandRows.clear();await load(props.sourceId,'refresh',false)}return}
  if(name==='createFolder'){dialog.value={kind:'createFolder',type:String(args[0]||'folder'),parent:typeof args[2]==='string'?args[2]:undefined,callback:typeof args[3]==='function'?args[3] as (id:string)=>void:undefined};return}
  if(name==='createFolderBatch'){dialog.value={kind:'createFolderBatch',parent:typeof args[0]==='string'?args[0]:tree.selectDir.file_id};return}
  if(name==='createText'){dialog.value={kind:'createText'};return}
  if(name==='createFolderDirect'||name==='createTextDirect'){
   const [user,drive,parent,nameOrFile]=args
   if(name==='createFolderDirect'?!!args[4]:!!args[5])throw Error('此文件浏览器不支持加密创建')
   if(user!==props.sourceId||drive!==props.sourceId)throw Error('文件操作来源不匹配')
   if(name==='createFolderDirect'&&dialog.value?.underlay?.kind==='showShare'&&dialog.value.underlay.importPort)return dialog.value.underlay.importPort.createFolder(String(user),String(drive),String(parent),String(nameOrFile))
   const location=parent==='backup_root'?props.initialPath||'':String(parent||'')
   if(!props.local){
    const source=account.value;if(!source)throw Error('来源不存在');const epoch=sourceGeneration
    if(name==='createTextDirect'){const ownerDialog=dialog.value;return createRemoteText(source,location,String(nameOrFile||''),String(args[4]||''),()=>!disposed&&epoch===sourceGeneration&&dialog.value===ownerDialog)}
    const result=await createRemoteFolder(source,remoteDirectoryPath(source.providerId,location),String(nameOrFile||''),()=>!disposed&&epoch===sourceGeneration)
    if(result.file_id&&!disposed&&epoch===sourceGeneration)commandRows.set(result.file_id,model({id:result.file_id,name:String(nameOrFile||''),isDirectory:true,size:0,playable:false},remoteDirectoryPath(source.providerId,location)))
    return result
   }
   const operation=name==='createFolderDirect'?{kind:'folder',parent:location,name:String(nameOrFile||'')}:{kind:'text',parent:location,name:String(nameOrFile||''),content:String(args[4]||'')}
   const receipt=await nativeCall<{schemaVersion:number;sourceId:string;path:string}>('local_file_create',{sourceId:props.sourceId,operation})
   if(receipt.schemaVersion!==1||receipt.sourceId!==user||typeof receipt.path!=='string'||!receipt.path)throw Error('创建结果无效，请刷新文件列表')
   return name==='createFolderDirect'?{file_id:receipt.path}:'success'
  }
  if(name==='folderFavorite'){const file=args[0] as IAliGetFileModel;emit('favorite',{...file,file_id:folderFavoriteLocation(file)});return}
  if(name==='open'){
   const file=args[0] as IAliGetFileModel;if(!file)return
   if(file.isDir)return load(props.sourceId,props.local?localDirectoryKey(typeof file.path==='string'?file.path:file.file_id):file.file_id,true)
   if(props.local)return nativeCall('player_open_local',{sourceId:props.sourceId,relativePath:file.file_id})
   const source=account.value,row=rawEntries.get(file.file_id);if(!source||!row)throw Error('来源或文件已失效')
   return playSource(source,row,[...rawEntries.values()])
  }
  if(name==='copyName'){await navigator.clipboard.writeText(files.map(file=>file.name).join('\n'));return}
  if(name==='download'){
   if(!account.value||props.local)throw Error('本地文件无需下载')
   if(!files.length)throw Error('没有可以下载的文件')
   if(args[1]&&!operations.value.has('files.downloadZip'))throw Error('此来源不支持打包下载')
   dialog.value={kind:'download',files:files.map(file=>({...file})),downloadZip:args[1]===true};return
  }
  if(name==='downloadConfirmed'){
   const scope=transferEntryScope(),current=dialog.value
   if(current?.kind!=='download'||!current.files?.length||!settings.downSavePath)throw Error('下载窗口或保存目录已失效')
   const check=()=>{scope.check();if(disposed||sourceGeneration!==actionContext||dialog.value!==current)throw Error('下载窗口已关闭或切换')}
   return await submitTransferEntry({kind:'download',account:{...scope.account,authOrigins:[...scope.account.authOrigins]},parent:currentPath,destination:settings.downSavePath,zip:current.downloadZip===true,files:current.files.map(file=>({id:file.file_id,name:file.name,isDirectory:file.isDir}))},check)
  }
  if(name==='uploadSelected'){
   const scope=transferEntryScope(),[parent,paths,picture,encrypted]=args
   if(!operations.value.has('upload.local')||picture||encrypted||typeof parent!=='string'||parent!==store.DirID||!Array.isArray(paths)||!paths.length||paths.some(path=>typeof path!=='string'||!path||/[\u0000-\u001f]/.test(path))||new Set(paths).size!==paths.length)throw Error('上传来源、目录或文件选择无效')
   const check=()=>{scope.check();if(disposed||sourceGeneration!==actionContext||store.DirID!==parent)throw Error('上传目录已切换')}
   return await submitTransferEntry({kind:'upload',account:{...scope.account,authOrigins:[...scope.account.authOrigins]},parent:remoteDirectoryPath(scope.account.providerId,parent,rootPath),paths:[...paths],conflict:settings.downUploadWhatExist},check)
  }
  if(name==='importShare'){
   if(props.local||!['aliyun','quark','guangya','pikpak'].includes(account.value?.providerId||''))throw Error('此来源导入分享尚未接入')
   importing?.dispose();const reading=createShareImportSession(),writer=account.value?.providerId==='pikpak'?createPikpakImportWriter(reading):account.value?.providerId==='guangya'?createGuangyaImportWriter(reading):account.value?.providerId==='quark'?createQuarkImportWriter(reading):createShareImportWriter(reading);importing=reading
   const ui:ShareImportUiPort=markRaw({...reading,...writer,close:()=>{void action('closeDialog',[])},selectDirectory:callback=>{void action('selectDirectory',['share','',callback])},refresh:async(user,drive,parent)=>{reading.check();if(user!==props.sourceId||drive!==props.sourceId)throw Error('转存刷新来源不匹配');if(parent===currentPath)await load(user,parent,false);else await list(user,drive,parent);reading.check()}})
   dialog.value={kind:'importShare',importPort:ui,resolved:value=>{reading.check();if(dialog.value?.kind!=='importShare'||importing!==reading)throw Error('导入窗口已变化');reading.selection(value.id,value.token,[]);dialog.value={kind:'showShare',importPort:ui,share:value}}};return
  }
  if(name==='share'){
   if(!files.length)throw Error('请先选择文件')
   if(!account.value||props.local)throw Error('本地来源不能创建网盘分享')
   dialog.value={kind:'createShare',files:files.map(file=>({...file})),sharetype:String(args[1]||'s'),driveType:account.value.providerId==='123'?'cloud123':String(args[2]||account.value.providerId)};return
  }
  if(name==='transcode'){if(args[0]!=='vip_push'&&args[0]!=='pay_push')throw Error('115 转码操作无效');return await menuDrive115VideoPush(args[0])}
  if(name==='advancedSearch'){if(account.value?.providerId!=='aliyun')throw Error('此来源不支持阿里高级搜索');dialog.value={kind:'search',searchRange:Array.isArray(args[0])?args[0] as string[]:[]};return}
  if(name==='search'){query=String(args[0]||'').trim();return load(props.sourceId,currentPath,false)}
  if(name==='scan'){const file=args[0] as IAliGetFileModel;const path=folderFavoriteLocation(file);if(sources.preferences.favorites.some(folder=>folder.sourceId===props.sourceId&&folder.path===path))return catalog.scanFolder(props.sourceId,path);return toggleFolderFavorite(sources,catalog,props.sourceId,path,file.name,!!props.local)}
  if(name==='openLocation'){
   const file=files[0];if(!file)return
   if(query){history.push({path:currentPath,query,title:crumbs.at(-1)?.title||props.name});query='';return load(props.sourceId,file.parent_file_id,false)}
   return load(props.sourceId,file.parent_file_id,true)
  }
  throw Error('该文件操作尚未接入，未更改任何文件')
 }catch(cause){if(!disposed&&sourceGeneration===actionContext)error.value=asAppError(cause).message;throw cause}
}
function folderFavoriteLocation(file:IAliGetFileModel){
 if(props.local&&typeof file.path==='string')return file.path
 if(account.value?.providerId==='baidu'&&typeof file.path==='string'){
  const saved=sources.preferences.favorites.find(folder=>!folder.local&&folder.sourceId===props.sourceId&&folder.path===file.path)
  if(saved)return saved.path
 }
 return file.file_id
}
const port=reactive({get context(){return sourceGeneration},get scanning(){return catalog.scanning},get account(){return account.value},get local(){return !!props.local},get sourceId(){return props.sourceId},store,tree,settings,get operations(){return operations.value},favorite:(file:IAliGetFileModel)=>sources.preferences.favorites.some(folder=>folder.sourceId===props.sourceId&&folder.path===folderFavoriteLocation(file)),height:360,load,more,list,action,file:(id:string)=>store.ListDataRaw.find(file=>file.file_id===id)||commandRows.get(id)||tree.selectDirPath.find(file=>file.file_id===id)}) as DrivePanePort
const unbind=bindDrivePane(port)
let observer:ResizeObserver|undefined
let disposeImageErrors=()=>{}
onMounted(()=>{window.addEventListener('click',onHideRightMenu,{passive:true});window.addEventListener('keydown',dismissMenuKey,true);if(root.value){disposeImageErrors=installDriveImageErrors(root.value,()=>!disposed);observer=new ResizeObserver(()=>{const list=root.value!.querySelector('#panfilelist');port.height=Math.max(120,list?root.value!.getBoundingClientRect().bottom-list.getBoundingClientRect().top-12-(root.value!.querySelector('.source-list-header')?.getBoundingClientRect().height||0):root.value!.clientHeight-128)});observer.observe(root.value);root.value.querySelectorAll('.toppanbtns,.toppanarea,.source-list-header').forEach(element=>observer!.observe(element))}})
onUnmounted(()=>{sizeRefresh?.stop();folderPreview.value?.cancel();cancelTextCreationScope(props.sourceId);window.removeEventListener('click',onHideRightMenu);window.removeEventListener('keydown',dismissMenuKey,true);onHideRightMenu();disposed=true;generation++;importing?.dispose();disposeImageErrors();observer?.disconnect();unbind();store.$dispose()})
watch(()=>[props.sourceId,props.initialPath],(_next,previous)=>{folderPreview.value?.cancel();if(previous?.[0])cancelTextCreationScope(previous[0]);generation++;sourceGeneration++;relocationRetry=undefined;operationError.value='';importing?.dispose();importing=undefined;dialog.value=undefined;localTransitions.length=0;commandRows.clear();history.length=0;crumbs.length=0;tree.user_id=props.sourceId;tree.drive_id=props.sourceId;rootPath=props.initialPath||'';currentPath=rootPath;query='';void load(props.sourceId,props.local?localDirectoryKey(currentPath):currentPath,false)},{immediate:true})
watch(()=>[props.sourceId,props.initialPath,JSON.stringify(account.value),settings.uiFolderSize],()=>{
 sizeRefresh?.stop();sizeRefresh=undefined
 const source=account.value,epoch=sourceGeneration,owner=JSON.stringify(source)
 if(props.local||!settings.uiFolderSize||source?.providerId!=='aliyun')return
 const check=()=>{if(disposed||epoch!==sourceGeneration||JSON.stringify(account.value)!==owner)throw Error('自动目录大小统计来源已切换')}
 sizeRefresh=startAliDirectorySizeRefresh(source,check,()=>{
  check();for(const file of new Set([...store.ListDataRaw,...commandRows.values()]))Object.assign(file,sizeRefresh!.apply(file))
  store.mRefreshListDataShow(true)
 })
},{immediate:true})
// Electron layout/PageMain.vue dismisses in click bubble and key capture phases.
// The source host owns those listeners while mounted, including teleported menus.
function dismissMenuKey(event:KeyboardEvent){
 const target=event.target instanceof Element?event.target:null
 if(target?.closest('input,textarea,select,[contenteditable="true"]'))return
 if(target?.closest('[role="dialog"]')&&!root.value?.contains(target))return
 if(!['Control','Shift','Alt','Meta'].includes(event.key))onHideRightMenu()
}
watch(dialog,()=>folderPreview.value?.cancel())
watch(()=>[JSON.stringify(account.value),settings.uiFolderPreviewEnabled],()=>folderPreview.value?.cancel())
function hoverFolder(event:MouseEvent){
 const target=event.target instanceof Element?event.target:null,row=target?.closest<HTMLElement>('.fileitem,.griditem')
 if(!row||!settings.uiFolderPreviewEnabled||event.relatedTarget instanceof Node&&row.contains(event.relatedTarget))return
 const title=row.querySelector('button.select')?.getAttribute('title')
 const index=title&&/^\d+$/.test(title)?Number(title):-1,file=Number.isInteger(index)?store.ListDataShow[index]:undefined
 if(!file?.isDir||['trash','recover'].includes(store.SelectDirType))return
 folderPreview.value?.open(row,{user_id:props.sourceId,drive_id:props.sourceId,file_id:file.file_id,name:file.name,path:file.path})
}
function leaveFolder(event:MouseEvent){
 const target=event.target instanceof Element?event.target:null,row=target?.closest('.fileitem,.griditem')
 if(row&&!(event.relatedTarget instanceof Node&&row.contains(event.relatedTarget)))folderPreview.value?.leave()
}
function cancelHover(event:Event){if(!(event.target instanceof Element&&event.target.closest('.folderPreviewPanel')))folderPreview.value?.cancel()}
function sourceMouse(event:MouseEvent){cancelHover(event);sendDriveMouse(event)}
function focusFileKeyboard(event:MouseEvent){
 const target=event.target instanceof Element?event.target:null
 const selectionControl=target?.closest('button.qujian')
 if(selectionControl){
  const host=root.value,epoch=sourceGeneration,previousFocus=document.activeElement
  void nextTick(async()=>{
   // Capture runs before the original button handler schedules its render.
   await nextTick()
   requestAnimationFrame(()=>{
    const focus=document.activeElement
    if(!disposed&&epoch===sourceGeneration&&host===root.value&&host?.isConnected&&!selectionControl.isConnected&&(focus===previousFocus||focus===selectionControl||focus===document.body))host.focus({preventScroll:true})
   })
  })
  return
 }
 if(!target?.closest('.fileitem,.griditem'))return
 const control=target.closest('button,a[href],input,textarea,select,[contenteditable="true"],[role="button"],[role="menuitem"],[role="option"],[role="tab"]')
 if(control&&!control.matches('button.select'))return
 // WebKit on macOS does not reliably focus a clicked button. Keep the
 // retained keyboard handler reachable after navigation destroys the old row.
 root.value?.focus({preventScroll:true})
}
function keyboard(event:KeyboardEvent){
 const target=event.target as HTMLElement|null
 if(target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')&&!target.closest('.source-drive-manager'))return
 if(target?.closest('input,textarea,select,[contenteditable="true"]'))return
 if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&!target?.closest('.fileitem button.select,.griditem button.select')&&target?.closest('button,a[href],[role="button"],[role="menuitem"],[role="option"],[role="tab"]')&&['Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Escape'].includes(event.key))return
 if(event.ctrlKey||event.metaKey||['ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Enter','Escape','F2','F3','F5','Backspace',' '].includes(event.key)){
  event.preventDefault();event.stopPropagation();sendDriveKeyboard(event)
 }
}
</script>
<template><section ref="root" class="source-drive-manager" tabindex="0" aria-label="文件源浏览器" @keydown.capture="keyboard" @click.capture="focusFileKeyboard" @pointerdown="sourceMouse" @mouseover="hoverFolder" @mouseout="leaveFolder" @scroll.capture="cancelHover" @dragstart.capture="cancelHover" @contextmenu.capture="cancelHover" @contextmenu.prevent><p v-if="error||operationError" class="drive-error" role="alert">{{[error,operationError].filter(Boolean).join('\n')}}<button @click="retryError">重试</button></p><OriginalPanRight><template #list-header><div v-if="$slots['list-header']" class="source-list-header"><slot v-if="store.DirID===breadcrumbKey(rootPath)" name="list-header"/></div></template></OriginalPanRight><FolderPreviewPopover ref="folderPreview"/><DriveDialogs :dialog="dialog"/></section></template>
<style scoped>
.source-drive-manager{--listhoverbg:var(--secondary);--listselectbg:color-mix(in srgb,var(--primary) 18%,var(--background));flex:1;min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;outline:none;padding:0 12px 12px}.drive-error{white-space:pre-line;color:var(--color-danger-6);font-size:12px;overflow-wrap:anywhere}.drive-error button{margin-left:8px}.source-drive-manager :deep(.toppanbtns){min-width:0;flex-wrap:wrap;height:auto!important;min-height:26px;gap:4px}.source-drive-manager :deep(.toppanlist){flex:1;min-height:0}.source-drive-manager :deep(.arco-input-search){max-width:180px}.source-drive-manager :deep(.rightmenu){max-width:min(94vw,480px)}
.source-drive-manager :deep(.source-star.is-favorite svg){fill:currentColor}.source-drive-manager :deep(.toppanbtn){flex-wrap:wrap;margin-right:6px}
.source-drive-manager :deep(.filename){min-width:0}
.source-drive-manager :deep(.toppanlist){display:flex;flex-direction:column}
.source-list-header{flex:none;position:relative;z-index:1}
.source-drive-manager :deep(.toppanlist>.arco-list){flex:1;min-height:0}
/* Retain the original selection controls; allow their groups to wrap in the 840px source shell. */
.source-drive-manager :deep(.toppanarea){flex-wrap:wrap;height:auto;min-height:40px;flex-shrink:0;row-gap:2px}
.source-drive-manager :deep(.toppanarea>div){flex-shrink:0;max-width:100%}
.source-drive-manager :deep(.toppanarea .selectInfo){flex-shrink:0;overflow:visible}
.source-drive-manager :deep(.toppanarea>div:nth-child(3)){flex-wrap:wrap;height:auto;min-height:38px}
</style>
