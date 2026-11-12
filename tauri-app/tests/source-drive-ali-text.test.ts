import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import TextModal from '@/features/files/drive/electron/pan/topbtns/CreatNewFileModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {alipan} from '@/features/sources/alipan'
import {json} from '@/features/sources/transport'
import {nativeCall} from '@/platform/native'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),request:vi.fn(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'ali-text-ui',providerId:'aliyun' as const,name:'Fixture',baseUrl:'https://api.aliyundrive.com',userId:'fixture-user',deviceId:'fixture-device',authOrigins:['https://api.aliyundrive.com','https://user.aliyundrive.com']},id=(driveId:string,fileId:string)=>JSON.stringify({driveId,fileId}),content='中文🎬'
let created=false,wrapper:ReturnType<typeof mount>|undefined
function receipt(request:any){return {schemaVersion:1,accountId:account.id,driveId:request.driveId,parentId:request.parentId,fileId:'new',name:request.name,size:new TextEncoder().encode(request.content).length}}
beforeEach(()=>{vi.resetAllMocks();created=false;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(alipan);vi.mocked(json).mockImplementation(async(_account,_method,url,body:any)=>url.endsWith('/v2/user/get')?{resource_drive_id:'resource',backup_drive_id:'backup'}:{items:created?[{file_id:'new',drive_id:body.drive_id,parent_file_id:'root',name:'电影.txt',type:'file',size:new TextEncoder().encode(content).length}]:[]});vi.mocked(nativeCall).mockImplementation(async(command,args:any)=>{if(command==='ali_text_create'){created=true;return receipt(args.request)}return true})})
afterEach(()=>{wrapper?.unmount();wrapper=undefined;vi.restoreAllMocks()})
async function browser(drive='resource'){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();if(drive)await getDrivePane().load(account.id,id(drive,'root'),true);await flushPromises();return wrapper}
it.each(['resource','backup'])('uses the unchanged original text dialog in the physical %s drive',async drive=>{
 await browser(drive);expect(getDrivePane().operations.has('upload.memory')).toBe(true);await wrapper!.trigger('keydown',{key:'n',metaKey:true});await flushPromises();const modal=wrapper!.getComponent(TextModal);(modal.vm as any).form.fileName='电影.txt';(modal.vm as any).form.fileContext=content;(modal.vm as any).formRef={validate:(callback:Function)=>callback()};(modal.vm as any).handleOK();await flushPromises();expect(wrapper!.findComponent(TextModal).exists()).toBe(false)
 expect(nativeCall).toHaveBeenCalledWith('ali_text_create',{request:expect.objectContaining({requestId:expect.any(String),account,driveId:drive,parentId:'root',name:'电影.txt',content})});expect(getDrivePane().store.ListDataRaw[0]?.file_id).toBe(id(drive,'new'))
})
it('retains text input and permits explicit retry after native failure',async()=>{
 await browser();vi.mocked(nativeCall).mockRejectedValueOnce(Error('upload failed'));await getDrivePane().action('createText',[]);await flushPromises();const modal=wrapper!.getComponent(TextModal);(modal.vm as any).form.fileName='电影.txt';(modal.vm as any).form.fileContext=content;(modal.vm as any).formRef={validate:(callback:Function)=>callback()};(modal.vm as any).handleOK();await flushPromises();expect(wrapper!.findComponent(TextModal).exists()).toBe(true);expect((modal.vm as any).form.fileContext).toBe(content);expect(created).toBe(false)
 ;(modal.vm as any).handleOK();await flushPromises();expect(wrapper!.findComponent(TextModal).exists()).toBe(false)
})
it('rejects a mismatched native receipt instead of closing the original dialog',async()=>{
 await browser();vi.mocked(nativeCall).mockImplementationOnce(async(_command,args:any)=>({...receipt(args.request),parentId:'other'}));await getDrivePane().action('createText',[]);await flushPromises();const modal=wrapper!.getComponent(TextModal);(modal.vm as any).form.fileName='电影.txt';(modal.vm as any).form.fileContext=content;(modal.vm as any).formRef={validate:(callback:Function)=>callback()};(modal.vm as any).handleOK();await flushPromises();expect(wrapper!.findComponent(TextModal).exists()).toBe(true);expect(created).toBe(false)
})
it.each(['dialog','unmount','identity','source'])('cancels native work when the %s scope closes or changes and ignores late success',async kind=>{
 await browser();await getDrivePane().action('createText',[]);let finish!:(value:any)=>void,request:any;vi.mocked(nativeCall).mockImplementation(async(command,args:any)=>{if(command==='ali_text_create'){request=args.request;return await new Promise(resolve=>{finish=resolve})}return true})
 const task=getDrivePane().action('createTextDirect',[account.id,account.id,id('resource','root'),'电影.txt',content]),outcome=task.then(()=>null,error=>error);await flushPromises()
 if(kind==='dialog')await getDrivePane().action('closeDialog',[]);else if(kind==='unmount'){wrapper!.unmount();wrapper=undefined}else if(kind==='source'){const next={...account,id:'ali-text-next'};useFileSourcesStore().accounts.push(next);await wrapper!.setProps({sourceId:next.id})}else useFileSourcesStore().accounts=[{...account,userId:'other-user'}]
 await flushPromises();expect(nativeCall).toHaveBeenCalledWith('ali_text_cancel',{requestId:request.requestId,accountId:account.id});finish(receipt(request));expect(await outcome).toBeInstanceOf(Error);expect(created).toBe(false)
})
it('does not create in the synthetic account root without an actual drive identity',async()=>{
 await browser('');await expect(getDrivePane().action('createTextDirect',[account.id,account.id,'backup_root','电影.txt',content])).rejects.toThrow();expect(vi.mocked(nativeCall).mock.calls.some(call=>call[0]==='ali_text_create')).toBe(false)
})
