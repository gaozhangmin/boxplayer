import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {baidu} from '@/features/sources/cloud'
import {rawRequest} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const response=(value:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(value))),finalUrl:''})
let account:any,removed:boolean,copied:boolean,apply:boolean,count=0
const movie={fs_id:'101',filename:'Movie.mkv',path:'/Movie.mkv',isdir:0,size:42},target={fs_id:'12',filename:'Dest',path:'/Dest',isdir:1,size:0}
const listing=(rows:any[])=>response({errno:0,has_more:0,list:rows.map(row=>({...row,server_filename:row.filename,server_mtime:0,server_ctime:0}))})
beforeEach(()=>{
 vi.resetAllMocks();removed=false;copied=false;apply=true;account={id:'baidu-batch-ui-'+(++count),providerId:'baidu',name:'Fixture',baseUrl:'',authOrigins:[]}
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(baidu)
 vi.mocked(rawRequest).mockImplementation(async(_account,method,raw)=>{
  const url=new URL(raw),q=url.searchParams
  if(method==='POST'){
   if(q.get('opera')==='delete'){if(apply)removed=true;return response({errno:0,taskid:7})}
   if(apply)copied=true;return response({errno:0,info:[{errno:0,path:movie.path}]})
  }
  if(q.get('method')==='filemetas')return response({errno:0,list:q.get('fsids')==='[12]'?[target]:q.get('fsids')==='[103]'?[{...movie,fs_id:'103',path:'/Dest/Movie.mkv'}]:[movie]})
  return listing(q.get('dir')==='/'?[target,...(!removed?[movie]:[])]:copied?[{...movie,fs_id:'103',path:'/Dest/Movie.mkv'}]:[])
 })
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await vi.waitFor(()=>{expect(getDrivePane().store.ListLoading).toBe(false);expect(getDrivePane().store.ListDataRaw).toHaveLength(2)});return {wrapper,pinia}}
it('copies using original Cmd+C and directory picker with protected native paths',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{
  expect(getDrivePane().operations.has('files.copy')).toBe(true)
  const original=vi.mocked(rawRequest).getMockImplementation()!;let finish!:()=>void
  vi.mocked(rawRequest).mockImplementationOnce((...args)=>new Promise(resolve=>{finish=()=>resolve(original(...args))}))
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('Movie.mkv'))!.trigger('click');await wrapper.trigger('keydown',{key:'c',metaKey:true});await flushPromises()
  await vi.waitFor(()=>expect(typeof finish).toBe('function'))
  expect(new DOMWrapper(document.body).get('.showpandirmodal').text()).toContain('复制文件到');finish()
  const picker=()=>new DOMWrapper(document.body).get('.showpandirmodal');await vi.waitFor(()=>expect(picker().findAll('.sharetitleleft').some(row=>row.text()==='Dest')).toBe(true));expect(picker().text()).toContain('复制文件到')
  await picker().findAll('.sharetitleleft').find(row=>row.text()==='Dest')!.trigger('click');await flushPromises();await picker().findAll('button').find(row=>row.text()==='选择')!.trigger('click');await flushPromises()
  await vi.waitFor(()=>expect(copied).toBe(true));await flushPromises()
  const call=vi.mocked(rawRequest).mock.calls.find(call=>call[1]==='POST')!,form=new URLSearchParams(call[3])
  expect(new URL(call[2]).searchParams.get('opera')).toBe('copy');expect(JSON.parse(form.get('filelist')!)).toEqual([{path:movie.path,dest:'/Dest'}]);expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='101')).toBe(true);expect(update).not.toHaveBeenCalled()
 }finally{wrapper.unmount();update.mockRestore()}
})
it('recycles through original Cmd+Delete and cleans only same-source catalog groups',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'101'},{id:'other',sourceId:'other',fileId:'101'}],playlists:{watch:['video','other']},series:{group:['video']}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  expect(getDrivePane().operations.has('trash.move')).toBe(true);for(const operation of ['trash.list','trash.restore','trash.delete','trash.empty'])expect(getDrivePane().operations.has(operation as any)).toBe(false)
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('Movie.mkv'))!.trigger('click');await wrapper.trigger('keydown',{key:'Delete',metaKey:true});await flushPromises()
  await vi.waitFor(()=>expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='101')).toBe(false));expect(snapshot.items.map((row:any)=>row.id)).toEqual(['other']);expect(snapshot.playlists.watch).toEqual(['other']);expect(snapshot.series.group).toEqual([])
 }finally{wrapper.unmount();update.mockRestore()}
})
it.each(['refresh','reopen'])('recovers local recycle-save failure through %s without sending another delete',async mode=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'101'}],playlists:{watch:['video']},series:{}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture save denied')).mockImplementation(async mutate=>mutate(snapshot));let active=wrapper
 try{
  expect(await getDrivePane().action('trashBatch',[account.id,account.id,['101']])).toEqual(['101']);expect(wrapper.text()).toContain('同步失败');expect(snapshot.items).toHaveLength(1)
  if(mode==='refresh'){await getDrivePane().load(account.id,'refresh',false);await flushPromises()}
  else{wrapper.unmount();active=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises()}
  await vi.waitFor(()=>expect(update).toHaveBeenCalledTimes(2));expect(snapshot.items).toEqual([]);expect(snapshot.playlists.watch).toEqual([]);expect(update).toHaveBeenCalledTimes(2);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
 }finally{active.unmount();update.mockRestore()}
})
it('confirms delayed recycle visibility on refresh when the old row has disappeared',async()=>{
 apply=false;const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'101'}],playlists:{watch:['video']},series:{}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  expect(await getDrivePane().action('trashBatch',[account.id,account.id,['101']])).toEqual([]);expect(update).not.toHaveBeenCalled()
  removed=true;await getDrivePane().load(account.id,'refresh',false);await flushPromises();expect(snapshot.items).toEqual([]);expect(update).toHaveBeenCalledOnce();expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
 }finally{wrapper.unmount();update.mockRestore()}
})
it('keeps an old delete receipt out of a switched source and its same-ID rows',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined),original=vi.mocked(rawRequest).getMockImplementation()!
 let finish!:(value:any)=>void;vi.mocked(rawRequest).mockImplementation(async(...args)=>args[1]==='POST'?new Promise(resolve=>finish=resolve):original(...args))
 try{
  const task=getDrivePane().action('trashBatch',[account.id,account.id,['101']]);await vi.waitFor(()=>expect(typeof finish).toBe('function'));const second={...account,id:account.id+'-second'};useFileSourcesStore(pinia).accounts.push(second);await wrapper.setProps({sourceId:second.id});await flushPromises()
  finish(response({errno:0,taskid:7}));expect(await task).toEqual([]);await flushPromises();expect(getDrivePane().sourceId).toBe(second.id);await vi.waitFor(()=>expect(getDrivePane().store.ListLoading).toBe(false));expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='101')).toBe(true);expect(update).not.toHaveBeenCalled()
 }finally{wrapper.unmount();update.mockRestore()}
})
