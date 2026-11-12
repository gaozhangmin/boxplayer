import {beforeEach,expect,it,vi} from 'vitest'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {createPinia} from 'pinia'
import {defineComponent,h} from 'vue'
import {useVideoCatalog} from '@/features/library/catalog'
import {apiCloud123RenameBatch} from '@/features/files/drive/batchRenamePorts'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import RenameMulti from '@/features/files/drive/electron/pan/topbtns/RenameMultiModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {driver} from '@/features/sources/drivers'
import {cloud123} from '@/features/sources/cloud'
import {json,request} from '@/features/sources/transport'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),json:vi.fn(),request:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),isNative:()=>false,asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)})}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})

const account={id:'123-rename-host',providerId:'123' as const,name:'Fixture',baseUrl:'',authOrigins:[]}
let names:Record<string,string>,deny:string
const response=(data:unknown)=>({status:200,headers:{},body:Array.from(new TextEncoder().encode(JSON.stringify(data))),finalUrl:''})
beforeEach(()=>{vi.resetAllMocks();names={'12':'Old.mkv','13':'Other.mkv'};deny='';vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(cloud123);vi.mocked(json).mockImplementation(async()=>({code:0,data:{fileList:Object.entries(names).map(([fileId,filename])=>({fileId:Number(fileId),parentFileId:0,filename,type:0,size:42})),lastFileId:-1}}));vi.mocked(request).mockImplementation(async(_a,method,url,body)=>{if(url.endsWith('/rename')){for(const value of JSON.parse(body!).renameList){const [id,name]=value.split('|');if(id!==deny)names[id]=name}return response({code:0})}const id=method==='GET'?new URL(url).searchParams.get('fileID')!:String(JSON.parse(body!).fileId);if(method==='PUT'){if(id===deny)return response({code:403});names[id]=JSON.parse(body!).fileName}return response({code:0,data:{fileId:Number(id),parentFileId:0,filename:names[id],type:0,trashed:0}})})})
async function browser(){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();return {wrapper,pinia}}
it('keeps failed 123 batch items out of catalog updates and preserves manual titles/progress',async()=>{
 deny='13';const {wrapper,pinia}=await browser(),snapshot:any={items:[{id:'stable',sourceId:account.id,fileId:'12',fileName:'Old.mkv',name:'Manual',metadataSource:'manual',progress:37}]},update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{expect(await apiCloud123RenameBatch(account.id,['12','13'],['New.mkv','Another.mkv'])).toEqual([{file_id:'12',parent_file_id:'',name:'New.mkv',isDir:false}]);expect(snapshot.items[0]).toMatchObject({id:'stable',fileName:'New.mkv',name:'Manual',progress:37});expect(names['13']).toBe('Other.mkv')}finally{wrapper.unmount();update.mockRestore()}
})
it('keeps a catalog failure retryable without issuing a second remote rename',async()=>{
 const {wrapper,pinia}=await browser(),snapshot:any={items:[{sourceId:account.id,fileId:'12',fileName:'Old.mkv',name:'Manual'}]},update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture save denied')).mockImplementation(async mutate=>mutate(snapshot))
 try{expect(await apiCloud123RenameBatch(account.id,['12'],['New.mkv'])).toEqual([]);expect(getDrivePane().store.ListDataRaw.find(row=>row.file_id==='12')!.name).toBe('Old.mkv');expect(await apiCloud123RenameBatch(account.id,['12'],['New.mkv'])).toHaveLength(1);expect(vi.mocked(request).mock.calls.filter(row=>row[2].endsWith('/rename'))).toHaveLength(1);expect(snapshot.items[0].fileName).toBe('New.mkv')}finally{wrapper.unmount();update.mockRestore()}
})
it('stops remaining requests and catalog writes when the owning dialog closes during preflight',async()=>{
 const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined);let finish!:(value:any)=>void
 try{await getDrivePane().action('rename',[false]);await flushPromises();vi.mocked(request).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const task=apiCloud123RenameBatch(account.id,['12','13'],['New.mkv','Another.mkv']);await flushPromises();await getDrivePane().action('closeDialog',[]);finish(response({code:0,data:{fileId:12,parentFileId:0,filename:'Old.mkv',type:0}}));expect(await task).toEqual([]);expect(request).toHaveBeenCalledTimes(1);expect(update).not.toHaveBeenCalled()}finally{wrapper.unmount();update.mockRestore()}
})

it('runs the original batch modal preview/submit and retains only failed checked rows for retry',async()=>{
 deny='13';const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate({items:[]} as any))
 try{
  getDrivePane().store.mMouseSelect('12',false,false);getDrivePane().store.mMouseSelect('13',true,false);await getDrivePane().action('rename',[false,true]);await flushPromises()
  const modal=wrapper.getComponent(RenameMulti),state=(modal.vm as any).$.setupState
  state.renameConfig.replace.search='mkv';state.renameConfig.replace.newword='mp4';state.renameConfig.replace.applyto='full'
  state.handleOK('');await flushPromises()
  expect(names['12']).toBe('Old.mp4');expect(names['13']).toBe('Other.mkv');expect(wrapper.findComponent(RenameMulti).exists()).toBe(true);expect(state.treeCheckedKeys.checked).toEqual(['13'])
  deny='';state.handleOK('');await flushPromises();expect(names['13']).toBe('Other.mp4');expect(wrapper.findComponent(RenameMulti).exists()).toBe(false)
  expect(vi.mocked(request).mock.calls.filter(row=>row[2].endsWith('/rename')).map(row=>JSON.parse(row[3]!).renameList)).toEqual([['12|Old.mp4','13|Other.mp4'],['13|Other.mp4']])
 }finally{wrapper.unmount();update.mockRestore()}
})
