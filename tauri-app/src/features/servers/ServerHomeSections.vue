<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import type {Account} from '../sources/contracts'
import {browseServer,categories,collectPlayable,setWatched,type BrowseRoute,type ServerItem} from './workspace'
import {useVideoCatalog,type VideoItem} from '../library/catalog'
import {serverFavorite} from '../sources/mediaServer'
import {serverArtwork} from '../sources/serverMetadata'
import {deleteServerMedia} from '../sources/playlists'
import {generalPreferences} from '../library/displayPreferences'
import {nativeCall} from '@/platform/native'
import WorkspaceContextMenu from '../library/WorkspaceContextMenu.vue'
import type {MenuEntry} from '../library/workspaceMenus'
import {readPreferences,writePreferences,preferenceKey,type ServerPreferences,type Favorite} from './preferences'
import type {HomeManagementItem} from '../library/unifiedHomeManagement'
import {useLibraryNavigation} from '@/stores/libraryNavigation'
import {useFileSourcesStore} from '@/stores/fileSources'
import SourceManager from '../sources/SourceManager.vue'
import SourceCardMenu from '../files/SourceCardMenu.vue'
import ServerRating from './ServerRating.vue'
import ServerShare from './ServerShare.vue'
import ServerResumeRow from './electron/ServerResumeRow.vue'
import ServerPosterRow from './electron/ServerPosterRow.vue'
import UnifiedMediaRow from '../library/electron/UnifiedMediaRow.vue'
import HomeShelfViewport from '../library/electron/HomeShelfViewport.vue'
import type {UnifiedLibraryRow} from '../library/electron/types'
import ServerArtwork from './ServerArtwork.vue'
const props=defineProps<{accounts:Account[];manager?:boolean;favoritesOnly?:boolean;hideFavorites?:boolean}>()
const emit=defineEmits<{navigate:[accountId:string,route:BrowseRoute];items:[items:HomeManagementItem[]]}>()
interface ServerHome{account:Account;preferences:ServerPreferences;libraries:ServerItem[];rows:{key:string;title:string;route:BrowseRoute;items:ServerItem[];error?:string}[];error?:string}
const navigation=useLibraryNavigation(),sources=useFileSourcesStore(),sourceManager=ref(false),reordering=ref(false)
const servers=ref<ServerHome[]>([]),loading=ref(false)
const sourceContext=ref<{id:string;x:number;y:number}>(),ratingItem=ref<ServerItem>(),ratingAccount=ref(''),shareItem=ref<ServerItem>()
const deleting=ref<{account:Account;item:ServerItem}>()
const catalog=useVideoCatalog(),error=ref(''),busy=ref(false)
const context=ref<{server:ServerHome;route:BrowseRoute;item?:ServerItem;favorite?:Favorite;x:number;y:number}>()
const prompt=ref<{server:ServerHome;favorite:Favorite;kind:'rename'|'cover'|'add';value:string}>()
function openMenu(event:MouseEvent,server:ServerHome,route:BrowseRoute,item?:ServerItem,favorite?:Favorite){context.value={server,route,item,favorite,x:event.clientX,y:event.clientY}}
const menuEntries=computed<MenuEntry[]>(()=>{const target=context.value;if(!target)return[];const base=[{id:'play',label:'播放'},{id:'loop',label:'循环播放'},{id:'shuffle',label:'随机播放'}];if(target.item){const item=target.item,tv=['series','show','season'].includes(item.kind),ids=tv?['play','loop','shuffle','rating','favorite','refresh','watched','playlist','delete']:['play','loop','rating','share','download','refresh','watched','favorite','playlist','delete'];const labels:Record<string,string>={play:'播放',loop:'循环播放',shuffle:'随机播放',rating:'个人评分',favorite:item.favorite?'取消收藏':'收藏',refresh:'刷新',watched:item.watched?'标记为未观看':'标记为已观看',playlist:'播放列表',share:'分享',download:'下载',delete:'删除'};return ids.filter(id=>id!=='delete'||generalPreferences.fileManagement).map(id=>({id,label:labels[id]!,disabled:id==='playlist'||id==='rating'&&item.kind==='season'||id==='download'&&!item.playable}))};if(target.favorite?.content)return [...base,{id:'favorite',label:'收藏'},{id:'cover',label:'选择封面'}];return [...base,...(target.favorite?[{id:'removeFavorite',label:'从收藏夹移除'},{id:'rename',label:'重命名收藏夹'},{id:'hide',label:target.favorite.hiddenOnHome?'在主屏幕显示':'在主屏幕隐藏'},{id:'cover',label:'选择封面'}]:[{id:'addFavorite',label:'添加到收藏夹'}])]})
function playResume(server:ServerHome,route:BrowseRoute,item:ServerItem){context.value={server,route,item,x:0,y:0};void action('play')}
async function action(id:string){const target=context.value;if(!target)return;context.value=undefined;error.value='';busy.value=true;try{
 if(['play','loop','shuffle'].includes(id)){const rows=target.item?.playable?[target.item]:await collectPlayable(target.server.account,target.route);const items=rows.map(item=>({id:JSON.stringify([target.server.account.id,item.id]),sourceId:target.server.account.id,fileId:item.id,fileName:item.name,name:item.name,type:item.kind==='movie'?'movie':'tv',local:false,addedAt:'',genres:item.genres||[],size:0} as VideoItem));await catalog.playMany(items,id as 'play'|'loop'|'shuffle')}
 else if(id==='delete'&&target.item)deleting.value={account:target.server.account,item:target.item}
 else if(id==='rating'&&target.item){ratingAccount.value=target.server.account.id;ratingItem.value=target.item}
 else if(id==='share'&&target.item)shareItem.value=target.item
 else if(id==='download'&&target.item)await nativeCall('source_download',{accountId:target.server.account.id,fileId:target.item.id,name:target.item.name})
 else if(id==='watched'&&target.item){await setWatched(target.server.account,target.item.id,!target.item.watched);await load()}
 else if(id==='favorite'){const item=target.item;if(item)await serverFavorite(target.server.account,item.id,!item.favorite);else if(target.route.id)await serverFavorite(target.server.account,target.route.id,true);await load()}
 else if(id==='refresh')await load()
 else if(id==='addFavorite'){const key=JSON.stringify([target.route.kind,target.route.id||'',target.route.category||'',target.route.favoriteType||'']);prompt.value={server:target.server,favorite:{key,title:target.route.title,route:target.route},kind:'add',value:target.route.title}}
 else if(target.favorite){if(id==='rename'||id==='cover')prompt.value={server:target.server,favorite:target.favorite,kind:id,value:id==='rename'?target.favorite.title:target.favorite.cover||''};else save(target.server,{...target.server.preferences,favorites:id==='removeFavorite'?target.server.preferences.favorites.filter(value=>value.key!==target.favorite!.key):target.server.preferences.favorites.map(value=>value.key===target.favorite!.key?{...value,hiddenOnHome:!value.hiddenOnHome}:value)})}
 }catch(cause){error.value=(cause as Error).message}finally{busy.value=false}}
async function removeItem(){const target=deleting.value;if(!target)return;busy.value=true;error.value='';try{await deleteServerMedia(target.account,target.item);deleting.value=undefined;await load()}catch(cause){error.value=(cause as Error).message}finally{busy.value=false}}
function savePrompt(){const value=prompt.value;if(!value)return;if(value.kind!=='cover'&&!value.value.trim())return;if(value.kind==='cover'&&(/^https?:|^\/\//i.test(value.value))){error.value='请选择此服务器中的封面路径';return}const preferences=readPreferences(value.server.account.id);save(value.server,{...preferences,favorites:value.kind==='add'?[...preferences.favorites.filter(favorite=>favorite.key!==value.favorite.key),{...value.favorite,title:value.value.trim()}]:preferences.favorites.map(favorite=>favorite.key===value.favorite.key?{...favorite,...(value.kind==='rename'?{title:value.value.trim()}:{cover:value.value.trim()})}:favorite)});prompt.value=undefined}
const orderedServers=computed(()=>[...servers.value].sort((a,b)=>{const order=sources.preferences.order,ai=order.indexOf(a.account.id),bi=order.indexOf(b.account.id);return (ai<0?99999:ai)-(bi<0?99999:bi)}))
function moveSource(id:string,offset:number){const order=sources.cards.map(card=>card.id),index=order.indexOf(id),target=index+offset;if(index<0||target<0||target>=order.length)return;[order[index],order[target]]=[order[target]!,order[index]!];sources.reorder(order)}
const artwork=ref<Record<string,string>>({}),pendingArtwork=new Set<string>(),visibleShelves=new Set<string>()
function clearArtwork(){for(const value of Object.values(artwork.value))URL.revokeObjectURL(value);artwork.value={};pendingArtwork.clear()}
async function visibleArtwork(server:ServerHome,row:ServerHome['rows'][number],visible:boolean){const shelfKey=server.account.id+':'+row.key;if(!visible){visibleShelves.delete(shelfKey);return}visibleShelves.add(shelfKey);const attempt=generation;for(const item of row.items){const key=server.account.id+':'+item.id;if(!item.imagePath||artwork.value[key]||pendingArtwork.has(key))continue;pendingArtwork.add(key);try{const url=await serverArtwork(server.account,row.key==='resume'?item.backdropPath||item.imagePath:item.imagePath);if(attempt!==generation)URL.revokeObjectURL(url);else artwork.value={...artwork.value,[key]:url}}catch{}finally{pendingArtwork.delete(key)}}}
onUnmounted(clearArtwork)
const shelfSnapshots=new Map<string,{height?:number;scrollLeft?:number}>()
function snapshot(key:string){let value=shelfSnapshots.get(key);if(!value){value={};shelfSnapshots.set(key,value)}return value}
function originalServerRow(server:ServerHome,row:ServerHome['rows'][number]):UnifiedLibraryRow{return {key:row.key==='resume'?'resume':server.account.id+':'+row.key,title:row.title+' - '+server.account.name,landscape:row.key==='resume'||!server.preferences.portrait,error:row.error,retry:load,more:()=>emit('navigate',server.account.id,row.route),cards:row.items.map(item=>({key:server.account.id+':'+item.id,title:item.name,image:artwork.value[server.account.id+':'+item.id],rating:item.rating,overview:item.overview,progress:item.progress,action:()=>row.key==='resume'?playResume(server,row.route,item):emit('navigate',server.account.id,{kind:item.isDirectory?'children':'detail',id:item.id,title:item.name}),posterMenu:{server:true,tv:['series','show','season'].includes(item.kind),watched:!!item.watched,favorite:!!item.favorite,disabled:['playlist',...(!item.playable?['download' as const]:[])],action:id=>{context.value={server,route:row.route,item,x:0,y:0};void action(id)}}}))}}
let generation=0
function choices(server:ServerHome){return [...categories.map(category=>({key:category.id,title:category.title,route:{kind:'category' as const,category:category.id,title:category.title}})),...server.libraries.map(library=>({key:'library:'+library.id,title:library.name,route:{kind:'children' as const,id:library.id,title:library.name}}))]}
async function load(){
 const current=++generation;clearArtwork();loading.value=true
 const values=await Promise.all(props.accounts.filter(account=>['jellyfin','emby','plex'].includes(account.providerId)).map(async(account)=>{
  const server:ServerHome={account,preferences:readPreferences(account.id),libraries:[],rows:[]}
  try{server.libraries=(await browseServer(account,{kind:'root',title:'媒体库'},{limit:100})).items}catch(cause){server.error=(cause as Error).message}
  if(!props.manager&&!props.favoritesOnly){server.rows=await Promise.all(server.preferences.home.flatMap(key=>choices(server).find(choice=>choice.key===key)||[]).map(async(choice)=>{
   try{return {...choice,items:(await browseServer(account,choice.route,{limit:24})).items}}
   catch(cause){return {...choice,items:[],error:(cause as Error).message}}
  }))}
  return server
 }))
 if(current===generation){servers.value=values;loading.value=false;for(const server of values)for(const row of server.rows)if(visibleShelves.has(server.account.id+':'+row.key))void visibleArtwork(server,row,true)}
}
function save(server:ServerHome,value:ServerPreferences){try{writePreferences(server.account.id,value);server.preferences=value;window.dispatchEvent(new CustomEvent('boxplayer:server-home-changed',{detail:server.account.id}))}catch(cause){server.error=(cause as Error).message}}
function toggle(server:ServerHome,key:string,checked:boolean){save(server,{...server.preferences,home:checked?[...new Set([...server.preferences.home,key])]:server.preferences.home.filter(value=>value!==key)})}
function move(server:ServerHome,key:string,offset:number){const keys=[...server.preferences.home],index=keys.indexOf(key),target=index+offset;if(index<0||target<0||target>=keys.length)return;[keys[index],keys[target]]=[keys[target]!,keys[index]!];save(server,{...server.preferences,home:keys})}
const items=computed<HomeManagementItem[]>(()=>servers.value.flatMap(server=>choices(server).map(choice=>({id:server.account.id+':'+choice.key,title:choice.title,sourceId:server.account.id,sourceTitle:server.account.name,available:true,optIn:true}))))
watch(items,value=>{emit('items',value);navigation.setServerMenus(servers.value.flatMap(server=>server.preferences.home.flatMap(key=>{const choice=choices(server).find(choice=>choice.key===key);return choice?[{accountId:server.account.id,id:server.account.id+':'+key,title:choice.title+' - '+server.account.name,route:choice.route}]:[]})))},{immediate:true})
watch(()=>[props.accounts.map(account=>account.id+account.baseUrl).join('|'),props.manager,props.favoritesOnly],()=>void load(),{immediate:true})
function refresh(event?:Event){if(event instanceof StorageEvent&&!event.key?.startsWith('boxplayer:server-workspace:'))return;void load()}
onMounted(()=>{window.addEventListener('storage',refresh);window.addEventListener('boxplayer:server-home-changed',refresh)})
onUnmounted(()=>{generation++;window.removeEventListener('storage',refresh);window.removeEventListener('boxplayer:server-home-changed',refresh)})
</script>
<template>
 <div class="server-home-sections" :aria-busy="busy"><p v-if="error" role="alert">{{error}}</p><div v-if="deleting" class="server-prompt-mask"><form role="dialog" aria-label="删除服务器媒体" @submit.prevent="removeItem"><h3>删除 {{deleting.item.name}}？</h3><p>此操作会请求媒体服务器删除媒体文件。</p><button :disabled="busy" type="submit">确认删除</button><button :disabled="busy" type="button" @click="deleting=undefined">取消</button></form></div><SourceCardMenu v-if="sourceContext" :source-id="sourceContext.id" :x="sourceContext.x" :y="sourceContext.y" @close="sourceContext=undefined" @reorder="reordering=true;sourceContext=undefined" @reauthorize="sourceManager=true;sourceContext=undefined"/><SourceManager v-if="sourceManager" @close="sourceManager=false" @saved="sources.refresh();sourceManager=false"/><ServerRating v-if="ratingItem" :account-id="ratingAccount" :item="ratingItem" @close="ratingItem=undefined"/><ServerShare v-if="shareItem" :item="shareItem" @close="shareItem=undefined"/><WorkspaceContextMenu v-if="context" :x="context.x" :y="context.y" :entries="menuEntries" label="服务器分类菜单" @action="action" @close="context=undefined"/><div v-if="prompt" class="server-prompt-mask"><form role="dialog" @submit.prevent="savePrompt"><h3>{{prompt.kind==='add'?'添加到收藏夹':prompt.kind==='rename'?'重命名收藏夹':'选择封面'}}</h3><input v-model="prompt.value" :aria-label="prompt.kind!=='cover'?'名称':'服务器封面路径'"/><button type="submit">保存</button><button type="button" @click="prompt=undefined">取消</button></form></div>
  <p v-if="loading&&accounts.length" role="status">正在读取服务器…</p>
  <template v-for="server in orderedServers" :key="server.account.id">
   <section v-if="manager" class="server-home-manager"><h3>{{server.account.name}}</h3><p v-if="server.error" role="alert">{{server.error}} <button @click="load">重试</button></p><label v-for="choice in choices(server)" :key="choice.key"><input type="checkbox" :checked="server.preferences.home.includes(choice.key)" @change="toggle(server,choice.key,($event.target as HTMLInputElement).checked)"/><span>{{choice.title}}</span><button aria-label="上移" @click.prevent="move(server,choice.key,-1)">↑</button><button aria-label="下移" @click.prevent="move(server,choice.key,1)">↓</button></label></section>
   <template v-else>
    <section v-if="!hideFavorites" class="server-home-favorites"><header><h2>{{server.account.name}}</h2><button @click="emit('navigate',server.account.id,{kind:'root',title:'媒体库'})">查看全部</button></header><div class="server-home-cards"><div role="button" tabindex="0" class="server-source-card" @contextmenu.prevent="sourceContext={id:server.account.id,x:$event.clientX,y:$event.clientY}" @click="emit('navigate',server.account.id,{kind:'root',title:'媒体库'})"><span class="source-symbol">▣</span><strong>{{server.account.name}}</strong><span v-if="reordering"><button aria-label="前移来源" @click.stop="moveSource(server.account.id,-1)">↑</button><button aria-label="后移来源" @click.stop="moveSource(server.account.id,1)">↓</button><button @click.stop="reordering=false">完成</button></span></div><button v-for="favorite in server.preferences.favorites.filter(favorite=>favoritesOnly||!favorite.hiddenOnHome)" :key="favorite.key" @click="emit('navigate',server.account.id,favorite.route)" @contextmenu.prevent="openMenu($event,server,favorite.route,undefined,favorite)"><div class="favorite-art"><ServerArtwork v-if="favorite.cover" :account="server.account" :path="favorite.cover" :alt="favorite.title"/><span v-else>☆</span></div><strong>{{favorite.title}}</strong></button></div></section>
    <p v-if="server.error" role="alert">{{server.error}} <button @click="load">重试</button></p>
    <template v-for="row in server.rows.filter(row=>row.items.length||row.error)" :key="row.key"><HomeShelfViewport @visible="visible=>visibleArtwork(server,row,visible)" :snapshot="snapshot(server.account.id+':'+row.key)" :landscape="row.key==='resume'||!server.preferences.portrait"><UnifiedMediaRow :row="originalServerRow(server,row)"/></HomeShelfViewport></template>

   </template>
  </template>
 </div>
</template>
<style scoped>
.server-prompt-mask{position:fixed;inset:0;background:#0004;display:grid;place-items:center;z-index:550}.server-prompt-mask form{padding:24px;background:var(--background);border-radius:14px;display:grid;gap:14px}.server-prompt-mask input{padding:8px;border:1px solid var(--border);border-radius:6px}.server-home-sections{display:grid;gap:26px}h2{font-size:19px;margin:0}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}header button{color:var(--primary)}.server-home-cards{display:flex;gap:20px;overflow:auto;padding:4px}.server-home-cards>button,.server-home-cards>.server-source-card{flex:0 0 150px;min-width:0;text-align:left}.server-home-cards strong,.server-home-cards small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:8px}.server-home-poster{aspect-ratio:2/3;border-radius:12px;overflow:hidden}.server-source-card,.favorite-art{border-radius:12px;background:var(--secondary)}.server-source-card{text-align:center!important;min-height:160px;padding:16px}.source-symbol,.favorite-art>span{color:var(--primary);font-size:48px}.favorite-art{height:120px;display:grid;place-items:center;overflow:hidden}.server-home-manager label{display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid var(--border)}.server-home-manager label span{flex:1}.server-home-manager h3{margin:12px 0}.server-home-manager button{padding:6px 10px;color:var(--primary)}[role=alert]{color:#b93838}
</style>
