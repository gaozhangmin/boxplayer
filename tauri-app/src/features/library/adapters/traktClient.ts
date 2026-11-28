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
export async function syncTraktPlaybackProgress(){if(!traktStatus.value.connected||!traktSyncEnabled.value)return;const records=await native.loadTraktPlayback();if(!traktStatus.value.connected||!traktSyncEnabled.value)return;const catalog=useVideoCatalog();await catalog.update(draft=>{for(const {id,patch} of playbackPatches(draft.items,records,traktSyncRange.value)){const item=draft.items.find(row=>row.id===id);if(item)Object.assign(item,patch)}})}
