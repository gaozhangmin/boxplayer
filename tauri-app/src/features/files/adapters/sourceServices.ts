import {computed} from 'vue'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {toggleFolderFavorite} from '../folderFavorites'
import {driver} from '@/features/sources/drivers'
import {nativeCall} from '@/platform/native'
import {Message} from '@arco-design/web-vue'
import {providerIcon} from '../sourcePresentation'
import type {ElectronFolder} from './types'
import type {LocalListing} from '@/platform/contracts'
export {type ElectronFolder as IAliGetFileModel} from './types'
export const message={error:(value:string)=>Message.error(value),success:(value:string)=>Message.success(value)}
const providerNames:Record<string,string>={google:'Google Drive',dropbox:'Dropbox',onedrive:'OneDrive',box:'Box',aliyun:'阿里云盘',cloud123:'123网盘','115':'115网盘',baidu:'百度网盘',pikpak:'PikPak',quark:'夸克网盘','139':'139云盘','189':'天翼云盘',guangya:'光鸭云盘',smb:'SMB',nfs:'NFS',ftp:'FTP',webdav:'WebDAV',alist:'AList'}
export function nativeProvider(id:string){return id==='aliyun'?'alipan-open':id==='cloud123'?'123':id}
export function getDriveProviderMeta(key:string){return {key,label:providerNames[key]||key,icon:providerIcon(nativeProvider(key))}}
export function isFileSourceRoot(folder:ElectronFolder){return ['', '/', '0','root','quark_root','baidu_root'].includes(folder.file_id)}
export const encodeLocal=(sourceId:string,path:string)=>JSON.stringify([sourceId,path])
export const decodeLocal=(path:string)=>JSON.parse(path) as [string,string]
export async function listLocal(path:string){const [sourceId,relativePath]=decodeLocal(path);const result=await nativeCall<LocalListing>('local_list',{sourceId,relativePath});return result.entries.filter(row=>!row.name.startsWith('.')).map(row=>({name:row.name,directory:row.isDirectory,path:encodeLocal(sourceId,row.relativePath)}))}
export async function listProviderFolderItems({folder}:{folder:ElectronFolder;userId?:string;driveId?:string}){const sources=useFileSourcesStore(),account=sources.accounts.find(a=>a.id===folder.user_id);if(!account)throw Error('来源不存在');const result:ElectronFolder[]=[];let cursor:string|undefined;const seen=new Set<string>();do{const page=await driver(account).list(account,folder.file_id,cursor);result.push(...page.entries.map(row=>({file_id:row.id,drive_id:account.id,user_id:account.id,name:row.name,path:row.id,isDir:row.isDirectory,size:row.size,category:row.playable?'video':'',serverType:row.serverType})));cursor=page.nextCursor;if(cursor){if(seen.has(cursor))throw Error('来源分页重复');seen.add(cursor)}}while(cursor);return result}
export function useMediaLibraryStore(){const sources=useFileSourcesStore(),catalog=useVideoCatalog();return {get isScanning(){return false},get folders(){return [...sources.snapshot.localFolders.map(folder=>({id:folder.id,name:folder.name,path:encodeLocal(folder.id,''),userId:'local',driveId:'local',driveServerId:'local',fileId:folder.id,isDriveRootFavorite:false,isFavorite:!sources.preferences.hiddenLocalRoots[folder.id]})),...sources.preferences.favorites.map(folder=>({id:folder.id,name:folder.name,path:folder.local?encodeLocal(folder.sourceId,folder.path):folder.path,userId:folder.sourceId,driveId:folder.local?'local':folder.sourceId,driveServerId:folder.local?'local':folder.sourceId,fileId:folder.path,isFavorite:true,isDriveRootFavorite:!folder.path}))]},addFolder(folder:{id:string;isFavorite?:boolean}){if(folder.isFavorite!==false)return;const local=sources.snapshot.localFolders.find(f=>f.id===folder.id);if(local)sources.preferences.hiddenLocalRoots[local.id]=true;else sources.removeBookmark(folder.id)},removeFolder(id:string){const favorite=sources.findBookmark(id);if(favorite)void toggleFolderFavorite(sources,catalog,favorite.sourceId,favorite.path,favorite.name,favorite.local).catch(e=>message.error(String(e)))}}}
let localChoice:{id:string;path:string;name:string}|undefined
export async function chooseLocal(){if(localChoice)await cancelLocal();localChoice=await nativeCall('local_choose_folder')||undefined;return localChoice}
export async function cancelLocal(){const selection=localChoice;localChoice=undefined;if(selection)await nativeCall('local_cancel_folder',{selectionId:selection.id}).catch(()=>{})}
export const MediaScanner={getInstance:()=>({async scanLocalFolder(path:string,name?:string){const catalog=useVideoCatalog(),sources=useFileSourcesStore();if(localChoice&&localChoice.path===path){const source=await nativeCall<{id:string;name:string}>('local_save_chosen_source',{selectionId:localChoice.id,name:name||localChoice.name});localChoice=undefined;await sources.refresh();await catalog.scanFolder(source.id,'');return}const [sourceId,relativePath]=decodeLocal(path);await toggleFolderFavorite(sources,catalog,sourceId,relativePath,name||'文件夹',true)},async favoriteFolder(folder:ElectronFolder,_provider:string,name:string,_root?:boolean,_covered?:boolean){await toggleFolderFavorite(useFileSourcesStore(),useVideoCatalog(),folder.user_id,folder.file_id,name,false)}})}
export async function downloadFolder(folder:ElectronFolder,name:string){await nativeCall('source_download',{accountId:folder.user_id,fileId:folder.file_id,name})}
