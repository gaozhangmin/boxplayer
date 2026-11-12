import {computed} from 'vue'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {serverFavorite} from '@/features/sources/mediaServer'
import {readPreferences,writePreferences,putFavorite,routeKey} from '@/features/servers/preferences'
import type {MediaServerConfig} from './types'
import type {SourceEntry} from '@/features/sources/contracts'
export interface MediaServerCardItem {id:string;serverId:string;provider:string;kind:string;title:string;rawType?:string;isFavorite?:boolean;images?:{primary?:string;thumb?:string};poster?:string;collectionType?:string}
export type MediaServerLibraryNode=MediaServerCardItem
export interface MediaServerDownloadInfo {url:string;fileName:string;fileSize?:number;headers:Record<string,string>;itemId:string}
const account=(id:string)=>{const value=useFileSourcesStore().accounts.find(a=>a.id===id);if(!value)throw Error('来源不存在');return value}
const convert=(server:MediaServerConfig,row:SourceEntry):MediaServerCardItem=>({id:row.id,serverId:server.id,provider:server.type,kind:row.isDirectory?'folder':'movie',title:row.name,rawType:row.serverType,isFavorite:row.favorite})
export async function getMediaServerLibraries(server:MediaServerConfig){return (await driver(account(server.id)).list(account(server.id),'')).entries.map(row=>convert(server,row))}
export async function getMediaServerLibraryPagedItems(server:MediaServerConfig,parent:string,page:number,_options?:unknown){let cursor:string|undefined;for(let index=0;index<=page;index++){const result=await driver(account(server.id)).list(account(server.id),parent,cursor);if(index===page)return {items:result.entries.map(row=>convert(server,row)),hasNextPage:!!result.nextCursor};cursor=result.nextCursor;if(!cursor)break}return {items:[],hasNextPage:false}}
export async function updateMediaServerFavoriteState(server:MediaServerConfig,id:string,wasFavorite:boolean,_item?:MediaServerCardItem){return serverFavorite(account(server.id),id,!wasFavorite)}
export const serverFolderFavorites=computed(()=>useFileSourcesStore().accounts.flatMap(a=>readPreferences(a.id).favorites.map(f=>({item:{serverId:a.id,id:f.route.id||'__all__'}}))))
export function rememberServerFolderFavorite(server:MediaServerConfig,item:MediaServerCardItem,add:boolean){const prefs=readPreferences(server.id);const route={kind:'category' as const,category:'all' as const,id:item.id,libraryId:item.id,title:item.title};writePreferences(server.id,add?putFavorite(prefs,route,item.title):{...prefs,favorites:prefs.favorites.filter(f=>f.key!==routeKey(route))});useFileSourcesStore().refreshServerFavorites()}
export async function getMediaServerDownloadInfo(server:MediaServerConfig,id:string):Promise<MediaServerDownloadInfo>{return {url:'',headers:{},fileName:id,itemId:id}}
export const toMsCacheUrl=(_serverId:string,path:string)=>path
