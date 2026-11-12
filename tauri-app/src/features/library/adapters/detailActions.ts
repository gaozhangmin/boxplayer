import {useVideoCatalog} from '../catalog'
import type {MediaLibraryItem} from '@/features/files/electron/mediaTypes'
import {nativeItem} from './libraryData'
import {openMediaShare as openOriginalShare,type MediaShareTarget} from '@/features/files/electron/mediaShare'
export function openPersonalRating(item:MediaLibraryItem){const native=nativeItem(item);if(native)window.dispatchEvent(new CustomEvent('boxplayer:personal-rating',{detail:{...native,type:native.type==='tv'?'tv':'movie'}}))}
export function openMediaShare(item:MediaShareTarget){const catalog=useVideoCatalog();openOriginalShare({...item,files:item.files?.map(file=>{const native=catalog.items.find(item=>item.id===file.id);return native?{...file,id:native.fileId,userId:native.sourceId,driveId:native.local?'local':native.sourceId,driveServerId:native.local?'local':native.sourceId}:file})})}
