/** Native boundary for directly migrated Electron drive components. No Electron token store. */
import {localDirectoryPath} from './localDirectoryKeys'
import { reactive, ref, watch, onScopeDispose } from 'vue'
import {createDriveSettings} from './settings'
import { Message } from '@arco-design/web-vue'
import type { Account } from '@/features/sources/contracts'
import type { IAliGetFileModel } from './electron/aliapi/alimodels'
import useOriginalPanFileStore from './electron/pan/panfilestore'
import { fileOperationAvailable } from '../adapters/providerCapabilities'
import type { DriveOperation } from '../electron/drive/services/agent/providerCapabilityTypes'
export type { KeyboardMessage } from '../adapters/keyboardMessage'
export { throttle } from './electron/utils/debounce'
export interface KeyboardState { KeyDownEvent: import('../adapters/keyboardMessage').KeyboardMessage }
export interface MouseMessage { isTrusted:boolean;Ctrl:boolean;Shift:boolean;Alt:boolean;button:number;buttons:number;srcElement:EventTarget|null }
export interface MouseState { MouseEvent:MouseMessage }
export interface IAliFileResp { m_drive_id:string;dirID:string;items:IAliGetFileModel[];next_marker:string }
export type FileStore=ReturnType<typeof useOriginalPanFileStore>
export interface DrivePanePort {
 context?:number;
 account?:Account;local:boolean;sourceId:string;scanning:boolean;store:FileStore;operations:ReadonlySet<DriveOperation>;
 favorite(file:IAliGetFileModel):boolean;tree:ReturnType<typeof createDriveTree>;settings:ReturnType<typeof createDriveSettings>;height:number;
 load(drive:string,path:string,history:boolean,album?:string):Promise<void>;
 more():Promise<void>;
 list(user:string,drive:string,path:string,validate?:()=>void):Promise<IAliGetFileModel[]>;
 file?(id:string):IAliGetFileModel|undefined;
 action(name:string,args:unknown[]):Promise<any>;
}
let pane:DrivePanePort|undefined
export function bindDrivePane(value:DrivePanePort){
 if(pane&&pane!==value)throw Error('A source browser is already mounted')
 pane=value
 return ()=>{if(pane===value)pane=undefined}
}
export function getDrivePane(){if(!pane)throw Error('The source browser is closed');return pane}
export function createDriveTree(){
 const state=reactive({user_id:'',drive_id:'',selectDir:{} as IAliGetFileModel & {album_type?:string},selectDirPath:[] as IAliGetFileModel[],navigationOptions:[] as IAliGetFileModel[],PanHistoryCount:0})
 return Object.assign(state,{mRenameFiles(rows:Array<{file_id:string;name:string}>){const names=new Map(rows.map(row=>[row.file_id,row.name]));state.selectDirPath=state.selectDirPath.map(row=>names.has(row.file_id)?{...row,name:names.get(row.file_id)!}:row);if(names.has(state.selectDir.file_id))state.selectDir={...state.selectDir,name:names.get(state.selectDir.file_id)!}}})
}
export {createDriveSettings} from './settings'

export function usePanFileStore(){return getDrivePane().store}
export function usePanTreeStore(){return getDrivePane().tree}
export function useSettingStore(){return getDrivePane().settings}
export function useWinStore(){
 const height=ref(window.innerHeight),resize=()=>{height.value=window.innerHeight}
 window.addEventListener('resize',resize);onScopeDispose(()=>window.removeEventListener('resize',resize))
 return {get height(){return height.value},get GetListHeight(){return `${getDrivePane().height}px`},get GetListHeightNumber(){return getDrivePane().height}}
}
const foot=reactive({rightWidth:560,info:'',mSaveDirInfo(value:string){foot.info=value}})
export function useFootStore(){return foot}
export function useAppStore(){return {appTab:'pan',toggleTab:(tab:string)=>action('navigate',tab)}}
export const message={error:(text:string,..._detail:unknown[])=>Message.error(text),success:(text:string)=>Message.success(text),warning:(text:string)=>Message.warning(text),info:(text:string)=>Message.info(text)}
export function ArrayToMap<T>(key:string,rows:T[]){return new Map(rows.map(row=>[(row as Record<string,unknown>)[key],row]))}
const orderKey=(drive:string,path:string)=>`tauri.driveOrder:${JSON.stringify([drive,path])}`
export const TreeStore={
 GetDirOrder(drive:string,path:string){try{const saved=localStorage.getItem(orderKey(drive,path));if(saved)return saved;const pane=getDrivePane();if(pane.local&&pane.sourceId===drive){const legacy=localDirectoryPath(path);if(legacy!==undefined)return localStorage.getItem(orderKey(drive,legacy||'backup_root'))||'name asc'}return 'name asc'}catch{return 'name asc'}},
 SaveDirOrder(drive:string,path:string,order:string){localStorage.setItem(orderKey(drive,path),order)},
 DeleteDirs(_drive:string,_paths:string[]){/* Directory tree was explicitly excluded from the migrated browser. */}
}
export const PanDAL={
 aReLoadOneDirToShow:(drive:string,path:string,history:boolean,album?:string)=>getDrivePane().load(drive,path,history,album),
 LoadMoreCurrentProviderItems:()=>getDrivePane().more(),
 aTreeScrollToDir(_path:string){/* F6/left tree is excluded; breadcrumb navigation still loads its target. */},
 RefreshPanTreeAllNode(_drive:string){/* The browser has no left directory tree. */},
 GetDirFileList:async(user:string,drive:string,path:string,_album:string)=>({items:await getDrivePane().list(user,drive,path)})
}
function subscribable<T extends object>(state:T){return Object.assign(state,{$subscribe(callback:(_mutation:unknown,value:T)=>void){const stop=watch(state,value=>callback(null,value),{deep:true,flush:'sync'});onScopeDispose(stop);return stop}})}
const keyboard=subscribable(reactive({KeyDownEvent:{Code:'',Key:'',Ctrl:false,Shift:false,Alt:false,Repeat:false,IsInput:false,IsEnmpty:true}}))
const mouse=subscribable(reactive({MouseEvent:{isTrusted:false,Ctrl:false,Shift:false,Alt:false,button:-1,buttons:0,srcElement:null as EventTarget|null}}))
export const useKeyboardStore=()=>keyboard
export const useMouseStore=()=>mouse
export function sendDriveKeyboard(event:KeyboardEvent){keyboard.KeyDownEvent={Code:event.code,Key:event.key,Ctrl:event.ctrlKey||event.metaKey,Shift:event.shiftKey,Alt:event.altKey,Repeat:event.repeat,IsInput:false,IsEnmpty:false}}
export function sendDriveMouse(event:MouseEvent){mouse.MouseEvent={isTrusted:event.isTrusted,Ctrl:event.ctrlKey||event.metaKey,Shift:event.shiftKey,Alt:event.altKey,button:event.button,buttons:event.buttons,srcElement:event.target}}
function provider(user:string){const current=getDrivePane();return current.account?.id===user?current.account.providerId:undefined}
export const isAliyunUser=(user:string)=>['aliyun','alipan-open'].includes(provider(user)||'')
export const isCloud123User=(user:string)=>provider(user)==='123'
export const isDrive115User=(user:string)=>provider(user)==='115'
export const isGuangyaUser=(user:string)=>provider(user)==='guangya'
export const isPikPakUser=(user:string)=>provider(user)==='pikpak'
export const isDropboxUser=(user:string)=>provider(user)==='dropbox'
export const isOneDriveUser=(user:string)=>provider(user)==='onedrive'
export const isBoxUser=(user:string)=>provider(user)==='box'
export const isGoogleUser=(user:string)=>provider(user)==='google'
export const isWebDavDrive=(drive:string)=>drive===getDrivePane().sourceId&&['webdav','alist'].includes(getDrivePane().account?.providerId||'')
function supported(user:string,operation:DriveOperation){const current=getDrivePane();return user===current.sourceId&&(current.local?current.operations.has(operation):!!current.account&&fileOperationAvailable(current.account,operation,current.operations))}
export const supportsCopy=(u:string,_d:string)=>supported(u,'files.copy')
export const supportsMove=(u:string,_d:string)=>supported(u,'files.move')
export const supportsRename=(u:string,_d:string)=>supported(u,'files.rename')
export const supportsCreateFolder=(u:string,_d:string)=>supported(u,'files.createFolder')
export const supportsCreateTextFile=(u:string,_d:string)=>supported(u,'upload.memory')
export const supportsCreateShare=(u:string,_d:string)=>supported(u,'share.create')
export const supportsShareImport=(u:string,_d:string)=>supported(u,'share.import')
export const supportsTrashMove=(u:string,_d:string)=>supported(u,'trash.move')
export const supportsTrashRestore=(u:string,_d:string)=>supported(u,'trash.restore')
export const supportsTrashPermanentDelete=(u:string,_d:string)=>(getDrivePane().account?.providerId!=='alipan-open'||getDrivePane().store.SelectDirType!=='trash')&&supported(u,'trash.delete')
export const supportsDirectPermanentDelete=(u:string,d:string)=>getDrivePane().account?.providerId==='alipan-open'?supported(u,'trash.delete'):!isDrive115User(u)&&!isBoxUser(u)&&supportsTrashPermanentDelete(u,d)
export const supportsLocalUpload=(u:string,_d:string)=>supported(u,'upload.local')
export const supportsZipDownload=(u:string,_d:string)=>supported(u,'files.downloadZip')
export const supportsSearch=(u:string,_d:string)=>supported(u,'files.search')
export const supportsEncryptedFileOperations=(_u:string)=>false
export const isWritableProviderDirectory=(id:string)=>!id.startsWith('search')&&!['recent','favorite','trash','recover','google_shared','google_shared_drives'].includes(id)
export const isValidDropUploadTarget=(u:string,d:string,id:string)=>supportsLocalUpload(u,d)&&isWritableProviderDirectory(id)
export const getDriveId=(_user:string,_type:string)=>getDrivePane().sourceId
export const getDriveType=(_user:string,_drive:string)=>({name:'backup'})
const action=(name:string,...args:unknown[])=>getDrivePane().action(name,args)
export const menuOpenFile=(...args:unknown[])=>action('open',...args)
export const menuCopySelectedFile=(...args:unknown[])=>action('copy',...args)
export const dropMoveSelectedFile=(...args:unknown[])=>action('dropMove',...args)
export const menuCreatShare=(...args:unknown[])=>action('share',...args)
export const menuTrashSelectFile=(...args:unknown[])=>action('trash',...args)
export const menuFavSelectFile=(...args:unknown[])=>action('favorite',...args)
export {topSearchAll} from './electron/pan/topbtns/search'
export {handleUpload} from './electron/pan/topbtns/upload'
export const modalUpload=(...args:unknown[])=>action('uploadSelected',...args)
export const modalCreatNewDir=(...args:unknown[])=>action('createFolder',...args)
export const modalCreatNewFile=(...args:unknown[])=>action('createText',...args)
export const modalDaoRuShareLink=(...args:unknown[])=>action('importShare',...args)
export const modalRename=(...args:unknown[])=>action('rename',...args)
export const modalSelectPanDir=(...args:unknown[])=>action('selectDirectory',...args)
export const modalCloud123OfflineDownload=(...args:unknown[])=>action('offline',...args)
export const modalShuXing=(...args:unknown[])=>action('properties',...args)
export const menuCopyFileName=(...args:unknown[])=>action('copyName',...args)
export const menuCopyFileTree=(...args:unknown[])=>action('copyTree',...args)
export const menuJumpToDir=(...args:unknown[])=>action('openLocation',...args)
export const menuDownload=(...args:unknown[])=>action('download',...args)
export const menuFileClearHistory=(...args:unknown[])=>action('clearHistory',...args)
export const menuFileColorChange=(...args:unknown[])=>action('color',...args)
export const topFavorDeleteAll=(...args:unknown[])=>action('clearFavorites',...args)
export const topRestoreSelectedFile=(...args:unknown[])=>action('restore',...args)
export const topRecoverSelectedFile=(...args:unknown[])=>action('recover',...args)
export const topTrashDeleteAll=(...args:unknown[])=>action('emptyTrash',...args)
export const canClearTrash=(u:string,_d:string)=>supported(u,'trash.empty')
export const menuDrive115VideoPush=(...args:unknown[])=>action('transcode',...args)
export const apiDrive115FileDetailResult=(...args:unknown[])=>action('detail115',...args)
export const resolveDriveFileToken=(...args:unknown[])=>action('resolveToken',...args)
export const listDriveToolChildren=(user:string,drive:string,path:string)=>getDrivePane().list(user,drive,path)
export const MediaScanner={getInstance:()=>({get isCurrentlyScanning(){return getDrivePane().scanning},scanFolder:(...args:unknown[])=>action('scan',...args)})}
// Excluded features retain rejecting ports until their source branches are pruned.
function excluded(..._args:unknown[]):never{throw Error('This feature is outside the file-manager milestone')}
export const modalPassword=(_type:string,_callback:(success:boolean,password?:string)=>void)=>excluded()
export const modalCreatNewAlbum=excluded,modalShowShareLink=excluded,menuAddAlbumSelectFile=excluded,menuDLNA=excluded,menuM3U8Download=excluded,menuFileEncTypeChange=excluded,menuVideoXBT=excluded
export const MusicScanner={getInstance:()=>({isScanning:false,scanFolder:async(..._args:unknown[]):Promise<{found:number}>=>excluded()})}
export const BookScanner=MusicScanner
export const AliShare={ApiShareBottleFish:async(..._args:unknown[]):Promise<any>=>excluded(),ApiGetShareToken:async(..._args:unknown[]):Promise<string>=>excluded()}
export const MAX_DOCUMENT_INSIGHT_SOURCES=0
export const isDocumentInsightFile=(_file:IAliGetFileModel)=>false
export const toDocumentInsightSource=(..._args:unknown[])=>excluded()
export const openDocumentInsight=(..._args:unknown[])=>excluded()
export const useModalStore=()=>({showModal:(...args:unknown[])=>action('dialog',...args)})
export const getDroppedPath=(_file:File):string=>'' // Native drag-drop paths will be supplied by the M6 transfer port, never inferred from WebView File.path.

export const favoriteSourceFolder=(file:IAliGetFileModel)=>action('folderFavorite',file)
export const isSourceFolderFavorite=(file:IAliGetFileModel)=>getDrivePane().favorite(file)

export const supportsDownload=()=>!getDrivePane().local&&getDrivePane().operations.has('files.download')
