<script setup lang="ts">
import {computed,ref} from 'vue'
import type {Account} from '../sources/contracts'
import {nativeCall} from '@/platform/native'
import {serverFavorite} from '../sources/mediaServer'
import {collectPlayable,serverDetail} from './workspace'
import {readPreferences,writePreferences,type Favorite} from './preferences'
import {useVideoCatalog,type VideoItem} from '../library/catalog'
import WorkspaceContextMenu from '../library/WorkspaceContextMenu.vue'
const props=defineProps<{account:Account;favorite:Favorite;x:number;y:number}>()
const emit=defineEmits<{close:[];changed:[]}>()
const catalog=useVideoCatalog(),prompt=ref<'rename'|'cover'>(),text=ref(''),busy=ref(false),error=ref('')
const entries=computed(()=>[{id:'play',label:'播放'},{id:'loop',label:'循环播放'},{id:'shuffle',label:'随机播放'},...(props.favorite.content?[{id:'favorite',label:'收藏 / 取消收藏'},{id:'cover',label:'选择封面'}]:[{id:'remove',label:'从收藏夹移除'},{id:'rename',label:'重命名收藏夹'},{id:'hide',label:props.favorite.hiddenOnHome?'在主屏幕显示':'在主屏幕隐藏'},{id:'cover',label:'选择封面'}])])
function publish(favorites:Favorite[]){const preferences=readPreferences(props.account.id);writePreferences(props.account.id,{...preferences,favorites});window.dispatchEvent(new CustomEvent('boxplayer:server-home-changed',{detail:props.account.id}));emit('changed')}
async function action(id:string){if(busy.value)return;error.value='';if(id==='rename'||id==='cover'){prompt.value=id;text.value=id==='rename'?props.favorite.title:props.favorite.cover||'';return}busy.value=true;try{
 if(['play','loop','shuffle'].includes(id)){const rows=await collectPlayable(props.account,props.favorite.route);const videos=rows.map(item=>({id:JSON.stringify([props.account.id,item.id]),sourceId:props.account.id,fileId:item.id,fileName:item.name,name:item.name,type:item.kind==='movie'?'movie':'tv',local:false,addedAt:'',genres:item.genres||[],size:0} as VideoItem));await catalog.playMany(videos,id as 'play'|'loop'|'shuffle')}
 else if(id==='favorite'&&props.favorite.route.id){const item=await serverDetail(props.account,props.favorite.route.id);await serverFavorite(props.account,item.id,!item.favorite)}
 else{const values=readPreferences(props.account.id).favorites;publish(id==='remove'?values.filter(value=>value.key!==props.favorite.key):values.map(value=>value.key===props.favorite.key?{...value,hiddenOnHome:!value.hiddenOnHome}:value))}
 emit('close')
 }catch(cause){error.value=(cause as Error).message}finally{busy.value=false}}
async function chooseCover(){try{const image=await nativeCall<string|null>('choose_cover_image');if(image)text.value=image}catch(cause){error.value=(cause as Error).message}}
function save(){const value=text.value.trim();if(prompt.value==='rename'&&!value)return;if(prompt.value==='cover'&&(/^(?:https?:|javascript:|\/\/)/i.test(value)||value.startsWith('data:')&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))){error.value='请选择所属服务器的封面图片路径';return}publish(readPreferences(props.account.id).favorites.map(favorite=>favorite.key===props.favorite.key?{...favorite,...(prompt.value==='rename'?{title:value}:{cover:value})}:favorite));emit('close')}
</script>
<template><WorkspaceContextMenu v-if="!prompt&&!busy&&!error" :x="x" :y="y" :entries="entries" label="服务器收藏菜单" @action="action" @close="emit('close')"/><Teleport to="body"><div v-if="prompt||busy||error" class="server-favorite-mask" @keydown.esc="!busy&&emit('close')"><form role="dialog" aria-modal="true" :aria-label="prompt==='rename'?'重命名收藏夹':'选择封面'" @submit.prevent="save"><h3>{{favorite.title}}</h3><p v-if="busy" role="status">正在处理…</p><template v-if="prompt"><label>{{prompt==='rename'?'名称':'服务器封面路径'}}<input v-model="text" :disabled="busy"/></label><button v-if="prompt==='cover'" type="button" @click="chooseCover">选择图片…</button><button type="submit" :disabled="busy">保存</button></template><p v-if="error" role="alert">{{error}}</p><button type="button" :disabled="busy" @click="emit('close')">关闭</button></form></div></Teleport></template>
<style scoped>.server-favorite-mask{position:fixed;inset:0;background:#0004;z-index:550;display:grid;place-items:center}form{width:min(440px,90vw);background:var(--background);color:var(--foreground);border:1px solid var(--border);padding:24px;border-radius:14px;display:grid;gap:14px}h3{margin:0}label{display:grid;gap:8px}input,button{padding:8px 12px;border:1px solid var(--border);background:var(--secondary);border-radius:6px}[role=alert]{color:#b93838}</style>
