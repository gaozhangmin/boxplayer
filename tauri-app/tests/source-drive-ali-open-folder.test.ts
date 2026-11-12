import {beforeEach,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import NewFolder from '@/features/files/drive/electron/pan/topbtns/CreatNewDirModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {alipan} from '@/features/sources/alipan'
import {request,json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'ali-open-folder-ui',providerId:'alipan-open' as const,name:'Fixture',baseUrl:'',authOrigins:['https://openapi.alipan.com']},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId})
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let created=false,denied=false
beforeEach(()=>{
 vi.resetAllMocks();created=false;denied=false;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(alipan)
 vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>url.endsWith('/getDriveInfo')?{resource_drive_id:'resource',backup_drive_id:'backup'}:{items:created?[{file_id:'new',drive_id:body.drive_id,parent_file_id:'root',name:'Folder',type:'folder'}]:[]})
 vi.mocked(request).mockImplementation(async(_account,_method,url,body)=>{
  if(denied)return response({code:'QuotaExhausted.Drive'})
  const value=JSON.parse(body!);if(url.endsWith('/create')){created=true;return response({file_id:'new'})}
  return response({file_id:'new',drive_id:value.drive_id,parent_file_id:'root',name:'Folder',type:'folder'})
 })
})
async function browser(drive:string){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await getDrivePane().load(account.id,id(drive,'root'),true);await flushPromises();return wrapper}
it.each(['resource','backup'])('creates in real open %s drive through the unchanged original keyboard/form/refresh chain',async drive=>{
 const wrapper=await browser(drive)
 try{
  expect(getDrivePane().operations.has('files.createFolder')).toBe(true)
  await wrapper.trigger('keydown',{key:'n',metaKey:true,shiftKey:true});await flushPromises()
  const modal=wrapper.getComponent(NewFolder);(modal.vm as any).form.dirName='Folder';(modal.vm as any).handleOK();await flushPromises()
  await vi.waitFor(()=>expect(wrapper.findComponent(NewFolder).exists()).toBe(false))
  expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:id(drive,'new'),parent_file_id:id(drive,'root'),name:'Folder',isDir:true})
  expect(vi.mocked(request).mock.calls.map(call=>call[2])).toEqual(['https://openapi.alipan.com/adrive/v1.0/openFile/create','https://openapi.alipan.com/adrive/v1.0/openFile/get'])
 }finally{wrapper.unmount()}
})
it('keeps the original folder dialog open after open-channel rejection and permits explicit retry',async()=>{
 denied=true;const wrapper=await browser('resource')
 try{
  await getDrivePane().action('createFolder',['folder']);await flushPromises();const modal=wrapper.getComponent(NewFolder);(modal.vm as any).form.dirName='Folder';(modal.vm as any).handleOK();await flushPromises()
  expect(wrapper.findComponent(NewFolder).exists()).toBe(true);expect(created).toBe(false)
  denied=false;(modal.vm as any).handleOK();await flushPromises();await vi.waitFor(()=>expect(wrapper.findComponent(NewFolder).exists()).toBe(false));expect(getDrivePane().store.ListDataRaw[0]?.file_id).toBe(id('resource','new'))
 }finally{wrapper.unmount()}
})
