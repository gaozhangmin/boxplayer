import { defineStore } from 'pinia'
import { ref, watch, computed, onScopeDispose } from 'vue'
import { readFilePreferences, type FolderBookmark } from '@/features/files/preferences'
import { accountsList } from '@/features/sources/transport'
import type { Account } from '@/features/sources/contracts'
import type { FileSourcesSnapshot } from '@/features/files/sidebar'
import { readPreferences, type Favorite } from '@/features/servers/preferences'
import type { BrowseRoute } from '@/features/servers/workspace'
import { isNative, localSources } from '@/platform/native'

export const serverFavoriteCardId=(sourceId:string,key:string)=>JSON.stringify(['serverFavorite',sourceId,key])
export interface FileSourceCard {id:string;name:string;subtitle?:string;local:boolean;favorite:boolean;server:boolean;sourceId:string;path:string;cover?:string;hiddenOnHome:boolean;serverFavorite?:Favorite;serverRoute?:BrowseRoute}

export const useFileSourcesStore = defineStore('fileSources', () => {
  const preferences = ref(readFilePreferences())
  watch(preferences, value => localStorage.setItem('tauri.filePreferences', JSON.stringify(value)), { deep:true, flush:'sync' })
  function bookmark(sourceId:string, path:string, name:string, local:boolean) {
    const id=JSON.stringify([sourceId,path]); const index=preferences.value.favorites.findIndex(item=>item.id===id)
    if(index>=0) preferences.value.favorites.splice(index,1)
    else preferences.value.favorites.push({id,sourceId,path,name,local})
  }
  function rename(id:string,name:string) { if(name.trim()) { const favorite=preferences.value.favorites.find(item=>item.id===id); if(favorite)favorite.name=name.trim();else preferences.value.names[id]=name.trim() } }
  function reorder(ids:string[]) { preferences.value.order=[...ids] }
  function removeBookmark(id:string) { preferences.value.favorites=preferences.value.favorites.filter(item=>item.id!==id) }
  function findBookmark(id?:string):FolderBookmark|undefined { return preferences.value.favorites.find(item=>item.id===id) }
  const accounts = ref<Account[]>([])
  const serverRevision=ref(0)
  const refreshServerFavorites=()=>{serverRevision.value++}
  window.addEventListener('boxplayer:server-home-changed',refreshServerFavorites);window.addEventListener('storage',refreshServerFavorites)
  onScopeDispose(()=>{window.removeEventListener('boxplayer:server-home-changed',refreshServerFavorites);window.removeEventListener('storage',refreshServerFavorites)})
  const serverFavorites=computed(()=>{void serverRevision.value;return accounts.value.filter(a=>['jellyfin','emby','plex'].includes(a.providerId)).flatMap(account=>readPreferences(account.id).favorites.map(favorite=>({sourceId:account.id,favoriteId:serverFavoriteCardId(account.id,favorite.key),name:favorite.title,route:favorite.route,favorite})))})
  const baseSnapshot = ref<FileSourcesSnapshot>({ localFolders: [], drives: [], mediaServers: [], hasDirectURLs: false })
  const snapshot = computed<FileSourcesSnapshot>(()=>({...baseSnapshot.value,
    serverFavorites:serverFavorites.value,
    presentation:{hiddenLocalRoots:preferences.value.hiddenLocalRoots,order:preferences.value.order,names:preferences.value.names,providerIds:Object.fromEntries(accounts.value.map(account=>[account.id,account.providerId])),descending:preferences.value.descending},
    localFolders:baseSnapshot.value.localFolders.map(f=>({...f,name:preferences.value.names[f.id]||f.name})),
    mediaServers:baseSnapshot.value.mediaServers.map(f=>({...f,name:preferences.value.names[f.id]||f.name})),
    drives:[...baseSnapshot.value.localFolders.filter(f=>preferences.value.favorites.some(bookmark=>bookmark.sourceId===f.id)).map(f=>({id:f.id,name:f.name,kind:'local' as const,favorites:preferences.value.favorites.filter(bookmark=>bookmark.sourceId===f.id)})),...baseSnapshot.value.drives.map(d=>({...d,name:preferences.value.names[d.id]||d.name,favorites:[...d.favorites,...preferences.value.favorites.filter(f=>f.sourceId===d.id&&!d.favorites.some(existing=>existing.id===f.id))]}))]
  }))
  // Home and Files consume the same identities, names, covers and ordering.
  const cards = computed<FileSourceCard[]>(()=>[
    ...snapshot.value.localFolders.filter(f=>!preferences.value.hiddenLocalRoots[f.id]).map(f=>({id:f.id,name:f.name,local:true,favorite:false,server:false,sourceId:f.id,path:''})),
    ...accounts.value.filter(a=>a.providerId!=='boxplayer').map(a=>({id:a.id,name:a.name,local:false,favorite:false,server:['jellyfin','emby','plex'].includes(a.providerId),sourceId:a.id,path:''})),
    ...preferences.value.favorites.filter(f=>snapshot.value.localFolders.some(s=>s.id===f.sourceId)||accounts.value.some(s=>s.id===f.sourceId)).map(f=>({...f,subtitle:!f.local&&['','/','0','root','quark_root','baidu_root'].includes(f.path)?accounts.value.find(a=>a.id===f.sourceId)?.name:undefined,favorite:true,server:false})),
    ...serverFavorites.value.map(f=>({id:f.favoriteId,name:f.name,local:false,favorite:false,server:true,sourceId:f.sourceId,path:f.route.id||'',cover:f.favorite.cover,hiddenOnHome:f.favorite.hiddenOnHome,serverFavorite:f.favorite,serverRoute:f.route}))
  ].map(c=>({...c,name:preferences.value.names[c.id]||c.name,cover:preferences.value.covers[c.id]||('cover'in c&&typeof c.cover==='string'?c.cover:undefined),hiddenOnHome:!!preferences.value.hiddenOnHome[c.id]||('hiddenOnHome'in c&&!!c.hiddenOnHome)})).sort((a,b)=>{
    const order=preferences.value.order, ai=order.indexOf(a.id),bi=order.indexOf(b.id)
    return (ai<0?9999:ai)-(bi<0?9999:bi)||a.name.localeCompare(b.name)*(preferences.value.descending?-1:1)
  }))
  const favoriteCards=computed(()=>cards.value.filter(card=>card.favorite||card.local||card.server))
  const homeCards=computed(()=>favoriteCards.value.filter(card=>!card.hiddenOnHome))
  function replaceSnapshot(next: FileSourcesSnapshot) { baseSnapshot.value = next }
  async function refresh() {
    if (!isNative()) return
    const [sources, remote] = await Promise.all([localSources(), accountsList()])
    accounts.value = remote
    baseSnapshot.value = { ...baseSnapshot.value, localFolders: sources.map(source => ({ id: source.id, name: source.name })), drives: remote.filter(a=>!['boxplayer','jellyfin','emby','plex'].includes(a.providerId)).map(a=>({id:a.id,name:a.name,kind:'remote',favorites:[]})), mediaServers:remote.filter(a=>['jellyfin','emby','plex'].includes(a.providerId)).map(a=>({id:a.id,name:a.name})) }
  }
  return { accounts, snapshot, preferences, cards, favoriteCards, homeCards, refreshServerFavorites, bookmark, rename, reorder, removeBookmark, findBookmark, replaceSnapshot, refresh }
})
