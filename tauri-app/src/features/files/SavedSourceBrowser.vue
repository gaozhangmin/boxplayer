<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { ArrowLeft, Folder, File, Film, Star, Download, RefreshCw } from 'lucide-vue-next'
import { nativeCall, asAppError } from '@/platform/native'
import { driver, playSource } from '@/features/sources/drivers'
import { readPreferences, writePreferences, putFavorite, routeKey } from '@/features/servers/preferences'
import type { BrowseRoute } from '@/features/servers/workspace'
import { serverFavorite } from '@/features/sources/mediaServer'
import { useFileSourcesStore } from '@/stores/fileSources'
import { useVideoCatalog } from '@/features/library/catalog'
import { toggleFolderFavorite, type FolderCatalog } from '@/features/files/folderFavorites'
import type { LocalListing } from '@/platform/contracts'
import type { SourceEntry } from '@/features/sources/contracts'
const props=defineProps<{sourceId?:string;device?:boolean;folderCatalog?:FolderCatalog}>()
const sources=useFileSourcesStore(),catalog=useVideoCatalog()
interface Row extends SourceEntry {path:string;modified?:number;deviceFolder?:boolean}
const rows=ref<Row[]>([]),loading=ref(false),error=ref(''),cursor=ref<string>(),path=ref(''),localSourceId=ref('')
const history=ref<{sourceId:string;path:string;name:string}[]>([])
const account=computed(()=>sources.accounts.find(a=>a.id===props.sourceId))
const local=computed(()=>!account.value)
const sourceId=computed(()=>account.value?.id||localSourceId.value||props.sourceId||'')
const server=computed(()=>!!account.value&&['jellyfin','emby','plex'].includes(account.value.providerId))
const atDevice=computed(()=>props.device&&!localSourceId.value)
const busy=ref(false),downloading=ref('')
const pending=ref<{row:Row;remove:boolean}>(),favoriteName=ref('')
let generation=0
onUnmounted(()=>{generation++})
function serverContent(row:Row){return ['Series','Season','show','season','Movie','movie','Episode','episode','Video'].includes(row.serverType||'')}
function favoriteRoute(row:Row):BrowseRoute{return !history.value.length?{kind:'category',category:'all',id:row.id,libraryId:row.id,title:row.name}:{kind:'children',id:row.id,libraryId:history.value[1]?.path||path.value,title:row.name}}
function isFavorite(row:Row){if(server.value){if(serverContent(row))return !!row.favorite;return readPreferences(sourceId.value).favorites.some(f=>f.key===routeKey(favoriteRoute(row)))}if(row.deviceFolder)return !sources.preferences.hiddenLocalRoots[row.id];if(local.value&&!row.path)return !sources.preferences.hiddenLocalRoots[sourceId.value];return sources.preferences.favorites.some(f=>f.sourceId===sourceId.value&&f.path===row.path)}
async function load(next?:string){
 const current=++generation;error.value='';cursor.value=undefined
 if(atDevice.value){rows.value=sources.snapshot.localFolders.map(f=>({id:f.id,name:f.name,path:'',deviceFolder:true,isDirectory:true,size:0,playable:false}));loading.value=false;return}
 if(!sourceId.value)return
 loading.value=true
 try{if(account.value){const page=await driver(account.value).list(account.value,path.value,next);if(current!==generation)return;const mapped=page.entries.map(row=>({...row,path:row.id}));rows.value=next?[...rows.value,...mapped]:mapped;cursor.value=page.nextCursor}
 else{const result=await nativeCall<LocalListing>('local_list',{sourceId:sourceId.value,relativePath:path.value});if(current!==generation)return;rows.value=result.entries.map(row=>({...row,path:row.relativePath}))}}
 catch(cause){if(current===generation)error.value=asAppError(cause).message}finally{if(current===generation)loading.value=false}
}
watch(()=>[props.sourceId,props.device],()=>{generation++;history.value=[];localSourceId.value='';path.value='';rows.value=[];void load()},{immediate:true})
async function open(row:Row){if(row.isDirectory){history.value.push({sourceId:localSourceId.value,path:path.value,name:row.name});if(row.deviceFolder)localSourceId.value=row.id;path.value=row.path;rows.value=[];await load();return}try{if(account.value)await playSource(account.value,row,rows.value);else await nativeCall('player_open_local',{sourceId:sourceId.value,relativePath:row.path})}catch(cause){error.value=asAppError(cause).message}}
async function back(){const previous=history.value.pop();if(!previous)return;localSourceId.value=previous.sourceId;path.value=previous.path;rows.value=[];await load()}
function requestFavorite(row:Row){pending.value={row,remove:isFavorite(row)};favoriteName.value=row.name==='所有文件夹'?(local.value?sources.snapshot.localFolders.find(f=>f.id===sourceId.value)?.name||'所有文件':'所有文件'):row.name}
async function applyFavorite(){const current=pending.value;if(!current||busy.value)return;busy.value=true;try{if(server.value&&account.value){if(serverContent(current.row)){await serverFavorite(account.value,current.row.id,!current.row.favorite);current.row.favorite=!current.row.favorite}else{const preferences=readPreferences(account.value.id),route=favoriteRoute(current.row);writePreferences(account.value.id,current.remove?{...preferences,favorites:preferences.favorites.filter(f=>f.key!==routeKey(route))}:putFavorite(preferences,route,favoriteName.value.trim()||current.row.name));window.dispatchEvent(new CustomEvent('boxplayer:server-home-changed',{detail:account.value.id}))}}else await toggleFolderFavorite(sources,props.folderCatalog||catalog,current.row.deviceFolder?current.row.id:sourceId.value,current.row.path,favoriteName.value.trim()||current.row.name,local.value);pending.value=undefined}catch(cause){error.value=asAppError(cause).message}finally{busy.value=false}}
async function download(row:Row){if(!account.value||downloading.value)return;downloading.value=row.id;try{await nativeCall('source_download',{accountId:account.value.id,fileId:row.id,name:row.name})}catch(cause){error.value=asAppError(cause).message}finally{downloading.value=''}}
function description(row:Row){const date=row.modified?new Date(row.modified<1e12?row.modified*1000:row.modified).toLocaleDateString():'';const size=row.isDirectory?'':row.size>=1024**3?(row.size/1024**3).toFixed(1)+' GB':row.size>=1024**2?(row.size/1024**2).toFixed(1)+' MB':Math.ceil(row.size/1024)+' KB';return [date,size].filter(Boolean).join(' - ')}
const rootRow=computed<Row>(()=>({id:'',path:'',name:'所有文件夹',isDirectory:true,playable:false,size:0}))
</script>
<template>
 <section class="saved-browser" aria-label="已保存来源文件浏览">
  <div class="saved-browser-toolbar"><button v-if="history.length" aria-label="返回上一级" :disabled="loading" @click="back"><ArrowLeft :size="18"/></button><span>{{history.at(-1)?.name||'所有文件'}}</span><button aria-label="刷新文件列表" :disabled="loading" @click="load()"><RefreshCw :size="17"/></button></div>
  <p v-if="error" role="alert">{{error}}</p><p v-if="loading" role="status">正在加载文件…</p>
  <div v-if="!atDevice&&!path&&!loading" class="compact-row"><button class="compact-main" @click="load()"><Folder :size="21"/><span>所有文件夹</span></button><button :disabled="busy||server" :aria-label="isFavorite(rootRow)?'取消收藏 所有文件夹':'收藏 所有文件夹'" @click="requestFavorite(rootRow)"><Star :size="19" :fill="isFavorite(rootRow)||server?'currentColor':'none'"/></button></div>
  <div v-for="row in rows" :key="row.id" class="compact-row"><button class="compact-main" :disabled="!row.isDirectory&&!row.playable" @click="open(row)"><component :is="row.isDirectory?Folder:row.playable?Film:File" :size="21"/><span><strong>{{row.name}}</strong><small v-if="description(row)">{{description(row)}}</small></span></button><button v-if="row.isDirectory" :disabled="busy" :aria-label="(isFavorite(row)?'取消收藏 ':'收藏 ')+row.name" @click="requestFavorite(row)"><Star :size="19" :fill="isFavorite(row)?'currentColor':'none'"/></button><button v-else-if="row.playable" :disabled="local||!!downloading" :aria-label="'下载 '+row.name" @click="download(row)"><Download :size="19"/></button></div>
  <button v-if="cursor" :disabled="loading" @click="load(cursor)">加载更多</button><div v-if="!rows.length&&!loading&&!error" class="saved-empty"><strong>空文件夹</strong><p>这儿什么都没有。</p></div>
  <form v-if="pending" class="favorite-prompt" role="dialog" :aria-label="pending.remove?'移除文件夹收藏':'添加文件夹收藏'" @submit.prevent="applyFavorite"><p v-if="pending.remove">移除收藏及不再被其他收藏覆盖的媒体记录？不会删除文件。</p><label v-else>收藏名称<input v-model="favoriteName" aria-label="收藏名称"/></label><button type="submit" :disabled="busy">{{pending.remove?'移除':'保存'}}</button><button type="button" :disabled="busy" @click="pending=undefined">取消</button></form>
 </section>
</template>
<style scoped>
.saved-browser{padding:8px 24px 24px;overflow:auto;flex:1;position:relative}.saved-browser-toolbar{display:flex;align-items:center;gap:12px;min-height:38px}.saved-browser-toolbar span{flex:1}.saved-browser button{border:0;background:transparent;color:inherit;cursor:pointer;padding:8px}.saved-browser button:disabled{opacity:.45;cursor:default}.compact-row{display:flex;align-items:center;min-height:52px;border-bottom:1px solid var(--border)}.compact-main{display:flex;align-items:center;gap:12px;min-width:0;flex:1;text-align:left}.compact-main svg{color:var(--primary);flex-shrink:0}.compact-main span{min-width:0}.compact-main strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500}.compact-main small{display:block;font-size:11px;color:var(--muted-text)}.compact-row>button:not(.compact-main){color:var(--primary)}.saved-empty{text-align:center;margin:64px 0;color:var(--muted-text)}.favorite-prompt{position:sticky;bottom:0;border:1px solid var(--border);background:var(--background);border-radius:10px;padding:16px}.favorite-prompt input{display:block;padding:8px;margin:8px 0;width:100%}
</style>
