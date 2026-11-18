import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import Main from '@/entries/main/App.vue'
import ServerWorkspace from '@/features/servers/ServerWorkspace.vue'
import { useFileSourcesStore } from '@/stores/fileSources'
vi.mock('@/features/servers/ServerWorkspace.vue',()=>({default:{props:['account','searchQuery','searchRevision','initialRoute','navigationRevision'],template:'<section class="server-workspace"/>',methods:{goBack:vi.fn()}}}))
vi.mock('@/platform/native', async original => ({ ...await original<typeof import('@/platform/native')>(), isNative: () => false }))
vi.mock('vue-sonner', () => ({ Toaster: { template: '<div />' }, toast: { info: vi.fn(), error: vi.fn() } }))
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)})})
afterEach(() => { document.body.innerHTML = '';vi.clearAllMocks() })
it('routes sidebar server selection and search to the account-bound server workspace', async () => {
 const pinia=createPinia(),sources=useFileSourcesStore(pinia)
 const owner={id:'server-a',providerId:'jellyfin' as const,name:'客厅 Jellyfin',userId:'user',baseUrl:'https://server.test',authOrigins:['https://server.test']}
 sources.accounts=[owner];sources.replaceSnapshot({localFolders:[],drives:[],mediaServers:[{id:owner.id,name:owner.name}],hasDirectURLs:false})
 const wrapper=mount(Main,{attachTo:document.body,global:{plugins:[pinia],stubs:{LibraryWorkspace:{template:'<div/>'}}}})
 const content=wrapper.get('.content-body').element
 content.scrollTop=600
 await wrapper.findAll('button').find(button=>button.text()===owner.name)!.trigger('click');await flushPromises()
 expect(wrapper.getComponent(ServerWorkspace).props('account')).toEqual(owner)
 expect(wrapper.getComponent(ServerWorkspace).props('initialRoute')).toBeUndefined()
 expect(content.scrollTop).toBe(0)
 expect(content.classList.contains('server-content')).toBe(true)
 expect(wrapper.find('.files-browser').exists()).toBe(false)
 await wrapper.get('.search-box input').setValue('new');await wrapper.get('.search-box').trigger('submit');await flushPromises()
 expect(wrapper.getComponent(ServerWorkspace).props('searchQuery')).toBe('new')
 expect(wrapper.getComponent(ServerWorkspace).props('searchRevision')).toBe(1)
 const revision = wrapper.getComponent(ServerWorkspace).props('navigationRevision')
 await wrapper.findAll('button').find(button=>button.text()===owner.name)!.trigger('click')
 expect(wrapper.getComponent(ServerWorkspace).props('navigationRevision')).toBe(revision+1)
 expect(wrapper.getComponent(ServerWorkspace).props('searchQuery')).toBe('')

 wrapper.unmount()
})

it('opens a Files server card on the same library root as its sidebar entry', async () => {
 const pinia=createPinia(),sources=useFileSourcesStore(pinia)
 const owner={id:'server-emby',providerId:'emby' as const,name:'本地 Emby',userId:'user',baseUrl:'https://server.test',authOrigins:['https://server.test']}
 sources.accounts=[owner];sources.replaceSnapshot({localFolders:[],drives:[],mediaServers:[{id:owner.id,name:owner.name}],hasDirectURLs:false})
 const wrapper=mount(Main,{attachTo:document.body,global:{plugins:[pinia],stubs:{LibraryWorkspace:{template:'<div/>'}}}})
 await wrapper.findAll('button').find(button=>button.text()==='文件')!.trigger('click')
 await flushPromises()
 await wrapper.get('.file-source-card[data-source-key="server:server-emby"]').trigger('click')
 await flushPromises()
 expect(wrapper.getComponent(ServerWorkspace).props('account')).toEqual(owner)
 expect(wrapper.getComponent(ServerWorkspace).props('initialRoute')).toBeUndefined()
 wrapper.unmount()
})
