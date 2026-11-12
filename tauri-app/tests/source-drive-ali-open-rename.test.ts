import {beforeEach,it,expect,vi} from 'vitest'
import {mount,flushPromises} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import Rename from '@/features/files/drive/electron/pan/topbtns/RenameModal.vue'
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
const account={id:'ali-open-rename-ui',providerId:'alipan-open' as const,name:'Fixture',baseUrl:'',authOrigins:['https://openapi.alipan.com']},id=(fileId:string)=>JSON.stringify({driveId:'drive',fileId}),response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
let names:Record<string,string>,denied:string
beforeEach(()=>{
 vi.resetAllMocks();names={movie:'Old.mkv',other:'Other.mkv'};denied='';vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(alipan)
 vi.mocked(json).mockImplementation(async(_account,_method,url)=>url.endsWith('/getDriveInfo')?{resource_drive_id:'drive'}:{items:Object.entries(names).map(([file_id,name])=>({file_id,name,type:'file',size:42}))})
 vi.mocked(request).mockImplementation(async(_account,_method,url,body)=>{const input=JSON.parse(body!);if(url.endsWith('/update')){if(input.file_id===denied)return response({code:'AlreadyExists'});names[input.file_id]=input.name;return response({})}return response({file_id:input.file_id,drive_id:'drive',parent_file_id:'root',name:names[input.file_id],type:'file'})})
})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();await getDrivePane().load(account.id,id('root'),true);await flushPromises();return {wrapper,pinia}}
it('renames from the original single-file dialog and retains catalog ID, manual title and progress',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'video',sourceId:account.id,fileId:id('movie'),fileName:'Old.mkv',name:'Manual',metadataSource:'manual',progress:37}]},update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{expect(getDrivePane().operations.has('files.rename')).toBe(true);getDrivePane().store.mMouseSelect(id('movie'),false,false);await getDrivePane().action('rename',[]);await flushPromises();const modal=wrapper.getComponent(Rename);(modal.vm as any).form.fileName='New.mkv';(modal.vm as any).handleOK();await flushPromises();expect(wrapper.findComponent(Rename).exists()).toBe(false);expect(snapshot.items[0]).toMatchObject({id:'video',fileId:id('movie'),fileName:'New.mkv',name:'Manual',progress:37});expect(request).toHaveBeenCalledTimes(3)}finally{wrapper.unmount();update.mockRestore()}
})
it('returns only confirmed rows from the original batch command and preserves failed item metadata',async()=>{
 denied='other';const {wrapper,pinia}=await browser(),snapshot:any={items:Object.entries(names).map(([fileId,fileName])=>({id:fileId,sourceId:account.id,fileId:id(fileId),fileName,name:'Manual',metadataSource:'manual'}))},update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{const result=await getDrivePane().action('renameBatch',[account.id,account.id,[id('movie'),id('other')],['New.mkv','Another.mkv']]);expect(result.map((row:any)=>row.file_id)).toEqual([id('movie')]);expect(snapshot.items.map((row:any)=>row.fileName)).toEqual(['New.mkv','Other.mkv']);expect(vi.mocked(request).mock.calls.filter(call=>call[2].endsWith('/update'))).toHaveLength(2);expect(wrapper.text()).toContain('未确认重命名')}finally{wrapper.unmount();update.mockRestore()}
})
it('does not submit old rename work after switching source during preflight',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined);let finish!:(value:any)=>void
 vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve))
 try{const task=getDrivePane().action('renameBatch',[account.id,account.id,[id('movie')],['New.mkv']]);await flushPromises();const next={...account,id:'ali-open-next'};useFileSourcesStore(pinia).accounts.push(next);await wrapper.setProps({sourceId:next.id});await flushPromises();finish(response({file_id:'movie',drive_id:'drive',parent_file_id:'root',name:'Old.mkv',type:'file'}));expect(await task).toEqual([]);expect(request).toHaveBeenCalledTimes(1);expect(update).not.toHaveBeenCalled()}finally{wrapper.unmount();update.mockRestore()}
})
