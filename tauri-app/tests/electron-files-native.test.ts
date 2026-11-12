import {beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia,setActivePinia} from 'pinia'
import {defineComponent,h} from 'vue'
import AddFileSourceModal from '@/features/files/electron/AddFileSourceModal.vue'
import UserLogin from '@/features/files/electron/UserLogin.vue'
import NativeServerRegistry from '@/features/files/adapters/NativeServerRegistry.vue'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useFilesPorts,type FilesPorts} from '@/features/files/adapters/filesPorts'
import {readPreferences,writePreferences} from '@/features/servers/preferences'
import {nativeCall} from '@/platform/native'
const mocks=vi.hoisted(()=>({scanFolder:vi.fn(async()=>{}),removeFolder:vi.fn(async()=>{}),load:vi.fn(async()=>{}),playMany:vi.fn(async()=>{})}))
vi.mock('@/features/library/catalog',()=>({useVideoCatalog:()=>({...mocks,items:[]})}))
vi.mock('@/platform/native',async original=>({...await original<typeof import('@/platform/native')>(),nativeCall:vi.fn(),localSources:vi.fn(async()=>[])}))
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.clearAllMocks();setActivePinia(createPinia());vi.mocked(nativeCall).mockImplementation(async command=>command==='account_list'?[]:null as never)})
const tick=async()=>{await flushPromises();await flushPromises()}
it('keeps the original provider order and name step before starting OAuth',async()=>{
 const wrapper=mount(AddFileSourceModal,{props:{visible:true,deviceName:'Mac',sources:[]},attachTo:document.body});await tick();const view=new DOMWrapper(document.body)
 expect(view.findAll('.source-picker .source-group button').map(button=>button.text())).toEqual(['添加本地文件夹','SMB','FTP','NFS','WebDAV','AList','Google Drive','Dropbox','OneDrive','Box','阿里云盘','123网盘','115网盘','百度网盘','PikPak','夸克网盘','139云盘','天翼云盘','光鸭云盘','Plex','Emby','Jellyfin'])
 await view.findAll('.source-picker button').find(button=>button.text()==='Google Drive')!.trigger('click');await tick();expect(nativeCall).not.toHaveBeenCalledWith('oauth_login',expect.anything())
 await view.get('#source-name').setValue('Personal Drive');await view.get('.source-connection-form').trigger('submit');await tick();expect(nativeCall).toHaveBeenCalledWith('oauth_login',expect.objectContaining({providerId:'google',name:'Personal Drive',clientId:'',clientSecret:null}));expect(view.text()).not.toMatch(/client_id|client_secret/)
 wrapper.unmount()
})
it('shows native-generated QR with the original surface and cancels a late QR after unmount',async()=>{
 let resolve!:(value:unknown)=>void;vi.mocked(nativeCall).mockImplementation(async command=>command==='drive115_begin'?await new Promise(done=>{resolve=done}):null as never)
 const wrapper=mount(UserLogin,{props:{embedded:true,provider:'115',sourceName:'Drive'}});await tick();expect(nativeCall).toHaveBeenCalledWith('drive115_begin',{clientId:'',clientSecret:null,name:'Drive'});expect(wrapper.find('input[placeholder="App ID（client_id）"]').exists()).toBe(false);wrapper.unmount();resolve({sessionId:'late',imageDataUrl:'data:image/png;base64,dGVzdA=='});await tick();expect(nativeCall).toHaveBeenCalledWith('drive115_cancel',{sessionId:'late'})
})
it('chooses a local folder without publication, cancels on Back, and saves only on submit',async()=>{
 vi.mocked(nativeCall).mockImplementation(async(command)=>command==='local_choose_folder'?{id:'choice',path:'/test/Videos',name:'Videos'}:command==='local_save_chosen_source'?{id:'local',name:'Films'}:command==='account_list'?[]:null as never)
 const wrapper=mount(AddFileSourceModal,{props:{visible:true,deviceName:'Mac',sources:[]},attachTo:document.body});await tick();const view=new DOMWrapper(document.body)
 await view.findAll('.source-picker button').find(button=>button.text()==='添加本地文件夹')!.trigger('click');await view.findAll('button').find(button=>button.text()==='选择文件夹')!.trigger('click');await tick();expect(nativeCall).not.toHaveBeenCalledWith('local_save_chosen_source',expect.anything());await view.get('.file-source-back').trigger('click');await tick();expect(nativeCall).toHaveBeenCalledWith('local_cancel_folder',{selectionId:'choice'})
 await view.findAll('.source-picker button').find(button=>button.text()==='添加本地文件夹')!.trigger('click');await view.findAll('button').find(button=>button.text()==='选择文件夹')!.trigger('click');await tick();await view.get('#source-name').setValue('Films');await view.get('.source-connection-form').trigger('submit');await tick();expect(nativeCall).toHaveBeenCalledWith('local_save_chosen_source',{selectionId:'choice',name:'Films'});expect(mocks.scanFolder).toHaveBeenCalledWith('local','');wrapper.unmount()
})
it('uses the original Plex resources UI with opaque IDs and saves only selected resources',async()=>{
 vi.mocked(nativeCall).mockImplementation(async command=>command==='plex_login'?{sessionId:'session',resources:[{id:'r1',name:'Server 1',connections:2},{id:'r2',name:'Server 2',connections:1}]}:command==='account_list'?[]:null as never)
 const wrapper=mount(NativeServerRegistry,{props:{defaultType:'plex',embedded:true},attachTo:document.body});await wrapper.get('#plex-source-name').setValue('Home');await wrapper.get('form').trigger('submit');await tick();expect(wrapper.findAll('.plex-resource-row')).toHaveLength(2);expect(wrapper.html()).not.toContain('accessToken');await wrapper.findAll('.plex-resource-row')[0].trigger('click');await wrapper.findAll('button').find(button=>button.text()==='保存')!.trigger('click');await tick();expect(nativeCall).toHaveBeenCalledWith('plex_save_resources',{sessionId:'session',selected:['r2'],name:'Home'});expect(wrapper.emitted('saved')).toHaveLength(1)
})
it('cancels pending native Plex discovery instead of saving accounts on exit',async()=>{
 vi.mocked(nativeCall).mockImplementation(async command=>command==='plex_login'?{sessionId:'session',resources:[{id:'r1',name:'Server',connections:1}]}:null as never);const wrapper=mount(NativeServerRegistry,{props:{defaultType:'plex',embedded:true}});await wrapper.get('form').trigger('submit');await tick();wrapper.unmount();await tick();expect(nativeCall).toHaveBeenCalledWith('plex_cancel_resources',{sessionId:'session'});expect(nativeCall).not.toHaveBeenCalledWith('plex_save_resources',expect.anything())
})
it('edits an existing server through its stable native identity and keeps blank passwords native',async()=>{
 const wrapper=mount(NativeServerRegistry,{props:{embedded:true,editingServer:{id:'server',type:'emby',name:'Home',baseUrl:'https://server.example',username:'user',createdAt:0,updatedAt:0}},attachTo:document.body});await wrapper.get('#server-add-name').setValue('Renamed');await wrapper.get('form').trigger('submit');await tick();expect(nativeCall).toHaveBeenCalledWith('server_update_connection',expect.objectContaining({accountId:'server',name:'Renamed',username:'user',password:null}));expect(nativeCall).not.toHaveBeenCalledWith('server_login',expect.anything())
})
it('removes a server shortcut without removing its source account',async()=>{
 const pinia=createPinia(),store=useFileSourcesStore(pinia);store.accounts=[{id:'server',providerId:'emby',name:'Server',baseUrl:'https://server.example',authOrigins:['https://server.example']}];writePreferences('server',{...readPreferences('server'),favorites:[{key:'favorite',title:'Movies',route:{kind:'category',id:'movies',category:'all',title:'Movies'}}]});store.refreshServerFavorites();let ports!:FilesPorts
 mount(defineComponent({setup(){ports=useFilesPorts(()=>{});return()=>h('div')}}),{global:{plugins:[pinia]}});const route=ports.originalModel.libraryBookmarks.favorites[0];await ports.action('server-category:'+route,'removeFavoriteFolder');expect(store.accounts).toHaveLength(1);expect(readPreferences('server').favorites).toEqual([]);expect(nativeCall).not.toHaveBeenCalledWith('account_remove',expect.anything())
})

it('groups Google browsing under My Drive and Shared Drives and places All Folders inside them',async()=>{
 const account={id:'google-groups',providerId:'google' as const,name:'我的 Google Drive',baseUrl:'',authOrigins:[]}
 useFileSourcesStore().accounts=[account]
 let ports!:FilesPorts
 const harness=mount(defineComponent({setup(){ports=useFilesPorts(vi.fn() as any);return()=>h('div')}}))
 await tick()
 const source=ports.savedSources.value.find(row=>row.id===account.id)!
 expect(source.drives?.map(row=>[row.label,row.folder.file_id])).toEqual([['我的硬盘','google_root'],['共享硬盘','google_shared']])
 const {default:Browser}=await import('@/features/files/electron/FileSourceBrowser.vue')
 const manager=defineComponent({props:['initialPath'],setup(props,{slots}){return()=>h('div',{'data-manager-path':props.initialPath},slots['list-header']?.())}})
 const wrapper=mount(Browser,{props:{source},global:{stubs:{SourceDriveManager:manager}},attachTo:document.body});await tick()
 expect(wrapper.find('[data-manager-path]').exists()).toBe(false)
 expect(wrapper.findAll('.source-file-row').some(row=>row.text().includes('所有文件夹'))).toBe(false)
 expect(wrapper.findAll('.share-browser-files button').map(row=>row.text())).toEqual(expect.arrayContaining(['我的硬盘','共享硬盘']))
 await wrapper.findAll('.share-browser-files button').find(row=>row.text()==='我的硬盘')!.trigger('click');await tick()
 expect(wrapper.get('[data-manager-path]').attributes('data-manager-path')).toBe('google_root')
 expect(wrapper.get('[data-manager-path] .source-all-files').text()).toContain('所有文件');expect(wrapper.find('.share-browser > .source-all-files').exists()).toBe(false)
 await wrapper.get('.share-browser-toolbar button').trigger('click');await tick()
 expect(wrapper.find('[data-manager-path]').exists()).toBe(false)
 await wrapper.findAll('.share-browser-files button').find(row=>row.text()==='共享硬盘')!.trigger('click');await tick()
 expect(wrapper.get('[data-manager-path]').attributes('data-manager-path')).toBe('google_shared')
 wrapper.unmount();harness.unmount()
})

it.each(['smb','ftp','nfs'])('connects %s through native protocol and keeps passwords out of metadata',async provider=>{
 vi.mocked(nativeCall).mockImplementation(async command=>command==='network_share_connect'?{id:'net',providerId:provider,name:'NAS',baseUrl:provider+'://nas/share',authOrigins:[]}:command==='accounts_list'?[]:null as never)
 const wrapper=mount(UserLogin,{props:{embedded:true,provider,sourceName:'NAS'}});await tick()
 const inputs=wrapper.findAll('.remote-field input');await inputs[1].setValue(provider+'://nas/share')
 if(provider!=='nfs'){await inputs[2].setValue('member');await inputs[3].setValue('synthetic-password')}
 expect(wrapper.findAll('input[type="password"]').length).toBe(provider==='nfs'?0:1)
 await wrapper.get('form').trigger('submit');await tick()
 expect(nativeCall).toHaveBeenCalledWith('network_share_connect',expect.objectContaining({provider,address:provider+'://nas/share',name:'NAS'}))
 expect(wrapper.emitted('connected')).toHaveLength(1);wrapper.unmount()
})

it('keeps Aliyun open between web login and the second authorization and renews only the second QR',async()=>{
 vi.useFakeTimers()
 let finishWeb!:(value:unknown)=>void
 vi.mocked(nativeCall).mockImplementation(async command=>command==='aliyun_begin'?await new Promise(done=>{finishWeb=done}):command==='alipan_renew'?{sessionId:'renewed',imageDataUrl:'data:image/png;base64,dGVzdA=='}:command==='alipan_poll'?{status:'scanned'}:command==='account_list'?[]:null as never)
 const wrapper=mount(UserLogin,{props:{embedded:true,provider:'aliyun',sourceName:'Aliyun'}})
 try{
  await tick();expect(wrapper.text()).toContain('第一次扫码');expect(wrapper.emitted('connected')).toBeUndefined()
  finishWeb({sessionId:'second',imageDataUrl:'data:image/png;base64,dGVzdA=='});await tick()
  expect(wrapper.find('.qrcodeframe').exists()).toBe(true);expect(wrapper.emitted('connected')).toBeUndefined()
  await vi.advanceTimersByTimeAsync(2000);await tick();expect(wrapper.emitted('connected')).toBeUndefined()
  await wrapper.get('.qrcodeframe img').trigger('click');await tick()
  expect(nativeCall).toHaveBeenCalledWith('alipan_renew',{sessionId:'second'});expect(vi.mocked(nativeCall).mock.calls.filter(([cmd])=>cmd==='aliyun_begin')).toHaveLength(1)
 }finally{wrapper.unmount();vi.useRealTimers()}
})
