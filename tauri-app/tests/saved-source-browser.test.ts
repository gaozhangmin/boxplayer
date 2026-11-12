import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import SavedSourceBrowser from '@/features/files/SavedSourceBrowser.vue'
import { useFileSourcesStore } from '@/stores/fileSources'
import { nativeCall } from '@/platform/native'
import { driver } from '@/features/sources/drivers'
vi.mock('@/platform/native',async original=>({...await original<typeof import('@/platform/native')>(),nativeCall:vi.fn()}))
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
let wrapper:ReturnType<typeof mount>|undefined
beforeEach(()=>{vi.resetAllMocks();const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)})})
afterEach(()=>wrapper?.unmount())
it('browses saved remote sources as compact rows, scans named bookmarks and downloads with owning account',async()=>{
 const pinia=createPinia(),store=useFileSourcesStore(pinia);store.accounts=[{id:'cloud',providerId:'onedrive',name:'Cloud',baseUrl:'',authOrigins:[]}]
 const scanFolder=vi.fn(async()=>{});vi.mocked(driver).mockReturnValue({list:vi.fn(async()=>({entries:[{id:'folder',name:'Shows',isDirectory:true,playable:false,size:0},{id:'video',name:'video.mp4',isDirectory:false,playable:true,size:1024}]})),resolve:vi.fn()});vi.mocked(nativeCall).mockResolvedValue(true)
 wrapper=mount(SavedSourceBrowser,{props:{sourceId:'cloud',folderCatalog:{scanFolder,removeFolder:vi.fn()}},global:{plugins:[pinia]}});await flushPromises();expect(wrapper.find('.directory-grid').exists()).toBe(false)
 await wrapper.get('[aria-label="收藏 Shows"]').trigger('click');await wrapper.get('[aria-label="收藏名称"]').setValue('My Shows');await wrapper.get('form').trigger('submit');await flushPromises();expect(scanFolder).toHaveBeenCalledWith('cloud','folder');expect(store.preferences.favorites[0]!.name).toBe('My Shows')
 await wrapper.get('[aria-label="下载 video.mp4"]').trigger('click');await flushPromises();expect(nativeCall).toHaveBeenCalledWith('source_download',{accountId:'cloud',fileId:'video',name:'video.mp4'})
})
it('shows actual device folders, navigates locally, and returns to the device list',async()=>{
 const pinia=createPinia();useFileSourcesStore(pinia).replaceSnapshot({localFolders:[{id:'films',name:'Films'}],drives:[],mediaServers:[],hasDirectURLs:false})
 vi.mocked(nativeCall).mockResolvedValue({entries:[{id:'v',name:'video.mp4',relativePath:'video.mp4',isDirectory:false,playable:true,size:10,modified:0}],relativePath:'',parentPath:null})
 wrapper=mount(SavedSourceBrowser,{props:{device:true},global:{plugins:[pinia]}});await flushPromises();expect(wrapper.text()).toContain('Films');await wrapper.get('.compact-main').trigger('click');await flushPromises();expect(nativeCall).toHaveBeenCalledWith('local_list',{sourceId:'films',relativePath:''});expect(wrapper.get('[aria-label="下载 video.mp4"]').attributes('disabled')).toBeDefined();await wrapper.get('[aria-label="返回上一级"]').trigger('click');await flushPromises();expect(wrapper.text()).toContain('Films');expect(wrapper.text()).not.toContain('video.mp4')
})
it('saves server-library stars into shared server preferences without scraping',async()=>{
 const {readPreferences}=await import('@/features/servers/preferences');const pinia=createPinia(),store=useFileSourcesStore(pinia);store.accounts=[{id:'server',providerId:'jellyfin',name:'Server',baseUrl:'https://server.example',authOrigins:['https://server.example']}]
 const scanFolder=vi.fn();vi.mocked(driver).mockReturnValue({list:vi.fn(async()=>({entries:[{id:'library',name:'Movies',serverType:'CollectionFolder',isDirectory:true,playable:false,size:0}]})),resolve:vi.fn()})
 wrapper=mount(SavedSourceBrowser,{props:{sourceId:'server',folderCatalog:{scanFolder,removeFolder:vi.fn()}},global:{plugins:[pinia]}});await flushPromises();await wrapper.get('[aria-label="收藏 Movies"]').trigger('click');await wrapper.get('form').trigger('submit');await flushPromises();expect(scanFolder).not.toHaveBeenCalled();expect(readPreferences('server').favorites[0]).toMatchObject({title:'Movies',route:{kind:'category',category:'all',id:'library'}});expect(store.cards.some(card=>card.serverFavorite?.title==='Movies')).toBe(true)
})
