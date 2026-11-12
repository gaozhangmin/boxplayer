import {computed,ref,onMounted,onUnmounted,watch} from 'vue'
import {Modal,Message} from '@arco-design/web-vue'
import {useFileSourcesStore,type FileSourceCard} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {useFileBrowseMode} from '../browseMode'
import {toggleFolderFavorite} from '../folderFavorites'
import {serverFavorite} from '@/features/sources/mediaServer'
import {collectPlayable,serverDetail} from '@/features/servers/workspace'
import {readPreferences,writePreferences} from '@/features/servers/preferences'
import {serverArtwork} from '@/features/sources/serverMetadata'
import {isPublicCover,isServerCover} from '../coverImages'
import {providerIcon} from '../sourcePresentation'
import {nativeCall} from '@/platform/native'
import type {BrowseRoute} from '@/features/servers/workspace'
import type {SavedSource} from './types'
export function useFilesPorts(emit:{(event:'selectSource',id:string):void;(event:'openFolder',folder:{sourceId:string;path:string;local:boolean;favoriteId:string}):void;(event:'serverRoute',id:string,route:BrowseRoute):void},options:{loadCatalog?:boolean}={}){
 const sources=useFileSourcesStore(),catalog=useVideoCatalog(),grid=useFileBrowseMode()
 const collectionMode=computed({get:()=>grid.value?'grid':'list',set:(value:string)=>{grid.value=value==='grid'}})
 const key=(card:FileSourceCard)=>card.favorite||card.local?'folder:'+card.id:card.serverFavorite?(card.serverFavorite.content?'server-folder:'+card.id:'server-category:home-entry/'+card.id):card.server?'server:'+card.id:'root:'+card.id
 const find=(id:string)=>sources.cards.find(card=>key(card)===id)
 const section=ref('files'),app={mediaLibrarySection:'files'}
 const sourceOverrides=computed<import('../electron/fileSourceOrder').FileSourceOverrides>({get:()=>Object.fromEntries(sources.cards.flatMap(card=>{const value={name:card.name,cover:card.cover,hiddenOnHome:card.hiddenOnHome,order:sources.preferences.order.includes(card.id)?sources.preferences.order.indexOf(card.id):9999};return [[key(card),value],...(card.serverFavorite&&!card.serverFavorite.content?[[key(card).slice('server-category:'.length),value]]:[])]})),set:()=>{}})
 function open(card:FileSourceCard){if(card.serverRoute)emit('serverRoute',card.sourceId,card.serverRoute);else if(card.server)emit('serverRoute',card.sourceId,{kind:'home',title:card.name});else if(card.favorite||card.local)emit('openFolder',{sourceId:card.sourceId,path:card.path,local:card.local,favoriteId:card.id});else emit('selectSource',card.sourceId)}
 const connectedFileRoots=computed(()=>sources.cards.filter(card=>!card.local&&!card.favorite&&!card.server).map(card=>({value:card.id,label:card.name,driveServerId:sources.accounts.find(account=>account.id===card.sourceId)?.providerId,providerIcon:providerIcon(sources.accounts.find(account=>account.id===card.sourceId)?.providerId)})))
 const rootIsFavorite=(root:{value:string})=>sources.preferences.favorites.some(f=>f.sourceId===root.value&&!f.path)
 const resolvedCovers=ref<Record<string,string>>({});let artworkGeneration=0
 function clearCovers(){for(const url of Object.values(resolvedCovers.value))if(url.startsWith('blob:'))URL.revokeObjectURL(url);resolvedCovers.value={}}
 watch(()=>sources.cards.map(card=>[card.id,card.cover]).flat(),async()=>{const generation=++artworkGeneration;clearCovers();for(const card of sources.cards.filter(card=>card.serverFavorite&&card.cover&&!card.cover.startsWith('data:'))){const account=sources.accounts.find(a=>a.id===card.sourceId);if(!account)continue;try{const url=await serverArtwork(account,card.cover!);if(generation!==artworkGeneration){URL.revokeObjectURL(url);continue}resolvedCovers.value[card.id]=url}catch{}}},{immediate:true})
 onUnmounted(()=>{artworkGeneration++;clearCovers()})
 const favoriteCover=(id:string)=>{const card=find(id);return card?.serverFavorite&&card.cover&&!card.cover.startsWith('data:')?resolvedCovers.value[card.id]:card?.cover}
 const descending=computed(()=>sources.preferences.descending)
 function commitOrder(ids:string[]){sources.reorder(ids.map(id=>find(id)?.id).filter((id):id is string=>!!id))}
 const dialog=ref<{key:string;action:string;name:string;url:string;username:string;password:string;rootPath:string}>(),error=ref(''),busy=ref(false)
 const dialogAccount=computed(()=>sources.accounts.find(account=>account.id===find(dialog.value?.key||'')?.sourceId))
 async function action(id:string,action:string){const card=find(id);if(!card)return;error.value='';
 if(card.serverFavorite&&action==='toggleServerFavorite'){const account=sources.accounts.find(a=>a.id===card.sourceId)!;const item=await serverDetail(account,card.serverFavorite.route.id||'');await serverFavorite(account,item.id,!item.favorite);return}
 if(card.serverFavorite&&['removeFavoriteFolder','delete'].includes(action)){const prefs=readPreferences(card.sourceId);writePreferences(card.sourceId,{...prefs,favorites:prefs.favorites.filter(f=>f.key!==card.serverFavorite!.key)});sources.refreshServerFavorites();return}
 if(['play','loopPlay','shufflePlay'].includes(action)){try{if(card.serverFavorite){const account=sources.accounts.find(a=>a.id===card.sourceId)!;const rows=await collectPlayable(account,card.serverFavorite.route);await catalog.playMany(rows.map(item=>({id:JSON.stringify([account.id,item.id]),sourceId:account.id,fileId:item.id,fileName:item.name,name:item.name,type:item.kind==='movie'?'movie' as const:'tv' as const,local:false,addedAt:'',genres:item.genres||[],size:0})),action==='loopPlay'?'loop':action==='shufflePlay'?'shuffle':'play');return}await catalog.load();await catalog.playMany(catalog.items.filter(item=>item.sourceId===card.sourceId&&(!card.path||item.folderPath===card.path||item.folderAncestors?.includes(card.path)||item.catalogRoots?.includes(card.path))),action==='loopPlay'?'loop':action==='shufflePlay'?'shuffle':'play')}catch(e){Message.error(String(e))}return}
 if(action==='hideFavoriteOnHome'||action==='showFavoriteOnHome'){sources.preferences.hiddenOnHome[card.id]=action==='hideFavoriteOnHome';return}
 if(action==='removeFavoriteFolder'||action==='removeRootFavorite'||action==='delete'){
  Modal.confirm({title:action==='delete'?'删除':'从收藏夹中移除',content:'移除来源或收藏及不再被其他收藏覆盖的媒体记录？不会删除原始文件。',okButtonProps:{status:'danger'},onOk:async()=>{if(card.local||card.favorite)await toggleFolderFavorite(sources,catalog,card.sourceId,card.path,card.name,card.local);else if(action==='removeRootFavorite'){const favorites=[...sources.preferences.favorites.filter(f=>f.sourceId===card.sourceId&&!f.path)];for(const f of favorites)await toggleFolderFavorite(sources,catalog,f.sourceId,f.path,f.name,f.local)}else{await nativeCall('account_remove',{accountId:card.sourceId});sources.preferences.favorites=sources.preferences.favorites.filter(f=>f.sourceId!==card.sourceId);await sources.refresh()}}});return
 }
 dialog.value={key:id,action,name:action==='addToFavorites'?'所有文件':action==='cover'?card.cover||'':card.name,url:dialogAccount.value?.baseUrl||'',username:'',password:'',rootPath:''}
 const account=sources.accounts.find(a=>a.id===card.sourceId);if(account){dialog.value.url=account.baseUrl;if(['jellyfin','emby','plex'].includes(account.providerId)&&action==='editShare'){const info=await nativeCall<{username:string}>('server_connection_info',{accountId:account.id});if(dialog.value?.key===id)dialog.value.username=info.username}if(['webdav','smb','nfs','ftp'].includes(account.providerId)&&action==='editShare'){const info=await nativeCall<{username:string;rootPath:string;url:string}>(account.providerId==='webdav'?'webdav_connection_info':'network_share_connection_info',{accountId:account.id});if(dialog.value?.key===id)Object.assign(dialog.value,info)}}
 }
 async function saveDialog(){const target=dialog.value,card=target&&find(target.key);if(!target||!card||busy.value)return;busy.value=true;error.value='';try{
 if(target.action==='cover'){const cover=target.name.trim();if(cover&&!(card.serverFavorite?isServerCover(cover):isPublicCover(cover)))throw Error('封面地址无效');if(card.serverFavorite){const prefs=readPreferences(card.sourceId);writePreferences(card.sourceId,{...prefs,favorites:prefs.favorites.map(f=>f.key===card.serverFavorite!.key?{...f,cover}:f)});sources.refreshServerFavorites()}else sources.preferences.covers[card.id]=cover}
 else if(target.action==='addToFavorites')await toggleFolderFavorite(sources,catalog,card.sourceId,'',target.name.trim()||'所有文件',false)
 else if(target.action==='renameCollection'){if(!target.name.trim())return;if(card.serverFavorite){const prefs=readPreferences(card.sourceId);writePreferences(card.sourceId,{...prefs,favorites:prefs.favorites.map(f=>f.key===card.serverFavorite!.key?{...f,title:target.name.trim()}:f)});sources.refreshServerFavorites();dialog.value=undefined;return}if(card.local&&!card.favorite)await nativeCall('local_rename_source',{sourceId:card.sourceId,name:target.name.trim()});sources.rename(card.id,target.name.trim());await sources.refresh()}
 else if(target.action==='editShare'){if(!target.name.trim())return;const account=dialogAccount.value;if(account){if(['webdav','smb','nfs','ftp'].includes(account.providerId))await nativeCall(account.providerId==='webdav'?'webdav_update_connection':'network_share_update_connection',{accountId:account.id,name:target.name.trim(),url:target.url,username:target.username,password:target.password||null,rootPath:target.rootPath});else await nativeCall('account_update_metadata',{accountId:account.id,name:target.name.trim(),baseUrl:null});sources.rename(card.id,target.name.trim());await sources.refresh()}}
 dialog.value=undefined
 }catch(cause){error.value=String(cause)}finally{busy.value=false}}
 async function removeSelected(ids:string[]){if(!ids.length||ids.some(id=>id.startsWith('root:')))return false;return new Promise<boolean>(resolve=>Modal.confirm({title:'删除',content:'已选择 '+ids.length+' 项',okButtonProps:{status:'danger'},onCancel:()=>resolve(false),onOk:async()=>{for(const id of ids){const card=find(id);if(!card)continue;if(card.serverFavorite){const prefs=readPreferences(card.sourceId);writePreferences(card.sourceId,{...prefs,favorites:prefs.favorites.filter(f=>f.key!==card.serverFavorite!.key)});sources.refreshServerFavorites()}else if(card.local||card.favorite)await toggleFolderFavorite(sources,catalog,card.sourceId,card.path,card.name,card.local);else if(card.server){await nativeCall('account_remove',{accountId:card.sourceId});await sources.refresh()}}resolve(true)}}))}
 const originalModel={
  folderFavoriteCards:computed(()=>sources.cards.filter(card=>card.serverFavorite?.content).map(card=>({key:key(card),title:card.name,item:{id:card.serverFavorite!.route.id||'__all__',serverId:card.sourceId,isFavorite:true},action:()=>open(card)}))),
  libraryBookmarks:{get favorites(){return sources.cards.filter(card=>card.serverFavorite&&!card.serverFavorite.content).map(card=>'home-entry/'+card.id)},get titles(){return Object.fromEntries(sources.cards.filter(card=>card.serverFavorite).map(card=>['home-entry/'+card.id,card.name]))}},
  media:{get folders(){return sources.cards.filter(card=>card.local||card.favorite).map(card=>({id:card.id,name:card.name,userId:card.sourceId,driveId:card.sourceId,driveServerId:card.sourceId,fileId:card.path,isFavorite:true,isDriveRootFavorite:card.favorite&&!card.path}))}},
  registry:{get servers(){return sources.accounts.filter(account=>['jellyfin','emby','plex'].includes(account.providerId)).map(account=>({id:account.id,name:account.name,type:account.providerId as 'jellyfin'|'emby'|'plex',customIconUrl:sources.preferences.covers[account.id]}))}},
  rootFolderMatchesAny:(root:{value:string},folder:{userId:string})=>root.value===folder.userId,
  isConnectedRootFolder:(folder:{userId:string;fileId:string})=>['','/','0','root','quark_root','baidu_root'].includes(folder.fileId)&&connectedFileRoots.value.some(root=>root.value===folder.userId),
  rootFavoriteDriveName:(folder:{userId:string})=>sources.accounts.find(account=>account.id===folder.userId)?.name||'',
  openConnectedFileRoot:(root:{value:string})=>{const card=sources.cards.find(card=>card.id===root.value);if(card)open(card)},
  showFolder:(folder:{id:string})=>{const card=sources.cards.find(card=>card.id===folder.id);if(card)open(card)},
  showServer:(id:string)=>{const card=sources.cards.find(card=>card.id===id);if(card)open(card)},
  categoryBookmarkTitle:(route:string)=>sources.cards.find(card=>'home-entry/'+card.id===route)?.name||route,showCatalog:(route:string)=>{const card=sources.cards.find(card=>'home-entry/'+card.id===route);if(card)open(card)},
  // User requirement: scraped folder favorites, including whole-drive favorites, use Star.
  getDriveProviderById:(_id:string)=>'',getDriveProviderIcon:(_id:string)=>''
 }
 const savedSources=computed<SavedSource[]>(()=>sources.accounts.filter(a=>a.providerId!=='boxplayer').map(account=>({id:account.id,name:account.name,icon:providerIcon(account.providerId),driveServerId:account.providerId,drives:account.providerId==='google'?[{label:'我的硬盘',folder:{file_id:'google_root',drive_id:account.id,user_id:account.id,name:'我的硬盘',path:'google_root',isDir:true,size:0}},{label:'共享硬盘',folder:{file_id:'google_shared',drive_id:account.id,user_id:account.id,name:'共享硬盘',path:'google_shared',isDir:true,size:0}}]:undefined,server:['jellyfin','emby','plex'].includes(account.providerId)?{id:account.id,name:account.name,type:account.providerId as 'jellyfin'|'emby'|'plex',baseUrl:account.baseUrl,createdAt:0,updatedAt:0}:undefined,folder:{file_id:'',drive_id:account.id,user_id:account.id,name:account.name,path:'',isDir:true,size:0}})))
 async function refresh(){await sources.refresh()}
 onMounted(()=>{if(options.loadCatalog!==false)void catalog.load()})
 return {originalModel,sourceOverrides,collectionMode,connectedFileRoots,rootIsFavorite,favoriteCover,section,app,descending,commitOrder,toggleDirection:()=>{sources.preferences.descending=!sources.preferences.descending},action,removeSelected,dialog,dialogAccount,error,busy,saveDialog,savedSources,refresh,deviceName:/Mac/i.test(navigator.platform)?'Mac':'PC'}
}
export type FilesPorts=ReturnType<typeof useFilesPorts>
