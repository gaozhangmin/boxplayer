/** Native persistence boundary for the unchanged Electron category browser. */
import {computed, reactive,toRaw} from 'vue'
import {cachedArtwork,originalArtwork} from '../artworkCache'
import {useVideoCatalog, type VideoItem} from '../catalog'
import {videoGroups} from '../presentation'
import {message} from '@/features/files/adapters/sourceServices'
import type {MediaLibraryItem, DriveFileItem} from '@/features/files/electron/mediaTypes'
export function nativeFile(item:VideoItem):DriveFileItem{return {id:item.id,name:item.fileName,path:item.fileId,userId:item.sourceId,driveId:item.local?'local':item.sourceId,driveServerId:item.local?'local':item.sourceId,fileSize:item.size,height:item.height,videoDuration:item.duration?String(item.duration):undefined}}
export function originalItem(item:VideoItem,files:VideoItem[]=[item]):MediaLibraryItem{
 const result:MediaLibraryItem={...item.originalMetadata,...item,id:item.id,parentId:'',posterUrl:cachedArtwork(item.poster),backdropUrl:cachedArtwork(item.backdrop),addedAt:new Date(item.addedAt),lastWatched:item.lastWatched?new Date(item.lastWatched):undefined,watchProgress:(item.progress||0)/100,mediaSubtype:item.mediaSubtype as MediaLibraryItem['mediaSubtype'],metadataSource:item.metadataSource==='server'?undefined:item.metadataSource,networks:item.networks?.map((name,index)=>({id:index,name,logo_path:''})),driveFiles:files.map(nativeFile),collectionMovies:undefined}
 if(item.type==='tv'){
  const metadataForSeason=(number:number)=>files.flatMap(file=>file.originalMetadata?.seasons||[]).find(season=>season.seasonNumber===number)
  const metadataForEpisode=(number:number,episodeNumber:number)=>files.flatMap(file=>file.originalMetadata?.seasons||[]).filter(season=>season.seasonNumber===number).flatMap(season=>season.episodes||[]).find(episode=>episode.episodeNumber===episodeNumber)
  const seasons=new Map<number,NonNullable<MediaLibraryItem['seasons']>[number]>()
  for(const file of files){const number=file.seasonNumber||1;let season=seasons.get(number);if(!season){season={...metadataForSeason(number),id:number,seasonNumber:number,name:metadataForSeason(number)?.name||'Season '+number,episodeCount:0,episodes:[]};seasons.set(number,season)}
   const episodeNumber=file.episodeNumber||1;const episode=season.episodes!.find(episode=>episode.episodeNumber===episodeNumber)
   if(episode)episode.driveFiles.push(nativeFile(file));else {const metadata=metadataForEpisode(number,episodeNumber);season.episodes!.push({...metadata,id:episodeNumber,seasonNumber:number,episodeNumber,name:metadata?.name||file.name,overview:metadata?.overview||file.overview,driveFiles:[nativeFile(file)]})}
   season.episodeCount=season.episodes!.length
  }result.seasons=[...seasons.values()]
 }

 return result
}
export function originalLibrary(){return videoGroups(useVideoCatalog().items).map(group=>originalItem(group.item,group.files))}
export function nativeItems(items:MediaLibraryItem[]){const ids=new Set(items.flatMap(item=>[item.id,...item.driveFiles.map(file=>file.id),...(item.seasons||[]).flatMap(season=>(season.episodes||[]).flatMap(episode=>episode.driveFiles.map(file=>file.id)))]));return useVideoCatalog().items.filter(item=>ids.has(item.id))}
export function nativeItem(item:MediaLibraryItem){return useVideoCatalog().items.find(row=>item.driveFiles.some(file=>file.id===row.id))||useVideoCatalog().items.find(row=>row.id===item.id)}
export function mediaIds(id:string):string[]{const catalog=useVideoCatalog();if(catalog.items.some(item=>item.id===id))return [id];for(const group of videoGroups(catalog.items)){if(id===group.item.id)return group.files.map(item=>item.id);const suffix=id.slice(group.item.id.length).match(/^_(\d+)(?:_(\d+))?$/);if(id.startsWith(group.item.id)&&suffix)return group.files.filter(item=>item.seasonNumber===Number(suffix[1])&&(!suffix[2]||item.episodeNumber===Number(suffix[2]))).map(item=>item.id)}return []}
function persist(action:()=>Promise<unknown>){void action().catch(error=>message.error(String(error)))}
export function updateOriginal(item:MediaLibraryItem){const catalog=useVideoCatalog(),ids=nativeItems([item]).map(row=>row.id);return catalog.update(draft=>{for(const row of draft.items)if(ids.includes(row.id))Object.assign(row,{name:item.name,type:item.type,year:item.year,rating:item.rating,overview:item.overview,certification:item.certification,poster:originalArtwork(item.posterUrl),backdrop:originalArtwork(item.backdropUrl),genres:item.genres,tmdbId:item.tmdbId,metadataSource:'manual',originalMetadata:JSON.parse(JSON.stringify(toRaw(item)))})})}
export function useMediaLibraryStore(){const catalog=useVideoCatalog();const store=reactive({
 get catalogRevision(){return catalog.data.revision},get mediaItems(){return originalLibrary()},
 get watchedItems(){return catalog.items.filter(item=>item.watched).map(item=>item.id)},
 get playlists(){return catalog.data.playlists},
 set playlists(value:Record<string,string[]>){persist(()=>catalog.update(draft=>{
   const result:Record<string,string[]>={};for(const [name,ids] of Object.entries(value))result[name]=[...new Set(ids.flatMap(mediaIds))];draft.playlists=result
 }))},
 get continueWatching(){return originalLibrary().filter(item=>nativeItems([item]).some(row=>!row.continueHidden&&(row.continueAdded||Number(row.progress)>0)))},
 isFavorite(id:string){return catalog.items.some(item=>mediaIds(id).includes(item.id)&&item.favorite)},
 isWatched(id:string){const ids=mediaIds(id);return !!ids.length&&catalog.items.filter(item=>ids.includes(item.id)).every(item=>item.watched)},
 toggleFavorite(id:string){const ids=mediaIds(id),value=!store.isFavorite(id);persist(()=>catalog.update(draft=>{for(const item of draft.items)if(ids.includes(item.id))item.favorite=value}))},
 markWatched(id:string,value:boolean){const ids=mediaIds(id);persist(()=>catalog.update(draft=>{for(const item of draft.items)if(ids.includes(item.id)){item.watched=value;item.progress=value?100:0}}))},
 updateMediaItem(_id:string,item:MediaLibraryItem){persist(()=>updateOriginal(item))},
 renamePlaylist(oldName:string,name:string){persist(()=>catalog.update(draft=>{draft.playlists[name]=draft.playlists[oldName]||[];delete draft.playlists[oldName]}))},
 addPlaylist(name:string){persist(()=>catalog.update(draft=>{draft.playlists[name]||=[]}))},
 removePlaylist(name:string){persist(()=>catalog.update(draft=>{delete draft.playlists[name]}))}
 });return store}
export const isMediaWatched=(item:MediaLibraryItem,watched:string[])=>{const ids=nativeItems([item]).map(row=>row.id);return ids.length>0&&ids.every(id=>watched.includes(id))}
export function setMediaWatched(item:MediaLibraryItem,value:boolean,store:ReturnType<typeof useMediaLibraryStore>){for(const native of nativeItems([item]))store.markWatched(native.id,value)}
export function loadCustomSeries(){return Object.entries(useVideoCatalog().data.series).map(([title,ids])=>({id:encodeURIComponent(title),title,members:ids.map(id=>({id,serverId:undefined as string|undefined}))}))}
export const originalLibraryRevision=computed(()=>useVideoCatalog().data.revision)
export default {async getHomeMediaLibrary(){return originalLibrary()},async getMediaLibraryCollectionItems(item:MediaLibraryItem){return originalLibrary().filter(row=>row.collectionId===item.collectionId)}}
