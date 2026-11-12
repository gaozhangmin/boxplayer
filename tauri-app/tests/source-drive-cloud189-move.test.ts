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
let account:any,moved:boolean,apply:boolean,count=0
beforeEach(()=>{
 vi.resetAllMocks();moved=false;apply=true;account={id:'189-move-ui-'+(++count),providerId:'189',name:'Fixture',baseUrl:'https://api.cloud.189.cn',authOrigins:[]}
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(cloud189)
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>{
  const parent=new URL(url).searchParams.get('folderId')
  return {fileListAO:{folderList:parent==='-11'?[{id:'target',name:'Target'}]:[],fileList:(parent==='target'?moved:parent==='-11'&&!moved)?[{id:'9007199254740997',name:'Movie.mkv',size:42}]:[]}}
 })
 vi.mocked(rawRequest).mockImplementation(async(_account,_method,url)=>{
  const create=url.endsWith('createBatchTask.action');if(!create&&apply)moved=true
  return {status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(create?{taskId:'9007199254740998'}:{taskStatus:4}))),finalUrl:''}
 })
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await getDrivePane().load(account.id,id('-11'),true);await flushPromises();return {wrapper,pinia}}
it('moves via the original Cmd+X directory picker and preserves catalog metadata',async()=>{
 const {wrapper,pinia}=await browser(),item:any={id:'stable',sourceId:account.id,fileId:id('9007199254740997'),fileName:'Movie.mkv',name:'Manual',metadataSource:'manual',progress:37,folderPath:id('-11'),folderAncestors:['',id('-11')],catalogRoots:['']}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate({items:[item]} as any))
 try{
  expect(getDrivePane().operations.has('files.move')).toBe(true)
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('Movie.mkv'))!.trigger('click');await wrapper.trigger('keydown',{key:'x',metaKey:true});await flushPromises()
  const picker=()=>new DOMWrapper(document.body).get('.showpandirmodal')
  expect(picker().text()).toContain('移动文件到')
  await picker().findAll('.sharetitleleft').find(row=>row.text().includes('个人空间'))!.trigger('click');await flushPromises()
  await picker().findAll('.sharetitleleft').find(row=>row.text()==='Target')!.trigger('click');await flushPromises()
  await picker().findAll('button').find(row=>row.text()==='选择')!.trigger('click');await flushPromises()
  expect(rawRequest).toHaveBeenCalledTimes(2);expect(update).toHaveBeenCalledOnce()
  expect(item).toMatchObject({id:'stable',name:'Manual',progress:37,folderPath:id('target'),folderAncestors:['',id('-11'),id('target')]})
  expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id===item.fileId)).toBe(false)
 }finally{wrapper.unmount();update.mockRestore()}
})
it('keeps an unconfirmed move out of local catalog updates and resumes its task through the same command',async()=>{
 apply=false;const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{
  const args=[account.id,account.id,[id('9007199254740997')],account.id,id('target')]
  expect(await getDrivePane().action('moveBatch',args)).toEqual([]);expect(update).not.toHaveBeenCalled();expect(wrapper.text()).toContain('尚未确认')
  apply=true;expect(await getDrivePane().action('moveBatch',args)).toEqual([id('9007199254740997')]);expect(update).toHaveBeenCalledOnce()
  expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
 }finally{wrapper.unmount();update.mockRestore()}
})
it.each(['refresh','reopen'])('recovers a remote move whose local sync failed through %s',async mode=>{
 const {wrapper,pinia}=await browser(),item:any={id:'stable',sourceId:account.id,fileId:id('9007199254740997'),fileName:'Movie.mkv',name:'Manual',metadataSource:'manual',progress:37,folderPath:id('-11'),folderAncestors:['',id('-11')]}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture local save denied')).mockImplementation(async mutate=>mutate({items:[item]} as any))
 let active=wrapper
 try{
  expect(await getDrivePane().action('moveBatch',[account.id,account.id,[item.fileId],account.id,id('target')])).toEqual([item.fileId])
  expect(wrapper.text()).toContain('同步失败');expect(item.folderPath).toBe(id('-11'))
  if(mode==='refresh'){await getDrivePane().load(account.id,'refresh',false);await flushPromises()}
  else{wrapper.unmount();active=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises()}
  expect(item).toMatchObject({id:'stable',name:'Manual',progress:37,folderPath:id('target'),folderAncestors:['',id('-11'),id('target')]})
  expect(update).toHaveBeenCalledTimes(2);expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
 }finally{active.unmount();update.mockRestore()}
})
it('recovers an unknown move on refresh even after the original row disappeared',async()=>{
 apply=false;const {wrapper,pinia}=await browser(),item:any={id:'stable',sourceId:account.id,fileId:id('9007199254740997'),fileName:'Movie.mkv',name:'Manual',metadataSource:'manual',folderPath:id('-11')}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate({items:[item]} as any))
 try{
  expect(await getDrivePane().action('moveBatch',[account.id,account.id,[item.fileId],account.id,id('target')])).toEqual([])
  moved=true;apply=true;await getDrivePane().load(account.id,'refresh',false);await flushPromises()
  expect(item.folderPath).toBe(id('target'));expect(update).toHaveBeenCalledOnce();expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id===item.fileId)).toBe(false)
  expect(vi.mocked(rawRequest).mock.calls.filter(call=>call[2].endsWith('createBatchTask.action'))).toHaveLength(1)
 }finally{wrapper.unmount();update.mockRestore()}
})
