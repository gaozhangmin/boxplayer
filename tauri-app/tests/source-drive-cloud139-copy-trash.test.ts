import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {cloud139} from '@/features/sources/cloud139'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
let account:any,removed:boolean,copied:boolean,apply:boolean,count=0
beforeEach(()=>{
 vi.resetAllMocks();removed=false;copied=false;apply=true;account={id:'139-batch-ui-'+(++count),providerId:'139',name:'Fixture',baseUrl:'https://personal.yun.139.com/hcy',authOrigins:[]}
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(cloud139)
 vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>{
  if(url.endsWith('/batchCopy')){if(apply)copied=true;return {success:true}}
  if(url.endsWith('/batchTrash')){if(apply)removed=true;return {success:true}}
  return {data:{items:body.parentFileId==='/'?[{fileId:'target',name:'Target',type:'folder'},...(!removed?[{fileId:'movie',name:'Movie.mkv',type:'file',size:42}]:[])]:body.parentFileId==='target'&&copied?[{fileId:'copied',name:'Movie.mkv',type:'file',size:42}]:[]}}
 })
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
it('copies through original Cmd+C and picker while retaining the original row and catalog',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{
  expect(getDrivePane().operations.has('files.copy')).toBe(true)
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('Movie.mkv'))!.trigger('click');await wrapper.trigger('keydown',{key:'c',metaKey:true});await flushPromises()
  const picker=()=>new DOMWrapper(document.body).get('.showpandirmodal');expect(picker().text()).toContain('复制文件到')
  await picker().findAll('.sharetitleleft').find(row=>row.text()==='Target')!.trigger('click');await flushPromises()
  await picker().findAll('button').find(row=>row.text()==='选择')!.trigger('click');await flushPromises()
  expect(json).toHaveBeenCalledWith(expect.objectContaining({id:account.id}),'POST',account.baseUrl+'/file/batchCopy',{fileIds:['movie'],parentFileId:'target'})
  expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='movie')).toBe(true);expect(update).not.toHaveBeenCalled()
 }finally{wrapper.unmount();update.mockRestore()}
})
it('recycles through original Cmd+Delete and removes confirmed catalog/group references',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'movie'},{id:'other',sourceId:'other',fileId:'movie'}],playlists:{watch:['video','other']},series:{group:['video']}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  expect(getDrivePane().operations.has('trash.move')).toBe(true);for(const operation of ['trash.list','trash.restore','trash.delete','trash.empty'])expect(getDrivePane().operations.has(operation as any)).toBe(false)
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('Movie.mkv'))!.trigger('click');await wrapper.trigger('keydown',{key:'Delete',metaKey:true});await flushPromises()
  expect(json).toHaveBeenCalledWith(expect.objectContaining({id:account.id}),'POST',account.baseUrl+'/recyclebin/batchTrash',{fileIds:['movie']})
  expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='movie')).toBe(false);expect(snapshot.items.map((row:any)=>row.id)).toEqual(['other']);expect(snapshot.playlists.watch).toEqual(['other']);expect(snapshot.series.group).toEqual([])
 }finally{wrapper.unmount();update.mockRestore()}
})
it.each(['refresh','reopen'])('recovers a failed local recycle save through %s without reposting',async mode=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'movie'}],playlists:{watch:['video']},series:{}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture save denied')).mockImplementation(async mutate=>mutate(snapshot));let active=wrapper
 try{
  expect(await getDrivePane().action('trashBatch',[account.id,account.id,['movie']])).toEqual(['movie']);expect(wrapper.text()).toContain('同步失败');expect(snapshot.items).toHaveLength(1)
  if(mode==='refresh'){await getDrivePane().load(account.id,'refresh',false);await flushPromises()}
  else{wrapper.unmount();active=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises()}
  expect(snapshot.items).toEqual([]);expect(snapshot.playlists.watch).toEqual([]);expect(update).toHaveBeenCalledTimes(2)
  expect(vi.mocked(json).mock.calls.filter(call=>call[2].endsWith('/batchTrash'))).toHaveLength(1)
 }finally{active.unmount();update.mockRestore()}
})
it('confirms accepted-but-not-visible recycling on refresh after its source row disappears',async()=>{
 apply=false;const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'movie'}],playlists:{watch:['video']},series:{}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  expect(await getDrivePane().action('trashBatch',[account.id,account.id,['movie']])).toEqual([]);expect(update).not.toHaveBeenCalled()
  removed=true;await getDrivePane().load(account.id,'refresh',false);await flushPromises();expect(snapshot.items).toEqual([]);expect(update).toHaveBeenCalledOnce()
  expect(vi.mocked(json).mock.calls.filter(call=>call[2].endsWith('/batchTrash'))).toHaveLength(1)
 }finally{wrapper.unmount();update.mockRestore()}
})
it('rejects a late recycle result after source switch without deleting new-account same-ID rows',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined),original=vi.mocked(json).getMockImplementation()!
 let finish!:(value:any)=>void;vi.mocked(json).mockImplementation(async(...args)=>args[2].endsWith('/batchTrash')?new Promise(resolve=>finish=resolve):original(...args))
 try{
  const task=getDrivePane().action('trashBatch',[account.id,account.id,['movie']]);await flushPromises()
  const second={...account,id:account.id+'-second'};useFileSourcesStore(pinia).accounts.push(second);await wrapper.setProps({sourceId:second.id});await flushPromises()
  finish({success:true});expect(await task).toEqual([]);await flushPromises()
  expect(getDrivePane().sourceId).toBe(second.id);expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='movie')).toBe(true);expect(update).not.toHaveBeenCalled()
 }finally{wrapper.unmount();update.mockRestore()}
})
it('keeps refused batch rows and catalog references while removing only confirmed successes',async()=>{
 const names=new Map([['a','A.mkv'],['b','B.mkv']])
 vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>{
  if(url.endsWith('/batchTrash')){if(body.fileIds[0]==='b')return {success:false,code:'9008'};names.delete(body.fileIds[0]);return {success:true}}
  return {data:{items:[...names].map(([fileId,name])=>({fileId,name,type:'file',size:42}))}}
 })
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'va',sourceId:account.id,fileId:'a'},{id:'vb',sourceId:account.id,fileId:'b'}],playlists:{watch:['va','vb']},series:{}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  await wrapper.trigger('keydown',{key:'a',metaKey:true});await wrapper.trigger('keydown',{key:'Delete',metaKey:true});await flushPromises()
  expect(getDrivePane().store.ListDataRaw.map(row=>row.file_id)).toEqual(['b']);expect(snapshot.items.map((row:any)=>row.id)).toEqual(['vb']);expect(snapshot.playlists.watch).toEqual(['vb']);expect(wrapper.text()).toContain('B.mkv')
 }finally{wrapper.unmount();update.mockRestore()}
})
