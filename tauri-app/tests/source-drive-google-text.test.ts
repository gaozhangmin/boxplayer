import type {Account} from '@/features/sources/contracts'
import {beforeEach,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import TextModal from '@/features/files/drive/electron/pan/topbtns/CreatNewFileModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {nativeCall} from '@/platform/native'
import {json,request,rawRequest} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),rawRequest:vi.fn(),text:(data:{body:number[]})=>new TextDecoder().decode(new Uint8Array(data.body))}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'google-text-fixture',providerId:'google' as const,name:'Fixture',baseUrl:'',authOrigins:[]},content='中文🎬',response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[]}),resolve:vi.fn()});vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.includes('/created?')?{id:'created',name:'电影.txt',parents:['actual-root'],size:String(new TextEncoder().encode(content).length),mimeType:'application/octet-stream'}:{id:'actual-root',mimeType:'application/vnd.google-apps.folder'});vi.mocked(request).mockResolvedValue(response({id:'created'}))})
async function browser(source:Account=account){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[source];const wrapper=mount(SourceDriveManager,{props:{sourceId:source.id,name:source.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return wrapper}
it('does not expose Google Drive text creation',async()=>{
 const wrapper=await browser();try{
  expect(getDrivePane().operations.has('upload.memory')).toBe(false)
  expect(wrapper.findComponent(TextModal).exists()).toBe(false)
  expect(request).not.toHaveBeenCalled()
 }finally{wrapper.unmount()}
})

it('submits OneDrive text through the same original dialog without a transfer engine',async()=>{
 const source:Account={...account,providerId:'onedrive',id:'onedrive-text-fixture'}
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.includes('/created?')?{id:'created',name:'电影.txt',parentReference:{id:'actual-root'},size:new TextEncoder().encode(content).length,file:{}}:{id:'actual-root',folder:{}})
 const wrapper=await browser(source);try{expect(getDrivePane().operations.has('upload.memory')).toBe(true);await getDrivePane().action('createText',[]);await flushPromises();const modal=wrapper.getComponent(TextModal);(modal.vm as any).form.fileName='电影.txt';(modal.vm as any).form.fileContext=content;(modal.vm as any).formRef={validate:(callback:Function)=>callback()};(modal.vm as any).handleOK();await flushPromises();expect(request).toHaveBeenCalledWith(source,'PUT',expect.stringContaining('/me/drive/items/actual-root:'),content,{'Content-Type':'application/octet-stream'});expect(wrapper.findComponent(TextModal).exists()).toBe(false)}finally{wrapper.unmount()}
})

it('submits Dropbox text from the same original dialog with the original refuse semantics',async()=>{
 const source:Account={...account,providerId:'dropbox',id:'dropbox-text-fixture'}
 vi.mocked(rawRequest).mockResolvedValue(response({id:'id:created'}))
 vi.mocked(json).mockResolvedValue({id:'id:created','.tag':'file',name:'电影.txt',path_display:'/电影.txt',size:new TextEncoder().encode(content).length})
 const wrapper=await browser(source);try{expect(getDrivePane().operations.has('upload.memory')).toBe(true);await getDrivePane().action('createText',[]);await flushPromises();const modal=wrapper.getComponent(TextModal);(modal.vm as any).form.fileName='电影.txt';(modal.vm as any).form.fileContext=content;(modal.vm as any).formRef={validate:(callback:Function)=>callback()};(modal.vm as any).handleOK();await flushPromises();expect(rawRequest).toHaveBeenCalledWith(source,'POST','https://content.dropboxapi.com/2/files/upload',content,expect.objectContaining({'Dropbox-API-Arg':expect.any(String)}));expect(JSON.parse(vi.mocked(rawRequest).mock.calls[0]![4]!['Dropbox-API-Arg']!)).toMatchObject({mode:'add',autorename:false});expect(wrapper.findComponent(TextModal).exists()).toBe(false)}finally{wrapper.unmount()}
})

it('submits Box text through the original dialog and original multipart function',async()=>{
 const source:Account={...account,providerId:'box',id:'box-text-fixture'}
 vi.mocked(rawRequest).mockResolvedValue(response({entries:[{id:'123'}]}))
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.includes('/files/')?{id:'123',type:'file',name:'电影.txt',parent:{id:'0'},size:new TextEncoder().encode(content).length,item_status:'active'}:{id:'0',type:'folder'})
 const wrapper=await browser(source);try{expect(getDrivePane().operations.has('upload.memory')).toBe(true);await getDrivePane().action('createText',[]);await flushPromises();const modal=wrapper.getComponent(TextModal);(modal.vm as any).form.fileName='电影.txt';(modal.vm as any).form.fileContext=content;(modal.vm as any).formRef={validate:(callback:Function)=>callback()};(modal.vm as any).handleOK();await flushPromises();expect(rawRequest).toHaveBeenCalledWith(source,'POST','https://upload.box.com/api/2.0/files/content',expect.stringContaining(content),expect.objectContaining({'Content-Type':expect.stringContaining('multipart/form-data')}));expect(wrapper.findComponent(TextModal).exists()).toBe(false)}finally{wrapper.unmount()}
})



it('submits Guangya through the original text dialog and native IO while preserving the no-transfer seam',async()=>{
 const source:Account={...account,providerId:'guangya',id:'guangya-text-fixture',authOrigins:['https://api.guangyapan.com']}
 vi.mocked(nativeCall).mockImplementation(async(command,args:any)=>{if(command==='guangya_text_begin')return {handle:'fixture-upload',md5:'fixture-md5'};if(command==='guangya_text_close')return;if(command==='guangya_text_step'){if(args.action==='token')return {data:{taskId:'fixture-task'},error:''};if(args.action==='info')return {fileId:'created',uploading:false,error:''}}})
 vi.mocked(request).mockResolvedValue(response({code:0,data:{fileId:'created',name:'电影.txt',resType:'1',parentId:'',fileSize:new TextEncoder().encode(content).length}}))
 const wrapper=await browser(source);try{expect(getDrivePane().operations.has('upload.memory')).toBe(true);await getDrivePane().action('createText',[]);await flushPromises();const modal=wrapper.getComponent(TextModal);(modal.vm as any).form.fileName='电影.txt';(modal.vm as any).form.fileContext=content;(modal.vm as any).formRef={validate:(callback:Function)=>callback()};(modal.vm as any).handleOK();await flushPromises();expect(nativeCall).toHaveBeenCalledWith('guangya_text_begin',{request:{account:source,parent:'',name:'电影.txt',content}});expect(nativeCall).toHaveBeenCalledWith('guangya_text_close',{handle:'fixture-upload'});expect(wrapper.findComponent(TextModal).exists()).toBe(false);expect(vi.mocked(nativeCall).mock.calls.some(([command])=>String(command).startsWith('transfer_'))).toBe(false)}finally{wrapper.unmount()}
})
