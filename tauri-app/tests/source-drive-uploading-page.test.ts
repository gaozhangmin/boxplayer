import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {reactive,defineComponent,h} from 'vue'
import UploadingTaskPane from '@/features/files/drive/UploadingTaskPane.vue'
import useUploadingStore,{type IUploadingModel} from '@/features/files/drive/electron/down/UploadingStore'
import {createUploadingDAL,createTaskKeyboard,createTaskMouse,type UploadTaskPane,type UploadTaskSnapshot} from '@/features/files/drive/taskPorts'
import {message} from '@/features/files/drive/ports'
const row=(id:number):IUploadingModel=>({UploadID:id,TaskID:id,name:`Task ${id}`,localFilePath:'/fixture',sizeStr:'1 B',icon:'',isDir:true,uploadState:'paused',speedStr:'',Progress:0,ProgressStr:'',errorMessage:''})
const snapshot=(id:number):UploadTaskSnapshot=>({taskId:0,name:'',rows:[row(id)],count:1})
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
afterEach(()=>vi.restoreAllMocks())
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})})
function context(){const pane=reactive<UploadTaskPane>({store:useUploadingStore(createPinia()),height:240,check:vi.fn(),keyboard:createTaskKeyboard(),mouse:createTaskMouse()});return {pane,dal:createUploadingDAL(pane)}}
it('renders original empty view and reports unavailable controls without inventing tasks',async()=>{
 const warning=vi.spyOn(message,'warning'),wrapper=mount(UploadingTaskPane,{global:{stubs:{AList:list,IconFont:true}}})
 await flushPromises();expect(wrapper.text()).toContain('上传中')
 const start=wrapper.findAll('button').find(button=>button.attributes('title')==='开始全部')
 expect(start).toBeDefined();await start!.trigger('click');await flushPromises()
 expect(warning).toHaveBeenCalledWith('传输服务尚未启用，未修改任务');expect(wrapper.findAll('.fileitem')).toHaveLength(0)
})
it('keeps task keyboard events local and passes original selected ids to the controller',async()=>{
 const command=vi.fn().mockResolvedValue(false),read=vi.fn().mockResolvedValue(snapshot(31))
 const wrapper=mount(UploadingTaskPane,{props:{controller:{command,read}},global:{stubs:{AList:list,IconFont:true}}})
 await flushPromises();await wrapper.get('.fileitem').trigger('click',{ctrlKey:false,shiftKey:false})
 await flushPromises();const pause=wrapper.findAll('button').find(button=>button.attributes('title')==='暂停')!
 await pause.trigger('click');await flushPromises();expect(command).toHaveBeenCalledWith('pause',0,[31],false)
 expect(read).toHaveBeenCalledTimes(1);expect(wrapper.text()).toContain('Task 31')
 await wrapper.trigger('keydown',{key:'a',metaKey:true});await flushPromises();expect(wrapper.get('.fileitem').classes()).not.toContain('selected')
 await wrapper.trigger('keydown',{key:'a',metaKey:true});await flushPromises();expect(wrapper.get('.fileitem').classes()).toContain('selected')
})
it('shares one request generation for a pane and ignores stale refresh results',async()=>{
 const {pane,dal}=context();let first!:(value:UploadTaskSnapshot)=>void
 pane.controller={read:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{first=resolve})).mockResolvedValueOnce(snapshot(2)),command:vi.fn()}
 const pending=dal.aReloadUploading();await createUploadingDAL(pane).aReloadUploading();first(snapshot(1));await pending
 expect(pane.store.ListDataShow.map(item=>item.UploadID)).toEqual([2]);expect(pane.store.ListLoading).toBe(false)
})
it('does not overwrite a disposed pane after a delayed read',async()=>{
 const {pane,dal}=context();let resolve!:(value:UploadTaskSnapshot)=>void,closed=false
 pane.check=()=>{if(closed)throw Error('closed')};pane.controller={read:()=>new Promise(done=>{resolve=done}),command:vi.fn()}
 const pending=dal.aReloadUploading();closed=true;resolve(snapshot(1));await pending
 expect(pane.store.ListDataShow).toEqual([])
})
it('retains rows and selection when execution is rejected or fails',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData(0,'',[row(8)],1);pane.store.mMouseSelect(8,false,false)
 pane.controller={read:vi.fn(),command:vi.fn().mockRejectedValue(Error('offline'))};const error=vi.spyOn(message,'error')
 expect(await dal.aUploadingDelete(false)).toBe(false);expect(error).toHaveBeenCalledWith('offline')
 expect(pane.store.ListSelected).toEqual(new Set([8]));expect(pane.store.ListDataShow).toHaveLength(1)
})
it('rejects ambiguous task identities before replacing visible rows',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData(0,'',[row(8)],1)
 pane.controller={read:vi.fn().mockResolvedValue({taskId:0,name:'',rows:[row(9),row(9)],count:2}),command:vi.fn()}
 const error=vi.spyOn(message,'error');await dal.aReloadUploading()
 expect(error).toHaveBeenCalledWith('上传任务条目标识或进度无效');expect(pane.store.ListDataShow.map(item=>item.TaskID)).toEqual([8])
})
it('does not dispatch repeated controls while a command is pending',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData(0,'',[row(8)],1);pane.store.mSelectAll()
 let done!:(accepted:boolean)=>void;const command=vi.fn().mockImplementation(()=>new Promise(resolve=>{done=resolve}))
 pane.controller={read:vi.fn(),command};const pending=dal.aUploadingStart(false,true)
 expect(await dal.aUploadingDelete(true)).toBe(false);expect(command).toHaveBeenCalledTimes(1)
 done(false);await pending;expect(pane.store.ListDataShow).toHaveLength(1)
})
