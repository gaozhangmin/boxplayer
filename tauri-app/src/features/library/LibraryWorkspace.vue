<script setup lang="ts">
import {cachedArtwork} from './artworkCache'
import {computed,onMounted,onUnmounted,ref,watch,toRaw,nextTick} from 'vue'
import {Film,Folder,Play,Library,Star,Eye,EyeOff,Grid2X2,List,RefreshCw,MoreHorizontal,ChevronLeft,ChevronDown,ArrowDown,ArrowUp,Search,Plus,X} from 'lucide-vue-next'
import UnifiedMediaRow from './electron/UnifiedMediaRow.vue'
import type {UnifiedLibraryRow,UnifiedLibraryCard} from './electron/types'
import FavoriteArtwork from './FavoriteArtwork.vue'
import HomeManagement from './electron/UnifiedHomeManagement.vue'
import UnifiedLibraryBrowser from './electron/UnifiedLibraryBrowser.vue'
import MediaDetail from './electron/MediaDetail.vue'
import MediaMetadataEditorModal from '@/features/files/electron/MediaMetadataEditorModal.vue'
import MediaPersonalRatingModal from '@/features/files/electron/MediaPersonalRatingModal.vue'
import MediaShareModal from '@/features/files/electron/MediaShareModal.vue'
import {openMediaShare as openOriginalMediaShare} from '@/features/files/electron/mediaShare'
function nativeFileForShare(item:VideoItem){return {id:item.fileId,name:item.fileName,path:item.fileId,userId:item.sourceId,driveId:item.local?'local':item.sourceId,driveServerId:item.local?'local':item.sourceId,fileSize:item.size}}
import MediaCollectionPicker from '@/features/files/electron/MediaCollectionPicker.vue'
import CustomMediaSeriesModal from './electron/CustomMediaSeriesModal.vue'
import {openCustomSeries} from './adapters/customSeries'
import HomeShelfViewport from './electron/HomeShelfViewport.vue'
import MediaServerIcon from '@/features/files/electron/MediaServerIcon.vue'
import SourceEmptyState from '@/features/files/electron/SourceEmptyState.vue'
import MediaLoadingIndicator from '@/features/files/electron/MediaLoadingIndicator.vue'
import LibraryObjectActions from './electron/LibraryObjectActions.vue'
import {originalItem,originalLibrary,nativeItem,nativeItems,updateOriginal} from './adapters/libraryData'
import type {MediaLibraryItem} from '@/features/files/electron/mediaTypes'
import {libraryPlaylistMembers,libraryMovieSeries} from './electron/unifiedLibraryCategories'
import {movieVersionItems} from './electron/seriesVersionPreferences'
import {loadCustomSeries} from './adapters/customSeries'
type Card=UnifiedLibraryCard
type Row=UnifiedLibraryRow
import {t} from '@/features/files/electron/i18n'
import UnifiedFilesPage from '@/features/files/electron/UnifiedFilesPage.vue'
import NativeFilesDialogs from '@/features/files/adapters/NativeFilesDialogs.vue'
import traktLogo from './trakt-logo.svg'
import ServerHomeSections from '@/features/servers/ServerHomeSections.vue'
import TraktAccount from './electron/TraktAccountModal.vue'
import TraktAvatar from './electron/TraktAvatar.vue'
import {traktAccount} from '@/features/trakt/client'
import {Ellipsis,Move,House,Pencil,SquareCheck,Shuffle,ListFilter} from 'lucide-vue-next'
import {nextMediaBrowseSort} from './electron/mediaBrowseSort'
import {loadTraktStatus,traktStatus,syncTrakt,type PlaybackProgress} from '@/features/trakt/client'
import {playbackPatches} from '@/features/trakt/progress'
import {libraryCategoryIcon as originalLibraryCategoryIcon} from './electron/libraryCategoryIcon'
function libraryCategoryIcon(route:string){return route.startsWith('source:folder:')||route.startsWith('root:')?Star:originalLibraryCategoryIcon(route)}
import type {BrowseRoute} from '@/features/servers/workspace'
import WorkspaceContextMenu from './WorkspaceContextMenu.vue'
import {posterMenu,objectMenu,playbackItems,orderedWorkspaceVersions,rootCategories,categoryLabels,appendMembers,renameCollection,moveMember,type WorkspaceVideo,type MenuEntry} from './workspaceMenus'
import {seriesPreferences,generalPreferences,setDisplayPreference} from './displayPreferences'
import {serverMetadata} from '@/features/sources/serverMetadata'
import SourceCardMenu from '@/features/files/SourceCardMenu.vue'
import SourceManager from '@/features/sources/SourceManager.vue'
import ServerArtwork from '@/features/servers/ServerArtwork.vue'
import ServerFavoriteMenu from '@/features/servers/ServerFavoriteMenu.vue'
import {readPreferences,writePreferences,type Favorite} from '@/features/servers/preferences'
import type {Account} from '@/features/sources/contracts'
import {sourceCardKey,reorderSourceSlots,serverLibraryStatistics} from './workspaceIntegration'
import {movieCollections} from './collectionModel'
import {useLibraryNavigation} from '@/stores/libraryNavigation'
import {nativeCall,addLocalSource,isNative} from '@/platform/native'
import {fileThumbnail} from '@/features/files/thumbnails'
import {Button} from '@/components/ui/button'
import {useVideoCatalog,applyMetadata,type VideoItem} from './catalog'
import {libraryTitle,videoLibraryRoutes,homeRouteTitle} from './navigation'
import {compareMediaBrowseValues,type MediaBrowseSort} from './mediaBrowseSort'
import {videoGroups} from './presentation'
import {categoryItems,categoryGroups} from './categories'
import {matchDailyLibraryRanking} from './recommendations'
import usePlacement from '@/stores/categoryPlacement'
import useBookmarks from '@/stores/unifiedLibraryBookmarks'
import useHome from '@/stores/unifiedHomePreferences'
import {categoryRouteForHomeId,libraryHomeId,type CategoryPlacementAction} from './categoryPlacement'
import {visibleHomeItems,withFixedHomeMenus,type HomeManagementItem,type UnifiedHomeSettings,type HomeManagementGroup,type HomeManagementNode,moveHomeItem,isHomeItemEnabled,orderedHomeItems} from './unifiedHomeManagement'
import {useFileSourcesStore} from '@/stores/fileSources'
import {supportsSourceShare,createSourceShare} from '@/features/sources/share'
import {serverFavorite} from '@/features/sources/mediaServer'
import {endpoint,request} from '@/features/sources/transport'
const props=defineProps<{route:string;query?:string;toolbarTarget?:string;origin?:'home'|'library'}>()
const toolbarReady=ref(false)
onMounted(()=>{toolbarReady.value=true})
const emit=defineEmits<{navigate:[route:string,origin?:'home'|'library'];source:[id:string];folder:[value:{sourceId:string;path:string;local:boolean;favoriteId:string}];server:[id:string,route:BrowseRoute];title:[title:string]}>()
const catalog=useVideoCatalog(),sources=useFileSourcesStore(),placement=usePlacement(),home=useHome(),bookmarks=useBookmarks()
const mode=ref<'grid'|'list'>('grid'),sort=ref<MediaBrowseSort>('title'),descending=ref(false),explicitSort=ref(false),localOnly=ref(false),selectionMode=ref(false),detail=ref<string>(),selected=ref<string[]>([]),error=ref(''),busy=ref(false),menu=ref(false),manageHome=ref(false),scanPicker=ref(false)
try{mode.value=localStorage.getItem('MediaLibrary_BrowseMode')==='list'?'list':'grid'}catch{}
watch(mode,value=>{try{if(localStorage.getItem('MediaLibrary_BrowseMode')!==value){localStorage.setItem('MediaLibrary_BrowseMode',value);window.dispatchEvent(new Event('boxplayer:browse-mode-changed'))}}catch{}})
function syncMode(){try{mode.value=localStorage.getItem('MediaLibrary_BrowseMode')==='list'?'list':'grid'}catch{}}
function storageMode(event:StorageEvent){if(event.key==='MediaLibrary_BrowseMode')syncMode()}
onMounted(()=>{window.addEventListener('boxplayer:browse-mode-changed',syncMode);window.addEventListener('storage',storageMode)})
onUnmounted(()=>{window.removeEventListener('boxplayer:browse-mode-changed',syncMode);window.removeEventListener('storage',storageMode)})
const prompt=ref<{kind:'rating'|'renameCollection'|'deleteCollection'|'playlist'|'series'|'rename'|'home'|'favorite'|'remove'|'homeTitle';value:string;route?:string;ids?:string[]}>()
const sourceContext=ref<{sourceId:string;favoriteId?:string;x:number;y:number}>(),showSourceManager=ref(false)
const serverFavoriteContext=ref<{account:Account;favorite:Favorite;x:number;y:number}>()
const serverPreferenceRevision=ref(0)
function refreshServerPreferences(){serverPreferenceRevision.value++}
function preferenceStorage(event:StorageEvent){if(event.key===null||event.key.startsWith('boxplayer:server-workspace:'))refreshServerPreferences()}
onMounted(()=>{window.addEventListener('boxplayer:server-home-changed',refreshServerPreferences);window.addEventListener('storage',preferenceStorage)})
onUnmounted(()=>{window.removeEventListener('boxplayer:server-home-changed',refreshServerPreferences);window.removeEventListener('storage',preferenceStorage)})
const serverStatistics=ref<{id:string;movies?:number;tv?:number;error?:string}[]>([]),statisticsLoading=ref(false)
let statisticsGeneration=0
async function loadStatistics(){const generation=++statisticsGeneration;statisticsLoading.value=true;const accounts=sources.accounts.filter(a=>['jellyfin','emby','plex'].includes(a.providerId)&&readPreferences(a.id).libraryMode!==false);serverStatistics.value=serverStatistics.value.filter(stat=>accounts.some(a=>a.id===stat.id));const results=await Promise.all(accounts.map(async account=>{try{return {id:account.id,...await serverLibraryStatistics(account)}}catch(cause){return {id:account.id,error:sourceName(account.id)+': '+(cause as Error).message}}}));if(generation===statisticsGeneration){serverStatistics.value=results;statisticsLoading.value=false}}
watch(()=>[props.route,sources.accounts.map(a=>[a.id,a.baseUrl,a.userId].join(':')).join('|')],()=>{if(props.route==='library')void loadStatistics();else{statisticsGeneration++;statisticsLoading.value=false}},{immediate:true})
onUnmounted(()=>{statisticsGeneration++})
const libraryStatistics=computed(()=>{const serverIds=new Set(sources.accounts.filter(a=>['jellyfin','emby','plex'].includes(a.providerId)).map(a=>a.id));const local=catalog.items.filter(item=>!serverIds.has(item.sourceId));return [{title:'电影',count:videoGroups(local.filter(i=>i.type==='movie')).length+serverStatistics.value.reduce((n,s)=>n+(s.movies||0),0)},{title:'电视',count:videoGroups(local.filter(i=>i.type==='tv')).length+serverStatistics.value.reduce((n,s)=>n+(s.tv||0),0)},{title:'其他',count:local.filter(i=>i.type==='unmatched').length}]})
const pendingSelection=ref<string[]>()
const assignment=ref<{kind:'playlist'|'series';ids:string[];selected:string[];name:string}>()
function assignCollection(kind:'playlist'|'series',ids:string[]){const groups=kind==='playlist'?catalog.data.playlists:catalog.data.series;assignment.value={kind,ids,selected:Object.keys(groups).filter(name=>ids.length>0&&ids.every(id=>groups[name]?.includes(id))),name:''}}
async function saveAssignment(){const value=assignment.value;if(!value)return;await run(()=>catalog.update(draft=>{const groups=draft[value.kind==='playlist'?'playlists':'series'];for(const name of Object.keys(groups)){if(value.selected.includes(name))appendMembers(groups,name,value.ids);else groups[name]=groups[name]!.filter(id=>!value.ids.includes(id))}if(value.name.trim())appendMembers(groups,value.name,value.ids)}));if(!error.value)assignment.value=undefined}
const playlistAssignment=computed({get:()=>assignment.value?.kind==='playlist'?assignment.value:undefined,set:(value)=>{if(!value)assignment.value=undefined}})
const playlistCreateName=computed({get:()=>assignment.value?.name||'',set:value=>{if(assignment.value)assignment.value.name=value}})
function savePlaylistAssignment(){void saveAssignment()}
const objectPrompt=computed({get:()=>prompt.value&&['renameCollection','deleteCollection'].includes(prompt.value.kind)?{route:prompt.value.route||'',action:prompt.value.kind==='deleteCollection'?'delete':'rename',get value(){return prompt.value?.value||''},set value(value:string){if(prompt.value)prompt.value.value=value}}:undefined,set:value=>{if(!value)prompt.value=undefined}})
const catalogPlacement=computed({get:()=>prompt.value&&['home','favorite','rename'].includes(prompt.value.kind)?{action:prompt.value.kind,get name(){return prompt.value?.value||''},set name(value:string){if(prompt.value)prompt.value.value=value}}:undefined,set:value=>{if(!value)prompt.value=undefined}})
const categoryFavoriteQueue=ref<string[]>([])
function saveObjectPrompt(){void savePrompt()}
function saveCatalogPlacement(){void savePrompt()}
const renameVisible=computed({get:()=>prompt.value?.kind==='homeTitle',set:value=>{if(!value)prompt.value=undefined}})
const renameText=computed({get:()=>prompt.value?.value||'',set:value=>{if(prompt.value)prompt.value.value=value}})
function saveCollectionName(){void savePrompt()}
const editing=ref<VideoItem>()
const metadataTarget=computed(()=>editing.value?originalItem(editing.value):{id:'',parentId:'',name:'',type:'unmatched' as const,genres:[],driveFiles:[],addedAt:new Date(0)})
async function saveOriginalMetadata(item:MediaLibraryItem){await updateOriginal(item);editing.value=undefined}

const sharing=ref<VideoItem>(),shareCopied=ref(false),shareFile=ref(''),shareResult=ref('')
const shareFiles=computed(()=>{if(!sharing.value)return [];return (videoGroups(catalog.items).find(group=>group.files.some(item=>item.id===sharing.value!.id))?.files||[sharing.value]).flatMap(item=>{const account=sources.accounts.find(account=>account.id===item.sourceId);return !item.local&&account&&supportsSourceShare(account)?[{item,account}]:[]})})
async function createShare(){const target=sharing.value,candidate=shareFiles.value.find(value=>value.item.id===shareFile.value)||shareFiles.value[0];if(!target||!candidate)return;await run(async()=>{const result=await createSourceShare(candidate.account,candidate.item.fileId,target.name);if(sharing.value?.id===target.id){shareResult.value=[shareText.value,result.url,result.password?'提取码：'+result.password:''].filter(Boolean).join('\n');shareCopied.value=false}})}
const shareText=computed(()=>sharing.value?[sharing.value.name,sharing.value.year,sharing.value.rating?'评分：'+sharing.value.rating:'',sharing.value.overview].filter(Boolean).join('\n'):'')
async function copyShare(){await run(async()=>{await navigator.clipboard.writeText(shareResult.value||shareText.value);shareCopied.value=true})}
const navigation=useLibraryNavigation()
function playItems(items:VideoItem[],mode:'play'|'loop'|'shuffle'){const preference=seriesPreferences.playbackVersion==='auto'?seriesPreferences.defaultVersion:seriesPreferences.playbackVersion;return catalog.playMany(playbackItems(items,preference),mode)}
async function playFrom(item:VideoItem[],selected:VideoItem){const preference=seriesPreferences.playbackVersion==='auto'?seriesPreferences.defaultVersion:seriesPreferences.playbackVersion;const rows=playbackItems(item,preference),chosen=rows.find(value=>value.id===selected.id||value.type==='movie'&&!!selected.tmdbId&&value.tmdbId===selected.tmdbId||value.type==='tv'&&!!selected.tmdbId&&value.tmdbId===selected.tmdbId&&value.seasonNumber===selected.seasonNumber&&value.episodeNumber===selected.episodeNumber)||selected;return catalog.play(chosen,rows)}
async function importTrakt(records:PlaybackProgress[]){await run(()=>catalog.update(draft=>{for(const {id,patch} of playbackPatches(draft.items,records,traktStatus.value.settings.range)){const item=draft.items.find(i=>i.id===id);if(item)Object.assign(item,patch)}}))}
async function syncPersonal(items:VideoItem[],action:'watchlist-add'|'watchlist-remove'|'rating'|'rating-remove',rating?:number){await loadTraktStatus();if(!traktStatus.value.connected||!traktStatus.value.settings.enabled)return;for(const item of [...new Map(items.map(item=>[item.type+':'+item.tmdbId,item])).values()])await syncTrakt({type:item.type==='tv'?'tv':'movie',tmdbId:item.tmdbId},action,rating)}
const context=ref<{x:number;y:number;route:string;item?:VideoItem;toolbar?:boolean;detailMenu?:boolean}>()
const favoriteTitleSort=ref(localStorage.getItem('boxplayer:favorite-cards-sort-title')==='true')
function setFavoriteTitleSort(value:boolean){favoriteTitleSort.value=value;localStorage.setItem('boxplayer:favorite-cards-sort-title',String(value))}
const favoriteReordering=ref(false),draggedFavorite=ref('')
function dropFavorite(key:string){if(!draggedFavorite.value||draggedFavorite.value===key)return;const keys=favoriteCards.value.map(card=>card.key),from=keys.indexOf(draggedFavorite.value),to=keys.indexOf(key);if(from<0||to<0)return;keys.splice(to,0,keys.splice(from,1)[0]!);void run(async()=>{await placement.reorderFavorites(keys);syncSourceOrder(keys)});draggedFavorite.value=''}
const reorderRoute=ref(''),traktVisible=ref(false)
const coverOffsets=ref<Record<string,number>>({})
try{coverOffsets.value=JSON.parse(localStorage.getItem('video-library-cover-offsets')||'{}')}catch{}
const librarySourceGroups=computed(()=>{const local=sources.snapshot.localFolders.map(source=>({id:source.id,name:source.name}));const folders=sources.preferences.favorites.filter(folder=>!folder.local).map(folder=>({id:folder.sourceId,name:folder.name}));const servers=sources.accounts.filter(a=>['jellyfin','emby','plex'].includes(a.providerId));return [...(local.length?[{title:'本地目录',sources:local}]:[]),...(folders.length?[{title:'网盘目录',sources:folders}]:[]),...servers.map(server=>({title:server.name,sources:[{id:server.id,name:'在主屏幕显示'}]}))]})
const sourceOptions=computed(()=>[...sources.snapshot.localFolders,...sources.accounts.filter(a=>a.providerId!=='boxplayer')])
function isServer(item:VideoItem){return sources.accounts.some(a=>a.id===item.sourceId&&['jellyfin','emby','plex'].includes(a.providerId))}
function openContext(event:MouseEvent,route:string,item?:VideoItem,toolbar=false,detailMenu=false){event.preventDefault();const box=toolbar?(event.currentTarget as HTMLElement).getBoundingClientRect():undefined;context.value={x:box?box.right-220:event.clientX,y:box?box.bottom+6:event.clientY,route,item,toolbar,detailMenu};sourceContext.value=undefined;serverFavoriteContext.value=undefined;menu.value=false}
const sortLabels:Record<string,string>={title:'片名',fileName:'文件名',addedAt:'添加日期',premiereDate:'上映日期'}
const sortContext=ref<{x:number;y:number}>()
function selectSort(value:string){const next=value as MediaBrowseSort;if(next===sort.value)descending.value=!descending.value;else {sort.value=next;descending.value=['addedAt','premiereDate'].includes(next)}explicitSort.value=true;sortContext.value=undefined}
const legacyHomePage=computed(()=>props.origin==='home'&&['recent','unwatched','daily','other'].includes(props.route))
const contextEntries=computed<MenuEntry[]>(()=>context.value?.item?posterMenu(context.value.item,isServer(context.value.item),context.value.route.startsWith('playlist/')?'playlist':context.value.route.startsWith('custom-series/')?'series':false,context.value.detailMenu):context.value?.route==='library-shortcuts'&&context.value.toolbar?[{id:'select',label:'选择',disabled:true},{id:'nextSort',label:'排序方式: '+sortLabels[sort.value]},...['play','loop','shuffle'].map(id=>({id,label:{play:'播放',loop:'循环播放',shuffle:'随机播放'}[id]!,disabled:true})),...objectMenu('library-shortcuts',placement.state('library-shortcuts').placed,true)]:context.value?.route==='favorites'?[{id:'favoriteTitle',label:'排序方式: 片名'},{id:'hideFavorites',label:'从主页移除'},{id:'renameFavorites',label:'重命名收藏夹'},{id:'favoriteOrder',label:'重新排序'}]:context.value?[...(context.value.toolbar&&legacyHomePage.value?[{id:'select',label:'选择',disabled:props.route==='daily'}]:[]),...(context.value.toolbar&&(isCatalogMediaPage.value||legacyHomePage.value)?[{id:'nextSort',label:'排序方式: '+sortLabels[sort.value]}]:[]),...(context.value.toolbar&&legacyHomePage.value?['play','loop','shuffle'].map(id=>({id,label:{play:'播放',loop:'循环播放',shuffle:'随机播放'}[id]!,disabled:props.route==='daily'})):[]),...objectMenu(context.value.route,placement.state(context.value.route).placed,context.value.toolbar)]:[])
function collectionAddress(route:string){const [root,...parts]=route.split('/');return {kind:root==='playlist'?'playlists' as const:'series' as const,name:decode(parts.join('/'))}}
function cover(route:string){const posters=[...new Set(filter(route).map(i=>i.poster).filter((v):v is string=>!!v))];return posters[(coverOffsets.value[route]||0)%posters.length]}
function cycleCover(route:string){if(new Set(filter(route).map(i=>i.poster).filter(Boolean)).size<2)throw new Error('至少需要两张可用海报才能轮换封面');coverOffsets.value={...coverOffsets.value,[route]:(coverOffsets.value[route]||0)+1};localStorage.setItem('video-library-cover-offsets',JSON.stringify(coverOffsets.value))}
function placeRoute(route:string,action:CategoryPlacementAction){if(action==='remove'||action==='removeFavorite')void run(()=>placement.change(route,action));else prompt.value={kind:action==='rename'?'rename':action,value:routeLabel(route),route}}
async function refreshMetadata(items:VideoItem[]){for(const target of items){if(isServer(target)){const account=sources.accounts.find(a=>a.id===target.sourceId)!;await catalog.patch(target.id,{...await serverMetadata(account,target.fileId),metadataSource:'server'});continue}if(target.metadataSource==='manual')continue;const response=await nativeCall<Record<string,any>>('catalog_metadata',{kind:target.type==='tv'?'tv':'movie',query:target.name,year:target.year||null,tmdbId:target.tmdbId?String(target.tmdbId):null,page:null});const metadata=response.data??response;if(!metadata.id)throw new Error('未找到元数据：'+target.name);const item={...target};applyMetadata(item,metadata,target.type==='tv');await catalog.patch(item.id,item)}}
async function refreshLibrary(){
 const failures:string[]=[],roots=new Map<string,Set<string>>()
 for(const source of sources.snapshot.localFolders)if(!sources.preferences.hiddenLocalRoots[source.id])roots.set(source.id,new Set(['']))
 for(const folder of sources.preferences.favorites){const account=sources.accounts.find(account=>account.id===folder.sourceId);if(account&&['jellyfin','emby','plex'].includes(account.providerId))continue;const paths=roots.get(folder.sourceId)||new Set<string>();paths.add(folder.path);roots.set(folder.sourceId,paths)}
 for(const item of catalog.items){if(isServer(item))continue;const paths=roots.get(item.sourceId)||new Set<string>();for(const path of item.catalogRoots||[''])paths.add(path);roots.set(item.sourceId,paths)}
 for(const [sourceId,paths] of roots)for(const path of paths){try{await catalog.scan(sourceId,path)}catch(cause){failures.push(sourceName(sourceId)+': '+(cause as Error).message)}}
 if(failures.length)throw new Error(failures.join('\n'))
}
function showSource(id:string,visible:boolean){void run(()=>placement.applyHome({...home.$state,hidden:visible?home.hidden.filter(v=>v!==id):[...new Set([...home.hidden,id])]}))}
async function menuAction(action:string){const target=context.value;if(!target)return;context.value=undefined;const item=target.item,items=item?(videoGroups(catalog.items).find(g=>g.files.some(i=>i.id===item.id))?.files||[item]):filter(target.route);
 if(action==='favoriteTitle'){setFavoriteTitleSort(!favoriteTitleSort.value);return}if(action==='hideFavorites'){void run(()=>placement.applyHome({...home.$state,hidden:[...new Set([...home.hidden,'sources'])]}));return}if(action==='renameFavorites'){prompt.value={kind:'homeTitle',value:home.titles.sources||'收藏夹',route:'sources'};return}if(action==='nextSort'){const values=['title','fileName','addedAt','premiereDate'];selectSort(values[(values.indexOf(sort.value)+1)%values.length]!);return}if(action==='favoriteOrder'){setFavoriteTitleSort(false);favoriteReordering.value=true;return}
 if(['play','loop','shuffle'].includes(action)){void run(()=>playItems(items,action as 'play'|'loop'|'shuffle'));return}
 if(action==='select'&&target.toolbar){selectionMode.value=true;selected.value=[];return}
 if(action==='select'){selectionMode.value=true;const destination=item&&props.route==='home'?(item.type==='tv'?'tv/all':'movies/all'):target.route;if(props.route!==destination){pendingSelection.value=items.map(i=>i.id);emit('navigate',destination)}else selected.value=items.map(i=>i.id);return}
 if(item){if(action==='rating'){window.dispatchEvent(new CustomEvent('boxplayer:personal-rating',{detail:{...item,type:item.type==='tv'?'tv':'movie'}}));return}
 if(action==='metadata'){if(!isServer(item))edit(item);return}
 if(action==='refresh'){void run(()=>refreshMetadata(items));return}
 if(action==='share'){openOriginalMediaShare({id:item.id,title:item.name,year:item.year,overview:item.overview,files:items.map(nativeFileForShare)});return}
 if(action==='download'){void run(()=>nativeCall('source_download',{accountId:item.sourceId,fileId:item.fileId,name:item.fileName}));return}
 if(action==='favorite'){void run(()=>favorite(item));return}
 if(action==='watched'){void run(async()=>{for(const member of items)await watched(member,!item.watched)});return}
 if(action==='continue'){const hidden=!item.continueHidden&&((item.progress||0)>0||!!item.continueAdded);void run(async()=>{await syncPersonal(items,hidden?'watchlist-remove':'watchlist-add');await catalog.update(draft=>{for(const member of draft.items.filter(i=>items.some(v=>v.id===i.id)))Object.assign(member,{continueHidden:hidden,continueAdded:!hidden})})});return}
 if(action==='delete'){prompt.value={kind:'remove',value:item.name,ids:items.map(i=>i.id)};return}
 if(action==='removeMember'){const {kind,name}=collectionAddress(target.route);void run(()=>catalog.update(draft=>{draft[kind][name]=(draft[kind][name]||[]).filter(id=>!items.some(i=>i.id===id))}));return}
 if(action==='reorderMember'){reorderRoute.value=target.route;return}}
 if(action==='series'){const first=items[0];if(first)openCustomSeries({id:first.id,title:first.name});return}if(action==='playlist'){assignCollection(action,items.map(i=>i.id));return}
 if(['home','favorite','remove','renameFavorite'].includes(action)){placeRoute(target.route,action==='renameFavorite'?'rename':action as CategoryPlacementAction);return}
 if(action==='cover'){void run(()=>cycleCover(target.route));return}
 if(action==='watched'||action==='unwatched'){void run(async()=>{for(const member of items)await watched(member,action==='watched')});return}
 if(action==='reorder'){reorderRoute.value=target.route;return}
 if(action==='renameCollection'||action==='deleteCollection'){prompt.value={kind:action,value:collectionAddress(target.route).name,route:target.route};return}
}
function reorder(id:string,offset:number){const {kind,name}=collectionAddress(reorderRoute.value);void run(()=>catalog.update(draft=>{draft[kind][name]=moveMember(draft[kind][name]||[],id,offset)}))}

const matching=ref<VideoItem>(),matchQuery=ref(''),matchResults=ref<Record<string,any>[]>([])
async function findMatches(){if(!matchQuery.value.trim())return;await run(async()=>{const result=await nativeCall<Record<string,any>>('catalog_metadata',{kind:'search',query:matchQuery.value.trim(),year:null,tmdbId:null,page:null});const payload=result.data??result;matchResults.value=Array.isArray(payload)?payload:payload.results||[]})}
async function chooseMatch(result:Record<string,any>){const target=matching.value;if(!target)return;await run(async()=>{const tv=result.media_type==='tv'||!!result.first_air_date;const response=await nativeCall<Record<string,any>>('catalog_metadata',{kind:tv?'tv':'movie',query:'',year:null,tmdbId:String(result.id),page:null});const metadata=response.data??response;if(!metadata.id)throw new Error('元数据响应缺少标识');const item=structuredClone(toRaw(target));applyMetadata(item,metadata,tv);await catalog.patch(item.id,item);matching.value=undefined})}

const libraryIndexRoutes=[['playlist','播放列表'],['series','系列'],['recent','最近添加'],['unwatched','未观看的'],['daily','每日精选'],['movies','电影'],['tv','电视剧'],['other','其他']] as const
const current=computed(()=>catalog.items.find(item=>item.id===detail.value))
const routes=computed(()=>{
 const base=[...videoLibraryRoutes].sort(([a],[b])=>a==='series'?-1:b==='series'?1:0).map(([route,title])=>({route,title:homeRouteTitle(route),id:libraryHomeId(route),sourceId:'local',available:true,optIn:libraryHomeId(route).startsWith('catalog:')}))
 const children=['movies/genres','tv/genres','tv/networks','movies/ratings','tv/ratings','movies/years','tv/years','movies/certification','tv/certification','movies/resolution','tv/resolution'].flatMap(route=>categoryGroups(catalog.items,route)).map(group=>({...group,id:libraryHomeId(group.route),sourceId:'local',available:true,child:true,optIn:true}))
 const collections=[...(seriesPreferences.useTMDB?movieCollections(catalog.items):[]).map(group=>({route:'series/'+group.id,title:group.title})),...Object.keys(catalog.data.playlists).map(title=>({route:'playlist/'+encodeURIComponent(title),title})),...Object.keys(catalog.data.series).map(title=>({route:'custom-series/'+encodeURIComponent(title),title}))].map(group=>({...group,id:libraryHomeId(group.route),sourceId:'local',available:true,child:true,optIn:true}))
 const roots=[...rootCategories('movies'),...rootCategories('tv')].filter(entry=>!base.some(b=>b.route===entry.route)).map(entry=>({...entry,id:libraryHomeId(entry.route),sourceId:'local',available:true,optIn:true}))
 const available=[...base,...roots,...children,...collections];const known=new Set(available.map(item=>item.id));return [...available,...home.order.filter(id=>!known.has(id)&&id!=='sources'&&!id.startsWith('source:')&&!['music','books'].includes(id)).map(id=>({id,route:categoryRouteForHomeId(id),title:home.titles[id]||libraryTitle(categoryRouteForHomeId(id)),sourceId:'local',available:true,child:id.includes(':group:')||id.startsWith('custom-series:'),optIn:true}))]
})
watch(routes,value=>{placement.setCatalog(value);navigation.setItems(value)},{immediate:true});placement.ensureLoaded()
const title=computed(()=>current.value?.name||home.titles[libraryHomeId(props.route)]||(props.route.startsWith('series/')?movieCollections(catalog.items).find(g=>g.id===props.route.slice(7))?.title:undefined)||(props.origin==='home'?homeRouteTitle(props.route):routeLabel(props.route)))
watch(title,value=>emit('title',value),{immediate:true})
watch(()=>[props.route,props.origin],()=>{detail.value=undefined;selectionMode.value=false;explicitSort.value=false;selected.value=pendingSelection.value||[];pendingSelection.value=undefined;menu.value=false;context.value=undefined;sourceContext.value=undefined;serverFavoriteContext.value=undefined;reorderRoute.value='';error.value=''})
onMounted(async()=>{await run(async()=>{await sources.refresh();await catalog.load()});void catalog.loadRanking()})

async function run(action:()=>unknown|Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await action()}catch(cause){error.value=(cause as Error).message}finally{busy.value=false}}
function decode(value:string){try{return decodeURIComponent(value)}catch{return value}}
const scoped=computed(()=>catalog.items.filter(item=>!localOnly.value||item.local))
function filter(route:string){const [root,category,value='']=route.split('/'),group=decode(value);let items=categoryItems(scoped.value,route)
 if(root==='detail-tag'){const metadata=(item:VideoItem)=>originalItem(item);if(category==='country')items=items.filter(item=>metadata(item).productionCountries?.includes(group));else if(['cast','crew'].includes(category||''))items=items.filter(item=>[...(metadata(item).credits?.cast||[]),...(metadata(item).credits?.crew||[])].some(person=>String(person.id)===group||person.name===group));return items}
 if(root==='unwatched'||category==='unwatched')items=items.filter(item=>!item.watched)
 if(root==='continue')items=items.filter(item=>!item.continueHidden&&((item.progress||0)>0||!!item.continueAdded))
 if(root==='favorites')items=items.filter(item=>item.favorite)
 if(root==='search'){const query=(props.query||'').trim().toLocaleLowerCase();items=query?items.filter(item=>[item.name,item.fileName,item.overview,...item.genres].some(value=>value?.toLocaleLowerCase().includes(query))):[]}
 if(root==='playlist'&&category){const ids=catalog.data.playlists[decode(category)]||[];items=ids.flatMap(id=>items.find(item=>item.id===id)||[])}
 if(root==='custom-series'&&category){const ids=catalog.data.series[decode(category)]||[];items=ids.flatMap(id=>items.find(item=>item.id===id)||[])}
 if(root==='series'&&category)items=movieCollections(items).find(group=>group.id===decode(category))?.members||[]
 if(root==='recent'||category==='recent')return [...items].sort((a,b)=>b.addedAt.localeCompare(a.addedAt))
 if(root==='daily')return matchDailyLibraryRanking(items.filter(i=>['movie','movies'].includes(generalPreferences.dailyPicks)?i.type==='movie':generalPreferences.dailyPicks==='tv'?i.type==='tv':true),catalog.dailyRanking)
 return items
}
const rows=computed(()=>filter(props.route).sort((a,b)=>!explicitSort.value&&['daily','playlist','series','custom-series','recent','continue'].includes(props.route.split('/')[0]!)?0:compareMediaBrowseValues({...a,title:a.name,premiereDate:a.releaseDate},{...b,title:b.name,premiereDate:b.releaseDate},sort.value,descending.value)))
const inlineSeries=computed(()=>{const root=props.route.split('/')[0];if(!props.route.endsWith('/all')||!(root==='movies'?seriesPreferences.showMovies:root==='tv'&&seriesPreferences.showTV))return [];const allowed=new Set(rows.value.map(item=>item.id));const custom=seriesPreferences.useCustom?Object.entries(catalog.data.series).map(([title,ids])=>({route:'custom-series/'+encodeURIComponent(title),title,members:ids.flatMap(id=>rows.value.find(item=>item.id===id)||[])})).filter(group=>group.members.length):[];const customIds=new Set(custom.flatMap(g=>g.members.map(i=>i.id)));const automatic=root==='movies'&&seriesPreferences.useTMDB?movieCollections(rows.value).map(group=>({route:'series/'+group.id,title:group.title,members:group.members.filter(i=>allowed.has(i.id)&&!customIds.has(i.id))})).filter(g=>g.members.length):[];return [...custom,...automatic]})
const displayRows=computed(()=>{const hidden=new Set(inlineSeries.value.flatMap(group=>group.members.map(item=>item.id)));const values=rows.value.filter(item=>!hidden.has(item.id));return seriesPreferences.mergeVersions?videoGroups(values).map(group=>({...group,item:group.item.type==='movie'?orderedWorkspaceVersions(group.files,seriesPreferences.defaultVersion)[0]!:group.item})):orderedWorkspaceVersions(values,seriesPreferences.defaultVersion).map(item=>({key:item.id,item,files:[item]}))})
const nativePreviews=ref<Record<string,string|null>>({}),pendingPreviews=new Set<string>()
let previewGeneration=0
onUnmounted(()=>{previewGeneration++;pendingPreviews.clear()})
function artworkFor(item:VideoItem,landscape=false){const poster=landscape?item.backdrop||item.poster:item.poster;if(poster)return cachedArtwork(poster);const key=JSON.stringify([item.sourceId,item.fileId,item.local]);if(isNative()&&!(key in nativePreviews.value)&&!pendingPreviews.has(key)){pendingPreviews.add(key);const generation=previewGeneration;void fileThumbnail(item.sourceId,item.fileId,item.local,()=>generation===previewGeneration).then(image=>{if(generation===previewGeneration)nativePreviews.value={...nativePreviews.value,[key]:image}}).finally(()=>pendingPreviews.delete(key))}return nativePreviews.value[key]||undefined}
function mediaCard(item:VideoItem,route:string,landscape=false):UnifiedLibraryCard{return {key:item.id,title:generalPreferences.showFileNames?item.fileName:item.seriesName||item.name,image:artworkFor(item,landscape),file:{sourceId:item.sourceId,fileId:item.fileId,local:!!item.local},rating:item.rating,overview:generalPreferences.hideSpoilers&&!item.watched?'简介已隐藏':item.overview,certification:item.certification,subtitle:[item.duration?Math.max(1,Math.round(item.duration/60))+'分钟':'',item.year,item.height?item.height+'p':''].filter(Boolean).join('  '),progress:item.progress,action:()=>{if(selected.value.length||selectionMode.value)toggle(item.id);else detail.value=item.id},posterMenu:{server:isServer(item),tv:item.type==='tv',watched:!!item.watched,favorite:!!item.favorite,continuing:!item.continueHidden&&(!!item.continueAdded||Number(item.progress)>0),homePlaylistItem:route.startsWith('playlist/'),seriesItem:route.startsWith('custom-series/'),disabled:item.local?['download']:[],action:action=>{context.value={x:0,y:0,route,item};void menuAction(({removePlaylistItem:'removeMember',removeSeriesItem:'removeMember',reorderPlaylistItem:'reorderMember',reorderSeriesItem:'reorderMember'} as Record<string,string>)[action]||action)}}}}
const catalogRow=computed<UnifiedLibraryRow>(()=>({key:props.route,title:title.value,cards:displayRows.value.map(group=>mediaCard(group.item,props.route)),more:()=>{}}))
function shelfRow(route:string,title:string,items:VideoItem[],landscape=false):UnifiedLibraryRow{return {key:landscape?'resume':route,title,cards:items.map(item=>mediaCard(item,route,landscape)),landscape,more:()=>navigateHome(route)}}

function openCollection(route:string){const first=filter(route)[0];if(seriesPreferences.openDetail||!first)emit('navigate',route);else void run(()=>playItems(filter(route),'play'))}
const currentFiles=computed(()=>current.value?videoGroups(catalog.items).find(group=>group.files.some(item=>item.id===current.value!.id))?.files||[current.value]:[])
const groupCards=computed(()=>{const [root,category]=props.route.split('/');if(props.route==='movies'||props.route==='tv')return rootCategories(props.route).map(g=>({...g,count:filter(g.route).length}));if(root==='playlist'&&!category)return Object.entries(catalog.data.playlists).map(([title,ids])=>({title,count:ids.length,route:'playlist/'+encodeURIComponent(title)}));if(root==='series'&&!category)return [...(seriesPreferences.useTMDB?movieCollections(scoped.value):[]).map(group=>({title:group.title,count:group.members.length,route:'series/'+encodeURIComponent(group.id)})),...(seriesPreferences.useCustom?Object.entries(catalog.data.series):[]).map(([title,ids])=>({title,count:ids.length,route:'custom-series/'+encodeURIComponent(title)}))];if(!category||!['genres','networks','ratings','years','certification','resolution'].includes(category)||props.route.split('/').length>2)return[];return categoryGroups(scoped.value,props.route)})
const groupIndex=computed(()=>['movies','tv','playlist','series'].includes(props.route)||props.route.split('/').length===2&&['genres','networks','ratings','years','certification','resolution'].includes(props.route.split('/')[1]!))
const isCatalogMediaPage=computed(()=>!groupIndex.value&&!['home','library','library-shortcuts','favorites','search'].includes(props.route))
async function refreshWorkspace(){await catalog.load();if(props.route==='home')window.dispatchEvent(new Event('boxplayer:server-home-changed'))}
const favoriteRoutes=computed(()=>placement.orderFavoriteCards(placement.favoriteRoutes.filter(route=>!['music','books'].includes(route)).map(key=>({key}))).map(card=>card.key))
const homeServerAccounts=computed(()=>sources.accounts.filter(account=>!home.hidden.includes('source:'+account.id)&&!home.hidden.includes('source:server:'+account.id)))
interface FavoriteCard {key:string;title:string;route?:string;source?:typeof sources.cards[number];account?:Account;serverFavorite?:Favorite;cover?:string}
const favoriteCards=computed(()=>{void serverPreferenceRevision.value;const cards:FavoriteCard[]=[...favoriteRoutes.value.map(route=>({key:route,title:routeLabel(route),route})),...sources.favoriteCards.map(source=>({key:sourceCardKey(source),title:source.name,source,cover:source.cover,...(source.serverFavorite?{account:sources.accounts.find(account=>account.id===source.sourceId),serverFavorite:source.serverFavorite}:{})}))];return favoriteTitleSort.value?[...cards].sort((a,b)=>a.title.localeCompare(b.title,undefined,{numeric:true})):placement.orderFavoriteCards(cards)})
watch(()=>favoriteCards.value.map(card=>card.key).join('\0'),()=>{void placement.setFavoriteCatalog(favoriteCards.value.map(card=>card.key))},{immediate:true})
watch(()=>sources.preferences.order.join('\0'),()=>{const cards=sources.favoriteCards.map(source=>sourceCardKey(source));void placement.reorderFavorites(reorderSourceSlots(favoriteCards.value.map(card=>card.key),cards))})
const homeFavoriteCards=computed(()=>favoriteCards.value.filter(card=>card.route?!home.hidden.includes(card.route):card.source?!card.source.hiddenOnHome&&!home.hidden.includes('source:'+card.source.sourceId)&&!home.hidden.includes('source:folder:'+card.source.id)&&!home.hidden.includes('source:server:'+card.source.sourceId):!card.serverFavorite?.hiddenOnHome&&!home.hidden.includes('source:'+card.account?.id)))
function navigateHome(route:string){emit('navigate',route,['recent','unwatched','daily','other','favorites','continue'].includes(route)?'home':'library')}
function openFavorite(card:FavoriteCard){if(card.account&&card.serverFavorite)emit('server',card.account.id,card.source?.serverRoute||card.serverFavorite.route);else if(card.source){if(card.source.server)emit('server',card.source.sourceId,{kind:'root',title:'媒体库'});else if(card.source.favorite)emit('folder',{sourceId:card.source.sourceId,path:card.source.path,local:card.source.local,favoriteId:card.source.id});else emit('source',card.source.sourceId)}else if(card.route)emit('navigate',card.route==='library'?'library-shortcuts':card.route)}
function favoriteContext(event:MouseEvent,card:FavoriteCard){event.preventDefault();context.value=undefined;sourceContext.value=undefined;serverFavoriteContext.value=undefined;if(card.account&&card.serverFavorite)serverFavoriteContext.value={account:card.account,favorite:card.serverFavorite,x:event.clientX,y:event.clientY};else if(card.source)sourceContext.value={sourceId:card.source.sourceId,favoriteId:card.source.favorite?card.source.id:undefined,x:event.clientX,y:event.clientY};else if(card.route)openContext(event,card.route)}
async function addSourceFolder(){showSourceManager.value=false;await run(async()=>{const source=await addLocalSource();if(source){await sources.refresh();emit('source',source.id)}})}
function sourceReorder(){favoriteReordering.value=true;if(props.route!=='favorites')navigateHome('favorites')}
function syncSourceOrder(keys:string[]){const byKey=new Map(favoriteCards.value.filter(card=>card.source).map(card=>[card.key,card.source!.id]));sources.reorder([...keys.flatMap(key=>byKey.get(key)||[]),...sources.cards.filter(card=>!byKey.has(sourceCardKey(card))).map(card=>card.id)])}
function moveFavorite(key:string,offset:number){const keys=moveMember(favoriteCards.value.map(c=>c.key),key,offset);void run(async()=>{await placement.reorderFavorites(keys);syncSourceOrder(keys)})}
const serverManagementItems=ref<HomeManagementItem[]>([])
const managedRoutes=computed(()=>orderedHomeItems(withFixedHomeMenus([{id:'sources',title:'收藏夹',sourceId:'local',available:true},...routes.value,...serverManagementItems.value]),home.$state))
const managementGroups=computed<HomeManagementGroup[]>(()=>{
 const byId=new Map(managedRoutes.value.map(item=>[item.id,item]))
 const node=(id:string):HomeManagementNode|undefined=>{const item=byId.get(id);return item?{id,title:item.title,item,children:managedRoutes.value.filter(child=>id==='custom-series'?child.id.startsWith('custom-series:')||child.id.startsWith('catalog:series/'):child.id.startsWith(id+':group:')).map(child=>({id:child.id,title:child.title,item:child}))}:undefined}
 const nodes=(ids:string[])=>ids.flatMap(id=>node(id)||[])
 const localNodes:HomeManagementNode[]=nodes(['sources','local:playlist','custom-series','recent','local:unwatched','local:daily'])
 for(const root of ['movies','tv'])localNodes.push({id:'management:'+root,title:root==='movies'?'电影':'电视剧',children:rootCategories(root).flatMap(entry=>{const value=node(libraryHomeId(entry.route));return value?[{...value,expandable:['genres','ratings','years','certification','resolution','networks'].includes(entry.route.split('/')[1]!)}]:[]})})
 localNodes.push(...nodes(['local:unmatched']))
 return [{id:'local',title:'媒体库',nodes:localNodes},...sources.accounts.filter(account=>['emby','jellyfin','plex'].includes(account.providerId)).map(account=>({id:account.id,title:account.name,nodes:serverManagementItems.value.filter(item=>item.sourceId===account.id).map(item=>({id:item.id,title:item.title,item}))}))]
})
const managementSettings=computed(()=>{void serverPreferenceRevision.value;const serverIDs=new Set(serverManagementItems.value.map(item=>item.id));const selected=serverManagementItems.value.filter(item=>readPreferences(item.sourceId).home.includes(item.id.slice(item.sourceId.length+1))).map(item=>item.id);return {...home.$state,order:[...new Set([...home.order,...selected])],hidden:[...home.hidden,...[...serverIDs].filter(id=>!selected.includes(id))]}})
async function saveHomeSettings(value:UnifiedHomeSettings){await run(async()=>{const remoteIDs=new Set(serverManagementItems.value.map(item=>item.id));for(const account of sources.accounts.filter(account=>['emby','jellyfin','plex'].includes(account.providerId))){const choices=serverManagementItems.value.filter(item=>item.sourceId===account.id);if(!choices.length)continue;const selected=orderedHomeItems(choices,value).filter(item=>!value.hidden.includes(item.id)&&value.order.includes(item.id));writePreferences(account.id,{...readPreferences(account.id),home:selected.map(item=>item.id.slice(account.id.length+1))})}await placement.applyHome({...value,order:value.order.filter(id=>!remoteIDs.has(id)),hidden:value.hidden.filter(id=>!remoteIDs.has(id))});window.dispatchEvent(new Event('boxplayer:server-home-changed'))})}
const shelves=computed(()=>visibleHomeItems(withFixedHomeMenus(routes.value),home.$state).map(item=>({route:categoryRouteForHomeId(item.id),title:home.titles[item.id]||item.title,items:videoGroups(homeItemsFor(categoryRouteForHomeId(item.id))).map(group=>group.item).slice(0,12),groups:homeGroups(categoryRouteForHomeId(item.id))})).filter(shelf=>shelf.items.length||shelf.groups.length))
function homeItemsFor(route:string){return filter(route).filter(item=>{if(home.hidden.includes('source:'+item.sourceId)||home.hidden.includes('source:server:'+item.sourceId))return false;const roots=sources.cards.filter(card=>!card.serverFavorite&&(card.local||card.favorite)&&card.sourceId===item.sourceId&&(!card.path||item.folderPath===card.path||item.folderAncestors?.includes(card.path)||item.catalogRoots?.includes(card.path)));return !roots.length||roots.some(card=>!home.hidden.includes('source:folder:'+card.id))})}
function homeGroups(route:string){if(['playlist','series','movies','tv'].includes(route)){if(route==='playlist')return Object.keys(catalog.data.playlists).map(title=>({route:'playlist/'+encodeURIComponent(title),title}));if(route==='series')return [...movieCollections(scoped.value).map(g=>({route:'series/'+g.id,title:g.title})),...Object.keys(catalog.data.series).map(title=>({route:'custom-series/'+encodeURIComponent(title),title}))];return rootCategories(route)}return route.split('/').length===2&&['genres','networks','ratings','years','certification','resolution'].includes(route.split('/')[1]!)?categoryGroups(scoped.value,route):[]}
function setShelf(id:string,enabled:boolean){void run(()=>placement.applyHome({...home.$state,order:enabled?[...new Set([...home.order,id])]:home.order,hidden:enabled?home.hidden.filter(value=>value!==id):[...new Set([...home.hidden,id])]}))}
function moveShelf(id:string,offset:number){const ids=shelves.value.map(item=>libraryHomeId(item.route)),destination=ids[ids.indexOf(id)+offset];if(destination)void run(()=>placement.applyHome(moveHomeItem(home.$state,ids,id,destination)))}
function detailTag(kind:string,value:string,personId?:number){if(!current.value)return;const root=current.value.type==='tv'?'tv':'movies';if(['genre','genres','year','years'].includes(kind))emit('navigate',root+'/'+(kind.startsWith('genre')?'genres':'years')+'/'+encodeURIComponent(value));else emit('navigate','detail-tag/'+kind+'/'+encodeURIComponent(personId?String(personId):value)+'/'+encodeURIComponent(value))}
function routeLabel(route:string){if(bookmarks.titles[route])return bookmarks.titles[route]!;if(route==='library-shortcuts')return '媒体库';const parts=route.split('/');if(parts.length===2&&['movies','tv'].includes(parts[0]!)&&parts[1]!=='all')return categoryLabels[parts[1]!]||libraryTitle(route);return libraryTitle(route)}
function sourceName(id:string){return sources.accounts.find(source=>source.id===id)?.name||sources.snapshot.localFolders.find(source=>source.id===id)?.name||'来源未连接'}
function toggle(id:string){selected.value=selected.value.includes(id)?selected.value.filter(value=>value!==id):[...selected.value,id]}
async function favorite(item:VideoItem){const account=sources.accounts.find(account=>account.id===item.sourceId);if(account&&['jellyfin','emby','plex'].includes(account.providerId))await serverFavorite(account,item.fileId,!item.favorite);await catalog.patch(item.id,{favorite:!item.favorite})}
async function watched(item:VideoItem,value:boolean){const account=sources.accounts.find(account=>account.id===item.sourceId);if(account&&['jellyfin','emby'].includes(account.providerId))await request(account,value?'POST':'DELETE',endpoint(account,`Users/${encodeURIComponent(account.userId||'')}/PlayedItems/${encodeURIComponent(item.fileId)}`));if(account?.providerId==='plex')await request(account,'GET',endpoint(account,`:/`+(value?'scrobble':'unscrobble')+'?'+new URLSearchParams({key:item.fileId,identifier:'com.plexapp.plugins.library'})));await catalog.patch(item.id,{watched:value,progress:value?100:0})}
function place(action:CategoryPlacementAction){if(action==='remove'||action==='removeFavorite'){void run(()=>placement.change(props.route,action));return}prompt.value={kind:action==='rename'?'rename':action==='home'?'home':'favorite',value:title.value,route:props.route}}
async function savePrompt(){const value=prompt.value;if(!value)return;await run(async()=>{if(value.kind==='rating'){const rating=value.value.trim()===''?undefined:Number(value.value);if(rating!==undefined&&(!Number.isInteger(rating)||rating<1||rating>10))throw new Error('评分必须为 1–10 的整数');await syncPersonal(catalog.items.filter(item=>value.ids?.includes(item.id)),rating===undefined?'rating-remove':'rating',rating);await catalog.update(draft=>{for(const item of draft.items)if(value.ids?.includes(item.id))item.personalRating=rating})}else if(value.kind==='playlist'||value.kind==='series')await catalog.update(draft=>appendMembers(draft[value.kind==='playlist'?'playlists':'series'],value.value,value.ids||[]));else if(value.kind==='renameCollection'||value.kind==='deleteCollection'){const route=value.route!,{kind,name}=collectionAddress(route);const next=route.split('/')[0]+'/'+encodeURIComponent(value.value.trim());await catalog.update(draft=>{if(value.kind==='deleteCollection')delete draft[kind][name];else renameCollection(draft[kind],name,value.value)});if(value.kind==='renameCollection'){await placement.renameRoute(route,next);if(coverOffsets.value[route]!==undefined){coverOffsets.value[next]=coverOffsets.value[route]!;delete coverOffsets.value[route];localStorage.setItem('video-library-cover-offsets',JSON.stringify(coverOffsets.value))}if(props.route===route)emit('navigate',next)}else{await placement.change(route,'remove');if(props.route===route)emit('navigate',kind==='playlists'?'playlist':'series')}}else if(value.kind==='remove'){for(const id of value.ids||[])await catalog.remove(id);detail.value=undefined;selected.value=[]}else if(value.kind==='homeTitle')await placement.renameHome(value.route!,value.value);else await placement.change(value.route!,value.kind,value.value);prompt.value=undefined})}
function collection(kind:'playlist'|'series'){assignCollection(kind,current.value?[current.value.id]:[...selected.value])}
function edit(item:VideoItem){editing.value=structuredClone(toRaw(item))}
async function saveEdit(){const item=editing.value;if(item)await run(async()=>{await catalog.patch(item.id,{...item,metadataSource:'manual'});editing.value=undefined})}

const fileMenu=ref<InstanceType<typeof UnifiedFilesPage>>()
watch(showSourceManager,async value=>{if(value){await nextTick();fileMenu.value?.openAdd();showSourceManager.value=false}})
function objectAction(event:Event){const value=(event as CustomEvent<{route:string;action:string}>).detail;if(!value||value.route.startsWith('home-entry/'))return;context.value={x:0,y:0,route:value.route};const action=value.action;void menuAction(action==='delete'?'deleteCollection':action==='rename'?'renameCollection':action)}
onMounted(()=>window.addEventListener('boxplayer:library-object-action',objectAction))
onUnmounted(()=>window.removeEventListener('boxplayer:library-object-action',objectAction))
const playlistReordering=ref(false)
const isSearchPage=computed(()=>props.route==='search')
const isCategoryPage=computed(()=>!['home','library'].includes(props.route))
const isServerCategoryPage=false,isServerRootPage=false,isFolderPage=false
const isGenreIndexPage=computed(()=>props.origin==='home'&&props.route==='movies/genres')
const activeHomeMenuId=computed(()=>libraryHomeId(props.route))
const videoView={playBrowse(mode:'play'|'loop'|'shuffle'){void run(()=>playItems(rows.value,mode))}}
function selectBrowseSort(value:MediaBrowseSort){selectSort(value)}
function refresh(){void run(refreshWorkspace)}
function hideFavoritesShelf(){context.value={x:0,y:0,route:'favorites'};void menuAction('hideFavorites')}
function renameCurrentHomeMenu(){context.value={x:0,y:0,route:'favorites'};void menuAction('renameFavorites')}
const collectionMode=mode,browseSort=sort,browseSortDescending=descending,browseSelection=selectionMode
const homePreferences=home,showTraktAccount=traktVisible,showHomeManagement=manageHome,showAddFileSource=showSourceManager
const section=computed<string>(()=>props.route==='home'?'home':'collection')
const selectedHomeRowKey=computed(()=>props.route==='library'?'library-index':props.route==='library-shortcuts'?'catalog:library':'catalog:'+props.route)
const isCatalogPage=computed(()=>!['home','library','search'].includes(props.route))
const isLibrarySettingsPage=computed(()=>props.route==='library')
const selectedObjectItems=selected
const selectedObjectKeys=computed(()=>selected.value.map(id=>'local:'+id))
const refreshing=busy,libraryScanning=computed(()=>catalog.scanning),metadataRefreshing=busy
const libraryBrowser=ref<InstanceType<typeof UnifiedLibraryBrowser>>()
const catalogTitle=ref('')
const recommendationLoading=computed(()=>false)
const recommendationError=computed(()=>catalog.error)
const dailyRecommendations=computed(()=>filter('daily').map(item=>originalItem(item)))
const libraryShortcutCards=computed(()=>libraryIndexRoutes.map(([key,title])=>({key,title,action:()=>emit('navigate',key)})))
const librarySourceGroupsOriginal=computed(()=>{const folders=sources.cards.filter(card=>!card.serverFavorite&&(card.local||card.favorite));return [...[{key:'local',title:t('librarySettings.localFolders'),sources:folders.filter(card=>card.local).map(card=>({key:'source:folder:'+card.id,title:card.name}))},{key:'cloud',title:t('librarySettings.cloudFolders'),sources:folders.filter(card=>!card.local).map(card=>({key:'source:folder:'+card.id,title:card.name}))}].filter(group=>group.sources.length),...sources.accounts.filter(account=>['emby','jellyfin','plex'].includes(account.providerId)).map(account=>({key:account.id,title:account.name,sources:[{key:'source:server:'+account.id,title:t('librarySettings.showOnHome')}]}))]})
const libraryStatisticsOriginal=computed(()=>libraryStatistics.value.map(stat=>({label:stat.title,count:stat.count})))
function localCard(item:MediaLibraryItem,landscape=false,playlistName?:string,seriesID?:string):UnifiedLibraryCard {const native=nativeItem(item);if(!native)throw new Error('媒体来源已移除');const card=mediaCard(native,playlistName?'playlist/'+encodeURIComponent(playlistName):seriesID?'custom-series/'+seriesID:props.route,landscape);return {...card,key:'local:'+native.id,sortValues:{title:item.name,fileName:item.driveFiles[0]?.name,addedAt:item.addedAt,premiereDate:item.releaseDate}}}
function showCatalog(route:string){emit('navigate',route)}
function showCustomSeries(id:string){emit('navigate','custom-series/'+id)}
function playCatalog(items:MediaLibraryItem[],mode:'play'|'loop'|'shuffle'){void run(()=>playItems(nativeItems(items),mode))}
function handleCatalogPlacement(route:string,action:CategoryPlacementAction){placeRoute(route,action)}
function toggleLibrarySource(key:string,visible:boolean){showSource(key,visible)}
function rescanLibraryFolders(){void run(refreshLibrary)}
function refreshLibraryMetadata(){void run(()=>refreshMetadata(catalog.items))}
function loadLibraryRecommendations(){void catalog.loadRanking()}
function openCategoryMenu(event:MouseEvent,route:string){openContext(event,route)}
const draggedFavoriteKey=draggedFavorite
const favoritesSortByTitle=favoriteTitleSort
const selectedHomeRow=computed(()=>props.route==='continue'?shelfRow('continue','继续观看',filter('continue')):props.route.startsWith('custom-series/')||props.route.startsWith('detail-tag/')||props.route==='search'?shelfRow(props.route,title.value,filter(props.route)):undefined)
const favoritePageCards=computed(()=> (props.route==='home'?homeFavoriteCards.value:favoriteCards.value).map(card=>({...card,action:()=>openFavorite(card)})))
function sourceServer(key:string){const card=favoriteCards.value.find(card=>card.key===key);const account=card?.account||(card?.source?.server?sources.accounts.find(account=>account.id===card.source!.sourceId):undefined);return account?{...account,type:account.providerId as 'emby'|'jellyfin'|'plex'}:undefined}
function favoriteCover(key:string){const card=favoriteCards.value.find(card=>card.key===key);return card?.source?fileMenu.value?.coverForKey(fileSourceMenuKey(card.source)):card?.cover}
function fileSourceMenuKey(source:typeof sources.cards[number]){return source.serverFavorite?(source.serverFavorite.content?'server-folder:':'server-category:home-entry/')+source.id:(source.favorite||source.local?'folder:':source.server?'server:':'root:')+source.id}
function openFavoriteCardMenu(event:MouseEvent,key:string){const card=favoriteCards.value.find(card=>card.key===key);if(card?.source){event.preventDefault();fileMenu.value?.openMenu(event,fileSourceMenuKey(card.source))}else if(card)favoriteContext(event,card)}
function startFavoriteReordering(){if(props.route!=='favorites')emit('navigate','favorites');setFavoriteTitleSort(false);favoriteReordering.value=true}
function finishFavoriteReordering(){favoriteReordering.value=false;draggedFavoriteKey.value=''}
const homeElement=ref<HTMLElement>(),homeScrollTop=ref(0)
const homeShelfSnapshots=new Map<string,{height?:number;scrollLeft?:number}>()
function homeShelfSnapshot(id:string){let snapshot=homeShelfSnapshots.get(id);if(!snapshot){snapshot={};homeShelfSnapshots.set(id,snapshot)}return snapshot}
watch(()=>props.route,async value=>{if(value==='home'){await nextTick();if(homeElement.value)homeElement.value.scrollTop=homeScrollTop.value}})
const homeLibrary=computed(()=>videoGroups(homeItemsFor('all')).map(group=>originalItem(group.item,group.files)))
const customSeriesGroups=computed(()=>loadCustomSeries())
function openVideo(item:MediaLibraryItem){const native=nativeItem(item);if(native)detail.value=native.id}
function localRow(items: MediaLibraryItem[], row: Omit<Row, 'cards'>, card: (item: MediaLibraryItem) => Card = localCard): Row {
  const movieList = row.key === libraryHomeId('movies/all')
  const tvList = row.key === libraryHomeId('tv/all')
  const groups: { id: string; title: string; members: MediaLibraryItem[] }[] = []
  if ((movieList && seriesPreferences.showMovies) || (tvList && seriesPreferences.showTV)) {
    if (seriesPreferences.useCustom) for (const group of customSeriesGroups.value) {
      const members = libraryPlaylistMembers(homeLibrary.value, group.members.filter(member => !member.serverId).map(member => member.id))
        .filter(item => item.type === (tvList ? 'tv' : 'movie'))
      if (members.length) groups.push({ id: 'custom:' + group.id, title: group.title, members })
    }
    const customIDs = new Set(groups.flatMap(group => group.members.map(item => item.id)))
    if (movieList) groups.push(...libraryMovieSeries(items).map(group => ({ ...group, members: group.members.filter(item => !customIDs.has(item.id)) })).filter(group => group.members.length))
  }
  const groupedIDs = new Set(groups.flatMap(group => group.members.map(item => item.id)))
  const members = movieVersionItems(items.filter(item => !groupedIDs.has(item.id)))
  const groupCards: Card[] = groups.map(group => ({ key: 'series:' + group.id, title: group.title, image: group.members[0]?.posterUrl,
    subtitle: t('customSeries.memberCount', { count: group.members.length }), action: () => {
      if (group.id.startsWith('custom:')) void showCustomSeries(group.id.slice(7))
      else if (group.members[0]) void openVideo(group.members[0])
    } }))
  return { ...row, count: groupCards.length + members.length, get cards() { return [...groupCards, ...members.map(card)] }, preview: () => [...groupCards, ...members.slice(0, 24).map(card)].slice(0, 24) }
}
const homeRows=computed<UnifiedLibraryRow[]>(()=>shelves.value.map(shelf=>{if(shelf.groups.length)return {key:libraryHomeId(shelf.route),title:shelf.title,grouped:true,landscape:true,count:shelf.groups.length,cards:shelf.groups.map(group=>({key:group.route,title:group.title,image:cover(group.route),contextMenu:(event:MouseEvent)=>openContext(event,group.route),action:()=>emit('navigate',group.route)})),more:()=>navigateHome(shelf.route)};const grouped=videoGroups(homeItemsFor(shelf.route)).map(group=>originalItem(group.item,group.files));const row=localRow(grouped,{key:libraryHomeId(shelf.route),title:shelf.title,more:()=>navigateHome(shelf.route)});return {key:row.key,title:row.title,landscape:row.landscape,grouped:row.grouped,count:Math.min(row.count??row.cards.length,24),get cards(){return row.preview?row.preview():row.cards.slice(0,24)},more:row.more}}))
const originalRows=computed(()=>[...(generalPreferences.recentlyPlayed&&homeItemsFor('continue').length?[shelfRow('continue','继续观看',homeItemsFor('continue').slice(0,24),true)]:[]),...homeRows.value])
const homeLayout=computed(()=>orderedHomeItems(withFixedHomeMenus([{id:'sources',title:home.titles.sources||'收藏夹',sourceId:'local',available:true},...routes.value]),home.$state).filter(item=>isHomeItemEnabled(item,home.$state)).map(item=>({item:{...item,title:home.titles[item.id]||item.title},row:homeRows.value.find(row=>row.key===item.id)})).filter(entry=>entry.item.id==='sources'?homeFavoriteCards.value.length:!!(entry.row?.count??entry.row?.cards.length)))
const homeIsEmpty=computed(()=>!homeLayout.value.length&&!originalRows.value.some(row=>row.key==='resume'))
const visibleHomeShelves=new Set<string>()
function homeRowVisibility(id:string,visible:boolean){if(visible)visibleHomeShelves.add(id);else visibleHomeShelves.delete(id)}
function openHomeMenu(id:string){if(id==='sources')navigateHome('favorites');else navigateHome(categoryRouteForHomeId(id))}
const media=computed(()=>({isScanning:catalog.scanning,scanProgress:catalog.scanCount,playlists:catalog.data.playlists}))
function favoriteCardClasses(key: string) {
 const root = key.split('/')[0]
 return {
  'favorite-movies': root === 'movies' || root === 'series',
  'favorite-playlist': root === 'playlist',
  'favorite-tv': root === 'tv',
  'favorite-other': root === 'other',
  'favorite-server': key.startsWith('source:server:'),
  'favorite-folder': key.startsWith('source:folder:') || key.startsWith('root:'),
  'favorite-music': root === 'music',
  'favorite-book': root === 'books'
 }
}
function startFavoriteDrag(event: DragEvent, key: string) {
 if (!favoriteReordering.value) { event.preventDefault(); return }
 draggedFavoriteKey.value = key
 event.dataTransfer?.setData('text/plain', key)
 if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function reorderFavoriteCard(targetKey: string, finish = false) {
 const sourceKey = draggedFavoriteKey.value
 if (!sourceKey || sourceKey === targetKey) return
 const order = favoritePageCards.value.map(card => card.key)
 const from = order.indexOf(sourceKey); const to = order.indexOf(targetKey)
 if (from < 0 || to < 0) return
 order.splice(to, 0, order.splice(from, 1)[0])
 void run(async()=>{await placement.reorderFavorites(order);syncSourceOrder(order)})
 if (finish) draggedFavoriteKey.value = ''
}
function dropFavoriteCard(targetKey: string) { reorderFavoriteCard(targetKey, true) }
function startFavoritePointer(event: PointerEvent, key: string) {
 if (!favoriteReordering.value || event.button !== 0) return
 draggedFavoriteKey.value = key
 ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
 event.preventDefault()
}
function moveFavoritePointer(event: PointerEvent) {
 if (!favoriteReordering.value || !draggedFavoriteKey.value) return
 const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-favorite-key]')
 const targetKey = target?.dataset.favoriteKey
 if (targetKey) reorderFavoriteCard(targetKey)
}
function finishFavoritePointer(event: PointerEvent) {
 const element = event.currentTarget as HTMLElement
 if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
 draggedFavoriteKey.value = ''
}

</script>
<template>
 <section class="video-workspace" :class="{'library-settings-page':route==='library'}" :aria-label="title" @keydown.esc="context=undefined;menu=false">
  <UnifiedFilesPage ref="fileMenu" menus-only @select-source="id=>emit('source',id)" @open-folder="folder=>emit('folder',folder)" @server-route="(id,route)=>emit('server',id,route)" @reorder-favorites="startFavoriteReordering"/><MediaMetadataEditorModal :visible="!!editing" :item="metadataTarget" @close="editing=undefined" @save="saveOriginalMetadata"/><MediaPersonalRatingModal/><CustomMediaSeriesModal/><MediaShareModal/><TraktAccount v-if="traktVisible" :visible="traktVisible" @close="traktVisible=false" @progress="importTrakt"/>
  <Teleport to="body"><div v-if="context&&!context.item" class="source-context-dismiss" @pointerdown="context=undefined" @contextmenu.prevent="context=undefined"><div class="source-context-menu" role="menu" :style="{left:context.x+'px',top:context.y+'px'}" @pointerdown.stop><LibraryObjectActions :route="context.route==='library-shortcuts'?'library':context.route" @action="context=undefined"/></div></div></Teleport>
  <Teleport v-if="toolbarTarget&&toolbarReady" :to="toolbarTarget"><div v-if="!detail" class="library-tools"><div v-if="isSearchPage" class="source-scope search-scopes" role="group" :aria-label="t('unified.sourceScope')"><button :class="{active:!localOnly}" @click="localOnly=false">媒体库</button><button :class="{active:localOnly}" @click="localOnly=true">本地文件</button><button v-for="server in sources.accounts.filter(a=>['jellyfin','emby','plex'].includes(a.providerId))" :key="server.id" @click="emit('server',server.id,{kind:'search',query:query||'',title:query||'搜索'})">{{server.name}}</button></div><button v-if="isSearchPage" class="round-button" :aria-label="mode==='grid'?t('mediaServer.listView'):t('mediaServer.gridView')" @click="mode=mode==='grid'?'list':'grid'"><Grid2X2 v-if="mode==='grid'" :size="18"/><List v-else :size="18"/></button>        <div v-if="isCategoryPage && !isSearchPage && !isLibrarySettingsPage && !isServerCategoryPage && !isGenreIndexPage" class="source-scope" role="group" :aria-label="t('unified.sourceScope')">
          <button :class="{ active: !localOnly }" :aria-pressed="!localOnly" @click="localOnly = false">{{ t('unified.allSources') }}</button>
          <button :class="{ active: localOnly }" :aria-pressed="localOnly" @click="localOnly = true">{{ t('unified.localFiles') }}</button>
        </div>
        <button v-if="section === 'home'" class="round-button" :disabled="refreshing" :aria-label="t('common.refresh')" @click="refresh()"><MediaLoadingIndicator v-if="refreshing" :size="18" /><RefreshCw v-else :size="18" /></button>
        <button v-if="section === 'home'" class="round-button" data-testid="unified-manage-home" :aria-label="t('media.manager')" @click="showHomeManagement = true"><List :size="18" /></button>
        <button v-if="section === 'home'" class="round-button" aria-label="Trakt" title="Trakt" @click="showTraktAccount = true"><TraktAvatar v-if="traktStatus.connected" :src="traktAccount?.avatar" :size="32" /><img v-else :src="traktLogo" alt="Trakt" width="26" height="26" /></button>
        <button v-if="(isCategoryPage || isServerRootPage || isFolderPage || section === 'files') && !isGenreIndexPage && !isLibrarySettingsPage && !isSearchPage" class="round-button" :aria-label="collectionMode === 'grid' ? t('mediaServer.listView') : t('mediaServer.gridView')" @click="collectionMode = collectionMode === 'grid' ? 'list' : 'grid'"><Grid2X2 v-if="collectionMode === 'grid'" :size="18" /><List v-else :size="18" /></button>
        <button v-if="section === 'collection' && (browseSelection || playlistReordering)" class="round-button" @click="browseSelection = false; selectedObjectItems = []; playlistReordering = false; libraryBrowser?.finishReorder()">{{ t('unified.reorderDone') }}</button>
        <a-dropdown v-if="isCategoryPage && !isServerCategoryPage && !isGenreIndexPage && !isLibrarySettingsPage && !isSearchPage && (isCatalogPage ? isCatalogMediaPage : !['local:daily', 'local:top-rated', 'local:playlist', 'custom-series'].includes(selectedHomeRowKey) && !selectedHomeRowKey.startsWith('local:playlist:group:'))" trigger="click" position="br">
          <button class="round-button more-button server-sort-button" :aria-label="t('unified.sortLabel')"><span>{{ t(`unified.sort.${browseSort}`) }}</span><ArrowDown v-if="browseSortDescending" :size="16" /><ArrowUp v-else :size="16" /></button>
          <template #content>
            <div class="server-sort-menu" role="menu">
              <button v-for="sort in (['title', 'fileName', 'addedAt', 'premiereDate'] as MediaBrowseSort[])" :key="sort" role="menuitemradio" :aria-checked="browseSort === sort" @click="selectBrowseSort(sort)"><ArrowDown v-if="browseSort === sort && browseSortDescending" :size="13" /><ArrowUp v-else-if="browseSort === sort" :size="13" /><span v-else class="sort-menu-spacer" /><span>{{ t(`unified.sort.${sort}`) }}</span></button>
            </div>
          </template>
        </a-dropdown>
<a-dropdown v-if="section!=='home'&&!isLibrarySettingsPage&&!isSearchPage" trigger="click" position="br"><button class="round-button more-button" :aria-label="t('media.manager')"><Ellipsis :size="18"/><ChevronDown :size="10"/></button><template #content>            <template v-if="isCatalogPage && selectedHomeRowKey === 'catalog:favorites'">
              <a-doption class="unified-action-option server-root-option" @click="favoritesSortByTitle = !favoritesSortByTitle"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t('unified.sort.title') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="hideFavoritesShelf"><template #icon><House :size="14" /></template>{{ t('unified.removeHome') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="renameCurrentHomeMenu"><template #icon><Pencil :size="14" /></template>{{ t('unified.renameCollection') }}</a-doption>
              <a-doption class="unified-action-option server-root-option" @click="startFavoriteReordering"><template #icon><Move :size="14" /></template>{{ t('unified.sourceReorder') }}</a-doption>
            </template>
            <template v-else-if="isCatalogPage">
              <a-doption v-if="isCatalogMediaPage" class="unified-action-option browse-sort-option" @click="browseSort = nextMediaBrowseSort(browseSort)"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t(`unified.sort.${browseSort}`) }}</a-doption>
              <LibraryObjectActions :route="selectedHomeRowKey.slice(8)" toolbar />
            </template>
            <template v-else-if="selectedHomeRowKey.startsWith('custom-series:') && section === 'collection'">
              <a-doption class="unified-action-option browse-sort-option" @click="browseSort = nextMediaBrowseSort(browseSort)"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t(`unified.sort.${browseSort}`) }}</a-doption>
              <LibraryObjectActions :route="'custom-series/' + selectedHomeRowKey.slice('custom-series:'.length)" toolbar />
            </template>
            <template v-else-if="isCategoryPage">
              <a-doption v-if="!isGenreIndexPage" class="unified-action-option" :disabled="section !== 'video'" @click="browseSelection = !browseSelection"><template #icon><SquareCheck :size="14" /></template>{{ t('unified.selectItems') }}</a-doption>
              <a-doption v-if="section !== 'collection' || !['local:playlist', 'custom-series'].includes(selectedHomeRowKey) && !isGenreIndexPage" class="unified-action-option browse-sort-option" @click="browseSort = nextMediaBrowseSort(browseSort)"><template #icon><ListFilter :size="14" /></template>{{ t('unified.sortLabel') }}: {{ t(`unified.sort.${browseSort}`) }}</a-doption>
              <a-doption v-if="!isGenreIndexPage" class="unified-action-option" :disabled="section !== 'video'" @click="videoView?.playBrowse('play')"><template #icon><Play :size="14" /></template>{{ t('unified.play') }}</a-doption>
              <a-doption v-if="!isGenreIndexPage" class="unified-action-option" :disabled="section !== 'video'" @click="videoView?.playBrowse('loop')"><template #icon><RefreshCw :size="14" /></template>{{ t('unified.loopPlay') }}</a-doption>
              <a-doption v-if="!isGenreIndexPage" class="unified-action-option" :disabled="section !== 'video'" @click="videoView?.playBrowse('shuffle')"><template #icon><Shuffle :size="14" /></template>{{ t('unified.shufflePlay') }}</a-doption>
              <LibraryObjectActions v-if="activeHomeMenuId" :route="categoryRouteForHomeId(activeHomeMenuId)" toolbar />
            </template>
</template></a-dropdown></div></Teleport>
  <a-modal v-model:visible="showHomeManagement" modal-class="unified-home-management-modal" :width="660" :footer="false" :closable="false" :hide-title="true" unmount-on-close :body-style="{padding:'0'}"><HomeManagement :items="managedRoutes" :groups="managementGroups" :settings="managementSettings" :placement-state="id=>placement.state(categoryRouteForHomeId(id))" @save="saveHomeSettings" @reset="placement.restoreOrder" @rename="placement.renameHome" @remove-placement="id=>placement.change(categoryRouteForHomeId(id),'remove')" @close="showHomeManagement=false"/></a-modal>
  <p v-if="statisticsLoading" role="status">正在读取服务器统计…</p><p v-for="stat in serverStatistics.filter(stat=>stat.error)" :key="stat.id" role="alert">{{stat.error}}（统计未完整汇总）<button @click="loadStatistics">重试统计</button></p><p v-if="error||catalog.error" role="alert">{{error||catalog.error}}</p>
  <div v-if="catalog.scanning" class="scan-status" role="status">正在扫描 {{sourceName(catalog.scanSource)}} · {{catalog.scanCount}} 个视频 <Button variant="ghost" @click="catalog.cancelScan">停止</Button></div>
<div v-if="route==='search'&&!toolbarTarget" class="scope" aria-label="搜索范围"><button :aria-pressed="!localOnly" @click="localOnly=false">媒体库</button><button :aria-pressed="localOnly" @click="localOnly=true">本地文件</button><button v-for="server in sources.accounts.filter(a=>['jellyfin','emby','plex'].includes(a.providerId))" :key="server.id" @click="emit('server',server.id,{kind:'search',query:query||'',title:query||'搜索'})">{{server.name}}</button></div>
  <MediaDetail v-if="current" :media-item="originalItem(current,currentFiles)" :active-playlist-name="route.startsWith('playlist/')?decode(route.slice(9)):undefined" :playlist-items="rows.map(item=>originalItem(item))" @back="detail=undefined" @metadata-updated="()=>catalog.load()" @open-playlist-item="item=>{const native=nativeItem(item);if(native)detail=native.id}" @tag-click="detailTag" @ai-rescrape="item=>{const native=nativeItem(item);if(native)edit(native)}"/>
  <template v-else>
        <section v-if="selectedHomeRowKey === 'library-index'" class="library-settings" data-testid="library-settings">
          <button class="library-settings-option" @click="showTraktAccount = true">Trakt · {{ t('trakt.account') }}</button>
          <div class="library-statistics"><div v-for="stat in libraryStatisticsOriginal" :key="stat.label"><strong>{{ stat.count }}</strong><span>{{ stat.label }}</span></div></div>
          <div v-for="group in librarySourceGroupsOriginal" :key="group.key" class="library-source-group"><h2>{{ group.title }}</h2><label v-for="source in group.sources" :key="source.key" class="library-settings-option"><input type="checkbox" :checked="!homePreferences.hidden.includes(source.key)" @change="toggleLibrarySource(source.key, ($event.target as HTMLInputElement).checked)" /><span>{{ source.title }}</span></label></div>
          <label class="library-settings-option library-visibility"><input type="checkbox" :checked="!homePreferences.hidden.includes('library')" @change="toggleLibrarySource('library', ($event.target as HTMLInputElement).checked)" /><span>{{ t('librarySettings.showLibrary') }}</span></label>
          <div class="library-refresh-actions"><button :disabled="libraryScanning || metadataRefreshing || media.isScanning" @click="rescanLibraryFolders"><Search :size="16" />{{ t('librarySettings.refreshLibrary') }}</button><button :disabled="metadataRefreshing || libraryScanning || media.isScanning" @click="refreshLibraryMetadata"><RefreshCw :size="16" :class="{ spinning: metadataRefreshing }" />{{ t('librarySettings.refreshMetadata') }}</button></div>
        </section>
      <div v-if="section === 'home' || (section === 'collection' && selectedHomeRowKey === 'sources')" class="unified-home" :class="{ 'source-screen-empty': section === 'home' && homeIsEmpty }" ref="homeElement" @scroll="section === 'home' && (homeScrollTop = ($event.target as HTMLElement).scrollTop)">
        <ServerHomeSections v-if="section==='home'" :accounts="homeServerAccounts" hide-favorites @items="serverManagementItems=$event" @navigate="(id,route)=>emit('server',id,route)"/><UnifiedMediaRow v-for="row in originalRows.filter(item => item.key === 'resume')" v-show="!(section === 'collection' && selectedHomeRowKey === 'sources')" :key="row.key" :row="row" />
        <template v-for="entry in (section === 'home' && homeIsEmpty ? [] : homeLayout)" :key="entry.item.id">
        <section v-if="entry.item.id === 'sources'" class="home-row source-shortcuts">
          <div class="row-heading"><h2>{{ entry.item.title }}</h2><button @click="openHomeMenu('sources')">{{ t('mediaServer.seeAllPlain') }}</button></div>
          <div class="horizontal-row">
            <button v-for="card in favoritePageCards" :key="card.key" class="favorite-shortcut favorite-library" :data-favorite-key="card.key" :class="favoriteCardClasses(card.key)" @click="card.action" @contextmenu.prevent="openFavoriteCardMenu($event, card.key)">
              <div class="favorite-shortcut-art"><img v-if="favoriteCover(card.key)" class="favorite-shortcut-cover" :src="favoriteCover(card.key)" alt="" draggable="false" /><MediaServerIcon v-else-if="sourceServer(card.key)" :server="sourceServer(card.key)!" :size="70" /><component :is="libraryCategoryIcon(card.key)" v-else :size="70" :stroke-width="2.8" aria-hidden="true" /></div>
              <strong>{{ card.title }}</strong>
            </button>
          </div>
        </section>
        <HomeShelfViewport v-else-if="entry.row" v-show="!(section === 'collection' && selectedHomeRowKey === 'sources')" :snapshot="homeShelfSnapshot(entry.item.id)" :landscape="entry.row.landscape" @visible="visible => homeRowVisibility(entry.item.id, visible)"><UnifiedMediaRow :row="entry.row" /></HomeShelfViewport>
        </template>
        <div v-if="section === 'home' && homeIsEmpty && refreshing" class="unified-loading-state"><MediaLoadingIndicator /></div>
        <SourceEmptyState v-if="section === 'home' && homeIsEmpty && !refreshing" home @add="showAddFileSource = true" />
      </div>
        <div v-if="isCatalogPage && selectedHomeRowKey === 'catalog:favorites'" class="favorite-page-wrap" :class="{ 'is-reordering': favoriteReordering }">
          <div v-if="favoriteReordering" class="source-reorder-hint" role="status"><span>{{ t('unified.dragSourceHint') }}</span><button @click="finishFavoriteReordering">{{ t('unified.reorderDone') }}</button></div>
          <div class="favorite-page-grid" data-testid="library-favorites">
          <button v-for="card in favoritePageCards" :key="card.key" :data-favorite-key="card.key" class="favorite-shortcut favorite-library" :class="[favoriteCardClasses(card.key), { 'source-dragging': draggedFavoriteKey === card.key }]" :draggable="favoriteReordering ? 'true' : 'false'" @dragstart="startFavoriteDrag($event, card.key)" @dragenter.prevent @dragover.prevent="$event.dataTransfer && ($event.dataTransfer.dropEffect = 'move')" @drop.prevent="dropFavoriteCard(card.key)" @dragend="draggedFavoriteKey = ''" @pointerdown="startFavoritePointer($event, card.key)" @pointermove="moveFavoritePointer" @pointerup="finishFavoritePointer" @pointercancel="finishFavoritePointer" @click="favoriteReordering ? undefined : card.action()" @contextmenu.prevent="!favoriteReordering && openFavoriteCardMenu($event, card.key)"><div class="favorite-shortcut-art"><img v-if="favoriteCover(card.key)" class="favorite-shortcut-cover" :src="favoriteCover(card.key)" alt="" draggable="false" /><MediaServerIcon v-else-if="sourceServer(card.key)" :server="sourceServer(card.key)!" :size="70" /><component :is="libraryCategoryIcon(card.key)" v-else :size="70" :stroke-width="2.8" aria-hidden="true" /></div><strong>{{ card.title }}</strong></button>
          </div>
        </div>

  <UnifiedMediaRow v-else-if="selectedHomeRow" :row="selectedHomeRow" :mode="mode" :show-more="false"/><UnifiedLibraryBrowser v-else-if="route!=='home'&&route!=='library'" ref="libraryBrowser" :route="route==='library-shortcuts'?'library':route" :mode="collectionMode" :sort="browseSort" :sort-descending="browseSortDescending" :local-only="localOnly" :daily-items="dailyRecommendations" :card="localCard" :selection="browseSelection?selectedObjectKeys:undefined" @navigate="showCatalog" @title="catalogTitle=$event" @play="playCatalog" @custom-series="showCustomSeries" @placement="handleCatalogPlacement"/>
  </template>
  <section v-if="reorderRoute" class="shelf"><h2>重新排序</h2><div v-for="item in filter(reorderRoute)" :key="item.id" class="source-option"><span>{{item.name}}</span><Button variant="ghost" aria-label="上移成员" @click="reorder(item.id,-1)">↑</Button><Button variant="ghost" aria-label="下移成员" @click="reorder(item.id,1)">↓</Button></div><Button @click="reorderRoute=''">完成</Button></section>
  <div v-if="selected.length||selectionMode" class="poster-selection-bar"><span>{{t('posterMenu.selectedCount',{count:selected.length})}}</span><button @click="selectionMode=false;selected=[]">{{t('common.cancel')}}</button></div>
    <a-modal :visible="!!playlistAssignment" :title="t('media.playlist')" @cancel="playlistAssignment = undefined" @ok="savePlaylistAssignment"><a-checkbox-group v-if="playlistAssignment" v-model="playlistAssignment.selected" :options="Object.keys(media.playlists)" /><a-input v-model="playlistCreateName" :placeholder="t('libraryObject.newPlaylist')" /></a-modal>
    <a-modal :visible="!!objectPrompt" :title="objectPrompt?.action === 'delete' ? t(objectPrompt.route.startsWith('playlist/') ? 'libraryObject.deletePlaylist' : 'libraryObject.deleteSeries') : t(objectPrompt?.route.startsWith('playlist/') ? 'libraryObject.renamePlaylist' : 'customSeries.rename')" @cancel="objectPrompt = undefined" @ok="saveObjectPrompt"><a-input v-if="objectPrompt?.action === 'rename'" v-model="objectPrompt.value" @press-enter="saveObjectPrompt" /><p v-else>{{ objectPrompt?.value }}</p></a-modal>
    <a-modal :visible="!!catalogPlacement" :title="catalogPlacement?.action === 'home' ? t('libraryBrowse.addHome') : catalogPlacement?.action === 'favorite' ? t('unified.addToFavorites') : t('unified.renameCollection')" @cancel="catalogPlacement = undefined; categoryFavoriteQueue = []" @ok="saveCatalogPlacement"><a-input v-if="catalogPlacement" v-model="catalogPlacement.name" @press-enter="saveCatalogPlacement" /></a-modal>
    <a-modal v-model:visible="renameVisible" :title="t('unified.renameCollection')" @ok="saveCollectionName"><a-input v-model="renameText" /></a-modal>
<a-modal :visible="prompt?.kind==='remove'" title="从媒体库移除" @cancel="prompt=undefined" @ok="savePrompt"><p>只移除媒体库关联，保留来源文件。</p></a-modal>

 </section>
</template>
<style scoped>
.source-reorder-hint{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:16px;color:var(--color-text-3);font-size:13px}
.source-reorder-hint button{background:transparent;border:0;color:#ff8700;font:inherit;cursor:pointer;padding:8px 12px}
.file-source-handle{display:flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;cursor:grab;touch-action:none}
.file-source-handle:active,.is-reordering .file-source-card:active{cursor:grabbing}
.is-reordering:not(.file-source-list) .file-source-card{cursor:grab;animation:source-card-wiggle .24s ease-in-out infinite alternate;transform-origin:50% 55%}
.is-reordering:not(.file-source-list) .file-source-card:nth-child(even){animation-delay:-.12s}
.favorite-page-wrap.is-reordering .favorite-shortcut{cursor:grab;animation:source-card-wiggle .24s ease-in-out infinite alternate;transform-origin:50% 55%;-webkit-user-drag:element;user-select:none}
.favorite-page-wrap.is-reordering .favorite-shortcut:nth-child(even){animation-delay:-.12s}
.favorite-page-wrap.is-reordering .favorite-shortcut:active{cursor:grabbing}
.file-source-card.source-dragging{position:relative;z-index:10;opacity:1;animation:none!important;transition:none!important;pointer-events:none;cursor:grabbing;background:var(--color-bg-1);box-shadow:0 12px 32px #0006;border-radius:10px}
.file-source-list .file-source-card{transition:transform .16s ease;user-select:none}
.file-source-card.source-drop-target .file-source-art{outline:2px solid #ff8700;outline-offset:3px}
@keyframes source-card-wiggle{from{transform:rotate(-.7deg)}to{transform:rotate(.7deg)}}
@media(prefers-reduced-motion:reduce){.is-reordering:not(.file-source-list) .file-source-card,.favorite-page-wrap.is-reordering .favorite-shortcut{animation:none;outline:1px dashed #ff8700;outline-offset:4px}}
.favorite-page-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,220px));gap:30px 24px}
.favorite-page-grid .favorite-shortcut{width:100%}
.source-shortcuts .row-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.source-shortcuts .row-heading h2{margin:0}
.source-shortcuts .row-heading button{border:0;background:transparent;color:#ff8000;cursor:pointer}
.unified-loading-state{display:flex;align-items:center;justify-content:center;min-height:56vh}
.unified-toolbar .round-button{padding:0;box-sizing:border-box;overflow:hidden;place-items:center}
.unified-library{display:flex;height:100%;min-height:0;background:var(--color-bg-1);color:var(--color-text-1)}
:global(#xbybody .unified-library .music-pane), :global(#xbybody .unified-library .music-pane .unified-toolbar){background:#000!important}
.unified-sidebar{display:flex;flex-direction:column;min-height:0;overflow:hidden!important}
.sidebar-navigation{flex:1;min-height:0;overflow-y:auto}
.sidebar-footer{flex-shrink:0;padding-top:12px}
.sidebar-footer-toggle{margin-bottom:24px;transform:rotate(90deg);color:var(--color-text-3)!important}
.unified-sidebar.collapsed{width:76px!important;padding:16px 10px}
.collapsed .nav-children,.collapsed .group-toggle,.collapsed .group-heading span,.collapsed .sidebar-search input{display:none!important}
.collapsed .group-header{justify-content:center;margin-top:20px}
.collapsed .group-heading{justify-content:center!important;padding:10px!important}
.collapsed .sidebar-search{justify-content:center;padding:10px;cursor:text}
.unified-sidebar{width:258px;flex-shrink:0;padding:18px 12px;overflow-y:auto;border-right:1px solid var(--color-border-2);background:var(--color-bg-2)}
.sidebar-search{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--color-border-2);border-radius:20px;margin-bottom:18px;color:var(--color-text-3)}
.sidebar-search input{width:100%;min-width:0;border:0;outline:none;background:transparent;color:var(--color-text-1)}
button{font:inherit;color:inherit;cursor:pointer}
.group-heading,.nav-children button{display:flex;align-items:center;gap:12px;border:0;background:transparent;width:100%;border-radius:9px;text-align:left;min-height:39px;padding:8px 12px}
.group-heading{font-weight:600;margin:12px 0 4px}.group-heading span{flex:1}.group-header{display:flex;align-items:center}.group-header .group-heading{flex:1}.group-toggle{background:transparent;border:0;border-radius:50%;padding:8px}.unified-sidebar svg{color:#ff8b25;flex-shrink:0}.nav-children{padding-left:14px}.nav-children span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.unified-sidebar button:hover,.unified-sidebar .selected{background:var(--color-fill-3)}
.library-scan-status{display:flex;align-items:center;gap:10px;flex-shrink:0;padding:10px 20px;border-bottom:1px solid var(--color-border-2);background:var(--color-bg-2);color:var(--color-text-1);font-size:13px}.library-scan-status>svg{color:#ff8800}.library-scan-count{color:var(--color-text-3)}
.unified-pane{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}.unified-toolbar{height:56px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--color-border-2)}
.unified-toolbar h1{font-size:15px;font-weight:600;margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.unified-toolbar{gap:12px}.round-button{display:grid;place-items:center;border:1px solid var(--color-border-2);background:var(--color-fill-1);border-radius:50%;width:36px;height:36px;flex-shrink:0}.round-button:disabled{cursor:wait;opacity:.6}.add-source{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:20px;padding:10px 16px;background:#ff8b25;color:#fff}button:focus-visible{outline:2px solid #ff8b25;outline-offset:2px}
.unified-home{flex:1;overflow-y:auto;padding:24px 28px}.home-row{margin-bottom:26px}h2{font-size:19px;font-weight:600;margin:0 0 14px}
:global(body #xbybody .unified-library .music-pane > .unified-toolbar) { background:#fafbfc!important; color:#20242c; border-bottom-color:#e9ecf0; }
:global(body[arco-theme='dark'] #xbybody .unified-library .music-pane > .unified-toolbar) { background:#181c1f!important; color:#edf0f2; border-bottom-color:#292e33; }
:global(body[arco-theme='dark'] #xbybody .unified-library .unified-home:not(.category-collection)){background:#1e1e1e!important}
:global(body[arco-theme='dark'] .search-pane){background:#1e1e1e}.search-pane .unified-toolbar{border-bottom:0}.search-pane .sidebar-search-results{padding-top:0}
.sidebar-search-results{height:100%;min-height:0}.search-result-group{margin:0 12px 32px}.search-result-group>h2{font-size:22px;margin:0 0 14px}.search-scopes{max-width:60%;overflow-x:auto;white-space:nowrap}.search-clear{padding:0!important;min-width:20px}.search-result-group :deep(.mode-grid .horizontal-row){grid-template-columns:repeat(8,minmax(0,1fr));gap:22px 20px}@media(max-width:1400px){.search-result-group :deep(.mode-grid .horizontal-row){grid-template-columns:repeat(6,minmax(0,1fr))}}@media(max-width:1050px){.search-result-group :deep(.mode-grid .horizontal-row){grid-template-columns:repeat(4,minmax(0,1fr))}}
.collection-empty-folder{border:1px solid var(--color-border-1);border-radius:24px;background:#000;min-height:100%}
.sort-option{display:block;width:100%;text-align:left;padding:10px;border:0;background:transparent;color:var(--color-text-1)}.sort-option:hover{background:var(--color-fill-3)}
.unified-toolbar{position:relative}.source-scope{position:absolute;left:50%;transform:translateX(-50%);display:flex;padding:3px;border:1px solid var(--color-border-2);border-radius:22px;background:var(--color-fill-1)}.source-scope button{border:0;background:transparent;border-radius:18px;padding:5px 18px;font-size:13px;color:var(--color-text-3)}.source-scope button.active{background:var(--color-fill-4);color:var(--color-text-1)}.category-collection{padding:16px}.ranking-empty{padding:80px 24px;text-align:center;color:var(--color-text-3)}.more-button{display:flex;align-items:center;justify-content:center;gap:2px;width:48px;border-radius:22px}
.horizontal-row{display:flex;align-items:flex-start;gap:24px;overflow-x:auto;padding:3px 0 10px;scrollbar-width:none}
.horizontal-row::-webkit-scrollbar{display:none}
.favorite-shortcut{padding:0;border:0;background:transparent;color:var(--color-text-1);width:172px;flex-shrink:0;text-align:left;cursor:pointer}
.favorite-shortcut-art{aspect-ratio:1.8;height:auto;border-radius:10% / 18%;display:flex;align-items:center;justify-content:center;color:#ffffffb8;background:linear-gradient(90deg,#ff5b00,#ff9600)}
.favorite-shortcut-art :deep(svg),.favorite-shortcut-art :deep(.media-server-provider-icon){width:48px!important;height:48px!important}
.favorite-shortcut-art{position:relative;overflow:hidden}.favorite-shortcut-cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.favorite-movies .favorite-shortcut-art{background:linear-gradient(90deg,#0075ff,#17c9e8)}
.favorite-tv .favorite-shortcut-art{background:linear-gradient(90deg,#ff1c61,#e434f1)}
.favorite-other .favorite-shortcut-art{background:linear-gradient(90deg,#20c866,#08dfc2)}
.favorite-music .favorite-shortcut-art{background:linear-gradient(90deg,#3288c8,#25c1df)}
.favorite-book .favorite-shortcut-art{background:linear-gradient(110deg,#777036,#b6a644)}
.favorite-server .favorite-shortcut-art{background:linear-gradient(90deg,#7229a7,#a32bf1)}
.favorite-folder .favorite-shortcut-art{background:linear-gradient(90deg,#ff8500,#ffc326)}
.favorite-shortcut strong{display:block;margin-top:8px;font-size:14px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.source-shortcuts .horizontal-row{gap:24px}
:global(#xbybody .unified-home.library-settings-page){background:#1e1e1e!important;}
.library-settings-page{background:#1e1e1e;min-height:calc(100% - 60px)}.library-settings-page .library-settings-option,.library-settings-page .library-statistics>div{background:#2c2c2c;color:#ddd}.library-settings{width:min(660px,calc(100% - 48px));margin:18px auto 60px;padding:0;color:var(--color-text-1)}.library-statistics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:26px}.library-statistics>div{display:flex;flex-direction:column;gap:5px;border-radius:10px;background:var(--color-fill-2);padding:13px}.library-statistics strong{color:#ff8b25;font-size:18px}.library-statistics span,.library-source-group h2{color:var(--color-text-3);font-size:13px}.library-source-group{margin-bottom:26px}.library-source-group h2{font-weight:500;margin:0 0 9px}.library-settings-option{display:flex;align-items:center;gap:16px;background:var(--color-fill-2);padding:17px 18px;border-radius:10px;font-size:14px;margin-top:8px;cursor:pointer}.library-settings-option input{accent-color:#0099ff;width:13px;height:13px}.library-visibility{margin-top:46px}.library-refresh-actions{display:flex;gap:28px;margin-top:18px}.library-refresh-actions button{display:flex;align-items:center;gap:8px;color:var(--color-text-2);border:0;background:transparent;font-size:13px;cursor:pointer}.library-refresh-actions button:disabled{opacity:.4}:global(body[arco-theme="dark"]) .library-settings{color:#ddd}:global(body[arco-theme="dark"]) .library-settings-option,:global(body[arco-theme="dark"]) .library-statistics>div{background:#2c2c2c}
.library-index{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:24px 22px;padding:8px 16px}
.library-index-card{min-width:0;padding:0;border:0;background:transparent;color:var(--color-text-1);text-align:left}
.library-index-art{aspect-ratio:2/3;border-radius:14px;background:var(--color-fill-2);display:flex;align-items:center;justify-content:center;color:#ff8b25}
:global(body[arco-theme="dark"]) .library-index-art{background:#202424}
.library-index-card strong{display:block;margin-top:10px;font-size:13px;font-weight:600}
.library-index-list{grid-template-columns:1fr}
.library-index-list .library-index-card{display:flex;align-items:center;gap:22px;padding:12px 0;border-bottom:1px solid var(--color-border-2)}
.library-index-list .library-index-art{width:98px;height:147px;flex-shrink:0}
@media(max-width:1100px){.library-index{grid-template-columns:repeat(5,minmax(0,1fr))}.library-index-list{grid-template-columns:1fr}}
@media(max-width:800px){.library-index{grid-template-columns:repeat(3,minmax(0,1fr))}.library-index-list{grid-template-columns:1fr}.favorite-page-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}}
.source-card{width:180px;height:112px;flex-shrink:0;background:#a85332;border:0;border-radius:16px;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}.source-card span{max-width:calc(100% - 20px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.music-source{background:#345d8b}.book-source{background:#777036}.server-source{background:#704c89}.folder-source{background:#927123}
.source-list{overflow:auto;flex:1;padding:0 18px}.source-list>button{display:flex;align-items:center;gap:18px;padding:16px;width:100%;border:0;border-bottom:1px solid var(--color-border-2);background:transparent;text-align:left}.source-list strong{flex:1}.source-list span{color:var(--color-text-3)}.source-art{width:86px;height:125px;display:grid;place-items:center;border-radius:9px;background:var(--color-fill-2);color:#ff8b25}.source-chevron{transform:rotate(180deg)}
.source-item{display:flex;align-items:center;border-bottom:1px solid var(--color-border-2);padding-right:16px}.source-open{display:flex;align-items:center;gap:18px;padding:16px;flex:1;min-width:0;border:0;background:transparent;text-align:left}.source-open strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-art{flex-shrink:0}
.embedded-workspace{flex:1;min-height:0;overflow:hidden}.home-empty{display:flex;align-items:center;flex-direction:column;padding:40px;color:var(--color-text-3);gap:12px}.load-error{padding:12px;background:var(--color-fill-2);border-radius:8px;margin-bottom:14px}.load-error button{background:transparent;border:0;color:#ff8b25}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}@media(max-width:1050px){.unified-sidebar{width:220px}.unified-home{padding:20px}}
.server-category-subtitle{margin-left:14px}.unified-toolbar .server-sort-button{display:flex;width:auto;min-width:72px;max-width:240px;gap:7px;padding:0 12px;border-radius:20px;background:var(--color-fill-3);color:#ff8700;white-space:nowrap}.server-sort-button span{overflow:hidden;text-overflow:ellipsis}.sort-menu-spacer{width:13px;flex-shrink:0}.server-sort-menu{min-width:132px;padding:4px;color:var(--color-text-1);max-height:calc(100vh - 90px);overflow-y:auto}.server-sort-menu button{display:flex;align-items:center;gap:7px;width:100%;min-height:25px;padding:3px 7px;border:0;border-radius:4px;background:transparent;color:inherit;font-size:13px;text-align:left;white-space:nowrap;cursor:pointer}.server-sort-menu button:hover,.server-sort-menu button:focus-visible{background:var(--color-fill-3)}.server-sort-menu .invisible{visibility:hidden}.server-sort-divider{height:1px;margin:5px 3px;background:var(--color-border-2)}
:global(.arco-dropdown-option.unified-action-option){box-sizing:border-box;min-width:190px;width:max-content!important;max-width:calc(100vw - 48px);padding:0 12px!important;line-height:28px!important;margin:2px 4px!important;font-size:13px}:global(.unified-action-option .arco-dropdown-option-icon){display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:16px;margin-right:9px}:global(.unified-action-option .arco-dropdown-option-content){white-space:nowrap;line-height:28px}:global(.unified-action-option svg){display:block;flex-shrink:0}
:global(.arco-dropdown-option.server-root-option){min-width:132px;padding:0 8px!important;margin:1px 3px!important;line-height:25px!important}:global(.server-root-option .arco-dropdown-option-icon){color:#ff8b25!important}
:global(.arco-dropdown-option.browse-sort-option){color:#fff!important}:global(.browse-sort-option .arco-dropdown-option-icon){color:#ff8800!important}
.source-screen-empty{display:flex;flex-direction:column}.source-screen-empty>.source-empty-state{flex:1;min-height:0}
.file-source-browser.file-sources-empty{display:flex;align-items:stretch}.file-sources-empty>.source-empty-state{flex:1;min-height:0}
.file-source-browser{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,174px);align-content:start;gap:22px;padding:22px 36px}.file-source-card{padding:0;border:0;background:transparent;color:var(--color-text-1);text-align:left}.file-source-art{position:relative;aspect-ratio:2/3;border-radius:16px;background:var(--color-fill-2);display:grid;place-items:center;color:#ff8b25}.file-source-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit}.file-source-art input{position:absolute;top:8px;right:8px}.file-source-card strong{display:block;font-size:13px;margin-top:10px}.file-source-list{display:flex;flex-direction:column;padding:0 16px;gap:0}.file-source-list .file-source-card{display:flex;align-items:center;gap:16px;padding:16px;border-bottom:1px solid var(--color-border-2)}.file-source-list .file-source-art{width:86px;height:129px;flex-shrink:0;border-radius:8px}.file-source-list strong{margin:0;font-size:14px}.file-source-subtitle{display:block;margin-top:4px;font-size:12px;font-weight:400;color:var(--color-text-3)}.file-source-handle{margin-left:auto;color:var(--color-text-3)}.file-source-add{background:#ff8700!important;color:white!important;border-radius:22px}
.file-source-art :deep(img.media-server-provider-icon) { position: static; inset: auto; object-fit: contain; border-radius: 0 }
.file-source-art img.file-source-provider-icon{position:static;width:56px;height:56px;object-fit:contain;border-radius:0}
.file-source-list .file-source-art img.file-source-provider-icon{width:28px;height:28px}
.file-sidebar-provider-icon{width:18px;height:18px;flex-shrink:0;object-fit:contain}
:global(.arco-dropdown:has([data-folder-option])){border-radius:12px!important;border:1px solid var(--color-border-3)!important;padding:4px!important;box-shadow:0 12px 24px rgba(0,0,0,.2)}
</style>

<style>
.file-source-selection-bar{position:fixed;right:20px;bottom:36px;z-index:100;display:flex;align-items:center;gap:16px;max-width:calc(100vw - 300px);padding:10px 14px;border:1px solid var(--color-border-2);border-radius:24px;background:var(--color-bg-popup);color:var(--color-text-1);box-shadow:0 6px 20px #0003;overflow-x:auto;white-space:nowrap;font-size:12px}
.file-source-selection-bar button{display:flex;align-items:center;gap:6px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;white-space:nowrap}.file-source-selection-bar button svg{color:#ff8800}.file-source-selection-bar button:disabled{opacity:.4;cursor:not-allowed}.file-source-selection-bar .danger svg{color:#ff375f}.file-source-card.source-selected .file-source-art{background:#684220!important;outline:1px solid #ff8800}.file-source-card.source-selected input{accent-color:#ff8800}.file-source-browser:has(+ .file-source-selection-bar){padding-bottom:90px}
.source-context-dismiss{position:fixed;inset:0;z-index:2000}
.source-context-menu{position:absolute;min-width:145px;padding:5px;border:1px solid var(--color-border-3);border-radius:12px;background: var(--app-overlay-bg);box-shadow:0 10px 26px #0004;color:var(--color-text-1)}
.source-context-menu button{display:flex;align-items:center;gap:7px;width:100%;min-height:25px;padding:3px 8px;border:0;border-radius:5px;background:transparent;color:inherit;font-size:13px;cursor:pointer;text-align:left}
.source-context-menu button svg{color:#ff8700;flex-shrink:0}.source-context-menu button:hover,.source-context-menu button:focus-visible{background:var(--color-fill-3)}
body[arco-theme='dark'] .source-context-menu{background: var(--app-overlay-bg);color:#e5e5e5;border-color:#484848}
.source-reorder>div{display:flex;gap:8px;align-items:center;padding:8px}.source-reorder span{flex:1}.source-reorder button{border:0;background:var(--color-fill-2);color:var(--color-text-1);padding:6px;border-radius:5px}
</style>

<style scoped>
.favorite-playlist .favorite-shortcut-art { background:linear-gradient(90deg,#ff452c,#ff9f57); }
</style>

<style scoped>
.video-workspace{padding:0;display:flex;flex-direction:column;height:100%}.unified-home{flex:1}.library-browser{padding:20px 30px}.library-tools{display:flex;align-items:center;gap:12px}.unified-home .source-shortcuts{margin-bottom:32px}
</style>
