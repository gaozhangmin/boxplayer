import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import NewFolder from '@/features/files/drive/electron/pan/topbtns/CreatNewDirModal.vue'
import Rename from '@/features/files/drive/electron/pan/topbtns/RenameModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {cloud139} from '@/features/sources/cloud139'
import {json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:vi.fn(),playable:(name:string)=>name.endsWith('.mkv')}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
let names:Record<string,string>,deny:boolean,count=0
let account:{id:string;providerId:'139';name:string;baseUrl:string;authOrigins:string[]}
beforeEach(()=>{
 vi.resetAllMocks();names={file:'Old.mkv'};deny=false
 account={id:'139-component-'+(++count),providerId:'139',name:'Fixture',baseUrl:'https://personal-kd-njs.yun.139.com/hcy',authOrigins:[]}
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(cloud139)
 vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>{
  if(url.endsWith('/create')){if(deny)return {success:false,code:'9008'};names.new=body.name;return {success:true,data:{fileId:'new'}}}
  if(url.endsWith('/update')){if(deny)return {success:false,code:'9008'};names.file=body.fileName;return {success:true}}
  return {data:{items:Object.entries(names).map(([fileId,name])=>({fileId,name,type:fileId==='new'?'folder':'file'}))}}
 })
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
it('creates using the original folder dialog and reloads actual directory identity',async()=>{
 const {wrapper}=await browser()
 try{
  await getDrivePane().action('createFolder',['folder']);await flushPromises()
  const modal=wrapper.getComponent(NewFolder);(modal.vm as any).form.dirName='Folder';(modal.vm as any).handleOK();await flushPromises()
  expect(wrapper.findComponent(NewFolder).exists()).toBe(false)
  expect(getDrivePane().store.ListDataRaw.find(row=>row.file_id==='new')).toMatchObject({name:'Folder',isDir:true})
 }finally{wrapper.unmount()}
})
it('renames using the original dialog and synchronizes confirmed catalog references',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{
  await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('rename',[]);await flushPromises()
  const modal=wrapper.getComponent(Rename);(modal.vm as any).form.fileName='New.mkv';(modal.vm as any).handleOK();await flushPromises()
  expect(wrapper.findComponent(Rename).exists()).toBe(false);expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'file',name:'New.mkv'});expect(update).toHaveBeenCalledOnce()
 }finally{wrapper.unmount();update.mockRestore()}
})
it('keeps the original folder dialog open on a rejected request',async()=>{
 deny=true;const {wrapper}=await browser()
 try{
  await getDrivePane().action('createFolder',['folder']);await flushPromises()
  const modal=wrapper.getComponent(NewFolder);(modal.vm as any).form.dirName='Folder';(modal.vm as any).handleOK();await flushPromises()
  expect(wrapper.findComponent(NewFolder).exists()).toBe(true);expect(names.new).toBeUndefined()
 }finally{wrapper.unmount()}
})

it('passes the original 139 model through the original file list store',async()=>{
 const {wrapper}=await browser()
 try{
  expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'file',drive_id:account.id,name:'Old.mkv',description:'cloud139_id:file',parent_file_id:'',icon:'iconfile_video'})
 }finally{wrapper.unmount()}
})

it('moves through the original Ctrl+X and directory picker, preserving stable catalog IDs',async()=>{
 let moved=false
 vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>{
  if(url.endsWith('/batchMove')){moved=true;return {success:true}}
  const target={fileId:'target',name:'Target',type:'folder'},file={fileId:'file',name:'Old.mkv',type:'file'}
  return {data:{items:body.parentFileId==='/'?(moved?[target]:[file,target]):body.parentFileId==='target'&&moved?[file]:[]}}
 })
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:'file',fileName:'Old.mkv',name:'Manual',metadataSource:'manual',progress:31,folderPath:'',folderAncestors:['']}]}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  expect(getDrivePane().operations.has('files.move')).toBe(true)
  await wrapper.findAll('.fileitem').find(row=>row.text().includes('Old.mkv'))!.trigger('click')
  await wrapper.trigger('keydown',{key:'x',metaKey:true});await flushPromises()
  const picker=()=>new DOMWrapper(document.body).findAll('.showpandirmodal').at(-1)!
  await vi.waitFor(()=>expect(picker().findAll('.sharetitleleft').some(row=>row.text()==='Target')).toBe(true))
  await picker().findAll('.sharetitleleft').find(row=>row.text()==='Target')!.trigger('click');await flushPromises()
  await picker().findAll('button').find(row=>row.text()==='选择')!.trigger('click');await flushPromises()
  expect(snapshot.items[0]).toMatchObject({id:'video',fileId:'file',name:'Manual',progress:31,folderPath:'target',folderAncestors:['','target']})
  expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='file')).toBe(false)
  expect(vi.mocked(json).mock.calls.filter(call=>call[2].endsWith('/batchMove'))).toHaveLength(1)
 }finally{wrapper.unmount();update.mockRestore()}
})

it('retries a rejected rename through the same original dialog after permission is restored',async()=>{
 deny=true;const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{
  await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('rename',[]);await flushPromises()
  const modal=wrapper.getComponent(Rename);(modal.vm as any).form.fileName='New.mkv';(modal.vm as any).handleOK();await flushPromises()
  expect(wrapper.findComponent(Rename).exists()).toBe(true);expect(getDrivePane().store.ListDataRaw[0]?.name).toBe('Old.mkv');expect(update).not.toHaveBeenCalled()
  deny=false;(modal.vm as any).handleOK();await flushPromises()
  expect(wrapper.findComponent(Rename).exists()).toBe(false);expect(getDrivePane().store.ListDataRaw[0]?.name).toBe('New.mkv');expect(update).toHaveBeenCalledOnce()
  expect(vi.mocked(json).mock.calls.filter(call=>call[2].endsWith('/update'))).toHaveLength(2)
 }finally{wrapper.unmount();update.mockRestore()}
})

it('renders live 139 metadata in the original properties modal and copies its public projection',async()=>{
 const {wrapper}=await browser(),copy=vi.fn().mockResolvedValue(undefined)
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}})
 try{
  await wrapper.get('.fileitem').trigger('click');names.file='Actual.mkv'
  await getDrivePane().action('properties',[]);await flushPromises()
  const modal=new DOMWrapper(document.body).get('.source-drive-dialog.shuxingmodal')
  expect(modal.text()).toContain('查看属性');expect(modal.text()).toContain('Actual.mkv')
  await modal.findAll('button').find(button=>button.text()==='复制JSON')!.trigger('click');await flushPromises()
  expect(JSON.parse(copy.mock.calls[0]![0])).toMatchObject({file_id:'file',drive_id:account.id,name:'Actual.mkv',type:'file',description:'cloud139_id:file'})
  expect(vi.mocked(json).mock.calls.every(call=>call[2].endsWith('/file/list'))).toBe(true)
 }finally{wrapper.unmount()}
})
