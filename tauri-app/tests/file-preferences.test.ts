import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { readFilePreferences, sortedFiles } from '@/features/files/preferences'
import { useFileSourcesStore } from '@/stores/fileSources'
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),clear:()=>values.clear()})})
it('rejects malformed stored bookmarks and recovers corrupt JSON',()=>{
 localStorage.setItem('tauri.filePreferences','broken');expect(readFilePreferences().favorites).toEqual([])
 localStorage.setItem('tauri.filePreferences',JSON.stringify({favorites:[null,{id:2}],sort:'invalid'}));expect(readFilePreferences().favorites).toEqual([]);expect(readFilePreferences().sort).toBe('name')
})
it('persists folder identity, display names and custom order without credentials',()=>{
 const store=useFileSourcesStore(createPinia());store.bookmark('drive','opaque-folder-id','Shows',false)
 const id=store.preferences.favorites[0]!.id;store.rename(id,'Series');store.reorder([id,'drive']);store.preferences.grid=true
 const saved=useFileSourcesStore(createPinia());expect(saved.preferences.favorites[0]).toMatchObject({sourceId:'drive',path:'opaque-folder-id',name:'Series'});expect(saved.preferences.grid).toBe(true);expect(saved.preferences.order).toEqual([id,'drive'])
 saved.bookmark('drive','opaque-folder-id','ignored',false);expect(saved.preferences.favorites).toEqual([])
})
it('sorts directories first in either direction and preserves the input',()=>{
 const entries=[{name:'Video 10',size:10,isDirectory:false},{name:'Folder',size:0,isDirectory:true},{name:'Video 2',size:2,isDirectory:false}]
 expect(sortedFiles(entries,'name',false).map(e=>e.name)).toEqual(['Folder','Video 2','Video 10'])
 expect(sortedFiles(entries,'size',true).map(e=>e.name)).toEqual(['Folder','Video 10','Video 2']);expect(entries[0]!.name).toBe('Video 10')
})
it('shares card names, covers, order and Home visibility while retaining Files cards',()=>{
 const store=useFileSourcesStore(createPinia());store.replaceSnapshot({localFolders:[{id:'local',name:'Local'}],drives:[],mediaServers:[],hasDirectURLs:false});store.bookmark('local','shows','Shows',true)
 const id=JSON.stringify(['local','shows']);store.rename(id,'Series');store.preferences.covers[id]='https://images.example/poster.jpg';store.preferences.hiddenOnHome[id]=true;store.reorder([id,'local'])
 expect(store.cards[0]).toMatchObject({id,name:'Series',cover:'https://images.example/poster.jpg',hiddenOnHome:true});expect(store.favoriteCards.some(card=>card.id===id)).toBe(true);expect(store.homeCards.some(card=>card.id===id)).toBe(false)
 store.preferences.hiddenOnHome[id]=false;expect(store.homeCards[0]!.id).toBe(id)
})
it('projects the same canonical card identities, names, icons and order into the sidebar',async()=>{
 const {buildFileSidebarEntries}=await import('@/features/files/sidebar');const store=useFileSourcesStore(createPinia())
 store.replaceSnapshot({localFolders:[{id:'local',name:'Local'}],drives:[{id:'cloud',name:'Cloud',kind:'remote',favorites:[]}],mediaServers:[{id:'server',name:'Server'}],hasDirectURLs:false});store.accounts=[{id:'cloud',name:'Cloud',providerId:'onedrive',baseUrl:'',authOrigins:[]},{id:'server',name:'Server',providerId:'jellyfin',baseUrl:'',authOrigins:[]}]
 store.bookmark('cloud','shows','Shows',false);const favoriteId=JSON.stringify(['cloud','shows']);store.rename('cloud','Renamed Cloud');store.rename(favoriteId,'Series');store.reorder([favoriteId,'server','cloud','local'])
 const entries=buildFileSidebarEntries(store.snapshot,'URL');expect(entries.map(entry=>entry.cardId)).toEqual(store.cards.map(card=>card.id));expect(entries.map(entry=>entry.title)).toEqual(store.cards.map(card=>card.name));expect(entries.find(entry=>entry.sourceId==='server')!.icon).toBe('/source-icons/jellyfin.svg');expect(entries.find(entry=>entry.kind==='drive')!.icon).toBe('/source-icons/onedrive.svg')
})
it('keeps server category/content favorite identities and routes in Files sidebar even when hidden on Home',async()=>{
 const {writePreferences,routeKey}=await import('@/features/servers/preferences'),{buildFileSidebarEntries}=await import('@/features/files/sidebar')
 const route={kind:'category' as const,category:'movies' as const,title:'Movies'};writePreferences('server',{version:1,home:[],layout:'grid',portrait:true,favorites:[{key:routeKey(route),title:'Server movies',route,hiddenOnHome:true}]})
 const store=useFileSourcesStore(createPinia());store.accounts=[{id:'server',name:'Server',providerId:'jellyfin',baseUrl:'',authOrigins:[]}];const card=store.cards.find(card=>card.serverFavorite)!;const entry=buildFileSidebarEntries(store.snapshot,'URL').find(entry=>entry.kind==='serverFavorite')!;expect(entry).toMatchObject({cardId:card.id,sourceId:'server',serverRoute:route,title:'Server movies'});expect(store.homeCards.some(value=>value.id===card.id)).toBe(false)
})
