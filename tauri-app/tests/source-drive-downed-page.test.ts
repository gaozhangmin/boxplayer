import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {reactive,defineComponent,h} from 'vue'
import {Modal} from '@arco-design/web-vue'
import DownedTaskPane from '@/features/files/drive/DownedTaskPane.vue'
import useDownedStore from '@/features/files/drive/electron/down/DownedStore'
import type {IStateDownFile} from '@/features/files/drive/electron/down/downloadTaskModels'
import {createDownedDAL,type DownedTaskPane as Pane} from '@/features/files/drive/downedTaskPorts'
import {bindCompletedDownloadActions} from '@/features/files/drive/completedDownloadActions'
import {createTaskKeyboard,createTaskMouse} from '@/features/files/drive/taskPorts'
import {message} from '@/features/files/drive/ports'
const row=(id:string,extra:Partial<IStateDownFile['Info']>={}):IStateDownFile=>({DownID:id,Info:{GID:id,user_id:'fixture',DownSavePath:'/fixture',ariaRemote:false,file_id:id,drive_id:'drive',name:`Movie ${id}.mp4`,size:64,sizestr:'64 B',icon:'',isDir:false,encType:'',sha1:'',crc64:'',...extra},Down:{DownState:'已完成',DownTime:0,DownSize:64,DownSpeed:0,DownSpeedStr:'',DownProcess:100,IsStop:true,IsDowning:false,IsCompleted:true,IsFailed:false,FailedCode:0,FailedMessage:'',AutoTry:0,DownUrl:''}})
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const options={global:{stubs:{AList:list,IconFont:true}}}
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}}))
afterEach(()=>vi.restoreAllMocks())
function context(){const pane=reactive<Pane>({store:useDownedStore(createPinia()),height:240,accounts:[],check:vi.fn(),keyboard:createTaskKeyboard(),mouse:createTaskMouse()});const dal=createDownedDAL(pane);return {pane,dal}}
it('renders original completed-download title and original range selection',async()=>{
 const controller={read:vi.fn().mockResolvedValue({rows:[row('a'),row('b'),row('c')],count:3}),remove:vi.fn(),open:vi.fn()}
 const wrapper=mount(DownedTaskPane,{...options,props:{controller}});await flushPromises();expect(wrapper.text()).toContain('已下载')
 await wrapper.get('button.qujian').trigger('click');await wrapper.findAll('.fileitem')[0]!.trigger('click');await wrapper.findAll('.fileitem')[2]!.trigger('click');await flushPromises();expect(wrapper.findAll('.fileitem.selected')).toHaveLength(3)
})
it('retains original confirmation with file deletion unchecked by default',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData([row('a')],1);const unbind=bindCompletedDownloadActions(pane.store,dal)
 const remove=vi.fn().mockResolvedValue(false);pane.controller={read:vi.fn(),remove,open:vi.fn()}
 let confirm:any;vi.spyOn(Modal,'confirm').mockImplementation((config:any)=>{confirm=config;return {} as any})
 const pending=pane.store.mDeleteDowned(['a']);expect(remove).not.toHaveBeenCalled();expect(confirm.title).toBe('删除已完成下载')
 confirm.onOk();await pending;expect(remove).toHaveBeenCalledWith('a',false);expect(pane.store.ListDataRaw).toHaveLength(1);unbind()
})
it('does not remove records when the original confirmation is cancelled or host closes',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData([row('a')],1);const unbind=bindCompletedDownloadActions(pane.store,dal)
 const remove=vi.fn();pane.controller={read:vi.fn(),remove,open:vi.fn()};let confirm:any
 vi.spyOn(Modal,'confirm').mockImplementation((config:any)=>{confirm=config;return {} as any})
 const cancelled=pane.store.mDeleteDowned(['a']);confirm.onCancel();await cancelled;expect(remove).not.toHaveBeenCalled()
 const closed=pane.store.mDeleteDowned(['a']);unbind();confirm.onOk();await closed;expect(remove).not.toHaveBeenCalled()
})
it('blocks destructive folder/cloud/remote removal and retains records on partial failure',async()=>{
 const {pane,dal}=context();const rows=[row('local'),row('folder',{isDir:true}),row('remote',{ariaRemote:true}),row('cloud',{offlineProvider:'pikpak'})]
 pane.store.aLoadListData(rows,4);const remove=vi.fn().mockResolvedValue(true),read=vi.fn().mockResolvedValue({rows:rows.slice(1),count:3});pane.controller={read,remove,open:vi.fn()};const error=vi.spyOn(message,'error')
 expect(await dal.remove(rows.map(item=>item.DownID),true)).toBe(false);expect(remove).toHaveBeenCalledTimes(1);expect(remove).toHaveBeenCalledWith('local',true);expect(error).toHaveBeenCalledTimes(3);expect(pane.store.ListDataRaw.map(item=>item.DownID)).toEqual(['folder','remote','cloud'])
})
it('opens at most ten local records and never treats cloud/remote records as local paths',async()=>{
 const {pane,dal}=context(),rows=[row('cloud',{offlineProvider:'pikpak'}),row('remote',{ariaRemote:true}),...Array.from({length:11},(_,i)=>row(String(i)))];pane.store.aLoadListData(rows,rows.length)
 const open=vi.fn().mockResolvedValue(true);pane.controller={read:vi.fn(),remove:vi.fn(),open};vi.spyOn(message,'info');vi.spyOn(message,'error')
 await dal.open(rows.map(item=>item.DownID),true);expect(open).toHaveBeenCalledTimes(8);expect(open).not.toHaveBeenCalledWith('cloud',true);expect(open).not.toHaveBeenCalledWith('remote',true)
})
it('rejects running and duplicate rows in a completed-only snapshot',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData([row('old')],1);const invalid=row('new');invalid.Down.IsCompleted=false
 pane.controller={read:vi.fn().mockResolvedValue({rows:[invalid],count:1}),remove:vi.fn(),open:vi.fn()};vi.spyOn(message,'error');expect(await dal.read()).toBe(false);expect(pane.store.ListDataRaw[0]?.DownID).toBe('old')
})
it('ignores stale reads and late disposed results',async()=>{
 const {pane,dal}=context();let done!:(value:{rows:IStateDownFile[];count:number})=>void,closed=false
 pane.check=()=>{if(closed)throw Error('closed')};pane.controller={read:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{done=resolve})).mockResolvedValueOnce({rows:[row('new')],count:1}),remove:vi.fn(),open:vi.fn()}
 const pending=dal.read();await createDownedDAL(pane).read();closed=true;done({rows:[row('old')],count:1});await pending;expect(pane.store.ListDataRaw[0]?.DownID).toBe('new')
})
it('preserves selection when an actual removal fails instead of setting fake pending-delete state',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData([row('a')],1);pane.store.mSelectAll();pane.controller={read:vi.fn(),remove:vi.fn().mockRejectedValue(Error('disk error')),open:vi.fn()};vi.spyOn(message,'error')
 expect(await dal.remove(['a'],false)).toBe(false);expect(pane.store.ListSelected).toEqual(new Set(['a']));expect(pane.store.ListDataRaw[0]?.Down.DownState).toBe('已完成');expect(pane.controller.read).not.toHaveBeenCalled()
})
it('confirms the clicked row instead of clearing the previous selection',async()=>{
 const controller={read:vi.fn().mockResolvedValue({rows:[row('a'),row('b')],count:2}),remove:vi.fn().mockResolvedValue(false),open:vi.fn()};let confirm:any
 vi.spyOn(Modal,'confirm').mockImplementation((config:any)=>{confirm=config;return {} as any})
 const wrapper=mount(DownedTaskPane,{...options,props:{controller}});await flushPromises();await wrapper.findAll('.fileitem')[0]!.trigger('click');await wrapper.findAll('.fileitem')[1]!.findAll('a').at(-1)!.trigger('click')
 expect(confirm.title).toBe('删除已完成下载');confirm.onOk();await flushPromises();expect(controller.remove).toHaveBeenCalledWith('b',false);expect(controller.remove).not.toHaveBeenCalledWith('a',false)
})
