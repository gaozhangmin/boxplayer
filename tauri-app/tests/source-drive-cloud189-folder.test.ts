import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import NewFolder from '@/features/files/drive/electron/pan/topbtns/CreatNewDirModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {cloud189} from '@/features/sources/cloud189'
import {rawRequest,json} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'189-folder-ui',providerId:'189' as const,name:'Fixture',baseUrl:'https://api.cloud.189.cn',authOrigins:[]}
const personal=JSON.stringify({fileId:'-11'}),family=JSON.stringify({fileId:'',familyId:'9007199254740999'})
let created:boolean,denied:boolean
beforeEach(()=>{
 vi.resetAllMocks();created=false;denied=false
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(cloud189)
 vi.mocked(rawRequest).mockImplementation(async()=>{created=!denied;return {status:denied?403:200,headers:{},body:Array.from(new TextEncoder().encode('{"folderId":9007199254740997}')),finalUrl:''}})
 vi.mocked(json).mockImplementation(async()=>({fileListAO:{folderList:created?[{id:'9007199254740997',name:'Folder'}]:[],fileList:[]}}))
})
async function browser(parent:string){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await getDrivePane().load(account.id,parent,true);await flushPromises();return wrapper}
it.each([personal,family])('creates using the original dialog in scope %s and reloads the native identity',async parent=>{
 const wrapper=await browser(parent)
 try{
  expect(getDrivePane().operations.has('files.createFolder')).toBe(true)
  await wrapper.trigger('keydown',{key:'n',metaKey:true,shiftKey:true});await flushPromises()
  const modal=wrapper.getComponent(NewFolder);(modal.vm as any).form.dirName='Folder';(modal.vm as any).handleOK();await flushPromises()
  await vi.waitFor(()=>{expect(wrapper.findComponent(NewFolder).exists()).toBe(false);expect(getDrivePane().store.ListDataRaw).toHaveLength(1)})
  const row=getDrivePane().store.ListDataRaw[0]!,location=JSON.parse(parent)
  expect(row.icon).toBe('iconfile-folder');expect(row.parent_file_id).toBe(parent);expect(row.description).toBe('cloud189_id:'+(location.familyId?'cloud189_family:'+location.familyId+':':'')+'9007199254740997')
  expect(row.name).toBe('Folder');expect(row.isDir).toBe(true);expect(JSON.parse(row.file_id)).toEqual({fileId:'9007199254740997',...(location.familyId?{familyId:location.familyId}:{})})
  const url=new URL(vi.mocked(rawRequest).mock.calls[0]![2]);expect(url.pathname).toBe(location.familyId?'/family/file/createFolder.action':'/createFolder.action')
  expect(rawRequest).toHaveBeenCalledOnce()
 }finally{wrapper.unmount()}
})
it('keeps the same original form open after rejection and allows explicit retry',async()=>{
 denied=true;const wrapper=await browser(personal)
 try{
  await getDrivePane().action('createFolder',['folder']);await flushPromises()
  const modal=wrapper.getComponent(NewFolder);(modal.vm as any).form.dirName='Folder';(modal.vm as any).handleOK();await flushPromises()
  expect(wrapper.findComponent(NewFolder).exists()).toBe(true);expect(created).toBe(false)
  denied=false;(modal.vm as any).handleOK();await flushPromises()
  await vi.waitFor(()=>expect(wrapper.findComponent(NewFolder).exists()).toBe(false));expect(getDrivePane().store.ListDataRaw[0]?.name).toBe('Folder');expect(rawRequest).toHaveBeenCalledTimes(2)
 }finally{wrapper.unmount()}
})
