import {beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import ServerHomeSections from '@/features/servers/ServerHomeSections.vue'
import {browseServer} from '@/features/servers/workspace'
import {preferenceKey,readPreferences} from '@/features/servers/preferences'
vi.mock('@/features/servers/workspace',async original=>({...await original<typeof import('@/features/servers/workspace')>(),browseServer:vi.fn(async(_account,route)=>({items:route.kind==='root'?[{id:'lib',name:'Library',isDirectory:true}]:[{id:'movie',name:'Film',kind:'movie',year:'2026',genres:[],isDirectory:false,playable:true}]}))}))
vi.mock('@/features/library/catalog',()=>({useVideoCatalog:()=>({playMany:vi.fn()})}))
vi.mock('@/features/sources/mediaServer',async original=>({...await original<typeof import('@/features/sources/mediaServer')>(),serverFavorite:vi.fn()}))
const account={id:'server',providerId:'jellyfin' as const,name:'Living Room',baseUrl:'https://server.test',authOrigins:['https://server.test'],userId:'user'}
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.clearAllMocks()})
it('keeps source cards and hidden favorites available on Favorites while Home respects hiding',async()=>{
 localStorage.setItem(preferenceKey(account.id),JSON.stringify({version:1,home:[],favorites:[{key:'hidden',title:'Hidden',hiddenOnHome:true,route:{kind:'category',category:'movies',title:'Movies'}}]}))
 const wrapper=mount(ServerHomeSections,{props:{accounts:[account],favoritesOnly:true},global:{plugins:[createPinia()],stubs:{ServerArtwork:true,SourceCardMenu:true,SourceManager:true,ServerRating:true,ServerShare:true}}});await flushPromises()
 expect(wrapper.text()).toContain('Hidden');await wrapper.get('.server-source-card').trigger('click')
 expect(wrapper.emitted('navigate')?.at(-1)).toEqual([account.id,{kind:'root',title:'媒体库'}])
 await wrapper.setProps({favoritesOnly:false});await flushPromises();expect(wrapper.text()).not.toContain('Hidden');wrapper.unmount()
})
it('Home row management changes Home independently of category favorites',async()=>{
 const wrapper=mount(ServerHomeSections,{props:{accounts:[account],manager:true},global:{plugins:[createPinia()],stubs:{ServerArtwork:true,SourceCardMenu:true,SourceManager:true,ServerRating:true,ServerShare:true}}});await flushPromises()
 const label=wrapper.findAll('label').find(label=>label.text().includes('电影'))!;await label.get('input').setValue(true);await flushPromises()
 expect(readPreferences(account.id).home).toContain('movies');expect(readPreferences(account.id).favorites).toEqual([])
 expect(browseServer).toHaveBeenCalledWith(account,{kind:'root',title:'媒体库'},expect.objectContaining({limit:100}));wrapper.unmount()
})
it('does not restart an unchanged account refresh and releases loading on the shared deadline', async () => {
 vi.useFakeTimers()
 const browse = vi.mocked(browseServer)
 browse.mockImplementationOnce((_account,_route,options) => new Promise((_resolve,reject) => {
  options?.signal?.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})
 }))
 const wrapper=mount(ServerHomeSections,{props:{accounts:[account],manager:true},global:{plugins:[createPinia()]}})
 try {
  await wrapper.setProps({accounts:[{...account}]})
  expect(browse).toHaveBeenCalledTimes(1)
  expect(wrapper.emitted('loading')?.at(-1)).toEqual([true])
  await vi.advanceTimersByTimeAsync(12000)
  expect(wrapper.emitted('loading')?.at(-1)).toEqual([false])
  expect(wrapper.get('[role="alert"]').text()).toContain('服务器请求超时')
 } finally {
  wrapper.unmount()
  vi.useRealTimers()
 }
})
