import {ref} from 'vue'
import {useVideoCatalog} from '../catalog'
import {nativeItems} from './libraryData'
import type {MediaLibraryItem} from '@/features/files/electron/mediaTypes'
import {loadTraktStatus,syncTrakt} from '@/features/trakt/client'
export const watchingUpdatePending=ref(false)
export const isContinueWatchingMember=(entry:Pick<MediaLibraryItem,'id'>,target:Pick<MediaLibraryItem,'id'|'type'>)=>entry.id===target.id||target.type==='tv'&&entry.id.startsWith(target.id+'_')
export async function toggleContinueWatching(_store:unknown,target:MediaLibraryItem){if(watchingUpdatePending.value)return;watchingUpdatePending.value=true;try{const catalog=useVideoCatalog(),items=nativeItems([target]),remove=items.some(item=>!item.continueHidden&&(item.continueAdded||Number(item.progress)>0));const status=await loadTraktStatus();if(status.connected&&status.settings.enabled&&target.tmdbId)await syncTrakt({type:target.type==='tv'?'tv':'movie',tmdbId:target.tmdbId},remove?'watchlist-remove':'watchlist-add');await catalog.update(draft=>{for(const item of draft.items)if(items.some(row=>row.id===item.id)){item.continueHidden=remove;item.continueAdded=!remove}})}finally{watchingUpdatePending.value=false}}
