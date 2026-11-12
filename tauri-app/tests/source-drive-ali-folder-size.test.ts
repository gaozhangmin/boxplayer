import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {alipan} from '@/features/sources/alipan'
import {request} from '@/features/sources/transport'
import {DriverData} from '@/features/files/drive/aliDirectoryCachePorts'
vi.mock('@/features/sources/alipan',()=>({alipan:{list:vi.fn()}}))
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),text:(response:any)=>new TextDecoder().decode(new Uint8Array(response.body)),playable:()=>false}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const AList=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'ali-size-fixture',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(fileId:string)=>JSON.stringify({driveId:'resource',fileId}),response=(data:unknown)=>({status:200,headers:{},finalUrl:'',body:Array.from(new TextEncoder().encode(JSON.stringify(data)))})
beforeEach(()=>{
 vi.resetAllMocks();DriverData.clear();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(alipan.list).mockResolvedValue({entries:[{id:id('root'),name:'资源盘',isDirectory:true,size:0,playable:false}]})
 vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:['a','b'].map(file=>({id:id(file),name:file,isDirectory:true,size:0,playable:false}))}),resolve:vi.fn()})
 vi.mocked(request).mockImplementation(async(_account,_method,url,body)=>{
  const input=JSON.parse(body!)
  if(url.includes('/batch?')){const items=['a','b'].map(file=>({drive_id:'resource',file_id:file,parent_file_id:'root',name:file,updated_at:'2026-11-09T00:00:00Z'}));return response({responses:[{id:'id1',status:200,body:{items,next_marker:''}},{id:'id2',status:200,body:{items:[...items].reverse(),next_marker:''}}]})}
  if(url.includes('/file/search?'))return response({items:[{size:input.query.includes('"a"')?10:input.query.includes('"b"')?20:1}]})
  throw Error('Unexpected size endpoint')
 })
})
async function open(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList}},attachTo:document.body});await flushPromises();return wrapper}
it('automatically updates original size cells and size sort without losing selection',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});const wrapper=await open()
 try{const pane=getDrivePane();pane.store.mOrderListData('size desc');pane.store.mMouseSelect(id('a'),false,false);await vi.advanceTimersByTimeAsync(50000);await flushPromises();expect(pane.store.ListDataShow.map(file=>[file.name,file.size])).toEqual([['b',20],['a',10]]);expect([...pane.store.ListSelected]).toEqual([id('a')]);expect(wrapper.text()).toContain('20.00B');expect(wrapper.text()).toContain('10.00B')}finally{wrapper.unmount();vi.useRealTimers()}
})
it('stops the warmup scheduler when the original browser is closed',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});const wrapper=await open();wrapper.unmount();await vi.advanceTimersByTimeAsync(60000);expect(request).not.toHaveBeenCalled();vi.useRealTimers()
})
it('does not schedule web size requests when the persisted preference is disabled',async()=>{
 vi.stubGlobal('localStorage',{getItem:(key:string)=>key==='tauri.driveSettings'?JSON.stringify({uiFolderSize:false}):null,setItem:()=>{}});vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});const wrapper=await open();try{await vi.advanceTimersByTimeAsync(60000);expect(request).not.toHaveBeenCalled()}finally{wrapper.unmount();vi.useRealTimers()}
})
