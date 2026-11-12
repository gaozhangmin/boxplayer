import {beforeEach,describe,it,expect,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import {message} from '@/features/files/drive/ports'
import {useVideoCatalog} from '@/features/library/catalog'
import NewFolder from '@/features/files/drive/electron/pan/topbtns/CreatNewDirModal.vue'
import Rename from '@/features/files/drive/electron/pan/topbtns/RenameModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {request} from '@/features/sources/transport'
import {guangya} from '@/features/sources/guangya'
import {mapGuangyaFileToAliModel} from '@/features/files/drive/electron/providers/guangyaMetadata'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',()=>({json:vi.fn(),request:vi.fn(),text:(response:{body:number[]})=>new TextDecoder().decode(new Uint8Array(response.body)),playable:(name:string)=>name.endsWith('.mkv')}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
const account={id:'source',providerId:'guangya' as const,name:'Fixture',baseUrl:'',authOrigins:[]},response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let names:Record<string,string>,deny=false
beforeEach(()=>{vi.resetAllMocks();names={file:'Old.mkv'};deny=false;vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue({list:vi.fn().mockImplementation(async()=>({entries:Object.entries(names).map(([id,name])=>({id,name,isDirectory:id==='new',size:1,playable:id!=='new'}))})),resolve:vi.fn()});vi.mocked(request).mockImplementation(async(_account,_method,url,body)=>{const requestBody=JSON.parse(body||'{}');if(url.endsWith('/create_dir')){if(deny)return response({code:403});names.new=requestBody.dirName;return response({code:0,data:{fileId:'new',resType:2}})}if(url.endsWith('/rename')){if(deny)return response({code:403});names.file=requestBody.newName;return response({code:0,data:{}})}const id=requestBody.fileId;return response({code:0,data:{fileId:id,name:names[id],resType:id==='new'?2:1,parentId:''}})})})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
describe('Guangya native commands in original source dialogs',()=>{
 it('creates through original folder form then reloads the original source list',async()=>{const {wrapper}=await browser();try{await getDrivePane().action('createFolder',['folder']);await flushPromises();const modal=wrapper.getComponent(NewFolder);(modal.vm as any).form.dirName='Folder';(modal.vm as any).handleOK();await flushPromises();expect(request).toHaveBeenCalledTimes(2);expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='new'&&row.name==='Folder'&&row.isDir)).toBe(true);expect(wrapper.findComponent(NewFolder).exists()).toBe(false)}finally{wrapper.unmount()}});
 it('renames through original form and synchronizes confirmed catalog names',async()=>{const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined);try{await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('rename',[]);await flushPromises();const modal=wrapper.getComponent(Rename);(modal.vm as any).form.fileName='New.mkv';(modal.vm as any).handleOK();await flushPromises();expect(getDrivePane().store.ListDataRaw[0]?.name).toBe('New.mkv');expect(update).toHaveBeenCalledOnce();expect(wrapper.findComponent(Rename).exists()).toBe(false)}finally{update.mockRestore();wrapper.unmount()}});
 it('keeps the original folder form open on a rejected create',async()=>{deny=true;const {wrapper}=await browser();try{await getDrivePane().action('createFolder',['folder']);await flushPromises();const modal=wrapper.getComponent(NewFolder);(modal.vm as any).form.dirName='Folder';(modal.vm as any).handleOK();await flushPromises();expect(wrapper.findComponent(NewFolder).exists()).toBe(true);expect(names.new).toBeUndefined();expect(request).toHaveBeenCalledOnce()}finally{wrapper.unmount()}});
 it('does not show a stale create failure after the source and dialog close',async()=>{const {wrapper,pinia}=await browser();let done!:(value:any)=>void;const error=vi.spyOn(message,'error').mockImplementation(()=>undefined as any);vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>done=resolve));try{await getDrivePane().action('createFolder',['folder']);await flushPromises();const modal=wrapper.getComponent(NewFolder);(modal.vm as any).form.dirName='Folder';(modal.vm as any).handleOK();await flushPromises();useFileSourcesStore(pinia).accounts.push({...account,id:'other'});await wrapper.setProps({sourceId:'other'});await flushPromises();done(response({error:'denied',error_description:'Provider denied'}));await flushPromises();expect(error).not.toHaveBeenCalled();expect(getDrivePane().store.ListDataRaw.map(row=>row.name)).toEqual(['Old.mkv'])}finally{error.mockRestore();wrapper.unmount()}});
})

it('passes the original Guangya model into the original list store and normalizes only root view identity',async()=>{const item={fileId:'original',name:'电影.mkv',resType:1,dirType:1,fileSize:123,thumbnailUrl:'https://fixture.test/cover',md5:'original-hash'};vi.mocked(driver).mockReturnValue(guangya);vi.mocked(request).mockResolvedValue(response({code:0,data:{list:[item]}}));const {wrapper}=await browser();try{await vi.waitFor(()=>expect(getDrivePane().store.ListDataRaw).toHaveLength(1));expect(getDrivePane().store.ListDataRaw[0]).toEqual({...mapGuangyaFileToAliModel(item,account.id,'guangya_root'),parent_file_id:'',category:'video'});expect(request).toHaveBeenCalledTimes(1)}finally{wrapper.unmount()}})

it('uses the original move action with Guangya capability and confirms the destination before returning success',async()=>{
 names.target='Target'
 vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[{id:'file',name:'Old.mkv',isDirectory:false,size:1,playable:true},{id:'target',name:'Target',isDirectory:true,size:0,playable:false}]}),resolve:vi.fn()})
 let moved=false
 vi.mocked(request).mockImplementation(async(_account,_method,url,body)=>{if(url.endsWith('/move_file')){moved=true;return response({code:0,data:{}})}const id=JSON.parse(body||'{}').fileId;return response({code:0,data:id==='target'?{fileId:id,name:'Target',resType:2,parentId:''}:{fileId:id,name:'Old.mkv',resType:1,parentId:moved?'target':''}})})
 const {wrapper}=await browser();try{expect(getDrivePane().operations.has('files.move')).toBe(true);expect(getDrivePane().operations.has('files.copy')).toBe(true);expect(await getDrivePane().action('moveBatch',[account.id,account.id,['file'],account.id,'target'])).toEqual(['file']);expect(moved).toBe(true);expect(request).toHaveBeenCalledTimes(3)}finally{wrapper.unmount()}
})

it('keeps the source item after the original copy action confirms a new target entry',async()=>{
 vi.mocked(driver).mockReturnValue({list:vi.fn().mockResolvedValue({entries:[{id:'file',name:'Old.mkv',isDirectory:false,size:1,playable:true},{id:'target',name:'Target',isDirectory:true,size:0,playable:false}]}),resolve:vi.fn()})
 let copied=false
 vi.mocked(request).mockImplementation(async(_account,_method,url)=>{if(url.endsWith('/copy_file')){copied=true;return response({code:0,data:{}})}if(url.endsWith('/get_file_list'))return response({code:0,data:{list:copied?[{fileId:'new-copy',name:'Old.mkv',resType:1,size:1,parentId:'target'}]:[]}});return response({code:0,data:{fileId:'target',name:'Target',resType:2,parentId:''}})})
 const {wrapper}=await browser();try{expect(await getDrivePane().action('copyBatch',[account.id,account.id,['file'],account.id,'target'])).toEqual(['file']);expect(getDrivePane().store.ListDataRaw.some(row=>row.file_id==='file')).toBe(true);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/copy_file'))).toHaveLength(1)}finally{wrapper.unmount()}
})

it('routes original trashBatch through Guangya recycle capability without exposing recycle management',async()=>{
 vi.mocked(request).mockResolvedValue(response({code:0,data:{}}))
 const {wrapper}=await browser();try{expect(getDrivePane().operations.has('trash.move')).toBe(true);expect(getDrivePane().operations.has('trash.list')).toBe(false);expect(await getDrivePane().action('trashBatch',[account.id,account.id,['file']])).toEqual(['file']);expect(request).toHaveBeenCalledWith(account,'POST','https://api.guangyapan.com/nd.bizuserres.s/v1/file/delete_file','{"fileIds":["file"]}',{'Content-Type':'application/json'})}finally{wrapper.unmount()}
})

it('routes original browser search navigation through the original Guangya search model',async()=>{
 vi.mocked(driver).mockReturnValue(guangya)
 vi.mocked(request).mockImplementation(async(_account,_method,_url,body)=>response({code:0,data:{list:JSON.parse(body||'{}').parentId==='*'?[{fileId:'result',name:'Movie.mkv',resType:1,fileSize:42,parentId:'parent',thumbnailUrl:'https://fixture.test/poster'}]:[]}}))
 const {wrapper}=await browser();try{expect(getDrivePane().operations.has('files.search')).toBe(true);await getDrivePane().load(account.id,'searchMovie',true);expect(getDrivePane().store.ListDataRaw).toHaveLength(1);expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:'result',drive_id:account.id,parent_file_id:'parent',name:'Movie.mkv',thumbnail:'https://fixture.test/poster',description:'guangya_id:result'});expect(getDrivePane().store.DirID).toBe('search:Movie')}finally{wrapper.unmount()}
})

it('renders live Guangya metadata in the original properties modal and copies the public projection',async()=>{
 const {wrapper}=await browser(),copy=vi.fn().mockResolvedValue(undefined)
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}})
 vi.mocked(request).mockResolvedValue(response({code:0,data:{fileId:'file',name:'Actual.mkv',resType:1,dirType:1,parentId:'',fileSize:4096,md5:'fixture-md5',createAt:'2026-11-01T00:00:00Z',private_token:'fixture-hidden'}}))
 try{
  await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('properties',[]);await flushPromises()
  const modal=new DOMWrapper(document.body).get('.source-drive-dialog.shuxingmodal');expect(modal.text()).toContain('Actual.mkv')
  await modal.findAll('button').find(button=>button.text()==='复制JSON')!.trigger('click');await flushPromises()
  const value=copy.mock.calls.at(-1)![0];expect(JSON.parse(value)).toMatchObject({file_id:'file',drive_id:account.id,size:4096,name:'Actual.mkv',content_hash:'fixture-md5',content_hash_name:'md5',created_at:'2026-11-01T00:00:00.000Z'});expect(value).not.toContain('fixture-hidden')
 }finally{wrapper.unmount()}
})

it('shows verified Guangya descendant totals in the original property controls',async()=>{
 const folder={fileId:'folder',name:'Folder',resType:2,dirType:1,parentId:'',fileSize:999}
 vi.mocked(driver).mockReturnValue(guangya)
 vi.mocked(request).mockImplementation(async(_account,_method,url,body)=>{
  const input=JSON.parse(body||'{}')
  if(url.endsWith('/get_file_detail'))return response({code:0,data:folder})
  const rows=input.parentId===''?[folder]:input.parentId==='folder'?[{fileId:'first',name:'First.mkv',resType:1,parentId:'folder',fileSize:10},{fileId:'sub',name:'Sub',resType:2,parentId:'folder',fileSize:0}]:[{fileId:'nested',name:'Nested.mkv',resType:1,parentId:'sub',fileSize:20}]
  return response({code:0,data:{list:rows}})
 })
 const {wrapper}=await browser()
 try{
  await vi.waitFor(()=>expect(getDrivePane().store.ListDataRaw).toHaveLength(1));await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('properties',[]);await flushPromises()
  const modal=new DOMWrapper(document.body).get('.source-drive-dialog.shuxingmodal')
  await vi.waitFor(()=>{const values=modal.findAll('input').map(input=>(input.element as HTMLInputElement).value);expect(values).toContain('子文件大小：30.00B，子文件：2个，子文件夹：1个');expect(values).toContain('30.00B')})
 }finally{wrapper.unmount()}
})
