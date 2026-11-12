import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {cloud189} from '@/features/sources/cloud189'
import {rawRequest,json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const id=(fileId:string)=>JSON.stringify({fileId})
let account:any,moved:boolean,apply:boolean,folder:boolean,count=0
beforeEach(()=>{
 vi.resetAllMocks();moved=false;apply=true;folder=false;account={id:'189-trash-ui-'+(++count),providerId:'189',name:'Fixture',baseUrl:'https://api.cloud.189.cn',authOrigins:[]}
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(cloud189)
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>{
  const parent=new URL(url).searchParams.get('folderId')
  const items=parent==='-11'&&!moved?[{id:'9007199254740997',name:'Movie.mkv',size:42}]:[]
  return {fileListAO:{folderList:folder?items:[],fileList:folder?[]:items}}
 })
 vi.mocked(rawRequest).mockImplementation(async(_account,_method,url)=>{
  const create=url.endsWith('createBatchTask.action');if(!create&&apply)moved=true
  return {status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(create?{taskId:'9007199254740998'}:{taskStatus:4}))),finalUrl:''}
 })
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await getDrivePane().load(account.id,id('-11'),true);await flushPromises();return {wrapper,pinia}}
it('runs original Cmd+Delete and removes only confirmed catalog/group references',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:id('9007199254740997')},{id:'other',sourceId:'other-source',fileId:id('9007199254740997')}],playlists:{watch:['video','other']},series:{group:['video']}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  expect(getDrivePane().operations.has('trash.move')).toBe(true)
  for(const operation of ['trash.list','trash.restore','trash.delete','trash.empty'])expect(getDrivePane().operations.has(operation as any)).toBe(false)
  await wrapper.get('.fileitem').trigger('click');await wrapper.trigger('keydown',{key:'Delete',metaKey:true});await flushPromises()
  expect(new URLSearchParams(vi.mocked(rawRequest).mock.calls[0][3]).get('type')).toBe('DELETE')
  expect(wrapper.findAll('.fileitem')).toHaveLength(0);expect(snapshot.items.map((item:any)=>item.id)).toEqual(['other']);expect(snapshot.playlists.watch).toEqual(['other']);expect(snapshot.series.group).toEqual([])
  expect(update).toHaveBeenCalledOnce()
 }finally{wrapper.unmount();update.mockRestore()}
})
it('purges descendant catalog items only after a folder task is confirmed',async()=>{
 folder=true;const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'child',sourceId:account.id,fileId:'child',folderPath:'nested',folderAncestors:['',id('-11'),id('9007199254740997'),'nested']},{id:'keep',sourceId:account.id,fileId:'keep',folderPath:id('-11')}],playlists:{watch:['child','keep']},series:{group:['child']}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  expect(await getDrivePane().action('trashBatch',[account.id,account.id,[id('9007199254740997')]])).toEqual([id('9007199254740997')])
  expect(snapshot.items.map((row:any)=>row.id)).toEqual(['keep']);expect(snapshot.playlists.watch).toEqual(['keep']);expect(snapshot.series.group).toEqual([])
 }finally{wrapper.unmount();update.mockRestore()}
})
it.each(['refresh','reopen'])('recovers a remote delete whose local catalog save failed on %s without reposting',async mode=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:id('9007199254740997')}],playlists:{watch:['video']},series:{group:['video']}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture catalog save denied')).mockImplementation(async mutate=>mutate(snapshot))
 let active=wrapper
 try{
  expect(await getDrivePane().action('trashBatch',[account.id,account.id,[id('9007199254740997')]])).toEqual([id('9007199254740997')]);expect(wrapper.text()).toContain('同步失败');expect(snapshot.items).toHaveLength(1)
  if(mode==='refresh'){await getDrivePane().load(account.id,'refresh',false);await flushPromises()}
  else{wrapper.unmount();active=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises()}
  expect(snapshot.items).toEqual([]);expect(snapshot.playlists.watch).toEqual([]);expect(snapshot.series.group).toEqual([]);expect(update).toHaveBeenCalledTimes(2)
  expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
 }finally{active.unmount();update.mockRestore()}
})
it('confirms an old task and synchronizes the catalog on refresh when its deleted row is already absent',async()=>{
 apply=false;const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:id('9007199254740997')}],playlists:{watch:['video']},series:{}}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  expect(await getDrivePane().action('trashBatch',[account.id,account.id,[id('9007199254740997')]])).toEqual([]);expect(update).not.toHaveBeenCalled()
  moved=true;await getDrivePane().load(account.id,'refresh',false);await flushPromises()
  expect(snapshot.items).toEqual([]);expect(wrapper.findAll('.fileitem')).toHaveLength(0);expect(update).toHaveBeenCalledOnce();expect(rawRequest).toHaveBeenCalledTimes(2)
 }finally{wrapper.unmount();update.mockRestore()}
})
it('keeps late delete completion out of a new account page and its catalog',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 let finish!:(value:any)=>void;vi.mocked(rawRequest).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve))
 try{
  const task=getDrivePane().action('trashBatch',[account.id,account.id,[id('9007199254740997')]]);await flushPromises()
  const second={...account,id:account.id+'-second'};useFileSourcesStore(pinia).accounts.push(second);await wrapper.setProps({sourceId:second.id});await flushPromises()
  finish({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify({taskId:'old-delete'}))),finalUrl:''});await task;await flushPromises()
  expect(getDrivePane().sourceId).toBe(second.id);expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id===id('-11'))).toBe(true);expect(update).not.toHaveBeenCalled();expect(rawRequest).toHaveBeenCalledOnce()
 }finally{wrapper.unmount();update.mockRestore()}
})
it('rejects local catalog mutation if the same account ID is replaced while its save is queued',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:id('9007199254740997')}],playlists:{watch:['video']},series:{}}
 let finish!:()=>void
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementationOnce(async(mutate,stillCurrent)=>{
  await new Promise<void>(resolve=>finish=resolve)
  expect(stillCurrent?.()).toBe(false)
  mutate(snapshot)
 })
 try{
  const task=getDrivePane().action('trashBatch',[account.id,account.id,[id('9007199254740997')]]);await flushPromises()
  useFileSourcesStore(pinia).accounts=[{...account,userId:'replacement-owner'}];finish();expect(await task).toEqual([]);await flushPromises()
  expect(snapshot.items).toHaveLength(1);expect(snapshot.playlists.watch).toEqual(['video'])
 }finally{wrapper.unmount();update.mockRestore()}
})
