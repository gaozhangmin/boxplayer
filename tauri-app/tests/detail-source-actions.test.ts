import {beforeEach,expect,it,vi} from 'vitest'
import {defineComponent} from 'vue'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia,setActivePinia} from 'pinia'
import ServerDetail from '@/features/servers/electron/ServerDetail.vue'
import {normalizeItem} from '@/features/servers/workspace'
import AddSource from '@/features/files/electron/AddFileSourceModal.vue'
import SavedSourceEditor from '@/features/sources/SavedSourceEditor.vue'
import {useFileSourcesStore} from '@/stores/fileSources'
import {nativeCall} from '@/platform/native'
import {setLocale} from '@/features/files/electron/i18n'
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:String(cause)})}))
const account={id:'server',providerId:'emby' as const,name:'Server',baseUrl:'https://fixture.invalid',userId:'viewer',authOrigins:['https://fixture.invalid']}
beforeEach(()=>{vi.clearAllMocks();setLocale('zh-CN');const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>data.set(key,value)});setActivePinia(createPinia());vi.mocked(nativeCall).mockImplementation(async command=>command==='server_connection_info'?{username:'viewer'}:true as never)})
it('updates the selected episode corner and emits download from the aligned action row',async()=>{
 const show=normalizeItem({Id:'show',Type:'Series',Name:'Show'},false),episode=normalizeItem({Id:'e1',Type:'Episode',Name:'Episode',IndexNumber:1,UserData:{Played:false}},false)
 const view=mount(ServerDetail,{props:{account,item:show,children:[],episodes:[episode],similar:[],menuEntries:[]},global:{stubs:{ServerArtwork:true,MediaSourceRatings:true}}});await flushPromises();expect(view.find('.episode-thumbnail .watched-corner').exists()).toBe(true)
 expect(view.findAll('.action-buttons>.action-button').map(button=>button.attributes('title'))).toEqual(['标记已观看','下载','评分','收藏','播放列表'])
 await view.get('.action-buttons [title="下载"]').trigger('click');expect(view.emitted('action')?.at(-1)).toEqual(['download',expect.objectContaining({id:'e1'})])
 await view.setProps({episodes:[{...episode,watched:true}]});await flushPromises();expect(view.find('.episode-thumbnail .watched-corner').exists()).toBe(false);view.unmount()
})
it('opens the selected saved source editor with the row pencil',async()=>{
 const sources=useFileSourcesStore();sources.accounts=[account]
 const view=mount(AddSource,{props:{embedded:true,visible:true,deviceName:'Mac',sources:[{id:account.id,name:account.name,folder:{file_id:'',drive_id:'server',name:'Server',path:'',isDir:true,size:0} as any}]},global:{stubs:{'a-modal':{template:'<div><slot/></div>'},SavedSourceEditor:defineComponent({name:'SavedSourceEditor',props:['account'],template:'<div data-testid="source-editor"/>'})}}})
 await flushPromises();await view.get('.saved-source-edit').trigger('click');await flushPromises();expect(view.getComponent({name:'SavedSourceEditor'}).props('account')).toMatchObject({id:'server'});view.unmount()
})
it('leaves stored passwords private while saving changes through the existing account identity',async()=>{
 const view=mount(SavedSourceEditor,{props:{account}});await flushPromises();expect((view.get('input[type=password]').element as HTMLInputElement).value).toBe('');expect(view.find('.remove-share').exists()).toBe(true)
 await view.get('form').trigger('submit');await flushPromises();expect(nativeCall).toHaveBeenCalledWith('server_update_connection',expect.objectContaining({accountId:'server',name:'Server',username:'viewer',password:null}));expect(view.emitted('saved')).toEqual([[]]);view.unmount()
})
