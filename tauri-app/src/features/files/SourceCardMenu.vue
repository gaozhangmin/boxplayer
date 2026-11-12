<script setup lang="ts">
import ElectronModal from '@/components/dialog/ElectronModal.vue'
import ServerEndpoints from '@/features/servers/ServerEndpoints.vue'
import {Play,Shuffle,Star,Pencil,Eye,Move,Image,RefreshCw,Trash2} from 'lucide-vue-next'
import { computed, ref, watch, nextTick } from 'vue'
import { useFileSourcesStore } from '@/stores/fileSources'
import { useVideoCatalog } from '@/features/library/catalog'
import { nativeCall, asAppError } from '@/platform/native'
import type { Account } from '@/features/sources/contracts'
import { toggleFolderFavorite, type FolderCatalog } from './folderFavorites'
import { isCoverDataUri, isPublicCover } from './coverImages'
import { validatedEndpoint } from './sourcePresentation'
const props=defineProps<{sourceId:string;favoriteId?:string;x:number;y:number;folderCatalog?:FolderCatalog;initialAction?:'rename'|'removeFavorite'|'addFavorite'}>()
const emit=defineEmits<{close:[];reorder:[];reauthorize:[]}>()
const sources=useFileSourcesStore(),catalog=useVideoCatalog()
const card=computed(()=>sources.cards.find(c=>c.id===(props.favoriteId||props.sourceId)))
const account=computed(()=>sources.accounts.find(a=>a.id===props.sourceId))
const menuElement=ref<HTMLElement>(),left=ref(props.x),top=ref(props.y)
watch(()=>[props.x,props.y],async()=>{await nextTick();left.value=Math.max(8,Math.min(props.x,window.innerWidth-236));top.value=Math.max(8,Math.min(props.y,window.innerHeight-(menuElement.value?.offsetHeight||300)-8));menuElement.value?.querySelector<HTMLButtonElement>('button')?.focus()},{immediate:true})
const connectionUser=ref(''),connectionPassword=ref(''),connectionRoot=ref(''),originalConnection=ref({username:'',rootPath:''})
const mode=ref('menu'),error=ref(''),busy=ref(false),text=ref(''),address=ref('')
watch(()=>[props.sourceId,props.favoriteId,props.initialAction],()=>{mode.value='menu';error.value='';if(props.initialAction==='removeFavorite')mode.value='removeFavorite';else if(props.initialAction)edit(props.initialAction)},{immediate:true})
const folder=computed(()=>!!card.value&&(card.value.favorite||card.value.local))
const rootFavorite=computed(()=>sources.preferences.favorites.some(f=>f.sourceId===props.sourceId&&f.path===''))
async function run(action:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await action();emit('close')}catch(cause){error.value=asAppError(cause).message}finally{busy.value=false}}
function edit(kind:string){const current=card.value;if(!current)return;const sourceId=props.sourceId;mode.value=kind;text.value=kind==='cover'?sources.preferences.covers[current.id]||'':kind==='addFavorite'?'所有文件':current.name;address.value=account.value?.baseUrl||'';connectionPassword.value='';if(kind==='edit'&&['webdav','smb','nfs','ftp'].includes(account.value?.providerId||'')){void nativeCall<{username:string;rootPath:string;url:string}>(account.value?.providerId==='webdav'?'webdav_connection_info':'network_share_connection_info',{accountId:props.sourceId}).then(value=>{if(!value||mode.value!=='edit'||props.sourceId!==sourceId)return;connectionUser.value=value.username;connectionRoot.value=value.rootPath;address.value=value.url;originalConnection.value={username:value.username,rootPath:value.rootPath}}).catch(()=>{})}}
async function favorite(name='所有文件'){const current=card.value;if(!current)return;await run(()=>toggleFolderFavorite(sources,props.folderCatalog||catalog,current.sourceId,current.favorite?current.path:'',name,current.local))}
async function play(kind:'play'|'loop'|'shuffle'){const current=card.value;if(!current)return;await run(async()=>{await catalog.load();await catalog.playMany(catalog.items.filter(item=>item.sourceId===current.sourceId&&(current.path===''||item.folderPath===current.path||item.folderAncestors?.includes(current.path)||item.catalogRoots?.includes(current.path))),kind)})}
function move(offset:number){const ids=sources.cards.map(c=>c.id),index=ids.indexOf(card.value?.id||''),target=index+offset;if(index>=0&&target>=0&&target<ids.length){[ids[index],ids[target]]=[ids[target]!,ids[index]!];sources.reorder(ids)}}
async function chooseCover(){if(busy.value)return;busy.value=true;error.value='';try{const image=await nativeCall<string|null>('choose_cover_image');if(image){if(!isCoverDataUri(image))throw new Error('所选图片格式无效');text.value=image}}catch(cause){error.value=asAppError(cause).message}finally{busy.value=false}}
async function save(){const current=card.value;if(!current)return;await run(async()=>{
 if(mode.value==='cover'){const cover=text.value.trim();if(cover&&!isPublicCover(cover))throw new Error('请选择本地图片或使用支持的公共图片地址');sources.preferences.covers[current.id]=cover;return}
 const name=text.value.trim();if(!name)throw new Error('请输入名称')
 if(current.favorite){sources.rename(current.id,name);return}
 if(current.local)await nativeCall('local_rename_source',{sourceId:current.sourceId,name})
 else if(['webdav','smb','nfs','ftp'].includes(account.value?.providerId||'')&&(['smb','nfs','ftp'].includes(account.value?.providerId||'')||connectionPassword.value||connectionUser.value!==originalConnection.value.username||connectionRoot.value!==originalConnection.value.rootPath||new URL(address.value).origin!==new URL(account.value!.baseUrl).origin)){const updated=await nativeCall<Account>(account.value?.providerId==='webdav'?'webdav_update_connection':'network_share_update_connection',{accountId:current.sourceId,name,url:address.value,username:connectionUser.value,password:connectionPassword.value||null,rootPath:connectionRoot.value});const index=sources.accounts.findIndex(a=>a.id===current.sourceId);if(index>=0)sources.accounts[index]=updated;connectionPassword.value=''}
 else if(account.value){const baseUrl=address.value===account.value.baseUrl?null:validatedEndpoint(account.value,address.value);const updated=await nativeCall<Account>('account_update_metadata',{accountId:current.sourceId,name,baseUrl});const index=sources.accounts.findIndex(a=>a.id===current.sourceId);if(index>=0)sources.accounts[index]=updated}
 sources.rename(current.id,name);await sources.refresh()
 })}
async function remove(){const current=card.value;if(!current)return;await run(async()=>{if(folder.value){await toggleFolderFavorite(sources,props.folderCatalog||catalog,current.sourceId,current.path,current.name,current.local);return}await nativeCall('account_remove',{accountId:current.sourceId});sources.preferences.favorites=sources.preferences.favorites.filter(f=>f.sourceId!==current.sourceId);await sources.refresh()})}
</script>
<template>
 <div v-if="card" class="source-menu-overlay" @click="!busy&&emit('close')" @keydown.esc="!busy&&emit('close')">
  <div v-if="mode==='menu'" ref="menuElement" class="source-context-menu" role="menu" :style="{left:left+'px',top:top+'px'}" @click.stop>
   <template v-if="folder"><button role="menuitem" :disabled="busy" @click="play('play')"><Play :size="17"/>播放</button><button role="menuitem" :disabled="busy" @click="play('loop')"><RefreshCw :size="17"/>循环播放</button><button role="menuitem" :disabled="busy" @click="play('shuffle')"><Shuffle :size="17"/>随机播放</button><button role="menuitem" @click="mode='removeFavorite'"><Star :size="17"/>从收藏夹中移除</button><button role="menuitem" @click="edit('rename')"><Pencil :size="17"/>重命名收藏夹</button><button role="menuitem" @click="sources.preferences.hiddenOnHome[card.id]=!card.hiddenOnHome;emit('close')"><Eye :size="17"/>{{card.hiddenOnHome?'在主屏幕显示':'在主屏幕隐藏'}}</button></template>
   <button v-else-if="!card.server" role="menuitem" :disabled="busy" @click="rootFavorite?mode='removeFavorite':edit('addFavorite')"><Star :size="17"/>{{rootFavorite?'从收藏夹中移除':'添加到收藏夹'}}</button>
   <button role="menuitem" @click="emit('reorder');emit('close')"><Move :size="17"/>重新排序</button>
   <button v-if="!folder" role="menuitem" @click="edit('edit')"><Pencil :size="17"/>编辑共享</button><button v-if="folder||card.server" role="menuitem" @click="edit('cover')"><Image :size="17"/>选择封面</button><button v-if="card.server" role="menuitem" @click="edit('endpoint')"><RefreshCw :size="17"/>编辑端点</button><button v-if="!folder" role="menuitem" @click="mode='delete'"><Trash2 :size="17"/>删除</button>
   <p v-if="error" role="alert">{{error}}</p>
  </div>
  <ServerEndpoints v-else-if="mode==='endpoint'&&account" :account="account" @close="emit('close')"/>
  <ElectronModal v-else :title="mode==='edit'?'编辑共享':mode==='rename'?'重命名收藏夹':mode==='cover'?'选择封面':mode==='addFavorite'?'添加到收藏夹':mode==='delete'?'删除':'从收藏夹中移除'" :busy="busy" @close="emit('close')"><form class="source-card-dialog" :class="{'source-editor':mode==='edit'}" :aria-label="mode==='endpoint'?'服务器线路':mode==='edit'?'编辑共享':mode==='cover'?'选择封面':mode==='rename'?'重命名':'移除收藏或来源'" @submit.prevent="mode==='addFavorite'?favorite(text.trim()||'所有文件'):mode==='delete'?remove():mode==='removeFavorite'?(folder?remove():favorite()):save()" @click.stop>
   <template v-if="mode==='delete'||mode==='removeFavorite'"><p>移除{{mode==='delete'?'来源':'收藏'}}及不再被其他收藏覆盖的媒体记录？不会删除文件。</p></template>
   <template v-else><label>{{mode==='cover'?'封面图片地址':mode==='addFavorite'?'收藏名称':'名称'}}<input v-if="mode!=='cover'||!isCoverDataUri(text)" v-model="text" :aria-label="mode==='cover'?'封面图片地址':mode==='rename'?'名称':mode==='addFavorite'?'收藏名称':'来源名称'" :disabled="busy" :required="mode!=='cover'&&mode!=='addFavorite'"/></label><template v-if="mode==='cover'"><img v-if="isCoverDataUri(text)" class="cover-preview" :src="text" alt="已选择的封面"/><button type="button" :disabled="busy" @click="chooseCover">选择图片</button><button type="button" :disabled="busy" @click="text=''">恢复默认</button></template><label v-if="mode==='edit'&&['webdav','alist','smb','nfs','ftp'].includes(account?.providerId||'')">服务器地址<input v-model="address" aria-label="服务器地址" :disabled="busy"/></label><template v-if="mode==='edit'&&['webdav','smb','nfs','ftp'].includes(account?.providerId||'')"><label>用户名<input v-model="connectionUser" aria-label="共享用户名" :disabled="busy" autocomplete="off"/></label><label>密码<input v-model="connectionPassword" type="password" placeholder="保留已保存的密码" aria-label="共享密码" :disabled="busy" autocomplete="new-password"/></label><label>挂载路径<input v-model="connectionRoot" aria-label="挂载路径" :disabled="busy"/></label></template></template>
   <p v-if="error" role="alert">{{error}}</p><div class="source-dialog-footer"><button type="button" :disabled="busy" @click="emit('close')">取消</button><button class="primary" type="submit" :disabled="busy">{{mode==='delete'?'确认删除':mode==='removeFavorite'?'移除':'保存'}}</button></div>
  </form></ElectronModal>
 </div>
</template>
<style scoped>
.source-menu-overlay{position:fixed;inset:0;z-index:90}.source-context-menu{position:absolute;width:220px;max-height:calc(100vh - 16px);overflow:auto;padding:8px;border:1px solid var(--border);border-radius:10px;background:var(--background);box-shadow:0 8px 30px #0003;display:flex;flex-direction:column}.source-context-menu button{display:flex;align-items:center;gap:10px;text-align:left;padding:9px;border:0;background:transparent;color:inherit;cursor:pointer}.source-context-menu button:hover{background:var(--muted)}button:disabled{opacity:.4;cursor:default}.source-card-dialog{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);max-width:90vw;width:420px;padding:24px;border:1px solid var(--border);border-radius:12px;background:var(--background)}.source-card-dialog label{display:block;margin-bottom:12px}.source-card-dialog input{display:block;padding:8px;width:100%;border:1px solid var(--border);background:var(--background);border-radius:6px}.source-card-dialog button{padding:8px 12px;border:1px solid var(--border);border-radius:6px;margin-right:8px;color:inherit;background:var(--muted)}.cover-preview{display:block;width:120px;height:160px;object-fit:cover;margin-bottom:12px}[role=alert]{color:#e35d5d;font-size:13px}
</style>

<style scoped>
.source-menu-overlay:has(.source-context-menu) .source-context-menu{width:auto;min-width:145px;padding:5px;border-radius:12px}.source-context-menu button{min-height:25px;font-size:13px;padding:3px 8px;gap:7px;border-radius:5px}.source-context-menu button svg{color:var(--primary)}.source-card-dialog{position:static;transform:none;width:auto;max-width:none;padding:0;border:0;border-radius:0;background:transparent}.source-card-dialog input{height:32px;padding:4px 12px;background:var(--secondary);border:1px solid transparent;border-radius:2px}.source-card-dialog input:focus{outline:1px solid var(--primary)}.source-dialog-footer{display:flex;justify-content:flex-end;gap:12px;margin:24px -20px -24px;padding:16px 20px;border-top:1px solid var(--border)}.source-dialog-footer button{height:32px;padding:0 15px;margin:0;border:0;border-radius:4px}.source-dialog-footer .primary{background:var(--primary);color:white}
</style>
