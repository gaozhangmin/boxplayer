import {beforeEach,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {request} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
let cleared=false,empty=true,serial=0
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{
 vi.resetAllMocks();cleared=false;empty=true;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(driver).mockReturnValue({resolve:vi.fn(),list:vi.fn().mockResolvedValue({entries:[]})})
 vi.mocked(request).mockImplementation(async(_account,method)=>{if(method==='POST'){cleared=true;return response({code:0})}return response({code:0,data:{fileList:cleared&&empty?[]:[{fileId:42,parentFileId:0,filename:'Film.mkv',type:0,size:42,trashed:1}],lastFileId:-1}})})
})
async function browser(){const source={id:'123-clear-ui-'+ ++serial,providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]},pinia=createPinia();useFileSourcesStore(pinia).accounts=[source];const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await getDrivePane().load(source.id,'trash',true);await flushPromises();return {source,pinia,wrapper}}
it('clears through the original toolbar command and removes only confirmed catalog references',async()=>{
 const {wrapper,source,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:source.id,fileId:'42'},{id:'other',sourceId:'other',fileId:'42'}],playlists:{list:['video','other']},series:{group:['video']}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{expect(getDrivePane().operations.has('trash.empty')).toBe(true);expect(wrapper.text()).toContain('清空回收站');await getDrivePane().action('emptyTrash',[]);await flushPromises();expect(vi.mocked(request).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1);expect(getDrivePane().store.ListDataRaw).toEqual([]);expect(snapshot.items.map((row:any)=>row.id)).toEqual(['other']);expect(update).toHaveBeenCalledTimes(1)}finally{wrapper.unmount();update.mockRestore()}
})
it('preserves catalog and visible rows when the provider has not emptied the recycle bin',async()=>{
 empty=false;const {wrapper,source,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{await expect(getDrivePane().action('emptyTrashDirect',[source.id,source.id])).rejects.toThrow('仍有项目');expect(getDrivePane().store.ListDataRaw.map(row=>row.file_id)).toEqual(['42']);expect(update).not.toHaveBeenCalled()}finally{wrapper.unmount();update.mockRestore()}
})
