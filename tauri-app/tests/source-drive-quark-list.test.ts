import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {quark} from '@/features/sources/cloud'
import {request} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({request:vi.fn(),json:vi.fn(),text:(value:{body:number[]})=>new TextDecoder().decode(new Uint8Array(value.body)),playable:()=>true}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'source',providerId:'quark' as const,name:'Fixture',baseUrl:'',authOrigins:[]},movie={fid:'movie',file_name:'Movie.mkv',pdir_fid:'nested',file_type:1,size:42,updated_at:1700000000}
const response=(rows:unknown[])=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify({code:0,data:{list:rows},metadata:{_total:rows.length}}))),finalUrl:''})
beforeEach(()=>{
 vi.resetAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
 vi.mocked(driver).mockReturnValue(quark);vi.mocked(request).mockImplementation(async(_a,_m,raw)=>{const url=new URL(raw);return response(url.pathname.endsWith('/search')||url.searchParams.get('pdir_fid')==='nested'?[movie]:[{fid:'nested',file_name:'Folder',file_type:0,pdir_fid:'0'}])})
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await vi.waitFor(()=>expect(getDrivePane().store.ListDataRaw).toHaveLength(1));return wrapper}
it('renders original Quark models and opens the actual result parent from search',async()=>{
 const wrapper=await browser();try{
  expect(getDrivePane().operations.has('files.search')).toBe(true)
  expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'nested',icon:'iconfile-folder',isDir:true})
  await getDrivePane().action('search',['Movie']);await flushPromises();expect(getDrivePane().store.DirID).toBe('search:Movie')
  expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'movie',parent_file_id:'nested',description:'quark_fid:movie;quark_pdir:nested',icon:'iconfile_video'})
  await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('openLocation',[]);await flushPromises()
  expect(new URL(vi.mocked(request).mock.calls.at(-1)![2]).searchParams.get('pdir_fid')).toBe('nested');expect(getDrivePane().store.DirID).toBe('nested')
 }finally{wrapper.unmount()}
})
it('leaves search when opening a result in the same current folder and Back restores that search',async()=>{
 const wrapper=await browser();try{
  await getDrivePane().load(account.id,'nested',true);await getDrivePane().action('search',['Movie']);await flushPromises()
  await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('openLocation',[]);await flushPromises()
  expect(getDrivePane().store.DirID).toBe('nested');expect(new URL(vi.mocked(request).mock.calls.at(-1)![2]).pathname).toBe('/1/clouddrive/file/sort')
  await getDrivePane().load(account.id,'back',false);await flushPromises();expect(getDrivePane().store.DirID).toBe('search:Movie')
 }finally{wrapper.unmount()}
})
