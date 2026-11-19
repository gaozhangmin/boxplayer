<script setup lang="ts">
import {ref,onMounted,onUnmounted} from 'vue'
import type {Account} from '../sources/contracts'
import type {ServerItem} from './workspace'
import {createServerPlaylist,deleteServerPlaylist,listServerPlaylists,serverPlaylistMembership,setServerPlaylistMembership} from '../sources/playlists'
import MediaCollectionPicker from './electron/MediaCollectionPicker.vue'
import ElectronModal from '@/components/dialog/ElectronModal.vue'
const props=defineProps<{account:Account;item:ServerItem}>(),emit=defineEmits<{close:[]}>()
const rows=ref<{id:string;title:string;count:number;selected:boolean}[]>([]),busy=ref(false),editing=ref<string|null>(null),name=ref(''),error=ref(''),deleting=ref<string>()
const loading=ref(false), controller=new AbortController()
onUnmounted(()=>controller.abort())
async function reload(){
 const signal=controller.signal
 const result=await listServerPlaylists(props.account,signal)
 const next=await Promise.all(result.map(async row=>({...row,selected:await serverPlaylistMembership(props.account,row.id,props.item.id,signal)})))
 if(!signal.aborted)rows.value=next
}
async function run(action:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await action();await reload()}catch(cause){if(!controller.signal.aborted)error.value=(cause as Error).message}finally{busy.value=false}}
onMounted(async()=>{loading.value=true;try{await run(async()=>{})}finally{loading.value=false}})
function toggle(id:string){const row=rows.value.find(r=>r.id===id);if(row)void run(()=>setServerPlaylistMembership(props.account,id,props.item.id,!row.selected))}
function create(){if(!name.value.trim())return;void run(async()=>{await createServerPlaylist(props.account,name.value,props.item.id);editing.value=null;name.value=''})}
function remove(){const id=deleting.value;if(id)void run(async()=>{await deleteServerPlaylist(props.account,id);deleting.value=undefined})}
</script>
<template><MediaCollectionPicker visible heading="播放列表" :item-title="item.name" :rows="rows" :editing="editing" v-model:name="name" :busy="busy" :loading="loading" :error="error" removable :renamable="false" @done="emit('close')" @close="emit('close')" @create="editing='';name=''" @toggle="toggle" @remove="deleting=$event" @cancel-name="editing=null" @confirm-name="create"/><ElectronModal v-if="deleting" title="删除播放列表" :busy="busy" @close="deleting=undefined"><p>删除服务器上的播放列表？媒体文件不会被删除。</p><template #footer><button :disabled="busy" @click="deleting=undefined">取消</button><button class="primary" :disabled="busy" @click="remove">确定</button></template></ElectronModal></template>
