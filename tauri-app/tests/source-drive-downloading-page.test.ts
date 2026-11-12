import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {reactive,defineComponent,h} from 'vue'
import DownloadingTaskPane from '@/features/files/drive/DownloadingTaskPane.vue'
import useDowningStore from '@/features/files/drive/electron/down/DowningStore'
import type {IStateDownFile} from '@/features/files/drive/electron/down/downloadTaskModels'
import {createDownloadingDAL,type DownloadingTaskPane as Pane} from '@/features/files/drive/downloadingTaskPorts'
import {bindDownloadingActions} from '@/features/files/drive/downloadingActions'
import {createTaskKeyboard,createTaskMouse} from '@/features/files/drive/taskPorts'
import {message} from '@/features/files/drive/ports'
const row=(id:string):IStateDownFile=>({DownID:id,Info:{GID:id,user_id:'fixture',DownSavePath:'/fixture',ariaRemote:false,file_id:id,drive_id:'drive',name:`Movie ${id}.mp4`,size:64,sizestr:'64 B',icon:'',isDir:false,encType:'',sha1:'',crc64:''},Down:{DownState:'已暂停',DownTime:0,DownSize:0,DownSpeed:0,DownSpeedStr:'',DownProcess:0,IsStop:true,IsDowning:false,IsCompleted:false,IsFailed:false,FailedCode:0,FailedMessage:'',AutoTry:0,DownUrl:''}})
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}}));afterEach(()=>vi.restoreAllMocks())
function context(){const pane=reactive<Pane>({store:useDowningStore(createPinia()),height:240,accounts:[],check:vi.fn(),keyboard:createTaskKeyboard(),mouse:createTaskMouse()});return {pane,dal:createDownloadingDAL(pane)}}
it('keeps original range/selection and excludes only planned URL/BT controls',async()=>{
 const controller={read:vi.fn().mockResolvedValue([row('a'),row('b'),row('c')]),command:vi.fn().mockResolvedValue(false)}
 const wrapper=mount(DownloadingTaskPane,{props:{controller},global:{stubs:{AList:list,IconFont:true}}});await flushPromises()
 expect(wrapper.text()).toContain('下载中');expect(wrapper.text()).not.toContain('新建下载')
 await wrapper.get('button.qujian').trigger('click');await wrapper.findAll('.fileitem')[0]!.trigger('click');await wrapper.findAll('.fileitem')[2]!.trigger('click');await flushPromises();expect(wrapper.findAll('.fileitem.selected')).toHaveLength(3)
 const start=wrapper.findAll('button').find(button=>button.text()==='开始')!;await start.trigger('click');await flushPromises();expect(controller.command).toHaveBeenCalledWith('start',['a','b','c'],false);expect(wrapper.text()).toContain('已暂停')
})
it('routes original store controls without optimistic task changes',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData([row('a')]);pane.store.mSelectAll();const unbind=bindDownloadingActions(pane.store,dal)
 const command=vi.fn().mockResolvedValue(false);pane.controller={read:vi.fn(),command}
 await pane.store.mStartDowning();await pane.store.mStopAllDowning();await pane.store.mOrderDowning(['a']);await pane.store.mDeleteDowning(['a'])
 expect(command.mock.calls.map(call=>call[0])).toEqual(['start','pause','prioritize','remove']);expect(pane.store.ListDataRaw[0]?.Down.DownState).toBe('已暂停');expect(pane.store.ListSelected).toEqual(new Set(['a']));unbind()
})
it('warns without a production engine and creates no fake task state',async()=>{
 const {pane,dal}=context(),warning=vi.spyOn(message,'warning');pane.store.aLoadListData([row('a')]);expect(await dal.command('start',[],true)).toBe(false);expect(warning).toHaveBeenCalledWith('传输服务尚未启用，未修改任务');expect(pane.store.ListDataDowningCount).toBe(0)
})
it('accepts new states only from an authoritative reread after accepted commands',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData([row('a')]);const updated=row('a');updated.Down.IsDowning=true;updated.Down.DownState='下载中';pane.controller={read:vi.fn().mockResolvedValue([updated]),command:vi.fn().mockResolvedValue(true)}
 expect(await dal.command('start',['a'],false)).toBe(true);expect(pane.store.ListDataDowningCount).toBe(1)
})
it('rejects excluded engine tasks and invalid progress before replacing rows',async()=>{
 const {pane,dal}=context();pane.store.aLoadListData([row('old')]);const bad=row('new');bad.Info.sourceType='magnet';pane.controller={read:vi.fn().mockResolvedValue([bad]),command:vi.fn()};vi.spyOn(message,'error');expect(await dal.read()).toBe(false);expect(pane.store.ListDataRaw[0]?.DownID).toBe('old')
})
it('ignores stale results and serializes native commands',async()=>{
 const {pane,dal}=context();let done!:(rows:IStateDownFile[])=>void;pane.controller={read:vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{done=resolve})).mockResolvedValueOnce([row('new')]),command:vi.fn()}
 const pending=dal.read();await createDownloadingDAL(pane).read();done([row('old')]);await pending;expect(pane.store.ListDataRaw[0]?.DownID).toBe('new')
 let accept!:(value:boolean)=>void;pane.controller.command=vi.fn().mockImplementation(()=>new Promise(resolve=>{accept=resolve}));const command=dal.command('start',['new'],false);expect(await dal.command('remove',[],true)).toBe(false);accept(false);await command;expect(pane.controller.command).toHaveBeenCalledTimes(1)
})
