import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {reactive,defineComponent,h} from 'vue'
import UploadedTaskPane from '@/features/files/drive/UploadedTaskPane.vue'
import useUploadedStore from '@/features/files/drive/electron/down/UploadedStore'
import type {IStateUploadTask} from '@/features/files/drive/electron/down/uploadTaskModels'
import {createUploadedDAL,type UploadedTaskPane as Pane} from '@/features/files/drive/uploadedTaskPorts'
import {createTaskKeyboard,createTaskMouse} from '@/features/files/drive/taskPorts'
import {message} from '@/features/files/drive/ports'
const row=(id:number):IStateUploadTask=>({TaskID:id,TaskName:`Movie ${id}`,TaskFileID:`remote-${id}`,user_id:'fixture',parent_file_id:'root',drive_id:'drive',check_name_mode:'refuse',isDir:false,encType:'',localFilePath:`/fixture/${id}`,Children:[],ChildTotalCount:1,ChildFinishCount:1,ChildTotalSize:64,ChildFinishSize:64})
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const options={global:{stubs:{AList:list,IconFont:true}}}
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}}))
afterEach(()=>vi.restoreAllMocks())
function context(){const pane=reactive<Pane>({store:useUploadedStore(createPinia()),height:240,check:vi.fn(),keyboard:createTaskKeyboard(),mouse:createTaskMouse()});return {pane,dal:createUploadedDAL(pane)}}
it('renders the original empty page without manufacturing completed records',async()=>{
 const wrapper=mount(UploadedTaskPane,options);await flushPromises();expect(wrapper.text()).toContain('已上传');expect(wrapper.findAll('.fileitem')).toHaveLength(0)
 const warning=vi.spyOn(message,'warning'),clear=wrapper.findAll('button').find(button=>button.text().includes('清空全部'))!
 expect(clear).toBeDefined();await clear.trigger('click');await flushPromises();expect(warning).toHaveBeenCalledWith('传输服务尚未启用，未修改任务')
})
it('targets the clicked record rather than a different selected record',async()=>{
 const read=vi.fn().mockResolvedValue({rows:[row(1),row(2)],count:2}),clear=vi.fn().mockResolvedValue(false),open=vi.fn().mockResolvedValue(true)
 const wrapper=mount(UploadedTaskPane,{...options,props:{controller:{read,clear,open}}});await flushPromises()
 await wrapper.findAll('.fileitem')[0]!.trigger('click',{ctrlKey:false,shiftKey:false})
 const buttons=wrapper.findAll('.fileitem')[1]!.findAll('button')
 await buttons.at(-1)!.trigger('click');await flushPromises();expect(clear).toHaveBeenCalledWith([2],false)
 await buttons.at(-2)!.trigger('click');await flushPromises();expect(open).toHaveBeenCalledWith(2,'dir')
 expect(wrapper.findAll('.fileitem')).toHaveLength(2)
})
it('preserves the original range interaction with numeric initial sentinel',async()=>{
 const wrapper=mount(UploadedTaskPane,{...options,props:{controller:{read:vi.fn().mockResolvedValue({rows:[row(1),row(2),row(3)],count:3}),clear:vi.fn(),open:vi.fn()}}});await flushPromises()
 await wrapper.get('button.qujian').trigger('click');await wrapper.findAll('.fileitem')[0]!.trigger('click');await wrapper.findAll('.fileitem')[2]!.trigger('click');await flushPromises()
 expect(wrapper.findAll('.fileitem.selected')).toHaveLength(3)
})
it('retains selection across reads and filters original completed-record names',()=>{
 const {pane}=context();pane.store.aLoadListData([row(1),row(2)],2);pane.store.mMouseSelect(2,false,false)
 pane.store.aLoadListData([row(2),row(3)],2);expect(pane.store.ListSelected).toEqual(new Set([2]))
 pane.store.mSearchListData('Movie 3');expect(pane.store.ListDataShow.map(item=>item.TaskID)).toContain(3);expect(pane.store.ListSelected.size).toBe(0)
})
it('rejects duplicate record identities and preserves the old list',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData([row(1)],1);pane.controller={read:vi.fn().mockResolvedValue({rows:[row(2),row(2)],count:2}),clear:vi.fn(),open:vi.fn()}
 const error=vi.spyOn(message,'error');await dal.aReloadUploaded();expect(error).toHaveBeenCalledWith('已上传任务条目标识或大小无效');expect(pane.store.ListDataShow[0]?.TaskID).toBe(1)
})
it('ignores stale refresh and closed-pane results',async()=>{
 const {pane,dal}=context();let done!:(value:{rows:IStateUploadTask[];count:number})=>void,closed=false
 pane.check=()=>{if(closed)throw Error('closed')};pane.controller={read:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{done=resolve})).mockResolvedValueOnce({rows:[row(2)],count:1}),clear:vi.fn(),open:vi.fn()}
 const pending=dal.aReloadUploaded();await createUploadedDAL(pane).aReloadUploaded();closed=true;done({rows:[row(1)],count:1});await pending
 expect(pane.store.ListDataShow[0]?.TaskID).toBe(2)
})
it('retains completed rows and selection when record removal fails',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData([row(1)],1);pane.store.mSelectAll()
 pane.controller={read:vi.fn(),clear:vi.fn().mockRejectedValue(Error('storage unavailable')),open:vi.fn()};const error=vi.spyOn(message,'error')
 expect(await dal.UploadedDelete(false)).toBe(false);expect(error).toHaveBeenCalledWith('storage unavailable');expect(pane.store.ListSelected).toEqual(new Set([1]));expect(pane.controller.read).not.toHaveBeenCalled()
})
