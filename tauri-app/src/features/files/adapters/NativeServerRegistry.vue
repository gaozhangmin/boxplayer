<script setup lang="ts">
import {ref,onUnmounted,watch} from 'vue'
import AddMediaServerModal from '../electron/AddMediaServerModal.vue'
import PlexResourcesModal from '../electron/PlexResourcesModal.vue'
import {nativeCall} from '@/platform/native'
import type {Account} from '@/features/sources/contracts'
import {useFileSourcesStore} from '@/stores/fileSources'
import {readPreferences,writePreferences} from '@/features/servers/preferences'
import type {MediaServerType,MediaServerConfig,NativePlexResource} from './serverTypes'
import {message} from './sourceServices'
const props=defineProps<{defaultType?:MediaServerType;formOnly?:boolean;embedded?:boolean;editingServer?:MediaServerConfig}>()
const emit=defineEmits<{close:[];saved:[]}>()
const visible=ref(true),submitting=ref(false),session=ref(''),resources=ref<NativePlexResource[]>([]),showResources=ref(false)
const requestId=crypto.randomUUID();let alive=true
let sourceName=''
async function save(payload:{type:MediaServerType;name:string;baseUrl:string;username?:string;password?:string;libraryMode?:boolean}){if(submitting.value)return;sourceName=payload.name;submitting.value=true;try{
 if(payload.type==='plex'&&!props.editingServer){const result=await nativeCall<{sessionId:string;resources:{id:string;name:string;connections:number}[]}>('plex_login',{requestId});if(!alive){await nativeCall('plex_cancel_resources',{sessionId:result.sessionId});return}session.value=result.sessionId;resources.value=result.resources.map(row=>({name:row.name,clientIdentifier:row.id,selectable:true,connections:Array.from({length:row.connections},()=>({local:false,relay:false}))}));visible.value=false;showResources.value=true;return}
 if(props.editingServer){await nativeCall('server_update_connection',{requestId,accountId:props.editingServer.id,name:payload.name,username:payload.username||'',password:payload.password||null});writePreferences(props.editingServer.id,{...readPreferences(props.editingServer.id),libraryMode:payload.libraryMode});await useFileSourcesStore().refresh();if(alive)emit('saved');return}
 const account=await nativeCall<Account>('server_login',{requestId,providerId:payload.type,name:payload.name,baseUrl:payload.baseUrl,username:payload.username||'',password:payload.password||''});writePreferences(account.id,{...readPreferences(account.id),libraryMode:payload.libraryMode});await useFileSourcesStore().refresh();if(alive)emit('saved')
 }catch(error){if(alive)message.error((error as {message?:string}).message||String(error))}finally{submitting.value=false}}
async function confirm(selected:NativePlexResource[]){if(submitting.value)return;submitting.value=true;try{await nativeCall('plex_save_resources',{sessionId:session.value,selected:selected.map(row=>row.clientIdentifier),name:sourceName});session.value='';await useFileSourcesStore().refresh();if(alive)emit('saved')}catch(error){message.error(String(error))}finally{submitting.value=false}}
watch(visible,value=>{if(!value&&!showResources.value&&!submitting.value)emit('close')});watch(showResources,value=>{if(!value)emit('close')})
onUnmounted(()=>{alive=false;void nativeCall('auth_cancel',{requestId}).catch(()=>{});if(session.value)void nativeCall('plex_cancel_resources',{sessionId:session.value}).catch(()=>{})})
</script>
<template><div class="media-server-registry-panel"><AddMediaServerModal v-model:visible="visible" :embedded="embedded" :loading="submitting" :editing-server="editingServer" :default-type="defaultType" @submit="save"/><PlexResourcesModal v-model:visible="showResources" :embedded="embedded" :loading="submitting" :resources="resources" @confirm="confirm"/></div></template>
