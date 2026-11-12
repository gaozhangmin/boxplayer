import {beforeEach,it,expect,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {alipan} from '@/features/sources/alipan'
import {request,json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const id=(fileId:string)=>JSON.stringify({driveId:'drive',fileId}),response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let account:any,serial=0,parent:string,copied:boolean,folder:boolean
beforeEach(()=>{
 vi.resetAllMocks();parent='root';copied=false;folder=false;account={id:'web-relocation-ui-'+ ++serial,providerId:'aliyun',name:'Fixture',baseUrl:'',authOrigins:['https://api.aliyundrive.com']};vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(alipan)
 vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>url.endsWith('/user/get')?{resource_drive_id:'drive'}:{items:body.parent_file_id==='root'?[{file_id:'target',name:'Target',type:'folder'},...(parent==='root'?[{file_id:'movie',name:folder?'Folder':'Old.mkv',type:folder?'folder':'file',size:42}]:[])]:body.parent_file_id==='target'?[...(parent==='target'?[{file_id:'movie',name:'Moved',type:folder?'folder':'file',size:42}]:[]),...(copied?[{file_id:'copied',name:'Copied',type:folder?'folder':'file',size:42}]:[])]:[]})
 vi.mocked(request).mockImplementation(async(_account,_method,url,raw)=>{
  const body=JSON.parse(raw!);if(url.endsWith('/batch')){const row=body.requests[0],copy=row.url==='/file/copy';if(copy)copied=true;else parent='target';return response({responses:[{id:row.id,status:200,body:{drive_id:'drive',file_id:copy?'copied':'movie'}}]})}
  if(body.file_id==='target')return response({drive_id:'drive',file_id:'target',parent_file_id:'root',name:'Target',type:'folder'})
  return response({drive_id:'drive',file_id:body.file_id,parent_file_id:body.file_id==='copied'?'target':parent,name:body.file_id==='copied'?'Copied':parent==='root'?(folder?'Folder':'Old.mkv'):'Moved',type:folder?'folder':'file'})
 })
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await getDrivePane().load(account.id,id('root'),true);await flushPromises();return {wrapper,pinia}}
async function chooseTarget(wrapper:ReturnType<typeof mount>,copy:boolean){getDrivePane().store.mMouseSelect(id('movie'),false,false);await wrapper.trigger('keydown',{key:copy?'c':'x',metaKey:true});await flushPromises();const picker=()=>new DOMWrapper(document.body).get('.showpandirmodal');expect(picker().text()).toContain(copy?'复制文件到':'移动文件到');const root=picker().findAll('.sharetitleleft').find(row=>row.text()==='资源盘');if(root){await root.trigger('click');await flushPromises()}await picker().findAll('.sharetitleleft').find(row=>row.text()==='Target')!.trigger('click');await flushPromises();await picker().findAll('button').find(row=>row.text()==='选择')!.trigger('click');await flushPromises()}
it('copies through original Cmd+C and nested directory picker without moving source or catalog media',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{expect(getDrivePane().operations.has('files.copy')).toBe(true);await chooseTarget(wrapper,true);expect(copied).toBe(true);expect(parent).toBe('root');expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id===id('movie'))).toBe(true);expect(update).not.toHaveBeenCalled();expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)}finally{wrapper.unmount();update.mockRestore()}
})
it.each([false,true])('moves through the original Cmd+X picker and retains stable catalog identity for folder=%s',async directory=>{
 folder=directory;const {wrapper,pinia}=await browser(),item:any={id:'video',sourceId:account.id,fileId:id(directory?'child':'movie'),fileName:'Old.mkv',name:'Manual',metadataSource:'manual',progress:37,folderPath:id(directory?'movie':'root'),folderAncestors:['',id('root'),...(directory?[id('movie')]:[])]},snapshot:any={items:[item]},update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{await chooseTarget(wrapper,false);expect(parent).toBe('target');expect(item).toMatchObject({id:'video',fileId:id(directory?'child':'movie'),name:'Manual',progress:37,folderPath:id(directory?'movie':'target')});expect(item.folderAncestors).toEqual(['',id('root'),id('target'),...(directory?[id('movie')]:[])]);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)}finally{wrapper.unmount();update.mockRestore()}
})
it('retries catalog synchronization through the same move command without another native move',async()=>{
 const {wrapper,pinia}=await browser(),item:any={id:'video',sourceId:account.id,fileId:id('movie'),fileName:'Old.mkv',name:'Manual',metadataSource:'manual'},snapshot:any={items:[item]},update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture save denied')).mockImplementation(async mutate=>mutate(snapshot))
 try{
  await getDrivePane().list(account.id,account.id,id('root'))
  const args=[account.id,account.id,[id('movie')],account.id,id('target')]
  await expect(getDrivePane().action('moveBatch',args)).rejects.toThrow('同步失败')
  expect(await getDrivePane().action('moveBatch',args)).toEqual([id('movie')]);expect(item.folderPath).toBe(id('target'));expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1)
 }finally{wrapper.unmount();update.mockRestore()}
})

it('retains the original source row and metadata when catalog persistence fails',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValue(Error('fixture save denied'))
 try{await getDrivePane().list(account.id,account.id,id('root'));const args=[account.id,account.id,[id('movie')],account.id,id('target')];await expect(getDrivePane().action('moveBatch',args)).rejects.toThrow('同步失败');expect(getDrivePane().store.ListDataRaw.find(row=>row.file_id===id('movie'))).toMatchObject({name:'Old.mkv',parent_file_id:id('root')});expect(vi.mocked(request).mock.calls.filter(row=>row[2].endsWith('/batch'))).toHaveLength(1)}finally{wrapper.unmount();update.mockRestore()}
})
it('does not commit late movement results or replay retained receipts under a replaced account',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined);let finish!:(value:any)=>void
 try{await getDrivePane().list(account.id,account.id,id('root'));vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const args=[account.id,account.id,[id('movie')],account.id,id('target')],task=getDrivePane().action('moveBatch',args);await flushPromises();useFileSourcesStore(pinia).accounts=[{...account,name:'Replacement'}];finish(response({responses:[{id:'movie',status:200,body:{drive_id:'drive',file_id:'movie'}}]}));expect(await task).toEqual([]);expect(update).not.toHaveBeenCalled();expect(await getDrivePane().action('moveBatch',args)).toEqual([]);expect(request).toHaveBeenCalledTimes(1)}finally{wrapper.unmount();update.mockRestore()}
})

it('existing error retry button completes retained move synchronization without refreshing away the source or resubmitting',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture save denied')).mockResolvedValue(undefined)
 try{
  await getDrivePane().list(account.id,account.id,id('root'))
  await expect(getDrivePane().action('moveBatch',[account.id,account.id,[id('movie')],account.id,id('target')])).rejects.toThrow('同步失败')
  await flushPromises();expect(wrapper.get('.drive-error').text()).toContain('同步失败')
  await wrapper.get('.drive-error button').trigger('click');await flushPromises()
  expect(update).toHaveBeenCalledTimes(2);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/batch'))).toHaveLength(1);expect(wrapper.find('.drive-error').exists()).toBe(false)
 }finally{wrapper.unmount();update.mockRestore()}
})

it('error retry refuses a same-ID account replacement before another provider request',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValue(Error('fixture save denied'))
 try{
  await getDrivePane().list(account.id,account.id,id('root'))
  await expect(getDrivePane().action('moveBatch',[account.id,account.id,[id('movie')],account.id,id('target')])).rejects.toThrow('同步失败')
  const count=vi.mocked(request).mock.calls.length;useFileSourcesStore(pinia).accounts=[{...account,name:'Replacement'}];await flushPromises()
  await wrapper.get('.drive-error button').trigger('click');await flushPromises()
  expect(request).toHaveBeenCalledTimes(count);expect(update).toHaveBeenCalledTimes(1);expect(wrapper.get('.drive-error').text()).toContain('来源已变化')
 }finally{wrapper.unmount();update.mockRestore()}
})
