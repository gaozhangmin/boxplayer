import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {alipan} from '@/features/sources/alipan'
import {request} from '@/features/sources/transport'
vi.mock('@/features/sources/alipan',()=>({alipan:{list:vi.fn()}}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body)),playable:()=>true}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'source',providerId:'aliyun' as const,name:'Fixture',baseUrl:'',authOrigins:[]},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let bins:Record<string,string[]>,failed=false,repeated=false
beforeEach(()=>{
 vi.resetAllMocks();bins={resource:['a','b'],backup:['a']};failed=false;repeated=false;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(alipan.list).mockResolvedValue({entries:['resource','backup'].map(drive=>({id:id(drive,'root'),name:drive,isDirectory:true,size:0,playable:false}))})
 vi.mocked(request).mockImplementation(async(_account,_method,url,body)=>{
  const input=JSON.parse(body!)
  if(url.includes('/recyclebin/list?'))return response({items:(bins[input.drive_id]||[]).slice(0,1).map(file=>({file_id:file,drive_id:input.drive_id,parent_file_id:'root',name:file+'.mkv',type:'file',size:1})),next_marker:(bins[input.drive_id]||[]).length>1?'next':''})
  if(url.endsWith('/batch')){const row=input.requests[0];if(failed&&row.body.drive_id==='backup')return response({responses:[{id:row.id,status:500,body:{code:'failed'}}]});if(!repeated)bins[row.body.drive_id]=bins[row.body.drive_id]!.filter(file=>file!==row.id);return response({responses:[{id:row.id,status:204}]})}
  throw Error('unexpected endpoint')
 })
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name,initialPath:'trash'},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();const snapshot={items:[{id:'resource-a',sourceId:account.id,fileId:id('resource','a')},{id:'backup-a',sourceId:account.id,fileId:id('backup','a')},{id:'other',sourceId:'other',fileId:id('resource','a')}],playlists:{},series:{}};const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot as any));return {wrapper,snapshot,update}}
describe('original Ali empty-bin UI through native repeated-first-page operation',()=>{
 it('clears both drives with original purge methods and reloads actual empty view',async()=>{
  const {wrapper,snapshot,update}=await browser();expect(wrapper.text()).toContain('清空回收站');vi.mocked(request).mockClear();await getDrivePane().action('emptyTrash',[]);await flushPromises()
  expect(bins).toEqual({resource:[],backup:[]});expect(getDrivePane().store.ListDataRaw).toEqual([]);expect(snapshot.items.map(item=>item.id)).toEqual(['other']);expect(update).toHaveBeenCalledTimes(1)
  expect(vi.mocked(request).mock.calls.filter(call=>call[2].includes('/recyclebin/list?')).every(call=>JSON.parse(call[3]!).marker==='')).toBe(true)
  expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(3);wrapper.unmount();update.mockRestore()
 })
 it('cleans confirmed catalog entries on partial failure but preserves the failed drive',async()=>{
  failed=true;const {wrapper,snapshot,update}=await browser();await expect(getDrivePane().action('emptyTrashDirect',[account.id,account.id])).rejects.toThrow('未完全清空');await flushPromises();expect(bins.backup).toEqual(['a']);expect(snapshot.items.map(item=>item.id)).toEqual(['backup-a','other']);expect(wrapper.text()).toContain('未确认');wrapper.unmount();update.mockRestore()
 })
 it('stops if provider repeats a confirmed-deleted row instead of looping forever',async()=>{
  repeated=true;const {wrapper,update}=await browser();await expect(getDrivePane().action('emptyTrashDirect',[account.id,account.id])).rejects.toThrow('未完全清空');expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1);wrapper.unmount();update.mockRestore()
 })
})
