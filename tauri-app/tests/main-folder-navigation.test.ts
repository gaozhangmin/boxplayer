import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import Main from '@/entries/main/App.vue'
import FileBrowser from '@/features/files/FileBrowser.vue'
import {useFileSourcesStore} from '@/stores/fileSources'
vi.mock('@/platform/native',async original=>({...await original<typeof import('@/platform/native')>(),isNative:()=>false,localList:vi.fn(async(sourceId,path)=>({sourceId,relativePath:path,parentPath:null,entries:[]}))}))
vi.mock('vue-sonner',()=>({Toaster:{template:'<div/>'},toast:{info:vi.fn(),error:vi.fn()}}))
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)})})
afterEach(()=>{document.body.innerHTML='';vi.clearAllMocks()})
it('keeps a favorite folder route when its source-selection notification follows',async()=>{
 const pinia=createPinia(),sources=useFileSourcesStore(pinia)
 sources.replaceSnapshot({localFolders:[{id:'local',name:'Videos'}],drives:[],mediaServers:[],hasDirectURLs:false})
 sources.bookmark('local','sub/folder','Favorites',true)
 const favorite=sources.preferences.favorites[0]!
 const wrapper=mount(Main,{attachTo:document.body,global:{plugins:[pinia],stubs:{LibraryWorkspace:{template:'<div/>'}}}})
 await wrapper.findAll('button').find(button=>button.text()==='文件')!.trigger('click');await flushPromises()
 wrapper.getComponent(FileBrowser).vm.$emit('openFolder',{sourceId:'local',path:'sub/folder',local:true,favoriteId:favorite.id})
 wrapper.getComponent(FileBrowser).vm.$emit('selectSource','local');await flushPromises()
 expect(wrapper.getComponent(FileBrowser).props('source')).toMatchObject({sourceId:'local',favoriteId:favorite.id,kind:'favorite'})
 expect(wrapper.get('.unified-toolbar h1').text()).toBe('Favorites')
 wrapper.unmount()
})
