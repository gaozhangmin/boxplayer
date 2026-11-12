/** Native auth and catalog boundary; no tokens reach the migrated Trakt component. */
import {computed,type Ref} from 'vue'
import * as native from '@/features/trakt/client'
import {playbackPatches} from '@/features/trakt/progress'
import {useVideoCatalog} from '../catalog'
export const traktStatus=native.traktStatus as Ref<native.Status&{username?:string}>,traktAccount=native.traktAccount
export const loadTraktStatus=native.loadTraktStatus,loadTraktAccount=native.loadTraktAccount,traktError=native.traktError
export const traktSyncEnabled=computed(()=>traktStatus.value.settings.enabled),traktSyncRange=computed(()=>traktStatus.value.settings.range)
export const setTraktSyncEnabled=(enabled:boolean)=>native.setTraktSettings({...traktStatus.value.settings,enabled})
export const setTraktSyncRange=(range:number)=>native.setTraktSettings({...traktStatus.value.settings,range})
export const openTraktVip=()=>native.openTraktPage('vip'),logoutTrakt=native.disconnectTrakt
let generation=0,timer:ReturnType<typeof setTimeout>|undefined,rejectPending:((reason:Error)=>void)|undefined
export async function cancelTraktLogin(){generation++;clearTimeout(timer);rejectPending?.(new Error('TRAKT_CANCELLED'));rejectPending=undefined;await native.cancelTraktLogin()}
export async function startTraktLogin(){const attempt=++generation,result=await native.startTraktLogin();if(attempt!==generation)throw new Error('TRAKT_CANCELLED');return new Promise<native.Status>((resolve,reject)=>{rejectPending=reject;const poll=async()=>{if(attempt!==generation)return;try{if(Date.now()>=result.expiresAt)throw new Error('TRAKT_EXPIRED');const state=await native.pollDeviceAuth();if(attempt!==generation)return;if(state.state==='connected'){rejectPending=undefined;resolve(state.status)}else timer=setTimeout(()=>void poll(),Math.max(1,state.interval)*1000)}catch(error){rejectPending=undefined;reject(error)}};timer=setTimeout(()=>void poll(),Math.max(1,result.interval)*1000)})}
export async function syncTraktPlaybackProgress(){if(!traktStatus.value.connected||!traktSyncEnabled.value)return;const records=await native.loadTraktPlayback();if(!traktStatus.value.connected||!traktSyncEnabled.value)return;const catalog=useVideoCatalog();await catalog.update(draft=>{for(const {id,patch} of playbackPatches(draft.items,records,traktSyncRange.value)){const item=draft.items.find(row=>row.id===id);if(item)Object.assign(item,patch)}})}
