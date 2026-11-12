import {beforeEach,expect,it,vi} from 'vitest'
import {createPinia} from 'pinia'
import {mount,flushPromises,DOMWrapper} from '@vue/test-utils'
import {defineComponent,h} from 'vue'
import SourceDriveManager from '@/features/files/drive/SourceDriveManager.vue'
import Rename from '@/features/files/drive/electron/pan/topbtns/RenameModal.vue'
import {getDrivePane} from '@/features/files/drive/ports'
import {useFileSourcesStore} from '@/stores/fileSources'
import {useVideoCatalog} from '@/features/library/catalog'
import {driver} from '@/features/sources/drivers'
import {cloud189} from '@/features/sources/cloud189'
import {rawRequest,json} from '@/features/sources/transport'
import {pendingCloud189RenameName} from '@/features/files/drive/cloud189Rename'
vi.mock('@/features/sources/drivers',()=>({driver:vi.fn(),playSource:vi.fn()}))
vi.mock('@/features/sources/transport',async original=>({...await original<typeof import('@/features/sources/transport')>(),rawRequest:vi.fn(),json:vi.fn()}))
vi.mock('@/platform/native',()=>({nativeCall:vi.fn(),asAppError:(cause:unknown)=>({message:cause instanceof Error?cause.message:String(cause)}),isNative:()=>false}))
const list=defineComponent({props:['data'],setup(props,{slots,expose}){expose({scrollIntoView:vi.fn()});return()=>h('div',(props.data||[]).map((item:unknown,index:number)=>slots.item?.({item,index})))}})
let account:any,actual:string,count=0,apply:boolean,denied:boolean
beforeEach(()=>{
 vi.resetAllMocks();actual='Old.mkv';apply=true;denied=false;account={id:'189-rename-ui-'+(++count),providerId:'189',name:'Fixture',baseUrl:'https://api.cloud.189.cn',authOrigins:[]}
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.mocked(driver).mockReturnValue(cloud189)
 vi.mocked(json).mockImplementation(async()=>({fileListAO:{folderList:[],fileList:[{id:'9007199254740997',name:actual,size:42}]}}))
 vi.mocked(rawRequest).mockImplementation(async()=>{if(apply&&!denied)actual='New.mkv';return {status:denied?403:200,headers:{},body:Array.from(new TextEncoder().encode('{}')),finalUrl:''}})
})
async function browser(family=false){const pinia=createPinia();useFileSourcesStore(pinia).accounts=[account];const wrapper=mount(SourceDriveManager,{props:{sourceId:account.id,name:account.name},global:{plugins:[pinia],stubs:{AList:list}},attachTo:document.body});await flushPromises();const parent=JSON.stringify({fileId:family?'':'-11',...(family?{familyId:'9007199254740999'}:{})});await getDrivePane().load(account.id,parent,true);await flushPromises();return {wrapper,pinia,parent}}
async function rename(wrapper:ReturnType<typeof mount>){await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('rename',[]);await flushPromises();const modal=wrapper.getComponent(Rename);(modal.vm as any).form.fileName='New.mkv';(modal.vm as any).handleOK();await flushPromises()}
it.each([false,true])('uses the original rename dialog and catalog sync in family=%s',async family=>{
 const {wrapper,pinia}=await browser(family),file=getDrivePane().store.ListDataRaw[0]!,snapshot:any={items:[{id:'video',sourceId:account.id,fileId:file.file_id,fileName:'Old.mkv',name:'Manual title',metadataSource:'manual',progress:37}]}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  expect(getDrivePane().operations.has('files.rename')).toBe(true);await rename(wrapper)
  expect(wrapper.findComponent(Rename).exists()).toBe(false);expect(getDrivePane().store.ListDataRaw[0]).toMatchObject({file_id:file.file_id,name:'New.mkv'})
  expect(snapshot.items[0]).toMatchObject({id:'video',fileId:file.file_id,fileName:'New.mkv',name:'Manual title',progress:37});expect(pendingCloud189RenameName(account.id,file.file_id)).toBeUndefined();expect(rawRequest).toHaveBeenCalledOnce()
 }finally{wrapper.unmount();update.mockRestore()}
})
it('repairs failed local catalog sync via the original rename entry without reposting',async()=>{
 const {wrapper,pinia}=await browser(),id=getDrivePane().store.ListDataRaw[0]!.file_id,snapshot:any={items:[{id:'video',sourceId:account.id,fileId:id,fileName:'Old.mkv',name:'Manual',metadataSource:'manual'}]}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture save denied')).mockImplementation(async mutate=>mutate(snapshot))
 try{
  await rename(wrapper);expect(wrapper.text()).toContain('同步失败');expect(pendingCloud189RenameName(account.id,id)).toBe('New.mkv')
  await getDrivePane().action('rename',[]);await flushPromises()
  expect(new DOMWrapper(document.body).get('#RenameInput').element).toHaveProperty('value','New.mkv');expect(snapshot.items[0]).toMatchObject({fileName:'New.mkv',name:'Manual'});expect(rawRequest).toHaveBeenCalledOnce();expect(update).toHaveBeenCalledTimes(2)
 }finally{wrapper.unmount();update.mockRestore()}
})
it('confirms an unknown result after refresh through the original rename entry even when the row already has its new name',async()=>{
 apply=false;const {wrapper,pinia}=await browser(),id=getDrivePane().store.ListDataRaw[0]!.file_id,update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{
  await rename(wrapper);expect(wrapper.findComponent(Rename).exists()).toBe(true);expect(pendingCloud189RenameName(account.id,id)).toBe('New.mkv')
  await getDrivePane().action('closeDialog',[]);actual='New.mkv';await getDrivePane().load(account.id,'refresh',false);await flushPromises()
  await wrapper.get('.fileitem').trigger('click');await getDrivePane().action('rename',[]);await flushPromises()
  expect(new DOMWrapper(document.body).get('#RenameInput').element).toHaveProperty('value','New.mkv');expect(pendingCloud189RenameName(account.id,id)).toBeUndefined();expect(rawRequest).toHaveBeenCalledOnce();expect(update).toHaveBeenCalledOnce()
 }finally{wrapper.unmount();update.mockRestore()}
})
it('allows explicit retry in the same original modal after definite refusal',async()=>{
 denied=true;const {wrapper,pinia}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockResolvedValue(undefined)
 try{
  await rename(wrapper);expect(wrapper.findComponent(Rename).exists()).toBe(true);expect(update).not.toHaveBeenCalled()
  denied=false;const modal=wrapper.getComponent(Rename);(modal.vm as any).handleOK();await flushPromises()
  expect(wrapper.findComponent(Rename).exists()).toBe(false);expect(rawRequest).toHaveBeenCalledTimes(2);expect(update).toHaveBeenCalledOnce()
 }finally{wrapper.unmount();update.mockRestore()}
})

it('synchronizes only confirmed rows after a partial original batch rename',async()=>{
 const names:Record<string,string>={'100':'Old.mkv','200':'Other.mkv'}
 vi.mocked(json).mockImplementation(async()=>({fileListAO:{folderList:[],fileList:Object.entries(names).map(([id,name])=>({id,name,size:42}))}}))
 vi.mocked(rawRequest).mockImplementation(async(_account,_method,raw)=>{
  const id=new URL(raw).searchParams.get('fileId')!
  if(id==='100')names[id]='New.mkv'
  return {status:id==='100'?200:409,headers:{},body:Array.from(new TextEncoder().encode('{}')),finalUrl:''}
 })
 const {wrapper,pinia}=await browser(),rows=getDrivePane().store.ListDataRaw,snapshot:any={items:rows.map((row,index)=>({id:'video-'+index,sourceId:account.id,fileId:row.file_id,fileName:row.name,name:'Manual-'+index,metadataSource:'manual',progress:31}))}
 const update=vi.spyOn(useVideoCatalog(pinia),'update').mockImplementation(async mutate=>mutate(snapshot))
 try{
  const result=await getDrivePane().action('renameBatch',[account.id,account.id,rows.map(row=>row.file_id),['New.mkv','Another.mkv']])
  expect(result.map((row:any)=>row.file_id)).toEqual([rows[0]!.file_id]);expect(snapshot.items.map((item:any)=>item.fileName)).toEqual(['New.mkv','Other.mkv']);expect(snapshot.items.map((item:any)=>item.name)).toEqual(['Manual-0','Manual-1']);expect(wrapper.text()).toContain('拒绝重命名');expect(rawRequest).toHaveBeenCalledTimes(2)
 }finally{wrapper.unmount();update.mockRestore()}
})

it('does not reopen or write the old recovery dialog after switching to another account with the same file ID',async()=>{
 const {wrapper,pinia,parent}=await browser(),update=vi.spyOn(useVideoCatalog(pinia),'update').mockRejectedValueOnce(Error('fixture sync denied'))
 try{
  await rename(wrapper);expect(pendingCloud189RenameName(account.id,getDrivePane().store.ListDataRaw[0]!.file_id)).toBe('New.mkv')
  let finish!:(value:any)=>void;vi.mocked(json).mockImplementationOnce(()=>new Promise(resolve=>finish=resolve))
  const recovery=getDrivePane().action('rename',[]);await flushPromises()
  const second={...account,id:account.id+'-second'};useFileSourcesStore(pinia).accounts.push(second)
  vi.mocked(json).mockImplementation(async()=>({fileListAO:{folderList:[],fileList:[{id:'9007199254740997',name:'Other-account.mkv',size:42}]}}))
  await wrapper.setProps({sourceId:second.id});await flushPromises();await getDrivePane().load(second.id,parent,true);await flushPromises()
  finish({fileListAO:{folderList:[],fileList:[{id:'9007199254740997',name:'New.mkv',size:42}]}});await recovery;await flushPromises()
  expect(wrapper.findComponent(Rename).exists()).toBe(false);expect(getDrivePane().store.ListDataRaw[0]?.name).toBe('Other-account.mkv');expect(rawRequest).toHaveBeenCalledOnce()
 }finally{wrapper.unmount();update.mockRestore()}
})
