import { computed,ref } from 'vue'
import {defineStore} from 'pinia'
import {nativeCall,isNative,localList} from '@/platform/native'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {serverMetadata} from '@/features/sources/serverMetadata'
import type {PlayerSnapshot} from '@/platform/contracts'
import {mediaFileNormalizer} from './mediaFileNormalizer'
import {tmdbCertification} from './tmdbCertification'
import type {TmdbRankedEntry} from './recommendations'
export interface VideoItem {originalMetadata?:import('@/features/files/electron/mediaTypes').MediaLibraryItem;id:string;sourceId:string;fileId:string;fileName:string;name:string;type:'movie'|'tv'|'unmatched';local:boolean;addedAt:string;year?:string;releaseDate?:string;rating?:number;genres:string[];certification?:string;overview?:string;poster?:string;backdrop?:string;duration?:number;mediaSubtype?:string;isMiniseries?:boolean;networks?:string[];watched?:boolean;favorite?:boolean;progress?:number;lastWatched?:string;size:number;height?:number;tmdbId?:number;collectionMovies?:VideoItem[];seriesId?:string;seriesName?:string;seasonNumber?:number;episodeNumber?:number;folderPath?:string;folderAncestors?:string[];catalogRoots?:string[];personalRating?:number;continueHidden?:boolean;continueAdded?:boolean;collectionId?:number;collectionName?:string;metadataSource?:'tmdb'|'manual'|'filename'|'server';scrapeRetrying?:boolean}
interface Snapshot{schemaVersion:1;revision:number;items:VideoItem[];playlists:Record<string,string[]>;series:Record<string,string[]>}
const blank=():Snapshot=>({schemaVersion:1,revision:0,items:[],playlists:{},series:{}})
export const useVideoCatalog=defineStore('video-catalog',()=>{
 const data=ref<Snapshot>(blank()),loading=ref(false),error=ref(''),scanning=ref(false),scanCount=ref(0),scanSource=ref('')
 const sources=useFileSourcesStore();let generation=0,scanGeneration=0;let writes=Promise.resolve()
 const dailyRanking=ref<TmdbRankedEntry[]>([]);let rankingDay=''
 async function loadRanking(){const day=new Date().toISOString().slice(0,10);if(!isNative()||rankingDay===day)return;try{const values=await Promise.all(['daily-movies','daily-tv'].map(async(kind)=>{const rows:TmdbRankedEntry[]=[];for(let page=1;page<=5;page++){const result=await nativeCall<Record<string,any>>('catalog_metadata',{kind,query:'',year:null,tmdbId:null,page});const payload=result.data??result;if(!Array.isArray(payload.results))throw new Error('每日精选响应无效');for(const row of payload.results)if(Number.isSafeInteger(row.id)&&row.id>0)rows.push({id:row.id,type:kind==='daily-movies'?'movie':'tv'});if(page>=Number(payload.total_pages||1)||!payload.results.length)break}return rows}));dailyRanking.value=values.flat();rankingDay=day}catch{/* Electron daily picks can rotate matched catalog entries while ranking is offline. */}}
 async function load(){if(!isNative())return;const current=++generation;loading.value=true;try{const result=await nativeCall<Snapshot>('catalog_load');if(current===generation){data.value=result;error.value=''}}catch(e){if(current===generation)error.value=(e as Error).message}finally{if(current===generation)loading.value=false}}
 function update(action:(draft:Snapshot)=>void,stillCurrent:()=>boolean=()=>true){
  const work=writes.then(async()=>{
   if(!stillCurrent())return
   if(!isNative())throw new Error('请在Tauri应用中操作媒体库')
   for(let attempt=0;attempt<3;attempt++){
    const fresh=await nativeCall<Snapshot>('catalog_load');if(!stillCurrent())return;const draft=structuredClone(fresh);action(draft)
    try{const saved=await nativeCall<Snapshot>('catalog_save',{expectedRevision:fresh.revision,catalog:draft});generation++;data.value=saved;error.value='';return}
    catch(cause){if((cause as {code?:string}).code!=='CATALOG_CONFLICT'||attempt===2)throw cause}
   }
  });writes=work.catch(()=>{});return work
 }

 function patch(id:string,patch:Partial<VideoItem>){return update(draft=>{const item=draft.items.find(item=>item.id===id);if(!item)throw new Error('媒体条目已移除');Object.assign(item,patch)})}
 function remove(id:string){return update(draft=>{draft.items=draft.items.filter(item=>item.id!==id);for(const group of [draft.playlists,draft.series])for(const name of Object.keys(group))group[name]=group[name]!.filter(member=>member!==id)})}
 function collection(kind:'playlists'|'series',name:string,ids:string[]){name=name.trim();if(!name)return Promise.reject(new Error('请输入名称'));return update(draft=>{const known=new Set(draft.items.map(item=>item.id));draft[kind][name]=[...new Set([...(draft[kind][name]||[]),...ids.filter(id=>known.has(id))])]})}
 function cancelScan(){scanGeneration++;scanning.value=false}
 async function scan(sourceId:string,rootPath=''){
  if(scanning.value)throw new Error('已有扫描任务');const current=++scanGeneration;scanning.value=true;scanSource.value=sourceId;scanCount.value=0;error.value=''
  try{await sources.refresh();const local=sources.snapshot.localFolders.some(source=>source.id===sourceId);const account=sources.accounts.find(account=>account.id===sourceId);if(!local&&!account)throw new Error('来源已移除')
   await load();if(current!==scanGeneration)return;const previousFiles=new Map(data.value.items.map(item=>[item.id,item]));
   const pending=[rootPath],parents=new Map<string,string[]>([[rootPath,[]]]),visited=new Set<string>(),found:VideoItem[]=[];const seen=new Set<string>();const addedAt=new Date().toISOString()
   while(pending.length){if(current!==scanGeneration)return;const parent=pending.shift()!;if(visited.has(parent))continue;visited.add(parent);if(visited.size>10000)throw new Error('目录超过扫描上限，请选择更小的来源')
    let cursor:string|undefined;const cursors=new Set<string>();do{
     if(current!==scanGeneration)return
     const page=local?await localList(sourceId,parent):await driver(account!).list(account!,parent,cursor)
     for(const row of page.entries){if(current!==scanGeneration)return;if(row.isDirectory){const child='relativePath'in row?row.relativePath:row.id;pending.push(child);if(!parents.has(child))parents.set(child,[...(parents.get(parent)||[]),parent]);continue}if(!row.playable)continue
      const fileId='relativePath'in row?row.relativePath:row.id;const id=JSON.stringify([sourceId,row.id]);if(seen.has(id))continue;seen.add(id)
      const item:VideoItem={id,sourceId,fileId,fileName:row.name,name:row.name,type:'unmatched',local,addedAt,genres:[],size:row.size,folderPath:parent,folderAncestors:[...(parents.get(parent)||[]),parent],catalogRoots:[rootPath]}
      const previous=previousFiles.get(id)
      if(previous&&previous.size===row.size&&!previous.scrapeRetrying){Object.assign(item,structuredClone(JSON.parse(JSON.stringify(previous))),{fileName:row.name,fileId,size:row.size,folderPath:parent,folderAncestors:[...(parents.get(parent)||[]),parent],catalogRoots:[rootPath]})}
      else if(account&&['jellyfin','emby','plex'].includes(account.providerId)){
       const info=await serverMetadata(account,row.id);Object.assign(item,info);item.metadataSource='server'
      }else{
       const normalized=mediaFileNormalizer.normalize(row.name,parent);item.seasonNumber=normalized.seasonNumber;item.episodeNumber=normalized.episodeNumber
       if(normalized.searchTitle){try{const payload=await nativeCall<Record<string,any>>('catalog_metadata',{kind:normalized.episodeNumber!==undefined?'tv':'movie',query:normalized.searchTitle,year:normalized.releaseYear?String(normalized.releaseYear):null,tmdbId:null});const result=payload.data??payload;const info=result.tv||result;if(payload.code!==undefined&&payload.code!==0){if(payload.code!==404)throw new Error('元数据服务暂不可用')}else if(info?.id){applyMetadata(item,info,normalized.episodeNumber!==undefined);if(item.type==='tv'&&item.seasonNumber!==undefined){const seasonResponse=await nativeCall<Record<string,any>>('catalog_metadata',{kind:'tv',query:'',year:null,tmdbId:String(item.tmdbId),season:item.seasonNumber});if(seasonResponse.code!==undefined&&seasonResponse.code!==0)throw new Error('季集元数据暂不可用');const seasonData=seasonResponse.data??seasonResponse;const details=seasonData.current_season||seasonData;const episode=(details.episodes||[]).find((entry:any)=>entry.episode_number===item.episodeNumber);item.originalMetadata={...item.originalMetadata!,seasons:[{id:Number(details.id||item.seasonNumber),seasonNumber:item.seasonNumber,name:details.name||'Season '+item.seasonNumber,episodeCount:details.episode_count||details.episodes?.length||0,overview:details.overview,posterPath:details.poster_path,airDate:details.air_date,credits:details.credits,episodes:episode?[{id:episode.id,seasonNumber:item.seasonNumber,episodeNumber:episode.episode_number,name:episode.name,overview:episode.overview,stillPath:episode.still_path,airDate:episode.air_date,runtime:episode.runtime,crew:episode.crew,driveFiles:[]}]:[]}]};if(episode?.runtime)item.duration=episode.runtime*60}}}catch{item.scrapeRetrying=true}}
      }
      if(current!==scanGeneration)return
      found.push(item);scanCount.value=found.length;if(found.length>100000)throw new Error('媒体数量超过上限，请缩小扫描范围')
     }
     cursor='nextCursor'in page?page.nextCursor:undefined;if(cursor){if(cursors.has(cursor))throw new Error('来源分页重复，扫描已停止');cursors.add(cursor)}
    }while(cursor)
   }
   if(current!==scanGeneration)return
   await sources.refresh();if(current!==scanGeneration)return;if(!sources.snapshot.localFolders.some(source=>source.id===sourceId)&&!sources.accounts.some(account=>account.id===sourceId))throw new Error('扫描期间来源已移除')
   await update(draft=>{const existing=new Map(draft.items.map(item=>[item.id,item]));for(const item of found){const previous=existing.get(item.id);if(previous){item.addedAt=previous.addedAt;item.watched=previous.watched??item.watched;item.favorite=previous.favorite??item.favorite;item.progress=previous.progress;item.lastWatched=previous.lastWatched;item.personalRating=previous.personalRating;item.continueHidden=previous.continueHidden;item.continueAdded=previous.continueAdded;item.catalogRoots=[...new Set([...(previous.catalogRoots||['']),rootPath])];if(previous.metadataSource==='manual'||previous.type!=='unmatched'&&item.type==='unmatched')Object.assign(item,{...previous,size:item.size,catalogRoots:item.catalogRoots,folderPath:item.folderPath,folderAncestors:item.folderAncestors})}existing.set(item.id,item)}const foundIds=new Set(found.map(item=>item.id));const removed=new Set<string>();
    for(const [id,item]of existing){if(item.sourceId!==sourceId||foundIds.has(id))continue;const roots=item.catalogRoots||[''];if(!roots.includes(rootPath))continue;item.catalogRoots=roots.filter(root=>root!==rootPath);if(!item.catalogRoots.length){existing.delete(id);removed.add(id)}}
    draft.items=[...existing.values()];for(const groups of [draft.playlists,draft.series])for(const name of Object.keys(groups))groups[name]=groups[name]!.filter(id=>!removed.has(id))
   },()=>current===scanGeneration)
   return current===scanGeneration
  }catch(e){if(current===scanGeneration){error.value=(e as Error).message;throw e}}finally{if(current===scanGeneration)scanning.value=false}
 }
 async function scanFolder(sourceId:string,path:string){
  const account=sources.accounts.find(account=>account.id===sourceId);if(account&&['jellyfin','emby','plex'].includes(account.providerId))throw new Error('媒体服务器使用服务端元数据，不执行目录刮削')
  const covered=data.value.items.filter(item=>item.sourceId===sourceId&&(item.folderPath===path||item.folderAncestors?.includes(path)||path===''))
  if(covered.length&&covered.some(item=>(item.catalogRoots||['']).some(root=>root===path||root===''||item.folderAncestors?.includes(root))))return update(draft=>{for(const item of draft.items)if(covered.some(value=>value.id===item.id))item.catalogRoots=[...new Set([...(item.catalogRoots||['']),path])]})
  return scan(sourceId,path)
 }
 function removeFolder(sourceId:string,path:string){return update(draft=>{
  const removed=new Set<string>();draft.items=draft.items.filter(item=>{if(item.sourceId!==sourceId)return true;const roots=item.catalogRoots||[''];item.catalogRoots=roots.filter(root=>root!==path);const belongs=item.folderPath===path||item.folderAncestors?.includes(path)||path==='';if(belongs&&!item.catalogRoots.length){removed.add(item.id);return false}return true})
  for(const groups of [draft.playlists,draft.series])for(const name of Object.keys(groups))groups[name]=groups[name]!.filter(id=>!removed.has(id))
 })}
 async function play(item:VideoItem,siblings:VideoItem[]=[item]){const rows=siblings.some(value=>value.id===item.id)?siblings:[item];await nativeCall('player_open_catalog_queue',{entries:rows.map(value=>({sourceId:value.sourceId,fileId:value.fileId,title:value.seriesName?`${value.seriesName} · ${value.name}`:value.name,local:value.local})),index:rows.findIndex(value=>value.id===item.id),loopPlayback:false})}
 async function playMany(items:VideoItem[],mode:'play'|'loop'|'shuffle'='play'){
  const rows=[...items];if(!rows.length)throw new Error('没有可播放的视频');if(rows.length>1000)throw new Error('播放列表超过1000项，请缩小范围')
  if(mode==='shuffle')for(let index=rows.length-1;index>0;index--){const target=Math.floor(Math.random()*(index+1));[rows[index],rows[target]]=[rows[target]!,rows[index]!]}
  await nativeCall('player_open_catalog_queue',{entries:rows.map(item=>({sourceId:item.sourceId,fileId:item.fileId,title:item.seriesName?`${item.seriesName} · ${item.name}`:item.name,local:item.local})),index:0,loopPlayback:mode==='loop'})
 }
 let lastProgressKey='',lastProgressTime=0
 async function recordProgress(snapshot:PlayerSnapshot){
  if(!Number.isFinite(snapshot.duration)||!Number.isFinite(snapshot.position)||snapshot.duration<=0||snapshot.position<0||!['playing','paused','ended'].includes(snapshot.state))return
  const item=data.value.items.find(item=>item.sourceId===snapshot.sourceId&&(item.fileId===snapshot.itemId||item.id===JSON.stringify([snapshot.sourceId,snapshot.itemId])));if(!item)return
  const now=Date.now(),key=snapshot.sessionId+':'+snapshot.state
  if(key===lastProgressKey&&now-lastProgressTime<15000)return
  lastProgressKey=key;lastProgressTime=now
  const progress=Math.min(100,Math.max(0,snapshot.position/snapshot.duration*100))
  await patch(item.id,{progress,lastWatched:new Date().toISOString(),watched:snapshot.state==='ended'||progress>=90?true:item.watched})
 }
 const items=computed(()=>data.value.items)
 return{data,items,loading,error,scanning,scanCount,scanSource,dailyRanking,loadRanking,load,update,patch,remove,collection,scan,scanFolder,removeFolder,cancelScan,play,playMany,recordProgress}
})
export function applyMetadata(item:VideoItem,info:Record<string,any>,tv:boolean){
 item.backdrop=info.backdrop_path?'https://api.xbyvideohub.com/api/tmdb/image/w780/'+String(info.backdrop_path).replace(/^\//,''):undefined;item.duration=Number(info.runtime||info.episode_run_time?.[0]||0)*60||item.duration;item.tmdbId=Number(info.id);item.name=info.title||info.name||item.name;item.type=tv?'tv':'movie';item.metadataSource='tmdb';item.year=String(info.release_date||info.first_air_date||'').slice(0,4)||item.year;item.releaseDate=info.release_date||info.first_air_date;item.rating=typeof info.vote_average==='number'?info.vote_average:undefined;item.overview=info.overview;item.genres=(info.genres||[]).map((genre:any)=>typeof genre==='string'?genre:genre.name).filter(Boolean);item.poster=info.poster_path?'https://api.xbyvideohub.com/api/tmdb/image/w500/'+String(info.poster_path).replace(/^\//,''):undefined;item.certification=tmdbCertification(info,tv);item.networks=(info.networks||[]).map((network:any)=>network.name);item.isMiniseries=info.type==='Miniseries';item.collectionId=info.belongs_to_collection?.id;item.collectionName=info.belongs_to_collection?.name;item.scrapeRetrying=false;item.originalMetadata={...(item.originalMetadata||{}),id:item.id,parentId:'',type:item.type,name:item.name,genres:item.genres,addedAt:new Date(item.addedAt),driveFiles:[],credits:info.credits,productionCountries:(info.production_countries||[]).map((country:any)=>country.name||country.iso_3166_1).filter(Boolean),logoUrl:info.logo_path?'https://api.xbyvideohub.com/api/tmdb/image/w500/'+String(info.logo_path).replace(/^\//,''):item.originalMetadata?.logoUrl,expectedSeasons:tv?(info.seasons||[]).filter((season:any)=>season.season_number>0).map((season:any)=>({seasonNumber:season.season_number,episodeCount:season.episode_count||0,airDate:season.air_date})):undefined}
}
