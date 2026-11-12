<script setup lang="ts">
import MediaMetadataEditorModal from './electron/MediaMetadataEditorModal.vue'
import MediaPersonalRatingModal from './electron/MediaPersonalRatingModal.vue'
import MediaShareModal from './electron/MediaShareModal.vue'
import MediaCollectionPicker from './electron/MediaCollectionPicker.vue'
import type {MediaLibraryItem} from './electron/mediaTypes'
import {openMediaShare} from './electron/mediaShare'
import FilesFolderToolbar from './electron/FilesFolderToolbar.vue'
import MediaEmptyFolder from './electron/MediaEmptyFolder.vue'
import NativeFilesDialogs from './adapters/NativeFilesDialogs.vue'
import {useFilesPorts} from './adapters/filesPorts'
import MediaPanRight from './electron/MediaPanRight.vue'
import type {BrowserFile} from './electron/MediaPanRight.vue'
import {decodeLocal,encodeLocal} from './adapters/sourceServices'
import { computed, ref, watch, onUnmounted, onMounted } from 'vue'
import { useVideoCatalog,type VideoItem } from '@/features/library/catalog'
import type { BrowseRoute } from '@/features/servers/workspace'
import { useFileBrowseMode } from './browseMode'
import { toggleFolderFavorite } from './folderFavorites'
import { sortedFiles } from './preferences'
import { nativeCall } from '@/platform/native'
import { driver, playSource } from '@/features/sources/drivers'
import type { SourceEntry } from '@/features/sources/contracts'
import { useI18n } from '@/lib/i18n'
import { useFileSourcesStore } from '@/stores/fileSources'
import { isNative, asAppError, localList, playLocal } from '@/platform/native'
import type { LocalEntry, LocalListing } from '@/platform/contracts'
import type { FileSidebarEntry } from './sidebar'
const props = defineProps<{ source?: FileSidebarEntry; toolbarTarget?: string; searchQuery?: string; searchRevision?: number; folderCatalog?: { scanFolder(sourceId:string,path:string):Promise<unknown>; removeFolder(sourceId:string,path:string):Promise<unknown> } }>()
const toolbarReady=ref(!props.toolbarTarget)
onMounted(()=>{toolbarReady.value=true})
const emit = defineEmits<{ selectSource: [id: string]; menu: [event: MouseEvent]; serverRoute:[accountId:string,route:BrowseRoute];title:[value:string];canGoBack:[value:boolean];goBack:[]; openFolder: [folder: {sourceId:string;path:string;local:boolean;favoriteId:string}] }>()
const { t } = useI18n()
const sources = useFileSourcesStore()
const catalog=useVideoCatalog()
onMounted(()=>{if(isNative())void catalog.load()})
const gridView=useFileBrowseMode()
const openedBookmark=ref<string>()
const currentBookmark=computed(()=>sources.findBookmark(props.source?.favoriteId||openedBookmark.value))


const selection=ref(false), selected=ref<string[]>([]),assignment=ref<{kind:'playlists'|'series';name:string;names:string[]}>()
function selectedFolderItems(){const source=props.source?.sourceId;if(!source)return [];const local=canBrowse.value;return (local?localEntries.value:orderedRemoteEntries.value).filter(row=>row.playable&&!row.isDirectory&&selected.value.includes('relativePath'in row?row.relativePath:row.id)).map(row=>{const fileId='relativePath'in row?row.relativePath:row.id;return catalog.items.find(item=>item.sourceId===source&&item.fileId===fileId)||{id:JSON.stringify([source,row.id]),sourceId:source,fileId,fileName:row.name,name:row.name,type:'unmatched' as const,local,addedAt:new Date().toISOString(),genres:[],size:row.size,folderPath:local?listing.value?.relativePath||'':remotePath.value,catalogRoots:[currentBookmark.value?.path||'']} as VideoItem})}
async function selectedWatched(value:boolean){try{const items=selectedFolderItems();await catalog.update(draft=>{for(const item of items){const stored=draft.items.find(value=>value.id===item.id);if(stored){stored.watched=value;stored.progress=value?100:0}else draft.items.push({...item,watched:value,progress:value?100:0})}})}catch(cause){error.value=asAppError(cause).message}}
async function playFolder(mode:'play'|'loop'|'shuffle'){
 const source=props.source?.sourceId;if(!source)return
 const local=canBrowse.value;let rows:Array<LocalEntry|SourceEntry>=local?[...localEntries.value]:[...orderedRemoteEntries.value]
 try{if(!local&&remoteAccount.value&&cursor.value){let next=cursor.value;const seen=new Set<string>();while(next){if(seen.has(next)){error.value='来源分页重复，无法生成播放列表';return}seen.add(next);const page=await driver(remoteAccount.value).list(remoteAccount.value,remotePath.value,next);rows.push(...page.entries);if(rows.length>10000){error.value='目录过大，请缩小播放范围';return}next=page.nextCursor||''}}}catch(cause){error.value=asAppError(cause).message;return}
 const items=rows.filter(row=>row.playable&&!row.isDirectory).map(row=>({id:JSON.stringify([source,row.id]),sourceId:source,fileId:'relativePath'in row?row.relativePath:row.id,fileName:row.name,name:row.name,type:'unmatched' as const,local,addedAt:'',genres:[],size:row.size}))
 try{await catalog.playMany(items,mode)}catch(cause){error.value=asAppError(cause).message}
}
const filePorts=useFilesPorts((event:string,...args:unknown[])=>{if(event==='selectSource')emit('selectSource',args[0] as string)})
function currentFolderAction(action:string){const card=sources.cards.find(card=>card.id===(currentBookmark.value?.id||props.source?.sourceId));if(card)void filePorts.action((card.favorite||card.local?'folder:':card.server?'server:':'root:')+card.id,action)}
const downloading=ref<string>()
async function download(entry:SourceEntry){const account=remoteAccount.value;if(!account||downloading.value)return;downloading.value=entry.id;try{await nativeCall<boolean>('source_download',{accountId:account.id,fileId:entry.id,name:entry.name})}catch(cause){error.value=asAppError(cause).message}finally{downloading.value=undefined}}
const bookmarkBusy=ref(false)
async function changeBookmark(sourceId:string,path:string,name:string,local:boolean){
 if(bookmarkBusy.value)return
 const folderCatalog=props.folderCatalog||catalog
 bookmarkBusy.value=true
 try{await toggleFolderFavorite(sources,folderCatalog,sourceId,path,name,local)}
 catch(cause){error.value=asAppError(cause).message}finally{bookmarkBusy.value=false}
}
function toggleFolder(path:string,name:string,local:boolean){if(props.source?.sourceId)void changeBookmark(props.source.sourceId,path,name,local)}
function isBookmarked(path:string){return sources.preferences.favorites.some(f=>f.sourceId===props.source?.sourceId&&f.path===path)}
const localEntries=computed(()=>sortedFiles((listing.value?.entries||[]).filter(e=>(!currentBookmark.value||e.isDirectory||e.playable)&&(!props.searchQuery||e.name.toLowerCase().includes(props.searchQuery.toLowerCase()))),sources.preferences.sort,sources.preferences.descending))
const presentationIndex=computed(()=>{
 const files=new Map<string,typeof catalog.items[number]>(),folders=new Map<string,typeof catalog.items[number]>()
 for(const item of catalog.items||[]){files.set(JSON.stringify([item.sourceId,item.fileId]),item);for(const path of new Set(['',...(item.folderAncestors||[]),...(item.folderPath===undefined?[]:[item.folderPath])])){const key=JSON.stringify([item.sourceId,path]);if(!folders.has(key)||(!folders.get(key)?.poster&&item.poster))folders.set(key,item)}}
 return {files,folders}
})
function metadataFor(path:string,directory=false,sourceId=props.source?.sourceId){return (directory?presentationIndex.value.folders:presentationIndex.value.files).get(JSON.stringify([sourceId,path]))}
const browserFiles=computed<BrowserFile[]>(()=>{const sourceId=props.source?.sourceId||'';return (canBrowse.value?localEntries.value:orderedRemoteEntries.value).map(row=>{const local='relativePath'in row,id=local?row.relativePath:row.id;return {file_id:local?encodeLocal(sourceId,id):id,drive_id:local?'local':sourceId,name:row.name,isDir:row.isDirectory,category:row.playable?'video':'',size:row.size,sizeStr:size(row.size),timeStr:'modified'in row?modifiedDate(Number(row.modified)||0):'',path:local?encodeLocal(sourceId,id):id}})})
const rawBrowserId=(id:string)=>canBrowse.value?decodeLocal(id)[1]:id
const browserMedia=computed(()=>new Map(browserFiles.value.flatMap(file=>{const item=metadataFor(rawBrowserId(file.file_id),file.isDir);return item?[[file.file_id,item] as const]:[]})))
const browserPosters=computed(()=>new Map([...browserMedia.value].flatMap(([id,item])=>item.poster?[[id,item.poster] as const]:[])))
const browserSelected=computed(()=>selected.value.map(id=>canBrowse.value?encodeLocal(props.source?.sourceId||'',id):id))
const browserFavorites=computed(()=>browserFiles.value.filter(file=>isBookmarked(rawBrowserId(file.file_id))).map(file=>file.file_id))
function selectBrowserFiles(ids:string[]){selected.value=ids.map(rawBrowserId)}
async function openBrowserFile(file:BrowserFile){const id=rawBrowserId(file.file_id);if(canBrowse.value){const row=localEntries.value.find(row=>row.relativePath===id);if(row)await open(row)}else{const row=orderedRemoteEntries.value.find(row=>row.id===id);if(row)await openRemote(row)}}
async function browserAction(action:string,file:BrowserFile){const id=rawBrowserId(file.file_id);selected.value=[id];if(action==='select'){selection.value=true;return}if(action==='watched'){await selectedWatched(!browserMedia.value.get(file.file_id)?.watched);return}if(action==='playlist'||action==='series'){assignment.value={kind:action==='playlist'?'playlists':'series',name:'',names:[]};return}if(action==='favorite'){toggleFolder(id,file.name,canBrowse.value);return}if(action==='download'){const row=orderedRemoteEntries.value.find(row=>row.id===id);if(row)await download(row);return}if(['play','loop','shuffle'].includes(action)){if(file.isDir){selection.value=false;await openBrowserFile(file);if(!error.value)await playFolder(action as 'play'|'loop'|'shuffle');return}const item=await ensureBrowserMedia(file);await catalog.playMany([item],action as 'play'|'loop'|'shuffle');return}if(action==='continue'){const item=browserMedia.value.get(file.file_id);if(item)await catalog.update(draft=>{const target=draft.items.find(row=>row.id===item.id);if(target){const included=!target.continueHidden&&(target.continueAdded||Number(target.progress)>0);target.continueHidden=!!included;target.continueAdded=!included}});return}const item=await ensureBrowserMedia(file);if(action==='rating')window.dispatchEvent(new CustomEvent('boxplayer:personal-rating',{detail:{...item,type:item.type==='tv'?'tv':'movie'}}));else if(action==='metadata')editingMetadata.value={id:item.id,parentId:'',name:item.name,type:item.type,genres:item.genres,year:item.year,rating:item.rating,overview:item.overview,certification:item.certification,tmdbId:item.tmdbId,posterUrl:item.poster,backdropUrl:item.backdrop,seasons:[],driveFiles:[],addedAt:new Date(item.addedAt)};else if(action==='share')openMediaShare({id:item.id,title:item.name,year:item.year,overview:item.overview,files:[{id:item.fileId,name:item.fileName,userId:item.sourceId,driveId:item.local?'local':item.sourceId,driveServerId:item.sourceId} as never]})}
const editingMetadata=ref<MediaLibraryItem>()
const metadataTarget=computed<MediaLibraryItem>(()=>editingMetadata.value||{id:'',parentId:'',name:'',type:'unmatched',genres:[],driveFiles:[],addedAt:new Date(0)})
async function ensureBrowserMedia(file:BrowserFile){const existing=browserMedia.value.get(file.file_id);if(existing)return existing;const item:VideoItem={id:JSON.stringify([props.source?.sourceId,rawBrowserId(file.file_id)]),sourceId:props.source?.sourceId||'',fileId:rawBrowserId(file.file_id),name:file.name,fileName:file.name,type:'unmatched',local:canBrowse.value,addedAt:new Date().toISOString(),genres:[],size:file.size,folderPath:canBrowse.value?listing.value?.relativePath:remotePath.value};await catalog.update(draft=>{if(!draft.items.some(row=>row.id===item.id))draft.items.push(item)});return item}
async function saveMetadata(value:MediaLibraryItem){await catalog.patch(value.id,{name:value.name,type:value.type,year:value.year,rating:value.rating,certification:value.certification,overview:value.overview,poster:value.posterUrl,backdrop:value.backdropUrl,genres:value.genres||[],tmdbId:value.tmdbId,metadataSource:'manual'});editingMetadata.value=undefined}
const collectionName=ref(''),collectionEditing=ref<string|null>(null)
const collectionRows=computed(()=>assignment.value?Object.entries(catalog.data[assignment.value.kind]).map(([name,ids])=>({id:name,title:name,count:ids.length,selected:assignment.value!.names.includes(name)})):[])
async function toggleCollection(name:string){const value=assignment.value;if(!value)return;value.names=value.names.includes(name)?value.names.filter(entry=>entry!==name):[...value.names,name];await saveAssignmentSelection(false)}
async function saveAssignmentSelection(close:boolean){const target=assignment.value;if(!target)return;const items=selectedFolderItems();await catalog.update(draft=>{for(const item of items)if(!draft.items.some(row=>row.id===item.id))draft.items.push(item);for(const [name,ids] of Object.entries(draft[target.kind]))draft[target.kind][name]=target.names.includes(name)?[...new Set([...ids,...items.map(item=>item.id)])]:ids.filter(id=>!items.some(item=>item.id===id))});if(close)assignment.value=undefined}
async function createCollection(){const target=assignment.value,name=collectionName.value.trim();if(!target||!name)return;await catalog.update(draft=>{draft[target.kind][name]||=[]});collectionName.value='';collectionEditing.value=null}
const orderedRemoteEntries=computed(()=>sortedFiles(remoteEntries.value.filter(e=>!currentBookmark.value||e.isDirectory||e.playable),sources.preferences.sort,sources.preferences.descending))

function closeDetail(){}
onUnmounted(()=>{requestSequence++})
const remoteEntries=ref<SourceEntry[]>([])
const remotePath=ref(''),remoteTitle=ref('')
const remoteHistory=ref<{path:string;query:string;title?:string}[]>([])
const remoteQuery=ref('')
const cursor=ref<string>()
watch(()=>props.source?.sourceId,id=>{if(currentBookmark.value&&currentBookmark.value.sourceId!==id)openedBookmark.value=undefined})
const remoteAccount=computed(()=>sources.accounts.find(a=>a.id===props.source?.sourceId))

async function browseRemote(path='',next?:string,query='',title?:string){
 const account=remoteAccount.value;if(!account)return
 const sequence=++requestSequence;loading.value=true;error.value=''
 try{const protocol=driver(account);if(query&&!protocol.search)throw new Error('此来源不支持搜索');const result=await(query?protocol.search!(account,query,next):protocol.list(account,path,next));if(sequence!==requestSequence)return;remoteEntries.value=next?[...remoteEntries.value,...result.entries]:result.entries;cursor.value=result.nextCursor;remotePath.value=path;remoteQuery.value=query;if(!next)remoteTitle.value=title||(!path?props.source?.title||'':remoteTitle.value)}
 catch(e){if(sequence===requestSequence)error.value=asAppError(e).message}finally{if(sequence===requestSequence)loading.value=false}
}
async function remoteBack(){const previous=remoteHistory.value.pop();if(previous)await browseRemote(previous.path,undefined,previous.query,previous.title)}
async function openRemote(entry:SourceEntry){if(selection.value){selected.value=selected.value.includes(entry.id)?selected.value.filter(id=>id!==entry.id):[...selected.value,entry.id];return}if(entry.isDirectory){remoteHistory.value.push({path:remotePath.value,query:remoteQuery.value,title:remoteTitle.value});await browseRemote(entry.id,undefined,'',entry.name)}else if(remoteAccount.value){try{await playSource(remoteAccount.value,entry,remoteEntries.value)}catch(e){error.value=asAppError(e).message}}}
const listing = ref<LocalListing>()
const folderTitle=computed(()=>{const root=currentBookmark.value?.path||'',path=listing.value?.relativePath||'';return !props.source?t('files'):canBrowse.value?(path&&path!==root?path.split(/[\\/]/).at(-1)||props.source.title:props.source.title):remoteTitle.value||props.source.title})
const error = ref('')
const loading = ref(false)
let requestSequence = 0
const canBrowse = computed(() => props.source?.kind === 'localFolder' || !!currentBookmark.value?.local)
watch(folderTitle,value=>emit('title',value),{immediate:true})
watch(()=>canBrowse.value?!!listing.value?.relativePath&&listing.value.relativePath!==(currentBookmark.value?.path||''):remoteHistory.value.length>0,value=>emit('canGoBack',value),{immediate:true})
function goBack(){if(canBrowse.value&&listing.value?.relativePath&&listing.value.relativePath!==(currentBookmark.value?.path||'')){void browse(listing.value.parentPath||'');return true}if(remoteHistory.value.length){void remoteBack();return true}emit('goBack');return false}
defineExpose({goBack})
async function browse(path = '') {
  if (!props.source?.sourceId || !canBrowse.value) return
  const sequence = ++requestSequence
  loading.value = true; error.value = ''
  try { const result = await localList(props.source.sourceId, path); if (sequence === requestSequence) listing.value = result }
  catch (e) { if (sequence === requestSequence) error.value = asAppError(e).message }
  finally { if (sequence === requestSequence) loading.value = false }
}
watch(() => [props.source?.id,props.searchQuery,props.searchRevision,currentBookmark.value?.id], () => { closeDetail();requestSequence++; listing.value = undefined; error.value = ''; remoteEntries.value=[];remoteHistory.value=[];if (canBrowse.value) void browse(currentBookmark.value?.path||'');else if(remoteAccount.value)void browseRemote(currentBookmark.value?.path||'',undefined,props.searchQuery||'') }, { immediate: true })
async function open(entry: LocalEntry) {if(selection.value){selected.value=selected.value.includes(entry.relativePath)?selected.value.filter(id=>id!==entry.relativePath):[...selected.value,entry.relativePath];return}
  if (entry.isDirectory) { await browse(entry.relativePath); return }
  if (!props.source?.sourceId || !entry.playable) return
  try { await playLocal(props.source.sourceId, entry.relativePath) } catch (e) { error.value = asAppError(e).message }
}
function modifiedDate(value:number){if(!value)return '';return new Date(value<1e12?value*1000:value).toLocaleDateString()}
function size(bytes: number) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB` }
</script>
<template>
  <section class="files-browser" :aria-label="t('files')">
    <Teleport v-if="toolbarReady" :to="toolbarTarget||'body'" :disabled="!toolbarTarget"><FilesFolderToolbar :mode="gridView?'grid':'list'" :descending="sources.preferences.descending" :selection="selection" @mode="gridView=$event==='grid'" @direction="sources.preferences.descending=!sources.preferences.descending" @selection="selection=!selection;selected=[]" @play="playFolder" @remove="currentFolderAction('removeFavoriteFolder')" @rename="currentFolderAction('renameCollection')"/></Teleport>
    <div v-if="selection" class="poster-selection-bar"><span>已选择 {{selected.length}} 项</span><button @click="selection=false;selected=[]">取消</button></div><p v-if="error" role="alert">{{error}}</p>
    <p v-if="loading" role="status">{{ t('loadingFiles') }}</p>
    <MediaEmptyFolder v-else-if="!browserFiles.length"/><MediaPanRight v-else :files="browserFiles" :media="browserMedia" :posters="browserPosters" :selected="browserSelected" :favorite-ids="browserFavorites" :favorite-browse="!!currentBookmark||canBrowse" :browse-mode="gridView?'grid':'list'" :browse-selection="selection" :descending="sources.preferences.descending" @enter-folder="openBrowserFile" @open-file="openBrowserFile" @open-media="item=>catalog.play(item)" @select="selectBrowserFiles" @file-action="browserAction"/>
    <NativeFilesDialogs :ports="filePorts"/><MediaCollectionPicker :visible="!!assignment" :heading="assignment?.kind==='series'?'系列':'播放列表'" item-title="添加到集合" :rows="collectionRows" :editing="collectionEditing" v-model:name="collectionName" :renamable="false" :removable="false" @toggle="toggleCollection" @create="collectionEditing='new'" @cancel-name="collectionEditing=null" @confirm-name="createCollection" @done="saveAssignmentSelection(true)" @close="assignment=undefined"/><MediaMetadataEditorModal :visible="!!editingMetadata" :item="metadataTarget" @close="editingMetadata=undefined" @save="saveMetadata"/><MediaPersonalRatingModal/><MediaShareModal/>  </section>
</template>

<style scoped>.files-browser{display:flex;flex-direction:column;min-height:100%;padding:0}.browser-error{color:#e35d5d}.poster-selection-bar{display:flex;justify-content:space-between;padding:10px 20px;font-size:13px}</style>
