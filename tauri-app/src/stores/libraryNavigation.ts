import {defineStore} from 'pinia'
import {ref} from 'vue'
import {libraryHomeId,categoryRouteForHomeId} from '@/features/library/categoryPlacement'
import {videoLibraryRoutes} from '@/features/library/navigation'
import type {MediaBrowseSort} from '@/features/library/electron/mediaBrowseSort'
import type {BrowseRoute} from '@/features/servers/workspace'
import type {HomeManagementItem} from '@/features/library/unifiedHomeManagement'
export const useLibraryNavigation=defineStore('video-library-navigation',()=>{
 const items=ref<HomeManagementItem[]>(videoLibraryRoutes.map(([route,title])=>{const id=libraryHomeId(route);return{id,title,sourceId:'local',available:true,optIn:id.startsWith('catalog:')}}))
 const homeScrollTop=ref(0)
 const browseSort=ref<MediaBrowseSort>('title')
 const browseDescending=ref(false)
 const localOnly=ref(false)
 const serverMenus=ref<{accountId:string;id:string;title:string;route:BrowseRoute}[]>([])
 function setServerMenus(value:typeof serverMenus.value){serverMenus.value=value}
 function setItems(value:HomeManagementItem[]){items.value=value}
 return{items,setItems,serverMenus,setServerMenus,homeScrollTop,browseSort,browseDescending,localOnly}
})
