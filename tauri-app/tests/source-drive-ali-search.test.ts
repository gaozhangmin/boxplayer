import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import SearchPan from '@/features/files/drive/electron/pan/topbtns/SearchPanModal.vue'
import {topSearchAll} from '@/features/files/drive/ports'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {alipan} from '@/features/sources/alipan'
import {request} from '@/features/sources/transport'
vi.mock('@/features/sources/alipan',()=>({alipan:{list:vi.fn()}}))
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body)),playable:()=>true}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(alipan.list).mockResolvedValue({entries:[{id:id('backup','root'),name:'备份盘',isDirectory:true,size:0,playable:false},{id:id('resource','root'),name:'资源盘',isDirectory:true,size:0,playable:false}]});vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),resolve:vi.fn()});vi.mocked(request).mockResolvedValue(response({items:[{drive_id:'resource',file_id:'movie',parent_file_id:'parent',name:'Movie.mkv',type:'file'}],next_marker:''}))
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return wrapper}
describe('original advanced search dialog in source manager',()=>{
 it('loads original form, submits its tokens and closes without dropping results',async()=>{
  const wrapper=await browser();try{await topSearchAll('topSearchAll高级搜索',['resource']);await flushPromises();const dialog=wrapper.findComponent(SearchPan);expect(dialog.exists()).toBe(true);const vm=dialog.vm as any;vm.form.name='Movie';vm.form.range=['resource'];vm.form.type=['video'];vm.form.ext='.mkv， .mp4';vm.handleOK();await flushPromises();expect(request).toHaveBeenCalledOnce();const body=JSON.parse(vi.mocked(request).mock.calls[0]![3]!);expect(body.drive_id_list).toEqual(['resource']);expect(body.query).toContain('name match "Movie"');expect(body.query).toContain('file_extension in ["mkv","mp4"]');expect(wrapper.findComponent(SearchPan).exists()).toBe(false);expect(getDrivePane().store.ListDataRaw[0]?.name).toBe('Movie.mkv')}finally{wrapper.unmount()}
 });
 it('routes ordinary search through the same original query and scope',async()=>{const wrapper=await browser();try{await topSearchAll('Movie',['resource']);await flushPromises();expect(JSON.parse(vi.mocked(request).mock.calls[0]![3]!).drive_id_list).toEqual(['resource']);expect(getDrivePane().store.SelectDirType).toBe('search')}finally{wrapper.unmount()}});
 it('closes the search dialog on source switch',async()=>{const wrapper=await browser();try{await topSearchAll('topSearchAll高级搜索',['resource']);await flushPromises();useFileSourcesStore().accounts.push({...account,id:'other'});await wrapper.setProps({sourceId:'other'});await flushPromises();expect(wrapper.findComponent(SearchPan).exists()).toBe(false);expect(request).not.toHaveBeenCalled()}finally{wrapper.unmount()}})
})
