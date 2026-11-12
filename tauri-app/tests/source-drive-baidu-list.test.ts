import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {baidu} from '@/features/sources/cloud'
import {rawRequest} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({rawRequest:vi.fn(),request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body)),playable:()=>true}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'source',providerId:'baidu' as const,name:'Fixture',baseUrl:'',authOrigins:[]},movie={fs_id:'9007199254740997',path:'/nested/Movie.mkv',server_filename:'Movie.mkv',isdir:0,size:42,server_mtime:1700000000}
const response=(rows:unknown[])=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify({errno:0,list:rows,has_more:0}))),finalUrl:''})
beforeEach(()=>{
 vi.resetAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(driver).mockReturnValue(baidu);vi.mocked(rawRequest).mockImplementation(async(_a,_m,raw)=>{const url=new URL(raw);if(url.pathname.endsWith('/multimedia'))return response([{fs_id:5,path:'/nested',filename:'nested',isdir:1}]);return response(url.searchParams.get('method')==='search'||url.searchParams.get('dir')==='/nested'?[movie]:[{fs_id:5,path:'/nested',server_filename:'nested',isdir:1,size:0}])})
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await vi.waitFor(()=>expect(getDrivePane().store.ListDataRaw).toHaveLength(1));return wrapper}
it('renders original Baidu models and opens the actual result parent from search',async()=>{
 const wrapper=await browser();try{
  expect(getDrivePane().operations.has('files.search')).toBe(true)
  expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'5',icon:'iconfile-folder',isDir:true})
  await getDrivePane().action('search',['Movie']);await flushPromises();expect(getDrivePane().store.DirID).toBe('search:Movie')
  expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:movie.fs_id,parent_file_id:'/nested',path:movie.path,description:'baidu_fsid:9007199254740997;baidu_path:/nested/Movie.mkv',icon:'iconfile_video'})
  await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('openLocation',[]);await flushPromises()
  expect(new URL(vi.mocked(rawRequest).mock.calls.at(-1)![2]).searchParams.get('dir')).toBe('/nested');expect(getDrivePane().store.DirID).toBe('/nested')
 }finally{wrapper.unmount()}
})
it('leaves search when opening a result in the same current folder and Back restores that search',async()=>{
 const wrapper=await browser();try{
  await getDrivePane().load(account.id,'/nested',true);await getDrivePane().action('search',['Movie']);await flushPromises()
  await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('openLocation',[]);await flushPromises()
  expect(getDrivePane().store.DirID).toBe('/nested');expect(new URL(vi.mocked(rawRequest).mock.calls.at(-1)![2]).searchParams.get('method')).toBe('list')
  await getDrivePane().load(account.id,'back',false);await flushPromises();expect(getDrivePane().store.DirID).toBe('search:Movie')
 }finally{wrapper.unmount()}
})

it('opens an original stable directory ID using metadata and keeps the actual path out of its identity',async()=>{
 const wrapper=await browser();try{
  await getDrivePane().load(account.id,'5',true);await flushPromises()
  const calls=vi.mocked(rawRequest).mock.calls.map(call=>new URL(call[2]));expect(calls.some(url=>url.pathname.endsWith('/multimedia')&&url.searchParams.get('fsids')==='[5]')).toBe(true)
  expect(calls.at(-1)!.searchParams.get('dir')).toBe('/nested');expect(getDrivePane().store.DirID).toBe('5');expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({parent_file_id:'5',path:movie.path})
 }finally{wrapper.unmount()}
})
it('keeps legacy physical-path favorites starred and routes removal to the existing bookmark without rewriting the row ID',async()=>{
 const wrapper=await browser();try{
  const sources=useFileSourcesStore();sources.bookmark(account.id,'/nested','Existing',false)
  const row=getDrivePane().store.ListDataRaw[0]!
  expect(row.file_id).toBe('5');expect(getDrivePane().favorite(row)).toBe(true)
  await getDrivePane().action('folderFavorite',[row]);expect(wrapper.emitted('favorite')?.[0]?.[0]).toMatchObject({file_id:'/nested',name:'nested'})
  expect(row.file_id).toBe('5');expect(sources.preferences.favorites).toHaveLength(1);expect(sources.preferences.favorites[0]!.path).toBe('/nested')
 }finally{wrapper.unmount()}
})
