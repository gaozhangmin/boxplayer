import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {json,request} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(response:{body:number[]})=>new TextDecoder().decode(new Uint8Array(response.body)),playable:(name:string)=>name.endsWith('.mkv')}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const box={id:'trash-box',providerId:'box' as const,name:'Fixture',baseUrl:'',authOrigins:[]},google={...box,id:'trash-google',providerId:'google' as const}
const movie={id:'a',name:'a.mkv',isDirectory:false,size:1,playable:true}
beforeEach(()=>{vi.resetAllMocks();const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})})
async function browser(source:typeof box|typeof google|{id:string;providerId:'quark';name:string;baseUrl:string;authOrigins:string[]}=box){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[source];const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
describe('original source trash toolbar and commands',()=>{
 it('uses original Quark bin navigation and models without exposing restore, purge or clear',async()=>{
  const source={...box,id:'trash-quark',providerId:'quark' as const}
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),resolve:vi.fn()})
  vi.mocked(request).mockResolvedValue({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify({code:0,data:{list:[{fid:'movie',record_id:'record',file_name:'Movie.mkv',file_type:1,pdir_fid:'old',size:4096}]},metadata:{_total:1}}))),finalUrl:''})
  const {wrapper}=await browser(source),body=new DOMWrapper(document.body)
  expect(getDrivePane().operations.has('files.move')).toBe(true);expect(getDrivePane().operations.has('files.copy')).toBe(false)
  await wrapper.get('.toppannavitem span').trigger('mouseenter')
  await vi.waitFor(()=>expect(body.findAll('.arco-dropdown-option').some(node=>node.text()==='回收站')).toBe(true))
  await body.findAll('.arco-dropdown-option').find(node=>node.text()==='回收站')!.trigger('click');await flushPromises()
  expect(getDrivePane().store.SelectDirType).toBe('trash')
  expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'movie',drive_id:source.id,parent_file_id:'old',description:'quark_fid:movie;quark_pdir:old;quark_record:record',size:4096})
  for(const key of ['trash.restore','trash.delete','trash.empty'] as const)expect(getDrivePane().operations.has(key)).toBe(false)
  await wrapper.get('.fileitem').trigger('click');await flushPromises()
  for(const label of ['清空回收站','还原选中','彻底删除'])for(const button of wrapper.findAll('button').filter(button=>button.text()===label))expect(button.isVisible()).toBe(false)
  const count=vi.mocked(request).mock.calls.length
  await expect(getDrivePane().action('restoreBatch',[source.id,source.id,'trash',['movie']])).rejects.toThrow('不支持')
  await expect(getDrivePane().action('emptyTrashDirect',[source.id,source.id])).rejects.toThrow('不支持')
  expect(request).toHaveBeenCalledTimes(count);wrapper.unmount()
 })
 it('keeps Quark rows after an unconfirmed recycle and retries through the original keyboard without another POST',async()=>{
  const source={...box,id:'trash-quark-confirmation',providerId:'quark' as const};let visible=false,posts=0
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[movie]}),resolve:vi.fn()})
  vi.mocked(request).mockImplementation(async(_account,method)=>{
   if(method==='POST')posts++
   const data=method==='POST'?{code:0,data:{}}:{code:0,data:{list:visible?[{fid:'a',record_id:'record-a',file_name:'a.mkv',file_type:1,pdir_fid:'old',size:1}]:[]},metadata:{_total:visible?1:0}}
   return {status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''}
  })
  const {wrapper,pinia}=await browser(source),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
  await wrapper.get('.fileitem').trigger('click');await wrapper.trigger('keydown',{key:'Delete',metaKey:true});await flushPromises()
  expect(wrapper.findAll('.fileitem')).toHaveLength(1);expect(update).not.toHaveBeenCalled();expect(posts).toBe(1)
  visible=true
  await wrapper.trigger('keydown',{key:'Delete',metaKey:true});await flushPromises()
  expect(wrapper.findAll('.fileitem')).toHaveLength(0);expect(update).toHaveBeenCalledOnce();expect(posts).toBe(1)
  wrapper.unmount();update.mockRestore()
 })
 it('snapshots all Box trash pages before purging and reloads the original empty-bin view',async()=>{
  let removed=0;vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),resolve:vi.fn()})
  vi.mocked(json).mockImplementation(async(_account,_method,url)=>{
   if(removed===2)return {entries:[]}
   return new URL(url).searchParams.get('marker')==='second'?{entries:[{id:'folder',type:'folder',name:'Folder'}]}:{entries:[{id:'a',type:'file',name:'a.mkv'}],next_marker:'second'}
  })
  vi.mocked(request).mockImplementation(async()=>{expect(vi.mocked(json).mock.calls.some(call=>new URL(call[2]).searchParams.get('marker')==='second')).toBe(true);removed++;return {status:204,headers:{},body:[],finalUrl:''}})
  const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
  await getDrivePane().load(box.id,'trash',true);await flushPromises();expect(wrapper.text()).toContain('清空回收站')
  await getDrivePane().action('emptyTrash',[]);await flushPromises()
  expect(vi.mocked(request).mock.calls.map(call=>call[2])).toEqual(['https://api.box.com/2.0/files/a/trash','https://api.box.com/2.0/folders/folder/trash'])
  expect(getDrivePane().store.ListDataRaw).toEqual([]);expect(update).toHaveBeenCalledTimes(1);wrapper.unmount();update.mockRestore()
 })
 it('does not remove same-ID rows from another source when a trash request completes late',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[movie]}),resolve:vi.fn()})
  let finish!:(value:any)=>void;vi.mocked(request).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined),second={...box,id:'other-box'}
  useFileSourcesStore(pinia).accounts.push(second);await wrapper.get('.fileitem').trigger('click')
  const operation=getDrivePane().action('trash',[false,false]);await flushPromises();await wrapper.setProps({sourceId:second.id});await flushPromises()
  finish({status:204,headers:{},body:[],finalUrl:''});await operation;await flushPromises()
  expect(getDrivePane().sourceId).toBe(second.id);expect(getDrivePane().store.ListDataRaw.map(row=>row.file_id)).toEqual(['a']);expect(update).toHaveBeenCalledTimes(1);wrapper.unmount();update.mockRestore()
 })
 it('moves a Box file to trash using Cmd+Delete and purges only confirmed catalog references',async()=>{
  let trashed=false;vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async()=>({entries:trashed?[]:[movie]})),resolve:vi.fn()})
  vi.mocked(request).mockImplementation(async()=>{trashed=true;return {status:204,headers:{},body:[],finalUrl:''}})
  const {wrapper,pinia}=await browser();const snapshot={items:[{id:'video',sourceId:box.id,fileId:'a'},{id:'other',sourceId:'another',fileId:'a'}],playlists:{watch:['video','other']},series:{group:['video']}}
  const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot as any))
  await wrapper.get('.fileitem').trigger('click');await wrapper.trigger('keydown',{key:'Delete',metaKey:true});await flushPromises()
  expect(request).toHaveBeenCalledWith(expect.objectContaining({id:box.id}),'DELETE','https://api.box.com/2.0/files/a')
  expect(wrapper.findAll('.fileitem')).toHaveLength(0);expect(snapshot.items.map(item=>item.id)).toEqual(['other']);expect(snapshot.playlists.watch).toEqual(['other']);expect(snapshot.series.group).toEqual([])
  wrapper.unmount();update.mockRestore()
 })
 it('exposes Trash in the existing root breadcrumb menu and renders the original bin toolbar',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),resolve:vi.fn()});vi.mocked(json).mockResolvedValue({entries:[{id:'a',name:'a.mkv',type:'file',parent:{id:'0'}}]})
  const {wrapper}=await browser();const body=new DOMWrapper(document.body)
  await wrapper.get('.toppannavitem span').trigger('mouseenter')
  await vi.waitFor(()=>expect(body.findAll('.arco-dropdown-option').some(node=>node.text()==='回收站')).toBe(true))
  await body.findAll('.arco-dropdown-option').find(node=>node.text()==='回收站')!.trigger('click');await flushPromises()
  expect(getDrivePane().store.SelectDirType).toBe('trash');expect(wrapper.text()).toContain('清空回收站');expect(wrapper.text()).toContain('回收站中的项目可以还原或彻底删除')
  expect(wrapper.text()).not.toContain('30天');wrapper.unmount()
 })
 it('restores only confirmed Google items and keeps failed selections visible',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),resolve:vi.fn()})
  vi.mocked(json).mockImplementation(async(_account,method,url)=>{if(method==='GET')return {files:['a','b'].map(id=>({id,name:id+'.mkv',trashed:true,mimeType:'video/mp4',parents:['old']}))};if(url.includes('/a?'))return {id:'a',trashed:false};throw Error('fixture denied')})
  const {wrapper}=await browser(google);await getDrivePane().load(google.id,'trash',true);await flushPromises();await wrapper.trigger('keydown',{key:'a',metaKey:true})
  expect(wrapper.text()).toContain('还原选中');await getDrivePane().action('restore',[]);await flushPromises()
  expect(getDrivePane().store.ListDataRaw.map(row=>row.file_id)).toEqual(['b']);expect(wrapper.get('[role=alert]').text()).toContain('fixture denied');wrapper.unmount()
 })
 it('aborts a cyclic empty-bin listing before issuing any delete',async()=>{
  vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),resolve:vi.fn()});vi.mocked(json).mockResolvedValue({entries:[],next_marker:'again'})
  const {wrapper}=await browser();await getDrivePane().load(box.id,'trash',true);await flushPromises()
  await expect(getDrivePane().action('emptyTrashDirect',[box.id,box.id])).rejects.toThrow('游标重复');expect(request).not.toHaveBeenCalled();wrapper.unmount()
 })
})
